import { frameToTimecode, type Film } from "@/lib/engine";
import type { Asset, Beat, Brief, ProductionDoc, StyleGuide } from "./types";

const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

export function productionMarkdown(brief: Brief, doc: ProductionDoc): string {
  return `# ${brief.productName} — Production document

**Logline.** ${doc.logline}

**Memory goal.** ${doc.memoryGoal}

**Audience.** ${doc.audience}

**Duration.** ${doc.durationSec}s

## Narrative arc
${doc.narrativeArc.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## Tone and pacing
${doc.toneAndPacing}

## Visual approach
${doc.visualApproach}

## Motion principles
${list(doc.motionPrinciples)}

## Asset boundary
**Must use:**
${list(doc.assetBoundary.mustUse)}

**Model may invent:**
${list(doc.assetBoundary.modelMayInvent)}

**Model may not invent:**
${list(doc.assetBoundary.modelMayNotInvent)}

## Forbidden
${list(doc.forbidden)}

## Open questions
${doc.openQuestions.length ? list(doc.openQuestions) : "_None._"}
`;
}

export function styleMarkdown(style: StyleGuide, assets: Asset[]): string {
  return `# Style notes

${style.summary}

## Palette
${style.palette.map((p) => `- \`${p.hex}\` **${p.name}** — ${p.usage}`).join("\n")}

## Typography
Display: **${style.typography.display}** · Body: **${style.typography.body}**
${list(style.typography.rules)}

## Motion character
${style.motionCharacter}

## Composition
${list(style.composition)}

## Do not
${list(style.doNot)}

## Confirmed assets
${assets
  .filter((a) => a.confirmed)
  .map((a) => {
    const note = style.assetNotes.find((n) => n.assetId === a.id);
    const regions = (a.regions.length ? a.regions : note?.regions ?? []).map((r) => `${r.label} (${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.w.toFixed(2)}×${r.h.toFixed(2)})`);
    return `- **${a.label}** (${a.kind}, \`${a.filename}\`)${note?.description ? ` — ${note.description}` : ""}${regions.length ? `\n  - Regions: ${regions.join("; ")}` : ""}`;
  })
  .join("\n")}
`;
}

export function shotListMarkdown(beats: Beat[], film: Film | null, assets: Asset[]): string {
  const label = (id: string) => assets.find((a) => a.id === id)?.label ?? id;
  return `# Shot list

| # | Beat | Time | Purpose | Key visual change | On-screen text | Assets |
|---|------|------|---------|-------------------|----------------|--------|
${beats
  .map((b, i) => {
    const range = film?.beats.find((x) => x.id === b.id);
    const time = range ? `${frameToTimecode(range.start, film!.fps)}–${frameToTimecode(range.end, film!.fps)}` : `${b.durationSec}s`;
    const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
    return `| ${i + 1} | ${cell(b.title)} | ${time} | ${cell(b.purpose)} | ${cell(b.keyVisualChange)} | ${cell(b.onScreenText)} | ${b.assets.map(label).join(", ")} |`;
  })
  .join("\n")}

${beats
  .map(
    (b, i) =>
      [
        `## ${i + 1}. ${b.title}`,
        `- **Entry state:** ${b.entryState}`,
        `- **Exit state:** ${b.exitState}`,
        ...b.components.map((c) => `- **${c.name}:** ${c.entry.size}, ${c.entry.color}, ${c.entry.content}, ${c.entry.position} → ${c.exit.size}, ${c.exit.color}, ${c.exit.content}, ${c.exit.position}`),
        ...(b.justification ? [`- **Justification:** ${b.justification}`] : []),
      ].join("\n"),
  )
  .join("\n\n")}
`;
}
