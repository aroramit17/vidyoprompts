/**
 * Pure frame evaluation: (film, frame, format) → draw list.
 * No canvas, no clock, no randomness. The draw list is plain JSON, so it can be hashed
 * to decide whether a frame actually changed between revisions.
 */
import { lerpColor } from "./color";
import { resolveEase } from "./easing";
import { resolveFilm, type ResolvedFilm } from "./layout";
import {
  COLOR_PROPS,
  PROP_DEFAULTS,
  type Film,
  type FormatId,
  type Keyframe,
  type Layer,
  type LayerProps,
  type Track,
} from "./schema";

export type Matrix = [number, number, number, number, number, number];

export type ResolvedProps = typeof PROP_DEFAULTS & Omit<LayerProps, keyof typeof PROP_DEFAULTS>;

export interface DrawItem {
  id: string;
  type: Layer["type"];
  beat?: string;
  /**
   * Cursor only: frames elapsed since each recent click (0..15). Relative, not absolute,
   * so a frame's state (and cache key) does not change when the timeline shifts.
   */
  clickPhases?: number[];
  matrix: Matrix;
  opacity: number;
  props: ResolvedProps;
}

export interface FrameState {
  width: number;
  height: number;
  background: string;
  fonts: Film["fonts"];
  items: DrawItem[];
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function localMatrix(x: number, y: number, rotationDeg: number, scale: number): Matrix {
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r) * scale;
  const sin = Math.sin(r) * scale;
  return [cos, sin, -sin, cos, x, y];
}

export function defaultEaseFor(film: Film, layer: Layer | null): string {
  if (!layer) return film.motion.classes.camera;
  const cls = layer.class ?? (layer.type === "text" ? "text" : "ui");
  return film.motion.classes[cls];
}

function sortedKeys(keys: Keyframe[]): Keyframe[] {
  return [...keys].sort((a, b) => a.f - b.f);
}

const sortedCache = new WeakMap<Track, Keyframe[]>();
function keysOf(track: Track): Keyframe[] {
  let s = sortedCache.get(track);
  if (!s) {
    s = sortedKeys(track.keys);
    sortedCache.set(track, s);
  }
  return s;
}

export function trackValue(track: Track, frame: number, defaultEase: string, film: Film): number | string {
  const keys = keysOf(track);
  if (frame <= keys[0].f) return keys[0].v;
  const last = keys[keys.length - 1];
  if (frame >= last.f) return last.v;
  let i = 1;
  while (i < keys.length && keys[i].f <= frame) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const span = b.f - a.f;
  const u = span <= 0 ? 1 : (frame - a.f) / span;
  const ease = resolveEase(b.ease ?? defaultEase, film.motion.springs) ?? ((t: number) => t);
  const t = ease(u);
  if (COLOR_PROPS.has(track.prop) || typeof a.v === "string" || typeof b.v === "string") {
    return lerpColor(String(a.v), String(b.v), Math.max(0, Math.min(1, t)));
  }
  return a.v + (b.v - a.v) * t;
}

function layerProps(film: Film, layer: Layer, frame: number): ResolvedProps {
  const props = { ...PROP_DEFAULTS, ...layer.props } as ResolvedProps;
  const ease = defaultEaseFor(film, layer);
  const bag = props as unknown as Record<string, unknown>;
  for (const track of layer.tracks) {
    bag[track.prop] = trackValue(track, frame, ease, film);
  }
  return props;
}

function cameraMatrix(film: ResolvedFilm, frame: number): Matrix {
  const tracks = film.camera?.tracks ?? [];
  if (tracks.length === 0) return IDENTITY;
  let cx = film.width / 2;
  let cy = film.height / 2;
  let zoom = 1;
  let rotation = 0;
  const ease = defaultEaseFor(film, null);
  for (const t of tracks) {
    const v = Number(trackValue(t, frame, ease, film));
    if (t.prop === "x") cx = v;
    else if (t.prop === "y") cy = v;
    else if (t.prop === "zoom" || t.prop === "scale") zoom = v;
    else if (t.prop === "rotation") rotation = v;
  }
  // translate(center) · rotate · scale(zoom) · translate(-camera)
  return multiply(localMatrix(film.width / 2, film.height / 2, rotation, zoom), [1, 0, 0, 1, -cx, -cy]);
}

