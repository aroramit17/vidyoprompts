/**
 * Format layout rules. The 16:9 program is the source of truth; 9:16 reuses the same
 * assets, timeline and states with different layout rules:
 *  - secondary layers are dropped (fewer simultaneous elements),
 *  - top-level layers are re-placed by horizontal zone: left-zone content stacks on top,
 *    right-zone content below, centred content spreads vertically,
 *  - visuals shrink to fit the narrow width; text keeps its pixel size (so it reads larger)
 *    and wraps to the safe width,
 *  - any explicit `vertical` override from the program wins over the automatic rule.
 */
import { FORMATS, type Film, type FormatId, type Layer, type LayerProps, type Track } from "./schema";

export interface ResolvedFilm extends Film {
  format: FormatId;
  width: number;
  height: number;
}

type Zone = "top" | "bottom" | "center";

const SRC = FORMATS["16:9"];
const V = FORMATS["9:16"];
const SAFE_TEXT_WIDTH = 940;
const SAFE_VISUAL_WIDTH = 1000;

function zoneOf(layer: Layer): Zone {
  const p = layer.props;
  const w = p.w ?? 100;
  const x = p.x ?? 0;
  const ax = p.anchorX ?? 0.5;
  const cx = x + (0.5 - ax) * w;
  if (cx < SRC.width * 0.42) return "top";
  if (cx > SRC.width * 0.58) return "bottom";
  return "center";
}

function mapX(x: number, zone: Zone): number {
  if (zone === "center") return V.width / 2 + (x - SRC.width / 2) * 0.5625;
  const zoneCenter = zone === "top" ? SRC.width * 0.25 : SRC.width * 0.75;
  return V.width / 2 + (x - zoneCenter) * 1.125;
}

function mapY(y: number, zone: Zone): number {
  if (zone === "top") return 140 + y * 0.78;
  if (zone === "bottom") return 960 + y * 0.82;
  return V.height / 2 + (y - SRC.height / 2) * 1.3;
}

function mapTrack(track: Track, fn: (v: number) => number): Track {
  return {
    prop: track.prop,
    keys: track.keys.map((k) => ({ ...k, v: typeof k.v === "number" ? fn(k.v) : k.v })),
  };
}

function verticalLayer(layer: Layer): Layer {
  const override = layer.vertical?.props ?? {};
  const overrideTracks = layer.vertical?.tracks ?? [];
  const overridden = new Set<string>([...Object.keys(override), ...overrideTracks.map((t) => t.prop)]);
  const props: LayerProps = { ...layer.props };
  let tracks = layer.tracks.filter((t) => !overridden.has(t.prop));

  if (!layer.parent) {
    const zone = zoneOf(layer);
    if (!overridden.has("x")) {
      if (props.x !== undefined) props.x = mapX(props.x, zone);
      tracks = tracks.map((t) => (t.prop === "x" ? mapTrack(t, (v) => mapX(v, zone)) : t));
    }
    if (!overridden.has("y")) {
      if (props.y !== undefined) props.y = mapY(props.y, zone);
      tracks = tracks.map((t) => (t.prop === "y" ? mapTrack(t, (v) => mapY(v, zone)) : t));
    }
    if (layer.type === "text") {
      if (!overridden.has("w") && (props.w ?? 0) > SAFE_TEXT_WIDTH) props.w = SAFE_TEXT_WIDTH;
      // Keep left-anchored text inside the safe margins.
      if (!overridden.has("x") && props.x !== undefined) {
        const w = props.w ?? 100;
        const ax = props.anchorX ?? 0.5;
        const left = props.x - ax * w;
        const right = left + w;
        if (left < 60) props.x += 60 - left;
        else if (right > V.width - 60) props.x -= right - (V.width - 60);
      }
    } else if (layer.type === "image" || layer.type === "rect" || layer.type === "ellipse" || layer.type === "group") {
      const w = (props.w ?? 100) * (props.scale ?? 1);
      const k = w > SAFE_VISUAL_WIDTH ? SAFE_VISUAL_WIDTH / w : 1;
      if (k < 1 && !overridden.has("scale")) {
        props.scale = (props.scale ?? 1) * k;
        tracks = tracks.map((t) => (t.prop === "scale" ? mapTrack(t, (v) => v * k) : t));
      }
    }
  }

  return {
    ...layer,
    props: { ...props, ...override },
    tracks: [...tracks, ...overrideTracks],
  };
}

const cache = new WeakMap<Film, Map<FormatId, ResolvedFilm>>();

export function resolveFilm(film: Film, format: FormatId = "16:9"): ResolvedFilm {
  let byFormat = cache.get(film);
  if (!byFormat) {
    byFormat = new Map();
    cache.set(film, byFormat);
  }
  const hit = byFormat.get(format);
  if (hit) return hit;

  const { width, height } = FORMATS[format];
  let resolved: ResolvedFilm;
  if (format === "16:9") {
    resolved = { ...film, format, width, height };
  } else {
    const dropped = new Set(
      film.layers
        .filter((l) => (l.vertical?.hide ?? l.priority === "secondary") === true)
        .map((l) => l.id),
    );
    // Children of dropped layers go too.
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of film.layers) {
        if (!dropped.has(l.id) && l.parent && dropped.has(l.parent)) {
          dropped.add(l.id);
          grew = true;
        }
      }
    }
    const camera = film.camera
      ? {
          tracks: film.camera.tracks.map((t) =>
            t.prop === "x"
              ? mapTrack(t, (v) => V.width / 2 + (v - SRC.width / 2) * 0.5625)
              : t.prop === "y"
                ? mapTrack(t, (v) => V.height / 2 + (v - SRC.height / 2) * 0.5625)
                : t,
          ),
        }
      : undefined;
    resolved = {
      ...film,
      format,
      width,
      height,
      camera,
      layers: film.layers.filter((l) => !dropped.has(l.id)).map(verticalLayer),
    };
  }
  byFormat.set(format, resolved);
  return resolved;
}
