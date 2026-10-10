/**
 * Gates: hard stops between production stages. Pure functions of the project state so
 * the server enforces them and the UI explains them with the same logic.
 */
import type { Film, Issue } from "@/lib/engine";
import { GATES, type Asset, type Beat, type Brief, type ContactSheet, type Flag, type GateId, type ProductionDoc, type ProjectMeta, type StyleGuide } from "./types";

export interface ProjectState {
  meta: ProjectMeta;
  brief: Brief | null;
  production: ProductionDoc | null;
  assets: Asset[];
  style: StyleGuide | null;
  beats: Beat[] | null;
  film: Film | null;
  filmIssues: Issue[];
  sheets: ContactSheet[];
  flags: Flag[];
}

export type GateStatus = "locked" | "open" | "approved";

export interface GateInfo {
  id: GateId;
  status: GateStatus;
  /** Why the gate cannot be approved (or why it is locked). Empty when it can be approved. */
  blockers: string[];
}

/** Must-use brief items that are not yet satisfied by a confirmed asset (or brief data). */
export function missingMustUse(brief: Brief, assets: Asset[]): string[] {
  const missing: string[] = [];
  for (const item of brief.mustUse) {
    if (item.kind === "color") {
      if (brief.brandColors.length === 0) missing.push(`${item.label} (add brand colors)`);
      continue;
    }
    const linked = assets.filter((a) => a.mustUseId === item.id);
    if (linked.length === 0) missing.push(`${item.label} (no asset linked)`);
    else if (!linked.some((a) => a.confirmed)) missing.push(`${item.label} (asset not confirmed)`);
  }
  return missing;
}

/** Stable fingerprint of the beat contract (works in the browser and on the server). */
export function beatsBasis(beats: Beat[]): string {
  const s = JSON.stringify(beats.map(({ justification: _j, ...b }) => b));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function latestSheet(state: Pick<ProjectState, "sheets">, format: "16:9" | "9:16"): ContactSheet | undefined {
  return [...state.sheets].reverse().find((s) => s.format === format);
}

export function computeGates(state: ProjectState): Record<GateId, GateInfo> {
  const { meta, brief, production, assets, style, beats, film, filmIssues } = state;
  const approved = (g: GateId) => !!meta.approvals[g];
  const out = {} as Record<GateId, GateInfo>;

  // 1. Brief
  {
    const blockers: string[] = [];
    if (!brief) blockers.push("Fill in the Director's Brief.");
    else {
      if (!brief.productName.trim()) blockers.push("Product name is missing.");
      if (!brief.memoryGoal.trim()) blockers.push("Say the one thing the viewer should remember.");
    }
    if (!production) blockers.push("Generate the production document and review it.");
    out.brief = { id: "brief", status: approved("brief") ? "approved" : "open", blockers };
  }

  // 2. Assets & style
  {
    const blockers: string[] = [];
    if (!approved("brief")) blockers.push("Approve the brief first.");
    if (brief) {
      for (const m of missingMustUse(brief, assets)) blockers.push(`Missing required asset: ${m}`);
    }
    const pending = assets.filter((a) => !a.confirmed);
    if (pending.length) blockers.push(`${pending.length} asset(s) awaiting confirmation (confirm or delete them).`);
    if (!assets.some((a) => a.confirmed && (a.kind === "screen" || a.kind === "image" || a.kind === "logo")))
      blockers.push("Upload at least one real screen, image or logo.");
    if (!style) blockers.push("Generate the style guide and asset notes.");
    out.assets = { id: "assets", status: !approved("brief") ? "locked" : approved("assets") ? "approved" : "open", blockers };
  }

  // 3. Beats
  {
    const blockers: string[] = [];
    if (!approved("assets")) blockers.push("Approve assets & style first.");
    if (!beats || beats.length === 0) blockers.push("Generate or write the beat list.");
    const confirmed = new Set(assets.filter((a) => a.confirmed).map((a) => a.id));
    for (const b of beats ?? []) {
      const bad = b.assets.filter((id) => !confirmed.has(id));
      if (bad.length) blockers.push(`Beat “${b.title}” references assets that are not confirmed.`);
      if (!b.keyVisualChange.trim()) blockers.push(`Beat “${b.title}” has no key visual change.`);
    }
    out.beats = { id: "beats", status: !approved("assets") ? "locked" : approved("beats") ? "approved" : "open", blockers };
  }

  // 4. Film program (auto-approved when a valid program exists)
  {
    const blockers: string[] = [];
    if (!approved("beats")) blockers.push("Approve the beats first.");
    if (!film) blockers.push("Generate the film program.");
    else if (beats && meta.filmBasis !== beatsBasis(beats)) blockers.push("The beats changed since this program was generated. Regenerate the film program.");
    const errors = filmIssues.filter((i) => i.level === "error");
    if (errors.length) blockers.push(`${errors.length} validation error(s) in the film program.`);
    const ok = approved("beats") && blockers.length === 0;
    out.film = { id: "film", status: !approved("beats") ? "locked" : ok ? "approved" : "open", blockers };
  }

  // 5. Review
  {
    const blockers: string[] = [];
    if (out.film.status !== "approved") blockers.push("A valid film program is required.");
    const sheet = latestSheet(state, "16:9");
    if (!sheet || sheet.filmRevision !== meta.filmRevision) blockers.push("Render a 16:9 contact sheet of the current program.");
    const openFlags = state.flags.filter((f) => f.status === "open");
    if (openFlags.length) blockers.push(`${openFlags.length} open review flag(s): address or dismiss them.`);
    const reviewApproved = approved("review") && meta.approvedSheet !== undefined && sheet?.revision === meta.approvedSheet && sheet?.filmRevision === meta.filmRevision;
    out.review = { id: "review", status: out.film.status !== "approved" ? "locked" : reviewApproved ? "approved" : "open", blockers };
  }

  // 6. Export
  {
    const blockers: string[] = [];
    if (out.review.status !== "approved") blockers.push("Approve the reviewed contact sheet first.");
    out.export = { id: "export", status: out.review.status !== "approved" ? "locked" : "open", blockers };
  }

  return out;
}

export function firstIncompleteGate(gates: Record<GateId, GateInfo>): GateId {
  return GATES.find((g) => gates[g].status !== "approved") ?? "export";
}

/** Gates cleared when work at `gate` is regenerated or edited. */
export function downstreamOf(gate: GateId, inclusive = true): GateId[] {
  const i = GATES.indexOf(gate);
  return GATES.slice(inclusive ? i : i + 1);
}
