/**
 * Contact-sheet frame selection: entry / middle / exit frames for every beat, plus short
 * strips around beat boundaries and around the fastest motion inside a beat.
 */
import { motionEnergy } from "./evaluate";
import type { Film, FormatId } from "./schema";

export type SheetFrameKind = "entry" | "mid" | "exit" | "strip";

export interface SheetFrame {
  frame: number;
  beat: string;
  kind: SheetFrameKind;
  /** Frames belonging to the same strip share a group id. */
  group?: string;
}

const STRIP_OFFSETS = [-6, -3, 0, 3, 6];

export function selectContactFrames(film: Film, format: FormatId = "16:9"): SheetFrame[] {
  const out = new Map<number, SheetFrame>();
  const put = (f: SheetFrame) => {
    if (f.frame < 0 || f.frame >= film.duration) return;
    const existing = out.get(f.frame);
    // Key frames win over strip frames.
    if (!existing || (existing.kind === "strip" && f.kind !== "strip")) out.set(f.frame, f);
  };

  for (const beat of film.beats) {
    const len = beat.end - beat.start;
    // Entry state: after the first motion settles a little (~1/4 in, max 0.5s).
    put({ frame: beat.start + Math.min(Math.round(film.fps / 2), Math.floor(len / 4)), beat: beat.id, kind: "entry" });
    put({ frame: beat.start + Math.floor(len / 2), beat: beat.id, kind: "mid" });
    put({ frame: beat.end - 1, beat: beat.id, kind: "exit" });
  }

  // Strips around boundaries (fast transitions).
  film.beats.slice(1).forEach((beat) => {
    for (const off of STRIP_OFFSETS) put({ frame: beat.start + off, beat: off < 0 ? prevBeat(film, beat.id) : beat.id, kind: "strip", group: `cut-${beat.id}` });
  });

  // Strip around the peak motion within each beat if it is far from boundaries.
  for (const beat of film.beats) {
    let best = -1;
    let bestEnergy = 0;
    for (let f = beat.start + 4; f < beat.end - 4; f += 2) {
      const e = motionEnergy(film, f, format);
      if (e > bestEnergy) {
        bestEnergy = e;
        best = f;
      }
    }
    if (best >= 0 && bestEnergy > 60 && best - beat.start > 8 && beat.end - best > 8) {
      for (const off of [-4, 0, 4]) put({ frame: best + off, beat: beat.id, kind: "strip", group: `peak-${beat.id}` });
    }
  }

  return [...out.values()].sort((a, b) => a.frame - b.frame);
}

function prevBeat(film: Film, id: string): string {
  const i = film.beats.findIndex((b) => b.id === id);
  return film.beats[Math.max(0, i - 1)].id;
}
