/**
 * File-based project storage. A project is a directory:
 *
 *   data/projects/<id>/
 *     project.json        meta + gate approvals
 *     brief.json          Director's Brief (user input)
 *     production.json     production document (AI-expanded, user-approved)
 *     assets.json         asset manifest; files in assets/
 *     style.json          style guide + asset notes
 *     beats.json          beats / states / shot list (the contract)
 *     film.json           current film program; revisions/ holds every prior program
 *     revisions.json      revision log (what changed and why)
 *     flags.json          review flags
 *     sheets/<n>-<fmt>/   contact sheets (frame PNGs + composite + sheet.json)
 *     cache/frames/       frame cache keyed by the hash of the evaluated frame
 *     exports/            MP4s
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Film } from "@/lib/engine";
import type { Asset, Beat, Brief, ContactSheet, ExportInfo, FilmRevision, Flag, ProductionDoc, ProjectMeta, StyleGuide } from "@/lib/studio/types";

export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.STUDIO_DATA_DIR || path.join(process.cwd(), "data"));
const PROJECTS = path.join(DATA_DIR, "projects");

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-]{2,80}$/;

export function projectDir(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(400, "Invalid project id");
  return path.join(PROJECTS, id);
}

export function projectPath(id: string, ...parts: string[]): string {
  const base = projectDir(id);
  const full = path.resolve(base, ...parts);
  if (full !== base && !full.startsWith(base + path.sep)) throw new HttpError(400, "Invalid path");
  return full;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJSON<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function writeJSON(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

export async function writeFileAtomic(file: string, data: Buffer | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

export function sha1(data: Buffer | Uint8Array | string): string {
  return createHash("sha1").update(data).digest("hex");
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "film"
  );
}

// ---- projects ---------------------------------------------------------------

export async function listProjects(): Promise<ProjectMeta[]> {
  await fs.mkdir(PROJECTS, { recursive: true });
  const ids = await fs.readdir(PROJECTS);
  const metas = await Promise.all(ids.filter((id) => ID_RE.test(id)).map((id) => readJSON<ProjectMeta>(path.join(PROJECTS, id, "project.json"))));
  return metas.filter((m): m is ProjectMeta => !!m).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createProject(name: string, extra: Partial<ProjectMeta> = {}): Promise<ProjectMeta> {
  const id = `${slug(name)}-${randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  const meta: ProjectMeta = { id, name: name.trim() || "Untitled film", createdAt: now, updatedAt: now, approvals: {}, filmRevision: 0, ...extra };
  await fs.mkdir(projectPath(id, "assets"), { recursive: true });
  await writeJSON(projectPath(id, "project.json"), meta);
  await writeJSON(projectPath(id, "assets.json"), []);
  return meta;
}

export async function getMeta(id: string): Promise<ProjectMeta> {
  const meta = await readJSON<ProjectMeta>(projectPath(id, "project.json"));
  if (!meta) throw new HttpError(404, "Project not found");
  return meta;
}

export async function saveMeta(meta: ProjectMeta): Promise<ProjectMeta> {
  meta.updatedAt = new Date().toISOString();
  await writeJSON(projectPath(meta.id, "project.json"), meta);
  return meta;
}

export async function deleteProject(id: string): Promise<void> {
  await getMeta(id);
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

// ---- documents --------------------------------------------------------------

export const docs = {
  brief: (id: string) => readJSON<Brief>(projectPath(id, "brief.json")),
  production: (id: string) => readJSON<ProductionDoc>(projectPath(id, "production.json")),
  style: (id: string) => readJSON<StyleGuide>(projectPath(id, "style.json")),
  beats: async (id: string) => (await readJSON<{ beats: Beat[] }>(projectPath(id, "beats.json")))?.beats ?? null,
  film: (id: string) => readJSON<Film>(projectPath(id, "film.json")),
  assets: async (id: string) => (await readJSON<Asset[]>(projectPath(id, "assets.json"))) ?? [],
  flags: async (id: string) => (await readJSON<Flag[]>(projectPath(id, "flags.json"))) ?? [],
  revisions: async (id: string) => (await readJSON<FilmRevision[]>(projectPath(id, "revisions.json"))) ?? [],
  exports: async (id: string) => (await readJSON<ExportInfo[]>(projectPath(id, "exports.json"))) ?? [],
};

export const save = {
  brief: (id: string, v: Brief) => writeJSON(projectPath(id, "brief.json"), v),
  production: (id: string, v: ProductionDoc) => writeJSON(projectPath(id, "production.json"), v),
  style: (id: string, v: StyleGuide) => writeJSON(projectPath(id, "style.json"), v),
  beats: (id: string, beats: Beat[]) => writeJSON(projectPath(id, "beats.json"), { beats }),
  assets: (id: string, v: Asset[]) => writeJSON(projectPath(id, "assets.json"), v),
  flags: (id: string, v: Flag[]) => writeJSON(projectPath(id, "flags.json"), v),
  exports: (id: string, v: ExportInfo[]) => writeJSON(projectPath(id, "exports.json"), v),
};

export async function removeDoc(id: string, name: "production" | "style" | "beats" | "film" | "flags"): Promise<void> {
  await fs.rm(projectPath(id, `${name}.json`), { force: true });
}

/** Save a new film revision; prior programs are kept for diffing and rollback. */
export async function saveFilm(meta: ProjectMeta, film: Film, info: Omit<FilmRevision, "revision" | "createdAt">): Promise<FilmRevision> {
  const revision = meta.filmRevision + 1;
  const entry: FilmRevision = { revision, createdAt: new Date().toISOString(), ...info };
  await writeJSON(projectPath(meta.id, "revisions", `film-${revision}.json`), film);
  await writeJSON(projectPath(meta.id, "film.json"), film);
  const log = await docs.revisions(meta.id);
  log.push(entry);
  await writeJSON(projectPath(meta.id, "revisions.json"), log);
  meta.filmRevision = revision;
  await saveMeta(meta);
  return entry;
}

export async function loadFilmRevision(id: string, revision: number): Promise<Film | null> {
  return readJSON<Film>(projectPath(id, "revisions", `film-${revision}.json`));
}

// ---- contact sheets -----------------------------------------------------------

export async function listSheets(id: string): Promise<ContactSheet[]> {
  const dir = projectPath(id, "sheets");
  if (!(await exists(dir))) return [];
  const names = await fs.readdir(dir);
  const sheets = await Promise.all(names.map((n) => readJSON<ContactSheet>(path.join(dir, n, "sheet.json"))));
  return sheets.filter((s): s is ContactSheet => !!s).sort((a, b) => a.revision - b.revision);
}
