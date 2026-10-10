/**
 * Studio package: everything needed to understand, re-render and continue a film.
 * Also imports a package as a new project, so the next film starts from this base.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { FilmSchema } from "@/lib/engine";
import { productionMarkdown, shotListMarkdown, styleMarkdown } from "@/lib/studio/markdown";
import { AssetSchema, BeatSchema, BriefSchema, ProductionDocSchema, StyleGuideSchema, type Asset, type ProjectMeta } from "@/lib/studio/types";
import { z } from "zod";
import { latestSheet } from "@/lib/studio/gates";
import { loadState } from "./studio";
import { createProject, docs, exists, getMeta, HttpError, projectPath, save, saveFilm, saveMeta, writeFileAtomic, writeJSON } from "./store";

const ENGINE_DIR = path.join(process.cwd(), "lib", "engine");

const README = (meta: ProjectMeta) => `# ${meta.name} — Studio package

This folder is the complete, inspectable source of the film.

| File | What it is |
|------|------------|
| \`brief.json\` | Director's Brief: the user's facts and constraints |
| \`production.md\` / \`.json\` | Approved production document |
| \`style.md\` / \`style.json\` | Style notes, palette, typography, asset notes |
| \`shotlist.md\` / \`beats.json\` | Beats, states and shot list (the contract) |
| \`film.json\` | Film program: a pure function of the frame number |
| \`revisions.json\` + \`revisions/\` | Every program revision and what changed |
| \`flags.json\` | Review flags and how they were resolved |
| \`assets/\` + \`assets.json\` | The real, confirmed assets |
| \`contact-sheets/\` | Contact sheets reviewed before export |
| \`exports/\` | Rendered MP4s |
| \`engine/\` | Renderer source (TypeScript, Canvas 2D) |

## Re-render

\`\`\`bash
# From a Studio checkout:
npm run render -- --package ./this-folder --format 16:9 --out film.mp4
npm run render -- --package ./this-folder --frame 120 --out frame.png
\`\`\`

## Start the next film

Import this zip on the Studio home page ("Start from a package"). The brief, assets, style and
motion rules carry over; beats, program and review start fresh.
`;

export async function buildPackage(id: string): Promise<{ filename: string; data: Buffer }> {
  const state = await loadState(id);
  const { meta, brief, production, assets, style, beats, film, flags } = state;
  const zip = new JSZip();
  const root = zip.folder(meta.id)!;
  root.file("README.md", README(meta));
  root.file("studio.json", JSON.stringify({ kind: "studio-package", version: 1, project: meta, exportedAt: new Date().toISOString() }, null, 2));
  if (brief) root.file("brief.json", JSON.stringify(brief, null, 2));
  if (brief && production) {
    root.file("production.json", JSON.stringify(production, null, 2));
    root.file("production.md", productionMarkdown(brief, production));
  }
  if (style) {
    root.file("style.json", JSON.stringify(style, null, 2));
    root.file("style.md", styleMarkdown(style, assets));
  }
  if (beats) {
    root.file("beats.json", JSON.stringify({ beats }, null, 2));
    root.file("shotlist.md", shotListMarkdown(beats, film, assets));
  }
  if (film) root.file("film.json", JSON.stringify(film, null, 2));
  root.file("flags.json", JSON.stringify(flags, null, 2));
  root.file("revisions.json", JSON.stringify(await docs.revisions(id), null, 2));
  for (let r = 1; r <= meta.filmRevision; r++) {
    const p = projectPath(id, "revisions", `film-${r}.json`);
    if (await exists(p)) root.file(`revisions/film-${r}.json`, await fs.readFile(p));
  }
  const confirmed = assets.filter((a) => a.confirmed);
  root.file("assets.json", JSON.stringify(confirmed, null, 2));
  for (const a of confirmed) root.file(`assets/${a.filename}`, await fs.readFile(projectPath(id, "assets", a.filename)));

  for (const format of ["16:9", "9:16"] as const) {
    const sheet = latestSheet(state, format);
    if (!sheet) continue;
    const dirName = `${String(sheet.revision).padStart(3, "0")}-${format.replace(":", "x")}`;
    const dir = projectPath(id, "sheets", dirName);
    const out = root.folder(`contact-sheets/${dirName}`)!;
    out.file("sheet.json", JSON.stringify(sheet, null, 2));
    for (const f of [...sheet.composites, ...sheet.frames.map((x) => x.file)]) out.file(f, await fs.readFile(path.join(dir, f)));
  }
  for (const e of await docs.exports(id)) {
    const p = projectPath(id, "exports", e.file);
    if (await exists(p)) root.file(`exports/${e.file}`, await fs.readFile(p));
  }
  for (const f of await fs.readdir(ENGINE_DIR)) {
    if (f.endsWith(".ts")) root.file(`engine/${f}`, await fs.readFile(path.join(ENGINE_DIR, f)));
  }
  const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { filename: `${meta.id}-studio-package.zip`, data };
}

/** New project carrying brand, assets, style and motion rules from an existing one. */
export async function forkProject(id: string, name?: string) {
  const state = await loadState(id);
  const meta = await createProject(name || `${state.meta.name} (next)`, { parentProject: id });
  if (state.brief) await save.brief(meta.id, { ...state.brief, memoryGoal: "", notes: "" });
  const assets = state.assets.filter((a) => a.confirmed);
  for (const a of assets) await fs.copyFile(projectPath(id, "assets", a.filename), projectPath(meta.id, "assets", a.filename));
  await save.assets(meta.id, assets);
  if (state.style) await save.style(meta.id, state.style);
  if (state.film) await writeJSON(projectPath(meta.id, "base-motion.json"), state.film.motion);
  return meta;
}

