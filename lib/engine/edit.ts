/**
 * Local, inspectable edits to a film program. Feedback becomes a list of patch ops,
 * each op touches one thing (a prop, a track, a beat length, a motion rule) and is
 * logged, so a revision is a readable diff instead of a regenerated video.
 */
import { z } from "zod";
import { LayerSchema, SpringSchema, TrackSchema, ANIMATABLE_PROPS, MOTION_CLASSES, type Film, type Layer, type Track } from "./schema";

export const PatchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), layer: z.string(), prop: z.string(), value: z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]) }),
  z.object({ op: z.literal("track"), layer: z.string(), prop: z.enum(ANIMATABLE_PROPS), keys: TrackSchema.shape.keys.or(z.array(z.never()).length(0)) }),
  z.object({ op: z.literal("window"), layer: z.string(), from: z.number().int().min(0), to: z.number().int().min(1) }),
  z.object({ op: z.literal("remove"), layer: z.string() }),
  z.object({ op: z.literal("add"), layerData: LayerSchema }),
  z.object({ op: z.literal("retime"), beat: z.string(), frames: z.number().int().min(6) }),
  z.object({ op: z.literal("ease"), motionClass: z.enum(MOTION_CLASSES), value: z.string() }),
  z.object({ op: z.literal("spring"), spring: SpringSchema }),
  z.object({ op: z.literal("minHold"), frames: z.number().int().min(0) }),
  z.object({ op: z.literal("camera"), prop: z.enum(["x", "y", "zoom", "rotation"]), keys: TrackSchema.shape.keys.or(z.array(z.never()).length(0)) }),
  z.object({ op: z.literal("background"), value: z.string() }),
]);
export type PatchOp = z.infer<typeof PatchOpSchema>;

export function cloneFilm(film: Film): Film {
  return JSON.parse(JSON.stringify(film));
}

/** Map a frame through a beat retime. */
function retimeMapper(start: number, end: number, newLen: number) {
  const oldLen = end - start;
  const delta = newLen - oldLen;
  return (f: number) => {
    if (f <= start) return f;
    if (f >= end) return f + delta;
    return start + Math.round(((f - start) * newLen) / oldLen);
  };
}

export function retimeBeat(film: Film, beatId: string, newLen: number): Film {
  const beat = film.beats.find((b) => b.id === beatId);
  if (!beat) throw new Error(`Unknown beat "${beatId}"`);
  const map = retimeMapper(beat.start, beat.end, Math.max(1, Math.round(newLen)));
  const next = cloneFilm(film);
  const mapTracks = (tracks: Track[] | undefined) =>
    tracks?.forEach((t) => {
      t.keys.forEach((k) => (k.f = map(k.f)));
    });
  next.beats.forEach((b) => {
    b.start = map(b.start);
    b.end = map(b.end);
  });
  next.duration = map(film.duration);
  next.layers.forEach((l) => {
    l.from = map(l.from);
    l.to = Math.max(map(l.from) + 1, map(l.to));
    l.from = Math.min(l.from, l.to - 1);
    mapTracks(l.tracks);
    mapTracks(l.vertical?.tracks);
    if (l.props.clicks) l.props.clicks = l.props.clicks.map(map);
    if (l.vertical?.props?.clicks) l.vertical.props.clicks = l.vertical.props.clicks.map(map);
  });
  mapTracks(next.camera?.tracks);
  return next;
}

export interface PatchResult {
  film: Film;
  applied: string[];
  rejected: string[];
}

const SETTABLE = new Set(Object.keys(LayerSchema.shape.props.shape));

