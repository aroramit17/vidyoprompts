/**
 * Studio service: every user or AI action, with gates enforced server-side.
 * Route handlers are thin wrappers around these functions.
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDirector, type DirectorContext } from "@/lib/ai";
import {
  applyPatch,
  lintFilm,
  parseFilm,
  PatchOpSchema,
  validateFilm,
  type Film,
  type FormatId,
  type Issue,
  type Motion,
  type PatchOp,
} from "@/lib/engine";
import { allowedFonts } from "@/lib/studio/fonts";
import { beatsBasis, computeGates, downstreamOf, latestSheet, type GateInfo, type ProjectState } from "@/lib/studio/gates";
import {
  AssetSchema,
  BeatSchema,
  BriefSchema,
  ProductionDocSchema,
  RegionSchema,
  StyleGuideSchema,
  type Asset,
  type Brief,
  type Flag,
  type FlagCategory,
  type GateId,
  type ProjectMeta,
} from "@/lib/studio/types";
import { z } from "zod";
import { encodeForVision, exportVideo, imageInfo, renderContactSheet } from "./render";
import { startJob, withLock } from "./jobs";
import { docs, getMeta, HttpError, listSheets, loadFilmRevision, projectPath, readJSON, save, saveFilm, saveMeta, sha1, writeFileAtomic } from "./store";

// ---- state ------------------------------------------------------------------------

export async function loadState(id: string): Promise<ProjectState> {
  const meta = await getMeta(id);
  const [brief, production, assets, style, beats, film, sheets, flags] = await Promise.all([
    docs.brief(id),
    docs.production(id),
    docs.assets(id),
    docs.style(id),
    docs.beats(id),
    docs.film(id),
    listSheets(id),
    docs.flags(id),
  ]);
  const filmIssues = film ? validateFilm(film, validationContext(assets)) : [];
  return { meta, brief, production, assets, style, beats, film, filmIssues, sheets, flags };
}

export function validationContext(assets: Asset[]) {
  return {
    assets: assets.map((a) => ({ id: a.id, kind: a.kind, label: a.label, confirmed: a.confirmed, mustUse: !!a.mustUseId })),
    fonts: allowedFonts(assets),
  };
}

export async function projectView(id: string) {
  const state = await loadState(id);
  const gates = computeGates(state);
  const [revisions, exportsList] = await Promise.all([docs.revisions(id), docs.exports(id)]);
  return { ...state, gates, revisions, exports: exportsList, director: getDirector().name, fonts: allowedFonts(state.assets) };
}

function require(gates: Record<GateId, GateInfo>, gate: GateId, need: "unlocked" | "approved" | "approvable") {
  const g = gates[gate];
  if (need === "unlocked" && g.status === "locked") throw new HttpError(409, `Gate locked: ${g.blockers[0] ?? gate}`, { gate, blockers: g.blockers });
  if (need === "approved" && g.status !== "approved") throw new HttpError(409, `Gate not approved: ${gate}`, { gate, blockers: g.blockers });
  if (need === "approvable" && (g.status === "locked" || g.blockers.length > 0))
    throw new HttpError(409, `Cannot approve ${gate}: ${g.blockers.join(" ")}`, { gate, blockers: g.blockers });
}

/** Clear approvals at and after `gate` (regenerate-from-here semantics). */
function clearFrom(meta: ProjectMeta, gate: GateId, inclusive = true) {
  for (const g of downstreamOf(gate, inclusive)) delete meta.approvals[g];
  if (downstreamOf(gate, inclusive).includes("review")) delete meta.approvedSheet;
}

async function directorContext(state: ProjectState, opts: { confirmedOnly?: boolean } = {}): Promise<DirectorContext> {
  if (!state.brief) throw new HttpError(409, "The brief is missing.");
  const assets = opts.confirmedOnly === false ? state.assets : state.assets.filter((a) => a.confirmed);
  return {
    brief: state.brief,
    production: state.production ?? undefined,
    style: state.style ?? undefined,
    assets,
    beats: state.beats ?? undefined,
    fonts: allowedFonts(state.assets),
    loadImage: (asset) => encodeForVision(projectPath(state.meta.id, "assets", asset.filename)),
  };
}

