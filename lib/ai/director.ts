/**
 * The Director is the AI layer. It is deliberately narrow: each method turns approved
 * files into the next file. Two implementations exist:
 *  - ClaudeDirector: Claude via the Anthropic SDK (structured outputs, vision).
 *  - OfflineDirector: deterministic heuristics, used when no API key is configured and in tests.
 */
import { z } from "zod";
import type { Film, Issue, PatchOp } from "@/lib/engine";
import type { Asset, Beat, Brief, Flag, ProductionDoc, StyleGuide } from "@/lib/studio/types";

export interface EncodedImage {
  mediaType: "image/png" | "image/jpeg";
  data: string; // base64
}

export interface DirectorContext {
  brief: Brief;
  production?: ProductionDoc;
  style?: StyleGuide;
  /** Confirmed assets only, unless a method says otherwise. */
  assets: Asset[];
  beats?: Beat[];
  /** Font families the film may use. */
  fonts: string[];
  /** Load a downscaled image of an asset for vision. */
  loadImage?: (asset: Asset) => Promise<EncodedImage | null>;
}

export const JustificationSchema = z.object({
  verdict: z.enum(["keep", "merge", "cut", "rework"]),
  justification: z.string(),
  suggestion: z.string(),
});
export type Justification = z.infer<typeof JustificationSchema>;

export const CritiqueFlagSchema = z.object({
  frame: z.number().int().nullable(),
  beat: z.string().nullable(),
  category: z.enum(["timing", "hierarchy", "missing-asset", "weak-focus", "readability", "generic", "motion", "other"]),
  note: z.string(),
});
export type CritiqueFlag = z.infer<typeof CritiqueFlagSchema>;

export interface CritiqueInput {
  film: Film;
  sheet: { frame: number; beat: string; kind: string }[];
  /** Contact sheet composite image(s). */
  images: EncodedImage[];
  lint: Issue[];
}

export interface FilmResult {
  film: Film;
  notes: string;
  attempts: number;
}

export interface RevisionResult {
  ops: PatchOp[];
  summary: string;
}

export interface Director {
  readonly name: "claude" | "offline";
  productionDoc(ctx: DirectorContext): Promise<ProductionDoc>;
  styleGuide(ctx: DirectorContext): Promise<StyleGuide>;
  beats(ctx: DirectorContext): Promise<Beat[]>;
  justifyBeat(ctx: DirectorContext, beatId: string): Promise<Justification>;
  film(ctx: DirectorContext, validate: (film: unknown) => { film?: Film; errors: string[] }): Promise<FilmResult>;
  critique(ctx: DirectorContext, input: CritiqueInput): Promise<CritiqueFlag[]>;
  revise(ctx: DirectorContext, film: Film, flags: Flag[]): Promise<RevisionResult>;
}
