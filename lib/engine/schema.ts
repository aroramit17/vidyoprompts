/**
 * The film program: the data the model writes and the deterministic engine renders.
 *
 * A film is a pure function of the frame number: every layer's visual state at frame `f`
 * is computed from its base props and keyframe tracks. There is no clock, no accumulated
 * state and no unseeded randomness, so any frame can be rendered in isolation (seekable)
 * and a change to one value only changes the frames that value touches.
 */
import { z } from "zod";

export const FORMATS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
} as const;
export type FormatId = keyof typeof FORMATS;
export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[];

export const LAYER_TYPES = ["text", "image", "rect", "ellipse", "line", "cursor", "group"] as const;
export const MOTION_CLASSES = ["ui", "text", "data", "camera", "accent"] as const;
export const FONT_ROLES = ["display", "body", "mono"] as const;
export const REVEALS = ["none", "words", "chars", "lines", "left", "right", "up", "down"] as const;

/** Props that may be animated with tracks. Numeric unless noted. */
export const ANIMATABLE_PROPS = [
  "x",
  "y",
  "w",
  "h",
  "opacity",
  "scale",
  "rotation",
  "zoom",
  "focusX",
  "focusY",
  "progress",
  "n",
  "radius",
  "strokeWidth",
  "x2",
  "y2",
  "fontSize",
  "fill", // color
  "color", // color
  "stroke", // color
] as const;
export type AnimatableProp = (typeof ANIMATABLE_PROPS)[number];
export const COLOR_PROPS = new Set<string>(["fill", "color", "stroke"]);

export const KeyframeSchema = z.object({
  /** Absolute frame number. */
  f: z.number().int().min(0),
  /** Numeric value, or a hex color for color props. */
  v: z.union([z.number(), z.string()]),
  /**
   * Easing for the segment that ARRIVES at this key (previous key → this key).
   * One of: linear, in, out, inOut, expoOut, backOut, snap, hold,
   * spring:<springName>, or cubic(x1,y1,x2,y2). Defaults to the layer's motion-class ease.
   */
  ease: z.string().optional(),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const TrackSchema = z.object({
  prop: z.enum(ANIMATABLE_PROPS),
  keys: z.array(KeyframeSchema).min(1),
});
export type Track = z.infer<typeof TrackSchema>;

export const LayerPropsSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    anchorX: z.number(),
    anchorY: z.number(),
    opacity: z.number(),
    scale: z.number(),
    rotation: z.number(),
    z: z.number(),
    fill: z.string(),
    stroke: z.string(),
    strokeWidth: z.number(),
    radius: z.number(),
    shadow: z.enum(["none", "soft", "lifted"]),
    // text
    text: z.string(),
    font: z.enum(FONT_ROLES),
    fontSize: z.number(),
    fontWeight: z.number(),
    lineHeight: z.number(),
    letterSpacing: z.number(),
    align: z.enum(["left", "center", "right"]),
    color: z.string(),
    reveal: z.enum(REVEALS),
    progress: z.number(),
    /** Counter value: `{n}` in text is replaced by this number. */
    n: z.number(),
    decimals: z.number().int(),
    // image
    asset: z.string(),
    fit: z.enum(["cover", "contain"]),
    zoom: z.number(),
    focusX: z.number(),
    focusY: z.number(),
    // line
    x2: z.number(),
    y2: z.number(),
    // cursor
    clicks: z.array(z.number().int()),
  })
  .partial();
export type LayerProps = z.infer<typeof LayerPropsSchema>;