const mutate = <T>(id: string, fn: () => Promise<T>) => withLock(id, fn);

// ---- 1. brief ----------------------------------------------------------------------

export function updateBrief(id: string, input: unknown) {
  return mutate(id, async () => {
    const parsed = BriefSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const brief: Brief = {
      ...parsed.data,
      mustUse: parsed.data.mustUse.map((m) => ({ ...m, id: m.id || randomUUID().slice(0, 8) })),
    };
    const meta = await getMeta(id);
    const before = await docs.brief(id);
    await save.brief(id, brief);
    if (JSON.stringify(before) !== JSON.stringify(brief)) {
      clearFrom(meta, "brief");
      await saveMeta(meta);
    }
    return brief;
  });
}

export function generateProduction(id: string) {
  return mutate(id, async () => {
    const state = await loadState(id);
    if (!state.brief) throw new HttpError(409, "Fill in the brief first.");
    const doc = await getDirector().productionDoc(await directorContext(state, { confirmedOnly: false }));
    await save.production(id, doc);
    clearFrom(state.meta, "brief");
    await saveMeta(state.meta);
    return doc;
  });
}

export function updateProduction(id: string, input: unknown) {
  return mutate(id, async () => {
    const doc = ProductionDocSchema.parse(input);
    await save.production(id, doc);
    const meta = await getMeta(id);
    clearFrom(meta, "brief");
    await saveMeta(meta);
    return doc;
  });
}

export function approve(id: string, gate: "brief" | "assets" | "beats" | "review") {
  return mutate(id, async () => {
    const state = await loadState(id);
    const gates = computeGates(state);
    require(gates, gate, "approvable");
    state.meta.approvals[gate] = new Date().toISOString();
    if (gate === "review") state.meta.approvedSheet = latestSheet(state, "16:9")!.revision;
    await saveMeta(state.meta);
    return computeGates({ ...state });
  });
}

export function reopen(id: string, gate: GateId) {
  return mutate(id, async () => {
    const meta = await getMeta(id);
    clearFrom(meta, gate);
    await saveMeta(meta);
    return meta;
  });
}

// ---- 2. assets -----------------------------------------------------------------------

const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif|svg\+xml)$/;

export interface UploadInput {
  filename: string;
  mime: string;
  data: Buffer;
  kind?: string;
  label?: string;
  mustUseId?: string;
  source?: Asset["source"];
  sourceUrl?: string;
  confirmed?: boolean;
}

export function addAsset(id: string, input: UploadInput) {
  return mutate(id, async () => {
    await getMeta(id);
    const ext = path.extname(input.filename).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 6) || ".bin";
    const isFont = FONT_EXT.test(input.filename);
    const isImage = IMAGE_MIME.test(input.mime) && !input.mime.includes("svg");
    if (input.mime.includes("svg")) throw new HttpError(400, "SVG is not supported yet; export the logo as PNG.");
    if (!isFont && !isImage && !input.mime.startsWith("video/")) throw new HttpError(400, `Unsupported file type ${input.mime || ext}.`);
    if (input.data.length > 80 * 1024 * 1024) throw new HttpError(400, "File too large (80MB max).");
    const assetId = `a-${randomUUID().slice(0, 8)}`;
    const filename = `${assetId}${ext}`;
    await writeFileAtomic(projectPath(id, "assets", filename), input.data);
    const dims = isImage ? await imageInfo(input.data) : null;
    if (isImage && !dims) throw new HttpError(400, "Could not decode image.");
    const kind = AssetSchema.shape.kind.safeParse(input.kind).success ? (input.kind as Asset["kind"]) : isFont ? "font" : input.mime.startsWith("video/") ? "reference" : "screen";
    const asset: Asset = {
      id: assetId,
      filename,
      kind,
      label: (input.label || input.filename.replace(/\.[^.]+$/, "")).slice(0, 120),
      mime: input.mime || "application/octet-stream",
      bytes: input.data.length,
      sha1: sha1(input.data),
      width: dims?.width,
      height: dims?.height,
      source: input.source ?? "upload",
      sourceUrl: input.sourceUrl,
      // Uploaded files are real by definition but still need a human to say "use this".
      confirmed: input.confirmed ?? false,
      mustUseId: input.mustUseId || undefined,
      description: "",
      regions: [],
      fontFamily: isFont ? input.filename.replace(/\.[^.]+$/, "").replace(/[-_](regular|bold|medium|semibold|light|italic|variable).*$/i, "").replace(/[-_]/g, " ") : undefined,
      createdAt: new Date().toISOString(),
    };
    const assets = await docs.assets(id);
    assets.push(asset);
    await save.assets(id, assets);
    const meta = await getMeta(id);
    clearFrom(meta, "assets");
    await saveMeta(meta);
    return asset;
  });
}

const AssetPatchSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  kind: AssetSchema.shape.kind.optional(),
  mustUseId: z.string().nullable().optional(),
  confirmed: z.boolean().optional(),
  description: z.string().max(2000).optional(),
  regions: z.array(RegionSchema).max(8).optional(),
  fontFamily: z.string().max(80).optional(),
});

export function updateAsset(id: string, assetId: string, input: unknown) {
  return mutate(id, async () => {
    const patch = AssetPatchSchema.parse(input);
    const assets = await docs.assets(id);
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) throw new HttpError(404, "Asset not found");
    const { mustUseId, ...rest } = patch;
    Object.assign(asset, rest);
    if (mustUseId !== undefined) asset.mustUseId = mustUseId ?? undefined;
    await save.assets(id, assets);
    const meta = await getMeta(id);
    // Regions and descriptions only inform the director; other changes alter the asset contract.
    const onlyNotes = Object.keys(patch).every((k) => k === "regions" || k === "description");
    if (!onlyNotes) {
      clearFrom(meta, "assets");
      await saveMeta(meta);
    }
    return asset;
  });
}

export function deleteAsset(id: string, assetId: string) {
  return mutate(id, async () => {
    const assets = await docs.assets(id);
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) throw new HttpError(404, "Asset not found");
    await save.assets(
      id,
      assets.filter((a) => a.id !== assetId),
    );
    await fs.rm(projectPath(id, "assets", asset.filename), { force: true });
    const meta = await getMeta(id);
    clearFrom(meta, "assets");
    await saveMeta(meta);
    return { ok: true };
  });
}

export function generateStyle(id: string) {
  return mutate(id, async () => {
    const state = await loadState(id);
    require(computeGates(state), "assets", "unlocked");
    const style = await getDirector().styleGuide(await directorContext(state));
    await save.style(id, style);
    // Copy AI-found regions onto assets that have none, so they are visible and editable.
    const assets = state.assets.map((a) => {
      const note = style.assetNotes.find((n) => n.assetId === a.id);
      if (!note) return a;
      return { ...a, description: a.description || note.description, regions: a.regions.length ? a.regions : note.regions };
    });
    await save.assets(id, assets);
    clearFrom(state.meta, "assets");
    await saveMeta(state.meta);
    return style;
  });
}

export function updateStyle(id: string, input: unknown) {
  return mutate(id, async () => {
    const style = StyleGuideSchema.parse(input);
    await save.style(id, style);
    const meta = await getMeta(id);
    clearFrom(meta, "assets");
    await saveMeta(meta);
    return style;
  });
}

// ---- 3. beats ----------------------------------------------------------------------------