const indexCache = new WeakMap<Film, Map<string, Layer>>();
function layerIndex(film: Film): Map<string, Layer> {
  let idx = indexCache.get(film);
  if (!idx) {
    idx = new Map(film.layers.map((l) => [l.id, l]));
    indexCache.set(film, idx);
  }
  return idx;
}

export function evaluateFrame(source: Film, frame: number, format: FormatId = "16:9"): FrameState {
  const film = resolveFilm(source, format);
  const index = layerIndex(film);
  const camera = cameraMatrix(film, frame);
  const memo = new Map<string, { matrix: Matrix; opacity: number; props: ResolvedProps } | null>();

  const resolve = (layer: Layer, depth: number): { matrix: Matrix; opacity: number; props: ResolvedProps } | null => {
    if (memo.has(layer.id)) return memo.get(layer.id)!;
    if (frame < layer.from || frame >= layer.to || depth > 32) {
      memo.set(layer.id, null);
      return null;
    }
    const props = layerProps(film, layer, frame);
    const local = localMatrix(props.x, props.y, props.rotation, props.scale);
    let matrix: Matrix;
    let opacity = props.opacity;
    const parent = layer.parent ? index.get(layer.parent) : undefined;
    if (parent) {
      const p = resolve(parent, depth + 1);
      if (!p) {
        memo.set(layer.id, null);
        return null;
      }
      matrix = multiply(p.matrix, local);
      opacity *= p.opacity;
    } else {
      matrix = layer.fixed ? local : multiply(camera, local);
    }
    const out = { matrix, opacity: Math.max(0, Math.min(1, opacity)), props };
    memo.set(layer.id, out);
    return out;
  };

  const items: DrawItem[] = [];
  film.layers.forEach((layer) => {
    const r = resolve(layer, 0);
    if (!r || layer.type === "group" || r.opacity <= 0.001) return;
    items.push({
      id: layer.id,
      type: layer.type,
      beat: layer.beat,
      ...(layer.type === "cursor"
        ? { clickPhases: (r.props.clicks ?? []).map((c) => frame - c).filter((d) => d >= 0 && d < 16) }
        : {}),
      matrix: r.matrix.map((v) => Math.round(v * 1e4) / 1e4) as Matrix,
      opacity: Math.round(r.opacity * 1e4) / 1e4,
      // Absolute click frames are folded into clickPhases above.
      props: layer.type === "cursor" ? { ...r.props, clicks: undefined } : r.props,
    });
  });
  const order = new Map(film.layers.map((l, i) => [l.id, i]));
  items.sort((a, b) => a.props.z - b.props.z || order.get(a.id)! - order.get(b.id)!);

  return { width: film.width, height: film.height, background: film.background, fonts: film.fonts, items };
}

/** Which beat a frame falls in. */
export function beatAt(film: Film, frame: number) {
  return film.beats.find((b) => frame >= b.start && frame < b.end) ?? film.beats[film.beats.length - 1];
}

/**
 * Motion energy between frame f and f+1: how much visible stuff moves.
 * Used to find fast transitions that deserve a contact-sheet strip.
 */
export function motionEnergy(film: Film, frame: number, format: FormatId = "16:9"): number {
  const a = evaluateFrame(film, frame, format);
  const b = evaluateFrame(film, frame + 1, format);
  const byId = new Map(a.items.map((i) => [i.id, i]));
  let energy = 0;
  for (const item of b.items) {
    const prev = byId.get(item.id);
    if (!prev) {
      energy += 40 * item.opacity;
      continue;
    }
    const dx = item.matrix[4] - prev.matrix[4];
    const dy = item.matrix[5] - prev.matrix[5];
    const ds = Math.abs(Math.hypot(item.matrix[0], item.matrix[1]) - Math.hypot(prev.matrix[0], prev.matrix[1]));
    const dz = Math.abs(item.props.zoom - prev.props.zoom);
    energy += Math.hypot(dx, dy) + ds * 400 + dz * 400 + Math.abs(item.opacity - prev.opacity) * 60;
  }
  return energy;
}

export function frameToTimecode(frame: number, fps: number): string {
  const totalSeconds = Math.floor(frame / fps);
  const ff = frame % fps;
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}
