import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  applyPatch,
  DEFAULT_MOTION,
  drawFrame,
  evaluateFrame,
  FilmSchema,
  resolveEase,
  resolveFilm,
  retimeBeat,
  selectContactFrames,
  springSettleTime,
  springValue,
  trackValue,
  validateFilm,
  lintFilm,
  type Ctx,
  type Film,
} from "@/lib/engine";

function sampleFilm(): Film {
  return FilmSchema.parse({
    version: 1,
    title: "Test",
    fps: 30,
    duration: 120,
    background: "#F4F3EF",
    fonts: { display: "Inter Display", body: "Inter", mono: "Inter" },
    palette: [{ name: "accent", hex: "#2F5BFF" }],
    motion: DEFAULT_MOTION,
    beats: [
      { id: "b1", label: "One", start: 0, end: 60 },
      { id: "b2", label: "Two", start: 60, end: 120 },
    ],
    layers: [
      {
        id: "title",
        type: "text",
        beat: "b1",
        from: 0,
        to: 60,
        props: { x: 160, y: 540, w: 900, anchorX: 0, text: "Ship films, not prompts", fontSize: 90, color: "#111111", reveal: "words" },
        tracks: [
          { prop: "progress", keys: [{ f: 0, v: 0 }, { f: 20, v: 1, ease: "linear" }] },
          { prop: "x", keys: [{ f: 0, v: 100 }, { f: 30, v: 160, ease: "spring:snappy" }] },
        ],
      },
      {
        id: "card",
        type: "rect",
        beat: "b2",
        from: 60,
        to: 120,
        props: { x: 1300, y: 540, w: 800, h: 500, fill: "#2F5BFF", radius: 20 },
        tracks: [{ prop: "scale", keys: [{ f: 60, v: 0.8 }, { f: 90, v: 1 }] }],
      },
      {
        id: "chip",
        type: "rect",
        beat: "b2",
        parent: "card",
        priority: "secondary",
        from: 60,
        to: 120,
        props: { x: 0, y: 0, w: 100, h: 40, fill: "#ffffff" },
        tracks: [],
      },
    ],
  });
}

describe("easing", () => {
  it("springs settle exactly at the end of their segment", () => {
    const ease = resolveEase("spring:snappy", DEFAULT_MOTION.springs)!;
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(Math.abs(ease(0.999) - 1)).toBeLessThan(0.01);
    const s = DEFAULT_MOTION.springs[2];
    expect(springValue(s, springSettleTime(s))).toBeCloseTo(1, 2);
  });

  it("supports presets, cubic() and rejects unknown names", () => {
    expect(resolveEase("inOut", [])!(0.5)).toBeCloseTo(0.5, 2);
    expect(resolveEase("cubic(0.2,0,0,1)", [])!(1)).toBe(1);
    expect(resolveEase("wobble", [])).toBeNull();
    expect(resolveEase("spring:nope", DEFAULT_MOTION.springs)).toBeNull();
  });
});

describe("evaluation", () => {
  it("holds values outside keys and interpolates inside", () => {
    const film = sampleFilm();
    const track = film.layers[1].tracks[0];
    expect(trackValue(track, 0, "linear", film)).toBe(0.8);
    expect(trackValue(track, 75, "linear", film)).toBeCloseTo(0.9, 5);
    expect(trackValue(track, 200, "linear", film)).toBe(1);
  });

  it("is a pure, seekable function of the frame", () => {
    const film = sampleFilm();
    const forward = [10, 50, 70, 100].map((f) => JSON.stringify(evaluateFrame(film, f)));
    const backward = [100, 70, 50, 10].map((f) => JSON.stringify(evaluateFrame(film, f))).reverse();
    expect(forward).toEqual(backward);
  });

  it("composes parent transforms", () => {
    const film = sampleFilm();
    const state = evaluateFrame(film, 60);
    const chip = state.items.find((i) => i.id === "chip")!;
    expect(chip.matrix[0]).toBeCloseTo(0.8, 5); // inherits the card's scale
    expect(chip.matrix[4]).toBeCloseTo(1300, 5);
  });

  it("renders identical pixels for the same frame", () => {
    const film = sampleFilm();
    const render = () => {
      const c = createCanvas(480, 270);
      drawFrame(c.getContext("2d") as unknown as Ctx, evaluateFrame(film, 15), { images: new Map() }, 0.25);
      return c.toBuffer("image/png");
    };
    expect(render().equals(render())).toBe(true);
  });

  it("engine source has no clocks or unseeded randomness", () => {
    const dir = path.join(__dirname, "..", "lib", "engine");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date\(/);
    }
  });
});

