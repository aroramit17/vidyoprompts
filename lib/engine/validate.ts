/**
 * Validation (hard errors that block rendering) and lint (review findings).
 *
 * The asset boundary is enforced here: the model may invent camera and motion, but every
 * image layer must point at a real, user-confirmed asset. A program that references an
 * unknown asset is rejected, it is never rendered with a stand-in.
 */
import { colorDistance, contrastRatio, isColor } from "./color";
import { resolveEase } from "./easing";
import { evaluateFrame } from "./evaluate";
import { FilmSchema, type Film, type Layer } from "./schema";

export interface AssetRef {
  id: string;
  kind: string;
  label: string;
  confirmed: boolean;
  mustUse?: boolean;
}

export interface ValidationContext {
  assets: AssetRef[];
  /** Font families the program may use. */
  fonts: string[];
}

export interface Issue {
  level: "error" | "warning";
  code: string;
  message: string;
  layer?: string;
  beat?: string;
  frame?: number;
}

const NEUTRAL_OK = 60; // rgb distance under which a color counts as "near" a palette/neutral color

export function parseFilm(raw: unknown): { film?: Film; issues: Issue[] } {
  const parsed = FilmSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.slice(0, 30).map((i) => ({
        level: "error" as const,
        code: "schema",
        message: `${i.path.join(".") || "(root)"}: ${i.message}`,
      })),
    };
  }
  return { film: parsed.data, issues: [] };
}

export function validateFilm(film: Film, ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, message: string, extra: Partial<Issue> = {}) =>
    issues.push({ level: "error", code, message, ...extra });
  const warn = (code: string, message: string, extra: Partial<Issue> = {}) =>
    issues.push({ level: "warning", code, message, ...extra });

  // Beats: contiguous, covering the timeline.
  const beats = [...film.beats].sort((a, b) => a.start - b.start);
  if (beats[0] && beats[0].start !== 0) err("beats", `First beat must start at frame 0 (starts at ${beats[0].start}).`);
  beats.forEach((b, i) => {
    if (b.end <= b.start) err("beats", `Beat "${b.id}" ends before it starts.`, { beat: b.id });
    const next = beats[i + 1];
    if (next && next.start !== b.end) err("beats", `Gap or overlap between beats "${b.id}" and "${next.id}".`, { beat: b.id });
  });
  const lastBeat = beats[beats.length - 1];
  if (lastBeat && lastBeat.end !== film.duration) err("beats", `Last beat must end at duration ${film.duration} (ends at ${lastBeat.end}).`);
  const beatIds = new Set(film.beats.map((b) => b.id));

  // Springs and eases.
  for (const [cls, ease] of Object.entries(film.motion.classes)) {
    if (!resolveEase(ease, film.motion.springs)) err("ease", `Motion class "${cls}" uses unknown ease "${ease}".`);
  }

  // Colors and fonts.
  if (!isColor(film.background)) err("color", `Background "${film.background}" is not a color.`);
  for (const role of ["display", "body", "mono"] as const) {
    const family = film.fonts[role];
    if (!ctx.fonts.includes(family)) err("font", `Font "${family}" (${role}) is not a confirmed font. Allowed: ${ctx.fonts.join(", ")}.`);
  }

  const assetById = new Map(ctx.assets.map((a) => [a.id, a]));
  const ids = new Set<string>();
  const layerById = new Map(film.layers.map((l) => [l.id, l]));

  for (const layer of film.layers) {
    const at = { layer: layer.id, beat: layer.beat };
    if (ids.has(layer.id)) err("layer", `Duplicate layer id "${layer.id}".`, at);
    ids.add(layer.id);
    if (layer.to <= layer.from) err("layer", `Layer "${layer.id}" has an empty visibility window.`, at);
    if (layer.from > film.duration) warn("layer", `Layer "${layer.id}" starts after the film ends.`, at);
    if (layer.beat && !beatIds.has(layer.beat)) err("layer", `Layer "${layer.id}" references unknown beat "${layer.beat}".`, at);
    if (layer.parent) {
      if (!layerById.has(layer.parent)) err("parent", `Layer "${layer.id}" has unknown parent "${layer.parent}".`, at);
      // Cycle check
      const seen = new Set<string>([layer.id]);
      let cur = layerById.get(layer.parent);
      while (cur) {
        if (seen.has(cur.id)) {
          err("parent", `Parent cycle through "${layer.id}".`, at);
          break;
        }
        seen.add(cur.id);
        cur = cur.parent ? layerById.get(cur.parent) : undefined;
      }
    }

    if (layer.type === "image") {
      const assetId = layer.props.asset;
      const asset = assetId ? assetById.get(assetId) : undefined;
      if (!assetId) err("asset", `Image layer "${layer.id}" has no asset.`, at);
      else if (!asset) err("asset-invented", `Image layer "${layer.id}" references "${assetId}", which is not a real uploaded asset. The model may not invent assets.`, at);
      else if (!asset.confirmed) err("asset-unconfirmed", `Image layer "${layer.id}" uses unconfirmed asset "${asset.label}".`, at);
      else if (asset.kind === "font" || asset.kind === "reference")
        err("asset-kind", `Image layer "${layer.id}" uses a ${asset.kind} asset "${asset.label}" as footage; references are for style only.`, at);
    }
    if (layer.type === "text" && !layer.props.text) err("text", `Text layer "${layer.id}" has no text.`, at);

    for (const key of ["fill", "stroke", "color"] as const) {
      const v = layer.props[key];
      if (v !== undefined && !isColor(v)) err("color", `Layer "${layer.id}" ${key} "${v}" is not a color.`, at);
    }
    for (const track of [...layer.tracks, ...(layer.vertical?.tracks ?? [])]) {
      for (const k of track.keys) {
        if (k.ease && !resolveEase(k.ease, film.motion.springs))
          err("ease", `Layer "${layer.id}" track ${track.prop} uses unknown ease "${k.ease}".`, at);
        if ((track.prop === "fill" || track.prop === "color" || track.prop === "stroke") && !isColor(k.v))
          err("color", `Layer "${layer.id}" track ${track.prop} has non-color value "${k.v}".`, at);
        if (!(track.prop === "fill" || track.prop === "color" || track.prop === "stroke") && typeof k.v !== "number")
          err("track", `Layer "${layer.id}" track ${track.prop} must have numeric values.`, at);
      }
    }
  }

  // Palette discipline: colors should come from the brand palette or near-neutrals.
  const palette = film.palette.map((p) => p.hex).filter(isColor);
  const neutrals = ["#ffffff", "#000000", "#111111", "#f5f5f5", "#e5e5e5", "#777777", "#333333"];
  const offPalette = new Set<string>();
  for (const layer of film.layers) {
    for (const key of ["fill", "stroke", "color"] as const) {
      const v = layer.props[key];
      if (!v || !isColor(v) || offPalette.has(v)) continue;
      const near = [...palette, ...neutrals].some((c) => colorDistance(c, v) < NEUTRAL_OK);
      if (!near) offPalette.add(v);
    }
  }
  if (offPalette.size > 0) warn("palette", `Colors outside the brand palette: ${[...offPalette].slice(0, 6).join(", ")}.`);

  return issues;
}