export function generateBeats(id: string) {
  return mutate(id, async () => {
    const state = await loadState(id);
    require(computeGates(state), "assets", "approved");
    const beats = await getDirector().beats(await directorContext(state));
    await save.beats(id, beats);
    clearFrom(state.meta, "beats");
    await saveMeta(state.meta);
    return beats;
  });
}

export function updateBeats(id: string, input: unknown) {
  return mutate(id, async () => {
    const state = await loadState(id);
    require(computeGates(state), "beats", "unlocked");
    const beats = z.array(BeatSchema).min(1).parse(input);
    const ids = new Set<string>();
    for (const b of beats) {
      if (ids.has(b.id)) throw new HttpError(400, `Duplicate beat id ${b.id}`);
      ids.add(b.id);
    }
    await save.beats(id, beats);
    clearFrom(state.meta, "beats");
    await saveMeta(state.meta);
    return beats;
  });
}

export function justifyBeat(id: string, beatId: string) {
  return mutate(id, async () => {
    const state = await loadState(id);
    if (!state.beats?.some((b) => b.id === beatId)) throw new HttpError(404, "Beat not found");
    const result = await getDirector().justifyBeat(await directorContext(state), beatId);
    const beats = state.beats.map((b) => (b.id === beatId ? { ...b, justification: `[${result.verdict}] ${result.justification} ${result.suggestion}` } : b));
    await save.beats(id, beats);
    return result;
  });
}

// ---- 4. film -----------------------------------------------------------------------------

function filmValidator(assets: Asset[]) {
  return (raw: unknown) => {
    const parsed = parseFilm(raw);
    if (!parsed.film) return { errors: parsed.issues.map((i) => i.message) };
    const errors = validateFilm(parsed.film, validationContext(assets)).filter((i) => i.level === "error");
    return errors.length ? { errors: errors.map((i) => i.message) } : { film: parsed.film, errors: [] };
  };
}

export function generateFilm(id: string) {
  return mutate(id, async () => {
    const state = await loadState(id);
    require(computeGates(state), "beats", "approved");
    const director = getDirector();
    const result = await director.film(await directorContext(state), filmValidator(state.assets));
    // Beats are a contract: the program must keep them, in order.
    const baseMotion = await readJSON<Motion>(projectPath(id, "base-motion.json"));
    if (baseMotion) result.film.motion = baseMotion;
    const expected = state.beats!.map((b) => b.id).join(",");
    const got = result.film.beats.map((b) => b.id).join(",");
    if (expected !== got) throw new HttpError(422, `The generated program changed the approved beats (${got} vs ${expected}).`);
    state.meta.filmBasis = beatsBasis(state.beats!);
    const rev = await saveFilm(state.meta, result.film, {
      source: director.name === "claude" ? "ai" : "offline",
      summary: result.notes,
      changes: [`Generated from ${state.beats!.length} approved beats (${result.attempts} attempt${result.attempts > 1 ? "s" : ""}).`],
    });
    await save.flags(id, []);
    const meta = await getMeta(id);
    clearFrom(meta, "review");
    await saveMeta(meta);
    return rev;
  });
}

async function commitFilm(id: string, film: Film, info: { source: "manual" | "patch" | "retime" | "motion"; summary: string; changes: string[] }) {
  const meta = await getMeta(id);
  const assets = await docs.assets(id);
  const issues = validateFilm(film, validationContext(assets));
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) throw new HttpError(422, `The change makes the program invalid: ${errors.map((e) => e.message).join(" ")}`, { issues });
  const rev = await saveFilm(meta, film, info);
  return { revision: rev, issues };
}

export function updateFilm(id: string, input: unknown) {
  return mutate(id, async () => {
    const state = await loadState(id);
    require(computeGates(state), "film", "unlocked");
    const parsed = parseFilm(input);
    if (!parsed.film) throw new HttpError(422, parsed.issues.map((i) => i.message).join(" "), { issues: parsed.issues });
    return commitFilm(id, parsed.film, { source: "manual", summary: "Manual edit of the film program.", changes: ["Program edited by hand."] });
  });
}

