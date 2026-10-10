/**
 * Claude-backed director. Each task is one request with a structured-output schema.
 * Film programs are validated against the engine and repaired in a short loop: validation
 * errors are appended to the conversation (append-only) and the model fixes its own program.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { PatchOpSchema, type Film } from "@/lib/engine";
import type { Beat, Flag, ProductionDoc, StyleGuide } from "@/lib/studio/types";
import { BeatSchema, ProductionDocSchema, RegionSchema, StyleGuideSchema } from "@/lib/studio/types";
import {
  CritiqueFlagSchema,
  JustificationSchema,
  type CritiqueFlag,
  type CritiqueInput,
  type Director,
  type DirectorContext,
  type FilmResult,
  type Justification,
  type RevisionResult,
} from "./director";
import { FILM_DSL, STUDIO_SYSTEM } from "./prompts";

export const CLAUDE_MODEL = process.env.STUDIO_MODEL || "claude-opus-5-5";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Plain schemas for structured outputs (no defaults or numeric bounds); results are then
// validated with the strict project schemas.
const PlainRegion = z.object({ label: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const PlainState = z.object({ size: z.string(), color: z.string(), content: z.string(), position: z.string() });
const PlainBeat = z.object({
  id: z.string(),
  title: z.string(),
  durationSec: z.number(),
  purpose: z.string(),
  entryState: z.string(),
  exitState: z.string(),
  keyVisualChange: z.string(),
  onScreenText: z.string(),
  assets: z.array(z.string()),
  components: z.array(z.object({ name: z.string(), entry: PlainState, exit: PlainState })),
  justification: z.string(),
});
const BeatsOut = z.object({ beats: z.array(PlainBeat) });
const StyleOut = z.object({
  summary: z.string(),
  palette: z.array(z.object({ name: z.string(), hex: z.string(), usage: z.string() })),
  typography: z.object({ display: z.string(), body: z.string(), rules: z.array(z.string()) }),
  motionCharacter: z.string(),
  composition: z.array(z.string()),
  doNot: z.array(z.string()),
  assetNotes: z.array(z.object({ assetId: z.string(), description: z.string(), regions: z.array(PlainRegion) })),
});
const FilmOut = z.object({ notes: z.string(), filmJson: z.string() });
const CritiqueOut = z.object({ flags: z.array(CritiqueFlagSchema) });
const RevisionOut = z.object({ summary: z.string(), opsJson: z.string() });

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const cleanRegion = (r: z.infer<typeof PlainRegion>) =>
  RegionSchema.parse({ label: r.label, x: clamp01(r.x), y: clamp01(r.y), w: clamp01(r.w), h: clamp01(r.h) });

export class ClaudeDirector implements Director {
  readonly name = "claude" as const;
  private client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  private async ask<S extends z.ZodType>(
    schema: S,
    messages: BetaMessageParam[],
    opts: { effort?: Effort; system?: string; maxTokens?: number } = {},
  ): Promise<{ value: z.infer<S>; content: BetaMessageParam["content"] }> {
    const useFallbacks = process.env.STUDIO_AI_FALLBACKS !== "off";
    const stream = this.client.beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 32000,
      system: opts.system ?? STUDIO_SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? "high", format: betaZodOutputFormat(schema) },
      messages,
      ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      throw new Error(`Claude declined this request${message.stop_details ? ` (${JSON.stringify(message.stop_details)})` : ""}.`);
    }
    if (message.stop_reason === "max_tokens") throw new Error("Claude ran out of output tokens before finishing; try again.");
    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Claude returned output that is not valid JSON.");
    }
    return { value: schema.parse(json), content: message.content as BetaMessageParam["content"] };
  }

  private async assetBlocks(ctx: DirectorContext, kinds = ["screen", "image", "logo", "reference"]): Promise<BetaContentBlockParam[]> {
    const blocks: BetaContentBlockParam[] = [];
    if (!ctx.loadImage) return blocks;
    for (const asset of ctx.assets.filter((a) => kinds.includes(a.kind)).slice(0, 12)) {
      const img = await ctx.loadImage(asset);
      if (!img) continue;
      blocks.push({ type: "text", text: `Asset ${asset.id} (${asset.kind}) “${asset.label}”, ${asset.width}x${asset.height}px:` });
      blocks.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
    }
    return blocks;
  }

  private assetList(ctx: DirectorContext) {
    return ctx.assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      label: a.label,
      size: a.width ? `${a.width}x${a.height}` : undefined,
      description: a.description || undefined,
      regions: a.regions.length ? a.regions : undefined,
      fontFamily: a.fontFamily,
      mustUse: a.mustUseId ? ctx.brief.mustUse.find((m) => m.id === a.mustUseId)?.label : undefined,
    }));
  }

  async productionDoc(ctx: DirectorContext): Promise<ProductionDoc> {
    const { value } = await this.ask(ProductionDocSchema, [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Expand this Director's Brief into a short production document the user will review and approve before any code is written.

Brief:
${JSON.stringify(ctx.brief, null, 2)}

Assets uploaded so far:
${JSON.stringify(this.assetList(ctx), null, 2)}

Requirements:
- logline: one sentence. memoryGoal: keep the user's words, tighten only if needed.
- narrativeArc: 3-6 steps, each naming what the viewer sees.
- visualApproach and motionPrinciples must be specific to this product, and must avoid the generic launch-video look.
- assetBoundary: list must-use real assets; what you may invent (camera, motion, layout, accents); what you may not invent (screens, logos, claims, numbers, colors, fonts).
- forbidden: the user's forbidden outcomes plus any you infer.
- openQuestions: gaps you would otherwise fill with a safe default. Empty if none.
- durationSec: the brief's duration.`,
          },
        ],
      },
    ]);
    return value;
  }

  async styleGuide(ctx: DirectorContext): Promise<StyleGuide> {
    const images = await this.assetBlocks(ctx);
    const { value } = await this.ask(StyleOut, [
      {
        role: "user",
        content: [
          ...images,
          {
            type: "text",
            text: `Write the style guide for this film from the approved production document and the REAL assets above.

Production document:
${JSON.stringify(ctx.production, null, 2)}

Brief colors: ${JSON.stringify(ctx.brief.brandColors)}
Brief fonts: ${JSON.stringify(ctx.brief.fonts)}
Fonts available to the renderer: ${ctx.fonts.join(", ")}
Asset list: ${JSON.stringify(this.assetList(ctx), null, 2)}

Requirements:
- palette: brand colors only (you may add a paper/background and an ink neutral). Give each a usage rule.
- typography.display/body: must be one of the available fonts. If the brand font is unavailable, pick the closest available and say so in rules.
- assetNotes: for every screen/image/logo asset, describe what it actually shows (read the image), and give 1-3 regions worth zooming into as normalised boxes (x, y, w, h in 0..1 of the image) with short labels. Never describe things that are not in the image.
- doNot: concrete prohibitions, including the user's forbidden list.`,
          },
        ],
      },
    ]);
    return StyleGuideSchema.parse({
      ...value,
      assetNotes: value.assetNotes
        .filter((n) => ctx.assets.some((a) => a.id === n.assetId))
        .map((n) => ({ ...n, regions: n.regions.map(cleanRegion) })),
    });
  }

  async beats(ctx: DirectorContext): Promise<Beat[]> {
    const { value } = await this.ask(BeatsOut, [
      {
        role: "user",
        content: `Turn the approved brief, production document and style guide into a beat list: the shot list that becomes a contract.

Brief: ${JSON.stringify(ctx.brief, null, 2)}
Production document: ${JSON.stringify(ctx.production, null, 2)}
Style guide: ${JSON.stringify(ctx.style, null, 2)}
Confirmed assets (the only footage that exists): ${JSON.stringify(this.assetList(ctx), null, 2)}

Requirements:
- 3-7 beats; durations (seconds) sum to ${ctx.brief.durationSec}.
- Each beat: purpose (why it exists), entryState, exitState, keyVisualChange (one visible change), onScreenText (short, real claims only; "" if none), assets (ids from the list above only).
- For UI beats, list components with explicit entry and exit states (size, color, content, position).
- Every must-use asset appears in at least one beat. The final beat should leave the memory goal attached to the real brand.
- ids: b1, b2, ...; justification: one line.`,
      },
    ]);
    const ids = new Set(ctx.assets.map((a) => a.id));
    return value.beats.map((b) => BeatSchema.parse({ ...b, assets: b.assets.filter((id) => ids.has(id)) }));
  }

  async justifyBeat(ctx: DirectorContext, beatId: string): Promise<Justification> {
    const { value } = await this.ask(
      JustificationSchema,
      [
        {
          role: "user",
          content: `The user is challenging beat "${beatId}". Justify it against the memory goal or recommend merging, cutting or reworking it. Be honest: if it is filler, say so.

Memory goal: ${ctx.brief.memoryGoal}
All beats: ${JSON.stringify(ctx.beats, null, 2)}`,
        },
      ],
      { effort: "medium" },
    );
    return value;
  }

  async film(ctx: DirectorContext, validate: (film: unknown) => { film?: Film; errors: string[] }): Promise<FilmResult> {
    const images = await this.assetBlocks(ctx, ["screen", "image", "logo"]);
    const messages: BetaMessageParam[] = [
      {
        role: "user",
        content: [
          ...images,
          {
            type: "text",
            text: `${FILM_DSL}

Write the film program for this project. The beats are an approved contract: one film beat per approved beat, same ids and order, durations converted at 30fps.

Brief: ${JSON.stringify(ctx.brief, null, 2)}
Production document: ${JSON.stringify(ctx.production, null, 2)}
Style guide: ${JSON.stringify(ctx.style, null, 2)}
Approved beats: ${JSON.stringify(ctx.beats, null, 2)}
Confirmed assets (image layers may ONLY use these ids): ${JSON.stringify(this.assetList(ctx), null, 2)}
Allowed font families: ${ctx.fonts.join(", ")}

Return { notes, filmJson } where filmJson is the complete Film JSON as a string and notes explains the key directing choices in 2-4 sentences.`,
          },
        ],
      },
    ];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { value, content } = await this.ask(FilmOut, messages, { effort: "high", maxTokens: 64000 });
      let parsed: unknown;
      let errors: string[];
      try {
        parsed = JSON.parse(value.filmJson);
        const result = validate(parsed);
        if (result.film) return { film: result.film, notes: value.notes, attempts: attempt };
        errors = result.errors;
      } catch (e) {
        errors = [`filmJson is not valid JSON: ${(e as Error).message}`];
      }
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `The program failed validation. Fix every error and return the complete corrected program:\n- ${errors.slice(0, 40).join("\n- ")}`,
      });
    }
    throw new Error("Claude could not produce a valid film program in 3 attempts.");
  }

  async critique(ctx: DirectorContext, input: CritiqueInput): Promise<CritiqueFlag[]> {
    const { value } = await this.ask(CritiqueOut, [
      {
        role: "user",
        content: [
          ...input.images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.data } })),
          {
            type: "text",
            text: `Critique this contact sheet like a demanding creative director. Frames are laid out left-to-right, top-to-bottom in this order:
${input.sheet.map((f, i) => `#${i + 1} frame ${f.frame} beat ${f.beat} (${f.kind})`).join("\n")}

Memory goal: ${ctx.brief.memoryGoal}
Forbidden: ${JSON.stringify(ctx.brief.forbidden)}
Beats: ${JSON.stringify(input.film.beats)}
Deterministic lint already found: ${JSON.stringify(input.lint.map((i) => i.message))}

Flag concrete, fixable problems: timing, hierarchy, missing real assets, weak focus, readability, generic look, motion. Each flag names a frame (number) or beat id, and says exactly what is wrong and what to change. Do not repeat the lint findings. At most 8 flags; none if it is genuinely good.`,
          },
        ],
      },
    ]);
    return value.flags;
  }

  async revise(ctx: DirectorContext, film: Film, flags: Flag[]): Promise<RevisionResult> {
    const messages: BetaMessageParam[] = [
      {
        role: "user",
        content: `${FILM_DSL}

Address these review flags with LOCAL edits to the film program. Do not regenerate the film; change only what the flags require.

Flags: ${JSON.stringify(flags.map((f) => ({ frame: f.frame, beat: f.beat, category: f.category, note: f.note })), null, 2)}
Confirmed assets: ${JSON.stringify(this.assetList(ctx))}
Current film program: ${JSON.stringify(film)}

Patch ops (opsJson is a JSON array of these):
  { "op": "set", "layer": id, "prop": <static prop>, "value": number|string|boolean|number[] }
  { "op": "track", "layer": id, "prop": <animatable prop>, "keys": [{ "f", "v", "ease"? }] }   // replaces the track; [] removes it
  { "op": "window", "layer": id, "from": frame, "to": frame }
  { "op": "remove", "layer": id }
  { "op": "add", "layerData": <full Layer> }
  { "op": "retime", "beat": id, "frames": <new beat length> }   // shifts everything after it
  { "op": "ease", "motionClass": "ui"|"text"|"data"|"camera"|"accent", "value": ease }
  { "op": "spring", "spring": { "name", "stiffness", "damping", "mass" } }
  { "op": "minHold", "frames": n }
  { "op": "camera", "prop": "x"|"y"|"zoom"|"rotation", "keys": [...] }
  { "op": "background", "value": "#hex" }
Note: frames in ops refer to the CURRENT program; put retime ops last.

Return { summary, opsJson }.`,
      },
    ];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { value, content } = await this.ask(RevisionOut, messages, { effort: "high" });
      try {
        const ops = z.array(PatchOpSchema).parse(JSON.parse(value.opsJson));
        return { ops, summary: value.summary };
      } catch (e) {
        messages.push({ role: "assistant", content });
        messages.push({ role: "user", content: `opsJson did not validate: ${(e as Error).message.slice(0, 2000)}. Return corrected ops.` });
      }
    }
    throw new Error("Claude could not produce valid patch ops.");
  }
}