export const LayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  type: z.enum(LAYER_TYPES),
  /** Beat this layer belongs to (for review, retiming and critique). */
  beat: z.string().optional(),
  /** Motion class decides default easing: object-class motion rules. */
  class: z.enum(MOTION_CLASSES).optional(),
  /** Parent layer id: x/y are then relative to the parent's anchor and inherit its transform. */
  parent: z.string().optional(),
  /** Visible on frames [from, to). */
  from: z.number().int().min(0),
  to: z.number().int().min(1),
  /** Ignore the camera (HUD-style). */
  fixed: z.boolean().optional(),
  /** Secondary layers are dropped from the 9:16 layout (fewer simultaneous elements). */
  priority: z.enum(["primary", "secondary"]).optional(),
  props: LayerPropsSchema,
  tracks: z.array(TrackSchema).default([]),
  /** Explicit 9:16 layout overrides. Without them, automatic layout rules apply. */
  vertical: z
    .object({
      hide: z.boolean().optional(),
      props: LayerPropsSchema.optional(),
      tracks: z.array(TrackSchema).optional(),
    })
    .optional(),
});
export type Layer = z.infer<typeof LayerSchema>;

export const SpringSchema = z.object({
  name: z.string().min(1),
  stiffness: z.number().positive(),
  damping: z.number().positive(),
  mass: z.number().positive(),
});
export type Spring = z.infer<typeof SpringSchema>;

export const MotionSchema = z.object({
  springs: z.array(SpringSchema),
  /** Default ease per motion class. */
  classes: z.object({
    ui: z.string(),
    text: z.string(),
    data: z.string(),
    camera: z.string(),
    accent: z.string(),
  }),
  /** Minimum number of frames important text must hold fully readable. */
  minHoldFrames: z.number().int().min(0),
});
export type Motion = z.infer<typeof MotionSchema>;

export const BeatRangeSchema = z.object({
  id: z.string(),
  label: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
});
export type BeatRange = z.infer<typeof BeatRangeSchema>;

export const FilmSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  fps: z.number().int().min(12).max(60),
  duration: z.number().int().min(1),
  /** Seed for any procedural variation. The engine never uses unseeded randomness. */
  seed: z.number().int().default(1),
  background: z.string(),
  fonts: z.object({ display: z.string(), body: z.string(), mono: z.string() }),
  palette: z.array(z.object({ name: z.string(), hex: z.string() })),
  motion: MotionSchema,
  camera: z.object({ tracks: z.array(TrackSchema) }).optional(),
  beats: z.array(BeatRangeSchema).min(1),
  layers: z.array(LayerSchema),
});
export type Film = z.infer<typeof FilmSchema>;

export const DEFAULT_MOTION: Motion = {
  springs: [
    { name: "snappy", stiffness: 220, damping: 26, mass: 1 },
    { name: "gentle", stiffness: 120, damping: 20, mass: 1 },
    { name: "bouncy", stiffness: 180, damping: 12, mass: 1 },
  ],
  classes: {
    ui: "spring:snappy",
    text: "expoOut",
    data: "spring:gentle",
    camera: "inOut",
    accent: "snap",
  },
  minHoldFrames: 36,
};

/** Default prop values, applied before evaluation. */
export const PROP_DEFAULTS: Required<
  Pick<
    LayerProps,
    | "x"
    | "y"
    | "w"
    | "h"
    | "anchorX"
    | "anchorY"
    | "opacity"
    | "scale"
    | "rotation"
    | "z"
    | "strokeWidth"
    | "radius"
    | "fontSize"
    | "fontWeight"
    | "lineHeight"
    | "letterSpacing"
    | "progress"
    | "n"
    | "decimals"
    | "zoom"
    | "focusX"
    | "focusY"
    | "x2"
    | "y2"
  >
> = {
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  anchorX: 0.5,
  anchorY: 0.5,
  opacity: 1,
  scale: 1,
  rotation: 0,
  z: 0,
  strokeWidth: 0,
  radius: 0,
  fontSize: 48,
  fontWeight: 600,
  lineHeight: 1.15,
  letterSpacing: 0,
  progress: 1,
  n: 0,
  decimals: 0,
  zoom: 1,
  focusX: 0.5,
  focusY: 0.5,
  x2: 100,
  y2: 0,
};
