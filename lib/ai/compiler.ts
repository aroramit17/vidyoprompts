/**
 * Offline film compiler: turns approved beats + confirmed assets into a film program
 * without a model. It is the deterministic fallback when no API key is configured, and
 * a reference for the kind of program the model is asked to write.
 *
 * Layout vocabulary (deliberately not "big centered text + gradient + fade + logo"):
 *  - ui:    real screenshot card enters on a spring, the camera of the card zooms into a
 *           named region, a highlight and cursor click land on it, caption is left-set.
 *  - data:  a counter counts to the real number, bars build up, one accent bar wins.
 *  - type:  left-aligned kinetic type with a word reveal and an accent wipe.
 *  - logo:  real logo with a ruled lockup and the memory line.
 */
import { contrastRatio, isColor, luminance, parseColor } from "@/lib/engine/color";
import { DEFAULT_MOTION, type Film, type Keyframe, type Layer, type LayerProps, type Track } from "@/lib/engine/schema";
import type { Asset, Beat, Brief, Region, StyleGuide } from "@/lib/studio/types";

export interface CompileInput {
  brief: Brief;
  style?: StyleGuide;
  assets: Asset[];
  beats: Beat[];
  fonts: { display: string; body: string; mono: string };
  fps?: number;
}

const k = (f: number, v: number | string, ease?: string): Keyframe => (ease ? { f, v, ease } : { f, v });
const tr = (prop: Track["prop"], ...keys: Keyframe[]): Track => ({ prop, keys });

function layer(id: string, type: Layer["type"], beat: string, from: number, to: number, props: LayerProps, tracks: Track[] = [], extra: Partial<Layer> = {}): Layer {
  return { id, type, beat, from, to, props, tracks, ...extra };
}