export function patchFilm(id: string, opsInput: unknown, source: "patch" | "retime" | "motion" = "patch", summary = "Local parameter change.") {
  return mutate(id, async () => {
    const film = await docs.film(id);
    if (!film) throw new HttpError(409, "No film program yet.");
    const ops = z.array(PatchOpSchema).parse(opsInput);
    const result = applyPatch(film, ops);
    if (result.applied.length === 0) throw new HttpError(422, `Nothing applied. ${result.rejected.join("; ")}`);
    return { ...(await commitFilm(id, result.film, { source, summary, changes: [...result.applied, ...result.rejected.map((r) => `rejected: ${r}`)] })), applied: result.applied, rejected: result.rejected };
  });
}

export function setMotion(id: string, motion: Motion) {
  const classes = Object.keys(motion.classes) as (keyof Motion["classes"])[];
  const ops: PatchOp[] = [
    ...motion.springs.map((spring) => ({ op: "spring" as const, spring })),
    ...classes.map((motionClass) => ({ op: "ease" as const, motionClass, value: motion.classes[motionClass] })),
    { op: "minHold", frames: motion.minHoldFrames },
  ];
  return patchFilm(id, ops, "motion", "Motion rules tweaked.");
}

export function revertFilm(id: string, revision: number) {
  return mutate(id, async () => {
    const film = await loadFilmRevision(id, revision);
    if (!film) throw new HttpError(404, "Revision not found");
    return commitFilm(id, film, { source: "manual", summary: `Reverted to revision ${revision}.`, changes: [`Restored program from revision ${revision}.`] });
  });
}

// ---- 5. review ---------------------------------------------------------------------------

export function renderSheet(id: string, format: FormatId) {
  return mutate(id, async () => {
    const state = await loadState(id);
    require(computeGates(state), "film", "approved");
    const next = (state.sheets.at(-1)?.revision ?? 0) + 1;
    return renderContactSheet(state.meta, state.film!, format, next);
  });
}

function newFlag(f: { frame: number | null; beat: string | null; category: FlagCategory; note: string; source: Flag["source"] }): Flag {
  return { id: randomUUID().slice(0, 8), status: "open", createdAt: new Date().toISOString(), ...f };
}

export function addFlag(id: string, input: unknown) {
  return mutate(id, async () => {
    const f = z
      .object({ frame: z.number().int().nullable(), beat: z.string().nullable(), category: z.enum(["timing", "hierarchy", "missing-asset", "weak-focus", "readability", "generic", "motion", "other"]), note: z.string().min(1).max(2000) })
      .parse(input);
    const flags = await docs.flags(id);
    const flag = newFlag({ ...f, source: "user" });
    flags.push(flag);
    await save.flags(id, flags);
    return flag;
  });
}

export function updateFlag(id: string, flagId: string, input: unknown) {
  return mutate(id, async () => {
    const patch = z.object({ status: z.enum(["open", "addressed", "dismissed"]).optional(), note: z.string().min(1).optional() }).parse(input);
    const flags = await docs.flags(id);
    const flag = flags.find((f) => f.id === flagId);
    if (!flag) throw new HttpError(404, "Flag not found");
    Object.assign(flag, patch);
    await save.flags(id, flags);
    return flag;
  });
}

export function lintIssues(state: ProjectState): Issue[] {
  if (!state.film) return [];
  return lintFilm(state.film, { ...validationContext(state.assets), mustUseAssetIds: state.assets.filter((a) => a.confirmed && a.mustUseId && a.kind !== "font" && a.kind !== "reference").map((a) => a.id) });
}

