/**
 * Studio project files. Every decision lives in an inspectable JSON file inside the
 * project directory; the UI and the AI only ever read and write these files.
 */
import { z } from "zod";

export const GATES = ["brief", "assets", "beats", "film", "review", "export"] as const;
export type GateId = (typeof GATES)[number];

export const GATE_LABELS: Record<GateId, string> = {
  brief: "Director's brief",
  assets: "Assets & style",
  beats: "Beats & states",
  film: "Film program",
  review: "Contact-sheet review",
  export: "Export & package",
};

export const ASSET_KINDS = ["logo", "screen", "image", "font", "reference", "other"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const MustUseSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  kind: z.enum(["logo", "screen", "image", "font", "color", "other"]),
  note: z.string().default(""),
});
export type MustUse = z.infer<typeof MustUseSchema>;

export const BriefSchema = z.object({
  productName: z.string().min(1, "Product name is required"),
  memoryGoal: z.string().min(1, "The one thing the viewer should remember is required"),
  audience: z.string().default(""),
  durationSec: z.number().min(6).max(90).default(20),
  mustUse: z.array(MustUseSchema).default([]),
  brandColors: z.array(z.object({ name: z.string(), hex: z.string() })).default([]),
  fonts: z.array(z.object({ role: z.enum(["display", "body", "mono"]), family: z.string() })).default([]),
  forbidden: z.array(z.string()).default([]),
  references: z.array(z.object({ kind: z.enum(["url", "asset", "note"]), value: z.string(), note: z.string().default("") })).default([]),
  siteUrl: z.string().default(""),
  notes: z.string().default(""),
});
export type Brief = z.infer<typeof BriefSchema>;

/** AI-expanded production document. Reviewed and approved before any code is written. */
export const ProductionDocSchema = z.object({
  logline: z.string(),
  memoryGoal: z.string(),
  audience: z.string(),
  narrativeArc: z.array(z.string()),
  toneAndPacing: z.string(),
  visualApproach: z.string(),
  motionPrinciples: z.array(z.string()),
  assetBoundary: z.object({
    mustUse: z.array(z.string()),
    modelMayInvent: z.array(z.string()),
    modelMayNotInvent: z.array(z.string()),
  }),
  forbidden: z.array(z.string()),
  openQuestions: z.array(z.string()),
  durationSec: z.number(),
});
export type ProductionDoc = z.infer<typeof ProductionDocSchema>;

export const RegionSchema = z.object({
  label: z.string(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type Region = z.infer<typeof RegionSchema>;

export const AssetSchema = z.object({
  id: z.string(),
  filename: z.string(),
  kind: z.enum(ASSET_KINDS),
  label: z.string(),
  mime: z.string(),
  bytes: z.number(),
  sha1: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  source: z.enum(["upload", "site", "package"]),
  sourceUrl: z.string().optional(),
  /** Nothing reaches the film until a person confirms it is real and approved for use. */
  confirmed: z.boolean(),
  /** Which must-use brief item this asset satisfies. */
  mustUseId: z.string().optional(),
  description: z.string().default(""),
  regions: z.array(RegionSchema).default([]),
  fontFamily: z.string().optional(),
  createdAt: z.string(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const StyleGuideSchema = z.object({
  summary: z.string(),
  palette: z.array(z.object({ name: z.string(), hex: z.string(), usage: z.string() })),
  typography: z.object({ display: z.string(), body: z.string(), rules: z.array(z.string()) }),
  motionCharacter: z.string(),
  composition: z.array(z.string()),
  doNot: z.array(z.string()),
  assetNotes: z.array(
    z.object({
      assetId: z.string(),
      description: z.string(),
      regions: z.array(RegionSchema),
    }),
  ),
});
export type StyleGuide = z.infer<typeof StyleGuideSchema>;

export const ComponentStateSchema = z.object({
  size: z.string(),
  color: z.string(),
  content: z.string(),
  position: z.string(),
});

export const BeatSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationSec: z.number().min(0.5).max(30),
  purpose: z.string(),
  entryState: z.string(),
  exitState: z.string(),
  keyVisualChange: z.string(),
  onScreenText: z.string(),
  assets: z.array(z.string()),
  components: z.array(
    z.object({
      name: z.string(),
      entry: ComponentStateSchema,
      exit: ComponentStateSchema,
    }),
  ),
  justification: z.string().default(""),
});
export type Beat = z.infer<typeof BeatSchema>;

export const FLAG_CATEGORIES = ["timing", "hierarchy", "missing-asset", "weak-focus", "readability", "generic", "motion", "other"] as const;
export type FlagCategory = (typeof FLAG_CATEGORIES)[number];

export const FlagSchema = z.object({
  id: z.string(),
  frame: z.number().int().nullable(),
  beat: z.string().nullable(),
  category: z.enum(FLAG_CATEGORIES),
  note: z.string(),
  source: z.enum(["user", "ai", "lint"]),
  status: z.enum(["open", "addressed", "dismissed"]),
  createdAt: z.string(),
});
export type Flag = z.infer<typeof FlagSchema>;

export interface SheetEntry {
  frame: number;
  beat: string;
  kind: "entry" | "mid" | "exit" | "strip";
  group?: string;
  file: string;
  hash: string;
  reused: boolean;
}

export interface ContactSheet {
  revision: number;
  format: "16:9" | "9:16";
  filmRevision: number;
  createdAt: string;
  frames: SheetEntry[];
  /** Composite pages (PNG), numbered frames in sheet order. */
  composites: string[];
  rendered: number;
  reused: number;
  ms: number;
}

export interface FilmRevision {
  revision: number;
  createdAt: string;
  source: "ai" | "offline" | "manual" | "patch" | "retime" | "motion";
  summary: string;
  changes: string[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Approval timestamps per gate. Approving re-locks nothing; regenerating clears downstream. */
  approvals: Partial<Record<GateId, string>>;
  filmRevision: number;
  /** Contact sheet revision (16:9) that was approved, so export knows what it is exporting. */
  approvedSheet?: number;
  /** Hash of the beats the current film program was generated from. */
  filmBasis?: string;
  parentProject?: string;
}

export interface ExportInfo {
  format: "16:9" | "9:16";
  file: string;
  filmRevision: number;
  createdAt: string;
  bytes: number;
  frames: number;
}

export interface Job {
  id: string;
  projectId: string;
  kind: "export" | "contact-sheet";
  format: "16:9" | "9:16";
  status: "running" | "done" | "error";
  progress: number;
  message: string;
  result?: unknown;
  startedAt: string;
  finishedAt?: string;
}