function saturation(hex: string): number {
  const c = parseColor(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function toHex6(color: string): string {
  const c = parseColor(color);
  if (!c) return color;
  return `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function choosePalette(brief: Brief, style?: StyleGuide) {
  const colors = (style?.palette.length ? style.palette.map((p) => ({ name: p.name, hex: p.hex })) : brief.brandColors)
    .filter((c) => isColor(c.hex))
    .map((c) => ({ name: c.name, hex: toHex6(c.hex) }));
  const byLum = [...colors].sort((a, b) => luminance(a.hex) - luminance(b.hex));
  const darkest = byLum[0];
  const lightest = byLum[byLum.length - 1];
  const ink = darkest && luminance(darkest.hex) < 0.06 ? darkest.hex : "#111111";
  const paper = lightest && luminance(lightest.hex) > 0.82 ? lightest.hex : "#F4F3EF";
  const accentCandidates = [...colors].sort((a, b) => saturation(b.hex) - saturation(a.hex));
  let accent = accentCandidates[0]?.hex ?? "#2F5BFF";
  // Shapes only need to be visible against paper; text needs real contrast.
  if (contrastRatio(accent, paper) < 1.25) accent = ink;
  const accentInk = contrastRatio(accent, paper) >= 3 ? accent : ink;
  // Text on accent fills
  const onAccent = contrastRatio("#ffffff", accent) >= contrastRatio(ink, accent) ? "#ffffff" : ink;
  const palette = [
    { name: "paper", hex: paper },
    { name: "ink", hex: ink },
    { name: "accent", hex: accent },
    ...colors.filter((c) => ![paper, ink, accent].includes(c.hex)),
  ];
  return { paper, ink, accent, accentInk, onAccent, palette };
}

function regionFor(asset: Asset, style?: StyleGuide): Region {
  const fromStyle = style?.assetNotes.find((n) => n.assetId === asset.id)?.regions[0];
  return asset.regions[0] ?? fromStyle ?? { label: "focus", x: 0.3, y: 0.25, w: 0.4, h: 0.4 };
}

/** Where a normalised image region lands inside a cover-fitted, zoomed card (mirrors draw.ts). */
export function regionInCard(imgW: number, imgH: number, cardW: number, cardH: number, region: Region, zoom: number) {
  const boxAspect = cardW / cardH;
  let sw = imgW;
  let sh = imgW / boxAspect;
  if (sh > imgH) {
    sh = imgH;
    sw = imgH * boxAspect;
  }
  sw /= Math.max(1, zoom);
  sh /= Math.max(1, zoom);
  const fx = (region.x + region.w / 2) * imgW;
  const fy = (region.y + region.h / 2) * imgH;
  const sx = Math.max(0, Math.min(imgW - sw, fx - sw / 2));
  const sy = Math.max(0, Math.min(imgH - sh, fy - sh / 2));
  const scale = cardW / sw;
  return {
    x: (region.x * imgW - sx) * scale - cardW / 2,
    y: (region.y * imgH - sy) * scale - cardH / 2,
    w: region.w * imgW * scale,
    h: region.h * imgH * scale,
  };
}

function captionSize(text: string): number {
  const n = text.length;
  if (n <= 28) return 84;
  if (n <= 48) return 68;
  if (n <= 80) return 56;
  return 44;
}

function estimateLines(text: string, fontSize: number, width: number): number {
  const charsPerLine = Math.max(8, Math.floor(width / (fontSize * 0.52)));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

export function parseNumber(text: string): { value: number; decimals: number; template: string } | null {
  const m = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const raw = m[1];
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
  return { value, decimals, template: text.replace(raw, "{n}") };
}

type Template = "ui" | "data" | "type" | "logo";

export function templateFor(beat: Beat, assets: Asset[], isLast: boolean): { template: Template; asset?: Asset } {
  const beatAssets = beat.assets.map((id) => assets.find((a) => a.id === id)).filter((a): a is Asset => !!a);
  const screen = beatAssets.find((a) => a.kind === "screen" || a.kind === "image");
  const logo = beatAssets.find((a) => a.kind === "logo");
  if (logo && (isLast || !screen)) return { template: "logo", asset: logo };
  if (screen) return { template: "ui", asset: screen };
  if (parseNumber(beat.onScreenText)) return { template: "data" };
  return { template: "type" };
}

export function compileFilm(input: CompileInput): Film {
  const fps = input.fps ?? 30;
  const { paper, ink, accent, accentInk, onAccent, palette } = choosePalette(input.brief, input.style);
  const layers: Layer[] = [];
  const beats: Film["beats"] = [];

  let cursorSec = 0;
  input.beats.forEach((beat, index) => {
    const s = Math.round(cursorSec * fps);
    cursorSec += beat.durationSec;
    const e = Math.round(cursorSec * fps);
    const len = e - s;
    const isLast = index === input.beats.length - 1;
    beats.push({ id: beat.id, label: beat.title, start: s, end: e });
    const exitStart = isLast ? e : e - Math.min(10, Math.floor(len / 5));
    const at = (fraction: number) => s + Math.round(len * fraction);
    const id = (name: string) => `${beat.id}-${name}`;
    const { template, asset } = templateFor(beat, input.assets, isLast);
    const eyebrow = `${String(index + 1).padStart(2, "0")} — ${beat.title}`.toUpperCase();
    const text = beat.onScreenText.trim() || beat.title;
    const words = text.split(/\s+/).length;
    const revealFrames = Math.min(Math.round(len * 0.35), 8 + words * 3);
    const exitTracks = (base: number, prop: "y" | "x" = "y"): Track[] =>
      isLast ? [] : [tr("opacity", k(exitStart, 1), k(e, 0, "in")), tr(prop, k(exitStart, base), k(e, base - 40, "in"))];

    const caption = (x: number, y: number, w: number, size: number, startAt: number) => {
      const lines = estimateLines(text, size, w);
      const blockH = lines * size * 1.12;
      layers.push(
        layer(id("eyebrow"), "text", beat.id, s, e, { x, y: y - blockH / 2 - 44, w, anchorX: 0, anchorY: 0.5, text: eyebrow, font: "body", fontSize: 22, fontWeight: 600, letterSpacing: 2.5, color: accentInk }, [
          tr("opacity", k(startAt, 0), k(startAt + 10, 1, "out"), ...(isLast ? [] : [k(exitStart, 1), k(e, 0, "in")])),
        ], { class: "text", priority: "secondary" }),
        layer(id("rule"), "rect", beat.id, s, e, { x: x - 36, y, w: 6, h: blockH, anchorX: 0, anchorY: 0.5, fill: accent, reveal: "down" }, [
          tr("progress", k(startAt, 0), k(startAt + 14, 1, "snap")),
          ...(isLast ? [] : [tr("opacity", k(exitStart, 1), k(e, 0, "in"))]),
        ], { class: "accent" }),
        layer(id("caption"), "text", beat.id, s, e, { x, y, w, anchorX: 0, anchorY: 0.5, text, font: "display", fontSize: size, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1, color: ink, reveal: "words" }, [
          tr("progress", k(startAt, 0), k(startAt + revealFrames, 1, "linear")),
          ...exitTracks(y),
        ], { class: "text" }),
      );
    };

    if (template === "ui" && asset) {
      const imgW = asset.width ?? 1600;
      const imgH = asset.height ?? 1000;
      const maxW = 1060;
      const maxH = 700;
      let cardW = maxW;
      let cardH = (maxW * imgH) / imgW;
      if (cardH > maxH) {
        cardH = maxH;
        cardW = (maxH * imgW) / imgH;
      }
      cardW = Math.round(cardW);
      cardH = Math.round(cardH);
      const cx = 1920 - 120 - cardW / 2;
      const cy = 540;
      const region = regionFor(asset, input.style);
      const zoomTo = Math.max(1.2, Math.min(2.4, 0.62 / Math.max(region.w, region.h)));
      const zoomStart = at(0.38);
      const zoomEnd = at(0.62);
      const hl = regionInCard(imgW, imgH, cardW, cardH, region, zoomTo);
      layers.push(
        layer(id("screen"), "image", beat.id, s, e, { x: cx, y: cy, w: cardW, h: cardH, asset: asset.id, fit: "cover", radius: 18, shadow: "lifted", fill: "#ffffff", focusX: region.x + region.w / 2, focusY: region.y + region.h / 2 }, [
          tr("x", k(s, cx + 420), k(s + 22, cx, "spring:snappy")),
          tr("opacity", k(s, 0), k(s + 8, 1, "out"), ...(isLast ? [] : [k(exitStart, 1), k(e, 0, "in")])),
          tr("zoom", k(zoomStart, 1), k(zoomEnd, zoomTo, "spring:gentle")),
          ...(isLast ? [] : [tr("y", k(exitStart, cy), k(e, cy - 40, "in"))]),
        ], { class: "ui", priority: "primary" }),
        layer(id("highlight"), "rect", beat.id, zoomEnd - 4, e, { x: hl.x + hl.w / 2, y: hl.y + hl.h / 2, w: hl.w + 24, h: hl.h + 24, radius: 12, stroke: accent, strokeWidth: 5 }, [
          tr("opacity", k(zoomEnd - 4, 0), k(zoomEnd + 4, 1, "out")),
          tr("scale", k(zoomEnd - 4, 1.12), k(zoomEnd + 10, 1, "spring:snappy")),
        ], { class: "accent", parent: id("screen"), priority: "secondary" }),
      );
      const clickAt = Math.min(exitStart - 8, zoomEnd + 16);
      const targetX = cx + hl.x + hl.w / 2;
      const targetY = cy + hl.y + hl.h / 2;
      if (clickAt > zoomEnd) {
        layers.push(
          layer(id("cursor"), "cursor", beat.id, zoomEnd - 6, e, { x: cx + cardW / 2 + 60, y: cy + cardH / 2 + 40, w: 30, h: 40, clicks: [clickAt], fill: ink, stroke: "#ffffff" }, [
            tr("x", k(zoomEnd - 6, cx + cardW / 2 + 60), k(clickAt - 2, targetX, "spring:gentle")),
            tr("y", k(zoomEnd - 6, cy + cardH / 2 + 40), k(clickAt - 2, targetY, "spring:gentle")),
            tr("opacity", k(zoomEnd - 6, 0), k(zoomEnd + 2, 1), ...(isLast ? [] : [k(exitStart, 1), k(e, 0)])),
          ], { class: "ui", priority: "secondary" }),
        );
      }
      caption(170, 560, 1920 - 120 - cardW - 170 - 70, Math.min(captionSize(text), 64), s + 10);
    } else if (template === "logo" && asset) {
      const imgW = asset.width ?? 600;
      const imgH = asset.height ?? 200;
      const scale = Math.min(640 / imgW, 280 / imgH);
      const w = Math.round(imgW * scale);
      const h = Math.round(imgH * scale);
      const size = Math.min(captionSize(text), 72);
      layers.push(
        layer(id("band"), "rect", beat.id, s, e, { x: 0, y: 0, w: 28, h: 1080, anchorX: 0, anchorY: 0, fill: accent, reveal: "down" }, [
          tr("progress", k(s, 0), k(s + 16, 1, "snap")),
        ], { class: "accent", priority: "secondary" }),
        layer(id("logo"), "image", beat.id, s, e, { x: 500, y: 540, w, h, asset: asset.id, fit: "contain" }, [
          tr("opacity", k(s + 4, 0), k(s + 12, 1, "out")),
          tr("scale", k(s + 4, 0.9), k(s + 28, 1, "spring:snappy")),
          ...exitTracks(540),
        ], { class: "ui", priority: "primary" }),
        layer(id("divider"), "line", beat.id, s, e, { x: 960, y: 380, x2: 0, y2: 320, stroke: ink, strokeWidth: 3 }, [
          tr("progress", k(s + 10, 0), k(s + 30, 1, "expoOut")),
        ], { class: "accent", priority: "secondary" }),
        layer(id("tagline"), "text", beat.id, s, e, { x: 1040, y: 540, w: 760, anchorX: 0, anchorY: 0.5, text, font: "display", fontSize: size, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1, color: ink, reveal: "words" }, [
          tr("progress", k(s + 18, 0), k(s + 18 + revealFrames, 1, "linear")),
          ...exitTracks(540),
        ], { class: "text", priority: "primary" }),
      );
    } else if (template === "data") {
      // "Teams find 26 months of runway…" → small lead-in, a huge counter, then the rest.
      const num = parseNumber(text)!;
      const at_n = num.template.indexOf("{n}");
      const before = num.template.slice(0, at_n).trim();
      const afterRaw = num.template.slice(at_n + 3);
      const suffix = /^\S*/.exec(afterRaw)![0]; // "%", "x", "k"… stays attached to the number
      const after = afterRaw.slice(suffix.length).trim();
      const counterColor = accentInk;
      if (before) {
        layers.push(
          layer(id("lead"), "text", beat.id, s, e, { x: 170, y: 300, w: 900, anchorX: 0, anchorY: 1, text: before, font: "display", fontSize: 56, fontWeight: 600, color: ink, reveal: "words" }, [
            tr("progress", k(s + 2, 0), k(s + 14, 1, "linear")),
            ...exitTracks(300),
          ], { class: "text" }),
        );
      }
      layers.push(
        layer(id("counter"), "text", beat.id, s, e, { x: 160, y: 480, w: 1000, anchorX: 0, anchorY: 0.5, text: `{n}${suffix}`, n: 0, decimals: num.decimals, font: "display", fontSize: 280, fontWeight: 800, lineHeight: 1, letterSpacing: -8, color: counterColor }, [
          tr("n", k(s + 8, 0), k(at(0.5), num.value, "expoOut")),
          tr("opacity", k(s + 4, 0), k(s + 10, 1)),
          ...exitTracks(480),
        ], { class: "data", priority: "primary" }),
      );
      if (after) {
        layers.push(
          layer(id("label"), "text", beat.id, s, e, { x: 170, y: 660, w: 880, anchorX: 0, anchorY: 0, text: after, font: "display", fontSize: 52, fontWeight: 600, lineHeight: 1.12, color: ink, reveal: "words" }, [
            tr("progress", k(s + 16, 0), k(s + 16 + revealFrames, 1, "linear")),
            ...exitTracks(660),
          ], { class: "text" }),
        );
      }
      const heights = [0.32, 0.48, 0.61, 1];
      heights.forEach((hFrac, i) => {
        const bx = 1240 + i * 140;
        const bh = Math.round(560 * hFrac);
        const startAt = s + 10 + i * 5;
        layers.push(
          layer(id(`bar${i + 1}`), "rect", beat.id, s, e, { x: bx, y: 860, w: 96, h: bh, anchorX: 0.5, anchorY: 1, radius: 6, fill: i === heights.length - 1 ? accent : `${ink}26`, reveal: "up" }, [
            tr("progress", k(startAt, 0), k(startAt + 26, 1, "spring:gentle")),
            ...(isLast ? [] : [tr("opacity", k(exitStart, 1), k(e, 0, "in"))]),
          ], { class: "data", priority: i === heights.length - 1 ? "primary" : "secondary" }),
        );
      });
      layers.push(
        layer(id("baseline"), "line", beat.id, s, e, { x: 1150, y: 862, x2: 600, y2: 0, stroke: ink, strokeWidth: 3 }, [
          tr("progress", k(s + 4, 0), k(s + 20, 1, "expoOut")),
          ...(isLast ? [] : [tr("opacity", k(exitStart, 1), k(e, 0))]),
        ], { class: "accent", priority: "secondary" }),
      );
    } else {
      // Kinetic type
      const size = Math.min(150, Math.max(84, Math.round(5200 / Math.max(14, text.length))));
      layers.push(
        layer(id("slab"), "rect", beat.id, s, e, { x: 1920, y: 0, w: 520, h: 1080, anchorX: 1, anchorY: 0, fill: accent, reveal: "left" }, [
          tr("progress", k(s, 0), k(s + 16, 1, "snap")),
          tr("w", k(s + 16, 520), k(e, 470, "linear")),
          ...(isLast ? [] : [tr("opacity", k(exitStart, 1), k(e, 0, "in"))]),
        ], { class: "accent", priority: "secondary" }),
        layer(id("caption"), "text", beat.id, s, e, { x: 160, y: 540, w: 1180, anchorX: 0, anchorY: 0.5, text, font: "display", fontSize: size, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3, color: ink, reveal: "words" }, [
          tr("progress", k(s + 6, 0), k(s + 6 + revealFrames, 1, "linear")),
          ...exitTracks(540),
        ], { class: "text", priority: "primary" }),
        layer(id("index"), "text", beat.id, s, e, { x: 1780, y: 980, w: 300, anchorX: 1, anchorY: 1, align: "right", text: String(index + 1).padStart(2, "0"), font: "display", fontSize: 120, fontWeight: 800, color: onAccent }, [
          tr("opacity", k(s + 10, 0), k(s + 20, 1, "out"), ...(isLast ? [] : [k(exitStart, 1), k(e, 0)])),
          tr("y", k(s + 10, 1040), k(s + 30, 980, "spring:snappy")),
        ], { class: "accent", priority: "secondary" }),
      );
    }
  });

  const duration = beats[beats.length - 1]?.end ?? fps * 10;
  return {
    version: 1,
    title: input.brief.productName,
    fps,
    duration,
    seed: 1,
    background: paper,
    fonts: input.fonts,
    palette,
    motion: structuredClone(DEFAULT_MOTION),
    // No film-length camera drift: every beat stays independent, so a local edit only
    // changes the frames it touches (and the contact-sheet cache can reuse the rest).
    camera: { tracks: [] },
    beats,
    layers,
  };
}
