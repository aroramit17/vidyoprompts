/**
 * ClaudeDirector plumbing with a stubbed SDK client: request shape, structured-output
 * schemas, JSON parsing, and the validate-and-repair loop for film programs.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { describe, expect, it } from "vitest";
import { ClaudeDirector } from "@/lib/ai/claude";
import { compileFilm } from "@/lib/ai/compiler";
import { CritiqueFlagSchema, JustificationSchema } from "@/lib/ai/director";
import { parseFilm, validateFilm, type Film } from "@/lib/engine";
import { BriefSchema, ProductionDocSchema, type Asset, type Beat } from "@/lib/studio/types";
import { demoBrief } from "../scripts/fixtures";

type Params = { model: string; messages: { role: string; content: unknown }[]; output_config: { effort: string; format: unknown }; thinking: unknown };

function stubClient(responses: unknown[]) {
  const calls: Params[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Params) {
          calls.push(JSON.parse(JSON.stringify(params)));
          const next = responses.shift();
          return {
            finalMessage: async () => ({
              stop_reason: "end_turn",
              content: [{ type: "text", text: typeof next === "string" ? next : JSON.stringify(next) }],
            }),
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const brief = BriefSchema.parse(demoBrief);
const assets: Asset[] = [
  { id: "a-logo", filename: "a-logo.png", kind: "logo", label: "Logo", mime: "image/png", bytes: 1, sha1: "x", width: 720, height: 200, source: "upload", confirmed: true, mustUseId: "logo", description: "", regions: [], createdAt: "" },
  { id: "a-dash", filename: "a-dash.png", kind: "screen", label: "Dashboard", mime: "image/png", bytes: 1, sha1: "y", width: 1600, height: 1000, source: "upload", confirmed: true, mustUseId: "cashflow", description: "", regions: [], createdAt: "" },
];
const beats: Beat[] = [
  { id: "b1", title: "Proof", durationSec: 4, purpose: "p", entryState: "a", exitState: "b", keyVisualChange: "zoom", onScreenText: "Runway, before your accountant.", assets: ["a-dash"], components: [], justification: "" },
  { id: "b2", title: "Lockup", durationSec: 3, purpose: "p", entryState: "a", exitState: "b", keyVisualChange: "rule draws", onScreenText: brief.memoryGoal, assets: ["a-logo"], components: [], justification: "" },
];
const ctx = { brief, assets, beats, fonts: ["Inter", "Inter Display"] };
const validate = (raw: unknown) => {
  const parsed = parseFilm(raw);
  if (!parsed.film) return { errors: parsed.issues.map((i) => i.message) };
  const errors = validateFilm(parsed.film, { assets: assets.map((a) => ({ ...a })), fonts: ctx.fonts }).filter((i) => i.level === "error");
  return errors.length ? { errors: errors.map((e) => e.message) } : { film: parsed.film, errors: [] };
};

describe("ClaudeDirector", () => {
  it("structured-output schemas convert", () => {
    for (const s of [ProductionDocSchema, JustificationSchema, CritiqueFlagSchema]) expect(() => betaZodOutputFormat(s)).not.toThrow();
  });

  it("sends the default model, adaptive thinking and a json_schema format", async () => {
    const doc = { logline: "l", memoryGoal: "m", audience: "a", narrativeArc: ["x"], toneAndPacing: "t", visualApproach: "v", motionPrinciples: ["m"], assetBoundary: { mustUse: [], modelMayInvent: [], modelMayNotInvent: [] }, forbidden: [], openQuestions: [], durationSec: 14 };
    const { client, calls } = stubClient([doc]);
    const result = await new ClaudeDirector(client).productionDoc(ctx);
    expect(result.logline).toBe("l");
    expect(calls[0].model).toBe("claude-opus-5-5");
    expect(calls[0].thinking).toEqual({ type: "adaptive" });
    expect((calls[0].output_config.format as { type: string }).type).toBe("json_schema");
  });

  it("repairs an invalid film program using validator feedback", async () => {
    const good: Film = compileFilm({ brief, assets, beats, fonts: { display: "Inter Display", body: "Inter", mono: "Inter" } });
    const bad = structuredClone(good);
    const img = bad.layers.find((l) => l.type === "image")!;
    img.props.asset = "invented-hero-shot";
    const { client, calls } = stubClient([
      { notes: "first", filmJson: JSON.stringify(bad) },
      { notes: "fixed", filmJson: JSON.stringify(good) },
    ]);
    const result = await new ClaudeDirector(client).film(ctx, validate);
    expect(result.attempts).toBe(2);
    expect(result.notes).toBe("fixed");
    // The repair turn tells the model exactly what was wrong.
    const repair = calls[1].messages.at(-1)!;
    expect(String(repair.content)).toMatch(/invented-hero-shot/);
  });

  it("drops beat assets that are not real", async () => {
    const out = { beats: [{ ...beats[0], assets: ["a-dash", "made-up"] }] };
    const { client } = stubClient([out]);
    const result = await new ClaudeDirector(client).beats(ctx);
    expect(result[0].assets).toEqual(["a-dash"]);
  });
});
