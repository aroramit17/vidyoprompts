/**
 * Project API. One dispatcher keeps every endpoint (and its gate checks, which live in
 * lib/server/studio.ts) in one readable table.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { FORMAT_IDS, MotionSchema, type FormatId } from "@/lib/engine";
import { handle, json } from "@/lib/server/http";
import { inspectSite } from "@/lib/server/inspect";
import { getJob, projectJobs } from "@/lib/server/jobs";
import { buildPackage, forkProject } from "@/lib/server/package";
import { renderFramePng } from "@/lib/server/render";
import { deleteProject, docs, exists, HttpError, loadFilmRevision, projectPath } from "@/lib/server/store";
import * as studio from "@/lib/server/studio";
import type { GateId } from "@/lib/studio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; path?: string[] }> };
type Handler = (req: Request, id: string, args: string[]) => Promise<unknown>;

const format = (v: unknown): FormatId => {
  if (!FORMAT_IDS.includes(v as FormatId)) throw new HttpError(400, `Unknown format ${String(v)}`);
  return v as FormatId;
};
const body = async (req: Request) => req.json().catch(() => ({})) as Promise<Record<string, unknown>>;
const GATE_IDS: GateId[] = ["brief", "assets", "beats", "film", "review", "export"];

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function sendFile(req: Request, file: string, cache = "private, max-age=0, must-revalidate"): Promise<Response> {
  if (!(await exists(file))) throw new HttpError(404, "File not found");
  const stat = await fs.stat(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, stat.size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${stat.size}` } });
    const handle = await fs.open(file, "r");
    const buf = Buffer.alloc(end - start + 1);
    await handle.read(buf, 0, buf.length, start);
    await handle.close();
    return new Response(new Uint8Array(buf), {
      status: 206,
      headers: { "content-type": type, "content-range": `bytes ${start}-${end}/${stat.size}`, "accept-ranges": "bytes", "content-length": String(buf.length), "cache-control": cache },
    });
  }
  return new Response(new Uint8Array(await fs.readFile(file)), {
    headers: { "content-type": type, "content-length": String(stat.size), "accept-ranges": "bytes", "cache-control": cache },
  });
}

const routes: Record<string, Handler> = {
  "GET ": async (_r, id) => studio.projectView(id),
  "DELETE ": async (_r, id) => {
    await deleteProject(id);
    return { ok: true };
  },

  // 1. Brief
  "PUT brief": async (r, id) => studio.updateBrief(id, await body(r)),
  "POST production/generate": async (_r, id) => studio.generateProduction(id),
  "PUT production": async (r, id) => studio.updateProduction(id, await body(r)),
  "POST approve/*": async (_r, id, [gate]) => {
    if (!["brief", "assets", "beats", "review"].includes(gate)) throw new HttpError(400, "This gate is approved automatically.");
    return studio.approve(id, gate as "brief" | "assets" | "beats" | "review");
  },
  "POST reopen/*": async (_r, id, [gate]) => {
    if (!GATE_IDS.includes(gate as GateId)) throw new HttpError(400, "Unknown gate");
    return studio.reopen(id, gate as GateId);
  },

  // 2. Assets
  "POST assets": async (r, id) => {
    const form = await r.formData();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new HttpError(400, "No files attached.");
    const created = [];
    for (const file of files) {
      created.push(
        await studio.addAsset(id, {
          filename: file.name,
          mime: file.type,
          data: Buffer.from(await file.arrayBuffer()),
          kind: String(form.get("kind") ?? "") || undefined,
          label: files.length === 1 ? String(form.get("label") ?? "") || undefined : undefined,
          mustUseId: String(form.get("mustUseId") ?? "") || undefined,
          confirmed: form.get("confirmed") === "true",
        }),
      );
    }
    return { assets: created };
  },
  "POST assets/inspect": async (r, id) => {
    const { url } = z.object({ url: z.string().min(3).max(2000) }).parse(await body(r));
    const capture = await inspectSite(url);
    const host = new URL(capture.url).hostname;
    const created = [];
    for (const shot of capture.shots) {
      created.push(
        await studio.addAsset(id, {
          filename: `${host}-${shot.label}.png`.replace(/[^a-z0-9.-]+/gi, "-"),
          mime: "image/png",
          data: shot.png,
          kind: "screen",
          label: `${host} — ${shot.label}`,
          source: "site",
          sourceUrl: capture.url,
          confirmed: false,
        }),
      );
    }
    return { assets: created, colors: capture.colors, fonts: capture.fonts, title: capture.title };
  },
  "PATCH assets/*": async (r, id, [assetId]) => studio.updateAsset(id, assetId, await body(r)),
  "DELETE assets/*": async (_r, id, [assetId]) => studio.deleteAsset(id, assetId),
  "GET assets/*/file": async (r, id, [assetId]) => {
    const asset = (await docs.assets(id)).find((a) => a.id === assetId);
    if (!asset) throw new HttpError(404, "Asset not found");
    return sendFile(r, projectPath(id, "assets", asset.filename), "private, max-age=31536000, immutable");
  },
  "POST style/generate": async (_r, id) => studio.generateStyle(id),
  "PUT style": async (r, id) => studio.updateStyle(id, await body(r)),

  // 3. Beats
  "POST beats/generate": async (_r, id) => studio.generateBeats(id),
  "PUT beats": async (r, id) => studio.updateBeats(id, (await body(r)).beats),
  "POST beats/*/justify": async (_r, id, [beatId]) => studio.justifyBeat(id, beatId),

  // 4. Film program
  "POST film/generate": async (_r, id) => studio.generateFilm(id),
  "PUT film": async (r, id) => studio.updateFilm(id, await body(r)),
  "POST film/patch": async (r, id) => {
    const b = await body(r);
    return studio.patchFilm(id, b.ops, "patch", typeof b.summary === "string" ? b.summary : "Local parameter change.");
  },
  "POST film/motion": async (r, id) => studio.setMotion(id, MotionSchema.parse((await body(r)).motion)),
  "POST film/retime": async (r, id) => {
    const { beat, frames } = z.object({ beat: z.string(), frames: z.number().int().min(6) }).parse(await body(r));
    return studio.patchFilm(id, [{ op: "retime", beat, frames }], "retime", `Retimed beat ${beat}.`);
  },
  "POST film/revert": async (r, id) => studio.revertFilm(id, z.object({ revision: z.number().int().min(1) }).parse(await body(r)).revision),
  "GET film/revisions/*": async (_r, id, [n]) => {
    const film = await loadFilmRevision(id, Number(n));
    if (!film) throw new HttpError(404, "Revision not found");
    return film;
  },
  "GET lint": async (_r, id) => ({ issues: studio.lintIssues(await studio.loadState(id)) }),
  "GET frame": async (r, id) => {
    const url = new URL(r.url);
    const rev = url.searchParams.get("rev");
    const film = rev ? await loadFilmRevision(id, Number(rev)) : await docs.film(id);
    if (!film) throw new HttpError(404, "No film program");
    const scale = Math.max(0.1, Math.min(1, Number(url.searchParams.get("scale") ?? 0.5)));
    const png = await renderFramePng(id, film, Number(url.searchParams.get("f") ?? 0), format(url.searchParams.get("format") ?? "16:9"), scale);
    return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  },

  // 5. Review
  "POST sheets": async (r, id) => studio.renderSheet(id, format((await body(r)).format ?? "16:9")),
  "GET sheets/*/*": async (r, id, [dir, file]) => {
    if (!/^\d{3}-(16x9|9x16)$/.test(dir) || !/^[\w.-]+\.png$/.test(file)) throw new HttpError(400, "Bad path");
    return sendFile(r, projectPath(id, "sheets", dir, file), "private, max-age=31536000, immutable");
  },
  "POST critique": async (_r, id) => studio.critique(id),
  "POST flags": async (r, id) => studio.addFlag(id, await body(r)),
  "PATCH flags/*": async (r, id, [flagId]) => studio.updateFlag(id, flagId, await body(r)),
  "POST flags/apply": async (r, id) => {
    const b = await body(r);
    return studio.applyFlags(id, Array.isArray(b.flagIds) ? b.flagIds.map(String) : undefined);
  },

  // 6. Export & package
  "POST export": async (r, id) => studio.startExport(id, format((await body(r)).format ?? "16:9")),
  "GET jobs": async (_r, id) => ({ jobs: projectJobs(id) }),
  "GET jobs/*": async (_r, id, [jobId]) => {
    const job = getJob(jobId);
    if (!job || job.projectId !== id) throw new HttpError(404, "Job not found");
    return job;
  },
  "GET exports/*": async (r, id, [file]) => {
    if (!/^[\w.-]+\.mp4$/.test(file)) throw new HttpError(400, "Bad file");
    return sendFile(r, projectPath(id, "exports", file));
  },
  "GET package": async (_r, id) => {
    const { filename, data } = await buildPackage(id);
    return new Response(new Uint8Array(data), {
      headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${filename}"`, "content-length": String(data.length) },
    });
  },
  "POST fork": async (r, id) => {
    const { name } = await body(r);
    return { project: await forkProject(id, typeof name === "string" ? name : undefined) };
  },
};

function match(method: string, segments: string[]): { handler: Handler; args: string[] } | null {
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = [key.slice(0, key.indexOf(" ")), key.slice(key.indexOf(" ") + 1)];
    if (m !== method) continue;
    const parts = pattern ? pattern.split("/") : [];
    if (parts.length !== segments.length) continue;
    const args: string[] = [];
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === "*") args.push(segments[i]);
      else if (parts[i] !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler, args };
  }
  return null;
}

async function dispatch(method: string, req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id, path: segments = [] } = await ctx.params;
    const found = match(method, segments.map(decodeURIComponent));
    if (!found) return json({ error: `No route ${method} /${segments.join("/")}` }, 404);
    return found.handler(req, id, found.args);
  });
}

export const GET = (req: Request, ctx: Ctx) => dispatch("GET", req, ctx);
export const POST = (req: Request, ctx: Ctx) => dispatch("POST", req, ctx);
export const PUT = (req: Request, ctx: Ctx) => dispatch("PUT", req, ctx);
export const PATCH = (req: Request, ctx: Ctx) => dispatch("PATCH", req, ctx);
export const DELETE = (req: Request, ctx: Ctx) => dispatch("DELETE", req, ctx);
