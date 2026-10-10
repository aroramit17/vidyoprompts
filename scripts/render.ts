/**
 * Re-render a film from an unzipped Studio package (or a project directory), without the app.
 *
 *   npm run render -- --package ./my-film --format 16:9 --out film.mp4
 *   npm run render -- --package ./my-film --frame 120 --out frame.png
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { drawFrame, evaluateFrame, FilmSchema, FORMATS, type Ctx, type FormatId, type ImageResource } from "../lib/engine";
import { BUNDLED_FONTS } from "../lib/studio/fonts";
import type { Asset } from "../lib/studio/types";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const dir = path.resolve(arg("package") ?? arg("project") ?? ".");
  const format = (arg("format", "16:9") as FormatId) ?? "16:9";
  if (!FORMATS[format]) throw new Error(`Unknown format ${format}`);
  const film = FilmSchema.parse(JSON.parse(await fs.readFile(path.join(dir, "film.json"), "utf8")));
  const assets: Asset[] = JSON.parse(await fs.readFile(path.join(dir, "assets.json"), "utf8"));

  for (const f of BUNDLED_FONTS) GlobalFonts.registerFromPath(path.join(__dirname, "..", "public", "fonts", f.file));
  for (const a of assets.filter((x) => x.kind === "font" && x.fontFamily)) GlobalFonts.registerFromPath(path.join(dir, "assets", a.filename), a.fontFamily);
  const images = new Map<string, ImageResource>();
  for (const a of assets.filter((x) => x.mime.startsWith("image/"))) {
    const img = await loadImage(await fs.readFile(path.join(dir, "assets", a.filename)));
    images.set(a.id, { source: img as unknown as CanvasImageSource, width: img.width, height: img.height });
  }
  const { width, height } = FORMATS[format];
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  const frameArg = arg("frame");
  if (frameArg !== undefined) {
    const out = arg("out", `frame-${frameArg}.png`)!;
    drawFrame(ctx, evaluateFrame(film, Number(frameArg), format), { images }, 1);
    await fs.writeFile(out, canvas.toBuffer("image/png"));
    console.log(`Wrote ${out}`);
    return;
  }

  const out = arg("out", `film-${format.replace(":", "x")}.mp4`)!;
  const ff = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(film.fps), "-i", "-", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((resolve, reject) => ff.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`)))));
  for (let f = 0; f < film.duration; f++) {
    drawFrame(ctx, evaluateFrame(film, f, format), { images }, 1);
    if (!ff.stdin.write((canvas as unknown as { data(): Buffer }).data())) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 30 === 0) process.stdout.write(`\r${Math.round((f / film.duration) * 100)}%`);
  }
  ff.stdin.end();
  await done;
  console.log(`\rWrote ${out} (${film.duration} frames, ${format})`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