export function applyPatch(film: Film, ops: PatchOp[]): PatchResult {
  let next = cloneFilm(film);
  const applied: string[] = [];
  const rejected: string[] = [];
  const find = (id: string): Layer | undefined => next.layers.find((l) => l.id === id);

  for (const op of ops) {
    switch (op.op) {
      case "set": {
        const layer = find(op.layer);
        if (!layer) {
          rejected.push(`set: unknown layer "${op.layer}"`);
          break;
        }
        // Swapping `asset` is allowed here; validation rejects anything that is not a real asset.
        if (SETTABLE.has(op.prop)) {
          const before = (layer.props as Record<string, unknown>)[op.prop];
          (layer.props as Record<string, unknown>)[op.prop] = op.value;
          applied.push(`${layer.id}.${op.prop}: ${JSON.stringify(before)} → ${JSON.stringify(op.value)}`);
        } else if (op.prop === "priority" && (op.value === "primary" || op.value === "secondary")) {
          layer.priority = op.value;
          applied.push(`${layer.id}.priority → ${op.value}`);
        } else if (op.prop === "class" && MOTION_CLASSES.includes(op.value as never)) {
          layer.class = op.value as Layer["class"];
          applied.push(`${layer.id}.class → ${op.value}`);
        } else rejected.push(`set: "${op.prop}" is not a settable prop`);
        break;
      }
      case "track": {
        const layer = find(op.layer);
        if (!layer) {
          rejected.push(`track: unknown layer "${op.layer}"`);
          break;
        }
        layer.tracks = layer.tracks.filter((t) => t.prop !== op.prop);
        if (op.keys.length > 0) layer.tracks.push({ prop: op.prop, keys: op.keys });
        applied.push(op.keys.length ? `${layer.id}: ${op.prop} track → ${op.keys.length} keys (${op.keys.map((k) => k.f).join(", ")})` : `${layer.id}: removed ${op.prop} track`);
        break;
      }
      case "window": {
        const layer = find(op.layer);
        if (!layer || op.to <= op.from) {
          rejected.push(`window: invalid for "${op.layer}"`);
          break;
        }
        applied.push(`${layer.id}: visible ${layer.from}–${layer.to} → ${op.from}–${op.to}`);
        layer.from = op.from;
        layer.to = op.to;
        break;
      }
      case "remove": {
        const before = next.layers.length;
        next.layers = next.layers.filter((l) => l.id !== op.layer && l.parent !== op.layer);
        if (next.layers.length === before) rejected.push(`remove: unknown layer "${op.layer}"`);
        else applied.push(`removed ${op.layer}`);
        break;
      }
      case "add": {
        if (find(op.layerData.id)) {
          rejected.push(`add: layer "${op.layerData.id}" already exists`);
          break;
        }
        next.layers.push(op.layerData);
        applied.push(`added ${op.layerData.type} layer ${op.layerData.id}`);
        break;
      }
      case "retime": {
        const beat = next.beats.find((b) => b.id === op.beat);
        if (!beat) {
          rejected.push(`retime: unknown beat "${op.beat}"`);
          break;
        }
        const before = beat.end - beat.start;
        next = retimeBeat(next, op.beat, op.frames);
        applied.push(`beat ${op.beat}: ${before} → ${op.frames} frames`);
        break;
      }
      case "ease": {
        applied.push(`motion.${op.motionClass}: ${next.motion.classes[op.motionClass]} → ${op.value}`);
        next.motion.classes[op.motionClass] = op.value;
        break;
      }
      case "spring": {
        const i = next.motion.springs.findIndex((s) => s.name === op.spring.name);
        if (i >= 0) next.motion.springs[i] = op.spring;
        else next.motion.springs.push(op.spring);
        applied.push(`spring ${op.spring.name}: k=${op.spring.stiffness} c=${op.spring.damping} m=${op.spring.mass}`);
        break;
      }
      case "minHold": {
        applied.push(`minHoldFrames: ${next.motion.minHoldFrames} → ${op.frames}`);
        next.motion.minHoldFrames = op.frames;
        break;
      }
      case "camera": {
        const camera = next.camera ?? { tracks: [] };
        camera.tracks = camera.tracks.filter((t) => t.prop !== op.prop);
        if (op.keys.length) camera.tracks.push({ prop: op.prop, keys: op.keys });
        next.camera = camera;
        applied.push(`camera.${op.prop} → ${op.keys.length} keys`);
        break;
      }
      case "background": {
        applied.push(`background: ${next.background} → ${op.value}`);
        next.background = op.value;
        break;
      }
    }
  }
  return { film: next, applied, rejected };
}

/** Frames whose rendered output could differ between two programs (cheap pre-check). */
export function changedLayerIds(a: Film, b: Film): string[] {
  const byId = new Map(a.layers.map((l) => [l.id, JSON.stringify(l)]));
  const changed: string[] = [];
  for (const l of b.layers) if (byId.get(l.id) !== JSON.stringify(l)) changed.push(l.id);
  for (const l of a.layers) if (!b.layers.some((x) => x.id === l.id)) changed.push(l.id);
  return changed;
}