export interface LintContext extends ValidationContext {
  mustUseAssetIds: string[];
}

function visibleWindow(layer: Layer) {
  return layer.to - layer.from;
}

/**
 * Review lint: deterministic checks that catch the usual failure modes before a human
 * looks at the contact sheet (unused must-use assets, unreadable holds, static beats,
 * fade-only motion, the generic centered-text look, crowded frames, low contrast).
 */
export function lintFilm(film: Film, ctx: LintContext): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Issue["level"], code: string, message: string, extra: Partial<Issue> = {}) =>
    issues.push({ level, code, message, ...extra });

  // Must-use assets appear on screen.
  const used = new Set(film.layers.filter((l) => l.type === "image").map((l) => l.props.asset));
  for (const id of ctx.mustUseAssetIds) {
    if (!used.has(id)) {
      const a = ctx.assets.find((x) => x.id === id);
      add("error", "must-use-missing", `Must-use asset "${a?.label ?? id}" never appears in the film.`);
    }
  }

  // Readability holds: text needs ~0.25s/word + minimum hold, measured at full progress.
  for (const layer of film.layers.filter((l) => l.type === "text" && !l.parent)) {
    const words = (layer.props.text ?? "").split(/\s+/).filter(Boolean).length;
    const needed = Math.max(film.motion.minHoldFrames, Math.round(words * 0.25 * film.fps));
    // Frames where the layer is fully revealed and mostly opaque.
    let readable = 0;
    const step = 2;
    for (let f = layer.from; f < layer.to; f += step) {
      const state = evaluateFrame(film, f);
      const item = state.items.find((i) => i.id === layer.id);
      if (item && item.opacity > 0.85 && item.props.progress >= 0.99) readable += step;
    }
    if (readable < needed)
      add("warning", "hold-short", `"${(layer.props.text ?? "").slice(0, 40)}" is readable for ${(readable / film.fps).toFixed(1)}s; needs ≥${(needed / film.fps).toFixed(1)}s.`, {
        layer: layer.id,
        beat: layer.beat,
        frame: layer.from,
      });
  }

  // Static beats and fade-only motion.
  const nonOpacityProps = new Set(["x", "y", "scale", "zoom", "focusX", "focusY", "w", "h", "rotation", "progress", "x2", "y2", "n"]);
  let fadeOnlyBeats = 0;
  for (const beat of film.beats) {
    const layers = film.layers.filter((l) => l.beat === beat.id || (l.from < beat.end && l.to > beat.start));
    const tracks = layers.flatMap((l) => l.tracks.filter((t) => t.keys.some((k) => k.f >= beat.start && k.f < beat.end)));
    const cameraMoves = (film.camera?.tracks ?? []).some((t) => t.keys.some((k) => k.f >= beat.start && k.f < beat.end));
    if (tracks.length === 0 && !cameraMoves)
      add("warning", "static-beat", `Beat "${beat.label}" has no visual change. Every beat needs a reason on screen.`, { beat: beat.id, frame: beat.start });
    else if (!cameraMoves && tracks.every((t) => !nonOpacityProps.has(t.prop))) fadeOnlyBeats++;
  }
  if (fadeOnlyBeats >= Math.max(1, Math.ceil(film.beats.length / 2)))
    add("warning", "fade-only", `${fadeOnlyBeats} beats only fade things in and out. Use spatial motion, zooms or reveals that carry meaning.`);

  // Generic look: big centered text over a flat background, then logo.
  const textLayers = film.layers.filter((l) => l.type === "text" && !l.parent);
  const centered = textLayers.filter(
    (l) => (l.props.align ?? "left") === "center" && Math.abs((l.props.x ?? 0) - 960) < 120 && Math.abs((l.props.y ?? 0) - 540) < 160,
  );
  const imageBeats = new Set(film.layers.filter((l) => l.type === "image").map((l) => l.beat));
  if (textLayers.length > 0 && centered.length / textLayers.length > 0.6 && imageBeats.size <= 1)
    add("warning", "generic-look", "Most text is big, centered and alone on screen. This is the generic launch-video look; anchor type to the product UI instead.");

  // Crowding and contrast, sampled at each beat's midpoint.
  for (const beat of film.beats) {
    const mid = Math.floor((beat.start + beat.end) / 2);
    const state = evaluateFrame(film, mid);
    const visible = state.items.filter((i) => i.opacity > 0.3 && i.type !== "line");
    if (visible.length > 9)
      add("warning", "crowded", `Beat "${beat.label}" shows ${visible.length} elements at once. Hierarchy suffers; cut or stage them.`, { beat: beat.id, frame: mid });
    for (const item of visible.filter((i) => i.type === "text")) {
      const color = item.props.color ?? "#111111";
      // Approximate the backdrop with the nearest filled rect beneath, else the film background.
      const below = state.items
        .slice(0, state.items.indexOf(item))
        .reverse()
        .find((i) => (i.type === "rect" || i.type === "ellipse") && i.props.fill && i.opacity > 0.8 && covers(i, item));
      const bg = below?.props.fill ?? film.background;
      if (isColor(color) && isColor(bg) && contrastRatio(color, bg) < 3)
        add("warning", "contrast", `Low contrast (${contrastRatio(color, bg).toFixed(1)}:1) for "${(item.props.text ?? "").slice(0, 30)}".`, {
          layer: item.id,
          beat: beat.id,
          frame: mid,
        });
    }
  }

  // Simultaneous motion: too many things moving in the same frames hurts focus.
  for (const beat of film.beats) {
    const starts = new Map<number, Set<string>>();
    for (const l of film.layers) {
      for (const t of l.tracks) {
        for (const k of t.keys) {
          if (k.f < beat.start || k.f >= beat.end || t.prop === "opacity") continue;
          const bucket = Math.floor(k.f / 6);
          if (!starts.has(bucket)) starts.set(bucket, new Set());
          starts.get(bucket)!.add(l.id);
        }
      }
    }
    const peak = Math.max(0, ...[...starts.values()].map((s) => s.size));
    if (peak > 5) add("warning", "focus", `In "${beat.label}" ${peak} elements move at the same moment. Stagger them so the eye has one target.`, { beat: beat.id });
  }

  for (const layer of film.layers) {
    if (visibleWindow(layer) < 6 && layer.type !== "line")
      add("warning", "flash", `Layer "${layer.id}" is on screen for under 0.2s.`, { layer: layer.id, beat: layer.beat, frame: layer.from });
  }
  return issues;
}

function covers(a: { matrix: number[]; props: { w: number; h: number; anchorX: number; anchorY: number } }, b: { matrix: number[] }) {
  const sx = Math.hypot(a.matrix[0], a.matrix[1]);
  const left = a.matrix[4] - a.props.w * a.props.anchorX * sx;
  const top = a.matrix[5] - a.props.h * a.props.anchorY * sx;
  const right = left + a.props.w * sx;
  const bottom = top + a.props.h * sx;
  return b.matrix[4] >= left && b.matrix[4] <= right && b.matrix[5] >= top && b.matrix[5] <= bottom;
}