export async function importPackage(buffer: Buffer) {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new HttpError(400, "Not a zip file.");
  }
  const manifestEntry = Object.values(zip.files).find((f) => f.name.endsWith("studio.json") && f.name.split("/").length <= 2);
  if (!manifestEntry) throw new HttpError(400, "Not a Studio package (studio.json missing).");
  const prefix = manifestEntry.name.slice(0, -"studio.json".length);
  const read = async (name: string) => zip.file(prefix + name)?.async("string");
  const manifest = z.object({ kind: z.literal("studio-package"), project: z.object({ name: z.string() }) }).parse(JSON.parse((await read("studio.json"))!));

  const meta = await createProject(manifest.project.name, {});
  try {
    const parseOpt = async <T>(name: string, schema: z.ZodType<T>) => {
      const raw = await read(name);
      return raw ? schema.parse(JSON.parse(raw)) : null;
    };
    const brief = await parseOpt("brief.json", BriefSchema);
    const production = await parseOpt("production.json", ProductionDocSchema);
    const style = await parseOpt("style.json", StyleGuideSchema);
    const beats = await parseOpt("beats.json", z.object({ beats: z.array(BeatSchema) }));
    const film = await parseOpt("film.json", FilmSchema);
    const assets = (await parseOpt("assets.json", z.array(AssetSchema))) ?? [];

    const kept: Asset[] = [];
    for (const a of assets) {
      if (!/^[a-z0-9-]+\.[a-z0-9]{1,6}$/i.test(a.filename)) continue;
      const file = zip.file(`${prefix}assets/${a.filename}`);
      if (!file) continue;
      await writeFileAtomic(projectPath(meta.id, "assets", a.filename), await file.async("nodebuffer"));
      kept.push({ ...a, source: "package" });
    }
    await save.assets(meta.id, kept);
    if (brief) await save.brief(meta.id, brief);
    if (production) await save.production(meta.id, production);
    if (style) await save.style(meta.id, style);
    if (beats) await save.beats(meta.id, beats.beats);
    const fresh = await getMeta(meta.id);
    if (film) await saveFilm(fresh, film, { source: "manual", summary: "Imported from package.", changes: ["Program imported from a Studio package."] });
    return await saveMeta(await getMeta(meta.id));
  } catch (e) {
    await fs.rm(projectPath(meta.id), { recursive: true, force: true });
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, `Package could not be imported: ${(e as Error).message.slice(0, 400)}`);
  }
}
