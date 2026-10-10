/**
 * Server-side rendering with @napi-rs/canvas: single frames, contact sheets with a
 * content-addressed frame cache, and MP4 export via ffmpeg.
 *
 * The cache key of a frame is the hash of its evaluated draw list (plus output scale and
 * the content hash of every asset it draws). Changing one value in the program therefore
 * re-renders only the frames whose evaluated state actually changed.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import {
  drawFrame,
  evaluateFrame,
  frameToTimecode,
  FORMATS,
  selectContactFrames,
  type Ctx,
  type Film,
  type FormatId,
  type FrameState,
  type ImageResource,
  type Resources,
} from "@/lib/engine";
import { BUNDLED_FONTS } from "@/lib/studio/fonts";
import type { Asset, ContactSheet, ExportInfo, ProjectMeta, SheetEntry } from "@/lib/studio/types";
import { docs, exists, projectPath, save, sha1, writeFileAtomic, writeJSON } from "./store";

const FONT_DIR = path.join(process.cwd(), "public", "fonts");
let bundledRegistered = false;
const registeredUploads = new Set<string>();

export function registerFonts(assets: Asset[], projectId?: string) {
  if (!bundledRegistered) {
    for (const f of BUNDLED_FONTS) GlobalFonts.registerFromPath(path.join(FONT_DIR, f.file));
    bundledRegistered = true;
  }
  if (!projectId) return;
  for (const a of assets) {
    if (a.kind !== "font" || !a.confirmed || !a.fontFamily) continue;
    const key = `${a.sha1}:${a.fontFamily}`;
    if (registeredUploads.has(key)) continue;
    GlobalFonts.registerFromPath(projectPath(projectId, "assets", a.filename), a.fontFamily);
    registeredUploads.add(key);
  }
}

export async function imageInfo(buffer: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const img = await loadImage(buffer);
    return { width: img.width, height: img.height };
  } catch {
    return null;
  }
}

export async function loadResources(projectId: string, film: Film, assets: Asset[]): Promise<{ resources: Resources; assetHashes: Record<string, string> }> {
  registerFonts(assets, projectId);
  const used = new Set(film.layers.filter((l) => l.type === "image" && l.props.asset).map((l) => l.props.asset!));
  const images = new Map<string, ImageResource>();
  const assetHashes: Record<string, string> = {};
  for (const asset of assets) {
    if (!used.has(asset.id) || !asset.confirmed) continue;
    try {
      const img = await loadImage(await fs.readFile(projectPath(projectId, "assets", asset.filename)));
      images.set(asset.id, { source: img as unknown as CanvasImageSource, width: img.width, height: img.height });
      assetHashes[asset.id] = asset.sha1;
    } catch {
      // Left missing: the renderer paints a loud MISSING ASSET block.
    }
  }
  return { resources: { images }, assetHashes };
}

export function frameHash(state: FrameState, scale: number, assetHashes: Record<string, string>): string {
  const assetsUsed = state.items.filter((i) => i.type === "image").map((i) => `${i.props.asset}:${assetHashes[i.props.asset ?? ""] ?? "missing"}`);
  return sha1(JSON.stringify({ v: 1, scale, state, assetsUsed }));
}

export function renderFrame(film: Film, frame: number, format: FormatId, scale: number, resources: Resources) {
  const state = evaluateFrame(film, frame, format);
  const canvas = createCanvas(Math.round(state.width * scale), Math.round(state.height * scale));
  const ctx = canvas.getContext("2d");
  drawFrame(ctx as unknown as Ctx, state, resources, scale);
  return { canvas, state };
}

export async function renderFramePng(projectId: string, film: Film, frame: number, format: FormatId, scale: number): Promise<Buffer> {
  const assets = await docs.assets(projectId);
  const { resources } = await loadResources(projectId, film, assets);
  const { canvas } = renderFrame(film, Math.max(0, Math.min(film.duration - 1, frame)), format, scale, resources);
  return canvas.toBuffer("image/png");
}

// ---- contact sheets -----------------------------------------------------------

const THUMB_SCALE = 0.25;

export async function renderContactSheet(meta: ProjectMeta, film: Film, format: FormatId, revision: number): Promise<ContactSheet> {
  const t0 = Date.now();
  const assets = await docs.assets(meta.id);
  const { resources, assetHashes } = await loadResources(meta.id, film, assets);
  const picks = selectContactFrames(film, format);
  const dirName = `${String(revision).padStart(3, "0")}-${format.replace(":", "x")}`;
  const sheetDir = projectPath(meta.id, "sheets", dirName);
  await fs.mkdir(sheetDir, { recursive: true });
  const cacheDir = projectPath(meta.id, "cache", "frames");
  await fs.mkdir(cacheDir, { recursive: true });

  const entries: SheetEntry[] = [];
  let rendered = 0;
  let reused = 0;
  for (const pick of picks) {
    const state = evaluateFrame(film, pick.frame, format);
    const hash = frameHash(state, THUMB_SCALE, assetHashes);
    const cached = path.join(cacheDir, `${hash}.png`);
    let wasReused = true;
    if (!(await exists(cached))) {
      const canvas = createCanvas(Math.round(state.width * THUMB_SCALE), Math.round(state.height * THUMB_SCALE));
      drawFrame(canvas.getContext("2d") as unknown as Ctx, state, resources, THUMB_SCALE);
      await writeFileAtomic(cached, canvas.toBuffer("image/png"));
      wasReused = false;
      rendered++;
    } else reused++;
    const file = `f${String(pick.frame).padStart(5, "0")}.png`;
    await fs.copyFile(cached, path.join(sheetDir, file));
    entries.push({ ...pick, file, hash, reused: wasReused });
  }

  const composites = await writeComposites(sheetDir, entries, film, format);
  const sheet: ContactSheet = {
    revision,
    format,
    filmRevision: meta.filmRevision,
    createdAt: new Date().toISOString(),
    frames: entries,
    composites,
    rendered,
    reused,
    ms: Date.now() - t0,
  };
  await writeJSON(path.join(sheetDir, "sheet.json"), sheet);
  return sheet;
}

const PER_PAGE = 20;

async function writeComposites(sheetDir: string, entries: SheetEntry[], film: Film, format: FormatId): Promise<string[]> {
  const { width, height } = FORMATS[format];
  const tw = Math.round(width * THUMB_SCALE);
  const th = Math.round(height * THUMB_SCALE);
  const cols = format === "16:9" ? 5 : 10;
  const label = 30;
  const gap = 12;
  const files: string[] = [];
  for (let page = 0; page * PER_PAGE < entries.length; page++) {
    const slice = entries.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
    const rows = Math.ceil(slice.length / cols);
    const canvas = createCanvas(cols * (tw + gap) + gap, rows * (th + label + gap) + gap);
    const ctx = canvas.getContext("2d") as SKRSContext2D;
    ctx.fillStyle = "#1b1b1d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < slice.length; i++) {
      const e = slice[i];
      const x = gap + (i % cols) * (tw + gap);
      const y = gap + Math.floor(i / cols) * (th + label + gap);
      const img = await loadImage(await fs.readFile(path.join(sheetDir, e.file)));
      ctx.drawImage(img, x, y, tw, th);
      if (e.kind === "strip") {
        ctx.fillStyle = "#ffb020";
        ctx.fillRect(x, y + th, tw, 3);
      }
      ctx.fillStyle = "#e8e8ea";
      ctx.font = '600 15px "Inter"';
      const n = page * PER_PAGE + i + 1;
      ctx.fillText(`#${n}  f${e.frame}  ${frameToTimecode(e.frame, film.fps)}  ${e.beat} · ${e.kind}`, x + 2, y + th + 21);
    }
    const name = `sheet-${page + 1}.png`;
    await writeFileAtomic(path.join(sheetDir, name), canvas.toBuffer("image/png"));
    files.push(name);
  }
  return files;
}

// ---- export -------------------------------------------------------------------

export async function exportVideo(meta: ProjectMeta, film: Film, format: FormatId, onProgress: (p: number) => void): Promise<ExportInfo> {
  const assets = await docs.assets(meta.id);
  const { resources } = await loadResources(meta.id, film, assets);
  const { width, height } = FORMATS[format];
  const file = `${meta.id}-${format.replace(":", "x")}-r${meta.filmRevision}.mp4`;
  const out = projectPath(meta.id, "exports", file);
  await fs.mkdir(path.dirname(out), { recursive: true });
  const ffmpeg = spawn(
    /*turbopackIgnore: true*/
    process.env.FFMPEG_PATH || "ffmpeg",
    [
      "-y",
      "-loglevel", "error",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", `${width}x${height}`,
      "-r", String(film.fps),
      "-i", "-",
      "-c:v", "libx264",
      "-preset", process.env.STUDIO_X264_PRESET || "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      `${out}.part.mp4`,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  ffmpeg.stderr.on("data", (d) => (stderr += d.toString()));
  const done = new Promise<void>((resolve, reject) => {
    ffmpeg.on("error", (e) => reject(new Error(`Could not start ffmpeg (${e.message}). Install ffmpeg or set FFMPEG_PATH.`)));
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-800)}`))));
  });

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  try {
    for (let f = 0; f < film.duration; f++) {
      drawFrame(ctx, evaluateFrame(film, f, format), resources, 1);
      const chunk = (canvas as unknown as { data(): Buffer }).data();
      if (!ffmpeg.stdin.write(chunk)) await new Promise<void>((r) => ffmpeg.stdin.once("drain", () => r()));
      if (f % 15 === 0) onProgress(f / film.duration);
    }
  } finally {
    ffmpeg.stdin.end();
  }
  await done;
  await fs.rename(`${out}.part.mp4`, out);
  const stat = await fs.stat(out);
  const info: ExportInfo = { format, file, filmRevision: meta.filmRevision, createdAt: new Date().toISOString(), bytes: stat.size, frames: film.duration };
  const list = (await docs.exports(meta.id)).filter((e) => e.format !== format);
  list.push(info);
  await save.exports(meta.id, list);
  onProgress(1);
  return info;
}

// ---- vision helpers -------------------------------------------------------------

/** Downscale an image file to at most `maxSide` px and return base64 JPEG for vision. */
export async function encodeForVision(file: string, maxSide = 1568): Promise<{ mediaType: "image/jpeg"; data: string } | null> {
  try {
    const img = await loadImage(await fs.readFile(file));
    const k = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = createCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { mediaType: "image/jpeg", data: (await canvas.encode("jpeg", 85)).toString("base64") };
  } catch {
    return null;
  }
}