describe("formats", () => {
  it("9:16 drops secondary layers and keeps the timeline", () => {
    const film = sampleFilm();
    const v = resolveFilm(film, "9:16");
    expect(v.width).toBe(1080);
    expect(v.layers.find((l) => l.id === "chip")).toBeUndefined();
    expect(v.duration).toBe(film.duration);
    const title = v.layers.find((l) => l.id === "title")!;
    expect(title.props.w).toBeLessThanOrEqual(940);
    expect(title.props.x!).toBeGreaterThanOrEqual(60);
  });
});

describe("validation", () => {
  it("rejects invented assets", () => {
    const film = sampleFilm();
    film.layers.push({ id: "fake", type: "image", beat: "b2", from: 60, to: 120, props: { asset: "made-up-dashboard" }, tracks: [] });
    const issues = validateFilm(film, { assets: [], fonts: ["Inter", "Inter Display"] });
    expect(issues.some((i) => i.code === "asset-invented")).toBe(true);
  });

  it("rejects fonts that are not available", () => {
    const film = sampleFilm();
    film.fonts.display = "Comic Sans MS";
    expect(validateFilm(film, { assets: [], fonts: ["Inter", "Inter Display"] }).some((i) => i.code === "font")).toBe(true);
  });

  it("lint flags short holds and missing must-use assets", () => {
    const film = sampleFilm();
    film.layers[0].to = 40; // fully revealed at 20, gone at 40: 0.7s of reading time
    const issues = lintFilm(film, { assets: [{ id: "logo", kind: "logo", label: "Logo", confirmed: true }], fonts: ["Inter"], mustUseAssetIds: ["logo"] });
    expect(issues.some((i) => i.code === "must-use-missing")).toBe(true);
    expect(issues.some((i) => i.code === "hold-short")).toBe(true);
  });
});

describe("local edits", () => {
  it("retiming a beat shifts everything after it and keeps beats contiguous", () => {
    const film = retimeBeat(sampleFilm(), "b1", 90);
    expect(film.beats).toEqual([
      { id: "b1", label: "One", start: 0, end: 90 },
      { id: "b2", label: "Two", start: 90, end: 150 },
    ]);
    expect(film.duration).toBe(150);
    expect(film.layers.find((l) => l.id === "card")!.from).toBe(90);
    expect(validateFilm(film, { assets: [], fonts: ["Inter", "Inter Display"] }).filter((i) => i.level === "error")).toEqual([]);
  });

  it("a one-value patch only changes frames that value touches", () => {
    const film = sampleFilm();
    const { film: next, applied } = applyPatch(film, [{ op: "set", layer: "card", prop: "fill", value: "#111111" }]);
    expect(applied).toHaveLength(1);
    expect(JSON.stringify(evaluateFrame(film, 30))).toBe(JSON.stringify(evaluateFrame(next, 30)));
    expect(JSON.stringify(evaluateFrame(film, 90))).not.toBe(JSON.stringify(evaluateFrame(next, 90)));
  });

  it("selects entry, mid, exit and strip frames for the contact sheet", () => {
    const frames = selectContactFrames(sampleFilm());
    const kinds = new Set(frames.map((f) => f.kind));
    expect(kinds).toEqual(new Set(["entry", "mid", "exit", "strip"]));
    expect(frames.every((f) => f.frame >= 0 && f.frame < 120)).toBe(true);
  });
});