/** Lint + AI critique of the latest 16:9 contact sheet; new findings become open flags. */
export function critique(id: string) {
  return mutate(id, async () => {
    const state = await loadState(id);
    require(computeGates(state), "film", "approved");
    const sheet = latestSheet(state, "16:9");
    if (!sheet || sheet.filmRevision !== state.meta.filmRevision) throw new HttpError(409, "Render a contact sheet of the current program first.");
    const lint = lintIssues(state);
    const dir = projectPath(id, "sheets", `${String(sheet.revision).padStart(3, "0")}-16x9`);
    const images = (await Promise.all(sheet.composites.slice(0, 4).map((c) => encodeForVision(path.join(dir, c))))).filter((x): x is NonNullable<typeof x> => !!x);
    const director = getDirector();
    const found = await director.critique(await directorContext(state), { film: state.film!, sheet: sheet.frames, images, lint });
    const lintFlags = director.name === "claude" ? lint.map((i) => ({ frame: i.frame ?? null, beat: i.beat ?? null, category: lintToCategory(i.code), note: i.message, source: "lint" as const })) : [];
    const aiFlags = found.map((f) => ({ ...f, source: director.name === "claude" ? ("ai" as const) : ("lint" as const) }));
    const existing = state.flags;
    const fresh = [...lintFlags, ...aiFlags]
      .filter((f) => !existing.some((e) => e.note === f.note && e.status !== "addressed"))
      .map((f) => newFlag({ frame: f.frame, beat: f.beat, category: f.category, note: f.note, source: f.source }));
    await save.flags(id, [...existing, ...fresh]);
    return { added: fresh.length, flags: [...existing, ...fresh] };
  });
}

function lintToCategory(code: string): FlagCategory {
  const map: Record<string, FlagCategory> = {
    "must-use-missing": "missing-asset",
    "hold-short": "readability",
    contrast: "readability",
    "static-beat": "motion",
    "fade-only": "motion",
    "generic-look": "generic",
    crowded: "hierarchy",
    focus: "weak-focus",
    flash: "timing",
  };
  return map[code] ?? "other";
}

/** Turn open flags into local program edits, then re-render the contact sheet. */
export function applyFlags(id: string, flagIds?: string[]) {
  return mutate(id, async () => {
    const state = await loadState(id);
    require(computeGates(state), "film", "approved");
    const targets = state.flags.filter((f) => f.status === "open" && (!flagIds || flagIds.includes(f.id)));
    if (targets.length === 0) throw new HttpError(409, "No open flags to address.");
    const director = getDirector();
    const { ops, summary } = await director.revise(await directorContext(state), state.film!, targets);
    if (ops.length === 0) return { summary, applied: [], rejected: [], sheet: null };
    const result = applyPatch(state.film!, ops);
    const issues = validateFilm(result.film, validationContext(state.assets));
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length) throw new HttpError(422, `Proposed fix is invalid: ${errors.map((e) => e.message).join(" ")}`);
    await saveFilm(state.meta, result.film, { source: "patch", summary, changes: [...result.applied, ...result.rejected.map((r) => `rejected: ${r}`)] });
    const flags = state.flags.map((f) => (targets.some((t) => t.id === f.id) ? { ...f, status: "addressed" as const } : f));
    await save.flags(id, flags);
    const meta = await getMeta(id);
    const sheet = await renderContactSheet(meta, result.film, "16:9", (state.sheets.at(-1)?.revision ?? 0) + 1);
    return { summary, applied: result.applied, rejected: result.rejected, sheet };
  });
}

// ---- 6. export ---------------------------------------------------------------------------

export async function startExport(id: string, format: FormatId) {
  const state = await loadState(id);
  const gates = computeGates(state);
  require(gates, "review", "approved");
  if (format === "9:16") {
    const sheet = latestSheet(state, "9:16");
    if (!sheet || sheet.filmRevision !== state.meta.filmRevision) throw new HttpError(409, "Render and look at the 9:16 contact sheet of the current program before exporting 9:16.");
  }
  const film = state.film!;
  const meta = state.meta;
  return startJob(id, "export", format, (progress) => exportVideo(meta, film, format, (p) => progress(p, `Encoding ${Math.round(p * 100)}%`)));
}
