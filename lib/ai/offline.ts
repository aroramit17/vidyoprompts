/**
 * Deterministic director. Produces usable, structured output from the brief alone so the
 * whole studio works without an API key, and so tests are reproducible.
 */
import type { Film, PatchOp } from "@/lib/engine";
import type { Beat, Flag, ProductionDoc, StyleGuide } from "@/lib/studio/types";
import { compileFilm, choosePalette, parseNumber } from "./compiler";
import type { CritiqueFlag, CritiqueInput, Director, DirectorContext, FilmResult, Justification, RevisionResult } from "./director";
import { chooseFonts } from "@/lib/studio/fonts";

const sentence = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.!?]*$/, ".");

export class OfflineDirector implements Director {
  readonly name = "offline" as const;

  async productionDoc({ brief, assets }: DirectorContext): Promise<ProductionDoc> {
    const screens = brief.mustUse.filter((m) => m.kind === "screen").map((m) => m.label);
    return {
      logline: `${brief.productName}: ${sentence(brief.memoryGoal)}`,
      memoryGoal: brief.memoryGoal,
      audience: brief.audience || "People evaluating the product for the first time.",
      narrativeArc: [
        "Open on the tension the product resolves, in the product's own words.",
        ...(screens.length ? screens.map((s) => `Prove it with the real ${s}: zoom to the part that matters.`) : ["Prove it with the real product UI."]),
        `Land the memory line: “${brief.memoryGoal}”.`,
        `Close on the real ${brief.productName} logo, no stand-in mark.`,
      ],
      toneAndPacing: `${brief.durationSec}s total. Confident, editorial pacing: each beat earns one idea, holds long enough to read, then moves.`,
      visualApproach:
        "Off-white paper background, ink type set left, one brand accent used for emphasis only. Real screenshots are shown as cards and zoomed into specific regions; no gradients, no centered slogan cards.",
      motionPrinciples: [
        "UI elements move on snappy springs; text reveals word by word; the camera barely drifts.",
        "One moving focus at a time; stagger everything else.",
        "Every beat has one visible state change that carries its meaning.",
        "Hold readable text for at least 1.2s after it lands.",
      ],
      assetBoundary: {
        mustUse: brief.mustUse.map((m) => `${m.label} (${m.kind})`),
        modelMayInvent: ["Camera moves and zooms", "Timing and easing", "Highlights, rules, cursors and accent shapes", "Layout and composition"],
        modelMayNotInvent: ["Product screens or UI", "Logos or brand marks", "Customer names, numbers or claims not in the brief", "New brand colors or fonts"],
      },
      forbidden: brief.forbidden.length ? brief.forbidden : ["Big centered text over a gradient", "Fake or mocked-up product UI"],
      openQuestions: [
        ...(assets.length === 0 ? ["No assets uploaded yet: which screens best prove the memory goal?"] : []),
        ...(brief.audience ? [] : ["Who exactly is the viewer, and where will they watch this?"]),
      ],
      durationSec: brief.durationSec,
    };
  }

  async styleGuide({ brief, assets }: DirectorContext): Promise<StyleGuide> {
    const { paper, ink, accent, palette } = choosePalette(brief);
    const fonts = chooseFonts(brief, assets);
    return {
      summary: `Editorial product film for ${brief.productName}: paper and ink with ${accent} as the single accent. Real UI carries the story; type is set left and large.`,
      palette: palette.map((p) => ({
        name: p.name,
        hex: p.hex,
        usage: p.hex === paper ? "Background" : p.hex === ink ? "Type and rules" : p.hex === accent ? "Emphasis: highlights, key bar, rules" : "Secondary brand color, sparingly",
      })),
      typography: {
        display: fonts.display,
        body: fonts.body,
        rules: ["Headlines left-aligned, tight tracking, max two lines.", "Small caps eyebrow labels for beat numbering.", "Never center a headline over an empty frame."],
      },
      motionCharacter: "Precise and calm: springs that settle without wobble, word-by-word reveals, slow camera drift.",
      composition: ["Asymmetric: type on the left third, product on the right two thirds.", "Zoom into a single region of a screen instead of showing everything.", "Generous margins (≥120px)."],
      doNot: ["Gradients or glows", "Stock imagery or invented UI", "More than one accent color per frame", ...brief.forbidden],
      assetNotes: assets
        .filter((a) => a.kind === "screen" || a.kind === "image" || a.kind === "logo")
        .map((a) => ({
          assetId: a.id,
          description: a.description || `${a.kind === "logo" ? "Logo" : "Screen"}: ${a.label}`,
          regions: a.regions.length ? a.regions : a.kind === "logo" ? [] : [{ label: "Primary focus", x: 0.3, y: 0.25, w: 0.4, h: 0.4 }],
        })),
    };
  }

  async beats({ brief, assets }: DirectorContext): Promise<Beat[]> {
    const screens = assets.filter((a) => a.confirmed && (a.kind === "screen" || a.kind === "image")).slice(0, 3);
    const logo = assets.find((a) => a.confirmed && a.kind === "logo");
    const numberLine = [brief.notes, brief.memoryGoal].map((t) => t.split(/[.\n]/).find((l) => parseNumber(l))).find(Boolean);

    const beats: Omit<Beat, "durationSec">[] = [];
    beats.push({
      id: "b1",
      title: "Tension",
      purpose: "Name the problem the viewer recognises before showing any product.",
      entryState: "Empty paper frame.",
      exitState: "Headline fully set on the left; accent slab on the right.",
      keyVisualChange: "Headline reveals word by word while the accent slab wipes in.",
      onScreenText: brief.notes.split(/[.\n]/)[0]?.trim() && !parseNumber(brief.notes.split(/[.\n]/)[0]) ? brief.notes.split(/[.\n]/)[0].trim() : `Before ${brief.productName}, this took too long.`,
      assets: [],
      components: [],
      justification: "",
    });
    screens.forEach((screen, i) => {
      const region = screen.regions[0]?.label ?? "the key area";
      beats.push({
        id: `b${beats.length + 1}`,
        title: screen.label,
        purpose: `Prove the claim with the real ${screen.label}.`,
        entryState: `${screen.label} card enters from the right on a spring; caption sets on the left.`,
        exitState: `Card zoomed into ${region} with a highlight and a cursor click.`,
        keyVisualChange: `Zoom into ${region}.`,
        onScreenText: i === 0 ? brief.memoryGoal : screen.description || screen.label,
        assets: [screen.id],
        components: [
          {
            name: screen.label,
            entry: { size: "Card ~1060px wide", color: "Real screenshot", content: "Full screen", position: "Right two thirds" },
            exit: { size: "Card, content zoomed ~2x", color: "Accent highlight ring", content: region, position: "Right two thirds" },
          },
        ],
        justification: "",
      });
    });
    if (numberLine) {
      beats.push({
        id: `b${beats.length + 1}`,
        title: "Proof in numbers",
        purpose: "Make the outcome concrete with a real number from the brief.",
        entryState: "Counter at zero, bars empty.",
        exitState: "Counter at the real value; accent bar tallest.",
        keyVisualChange: "Counter counts up while bars build.",
        onScreenText: numberLine.trim(),
        assets: [],
        components: [],
        justification: "",
      });
    }
    beats.push({
      id: `b${beats.length + 1}`,
      title: "Lockup",
      purpose: "Leave the memory line attached to the real brand.",
      entryState: "Paper block wipes in; logo scales up from 90%.",
      exitState: "Logo and memory line locked up, holding.",
      keyVisualChange: "Rule draws between logo and line.",
      onScreenText: brief.memoryGoal,
      assets: logo ? [logo.id] : [],
      components: [],
      justification: "",
    });

    // Distribute duration: lockup and tension shorter, proof beats longer.
    const weights = beats.map((b) => (b.assets.some((id) => screens.some((s) => s.id === id)) ? 1.5 : b.title === "Lockup" ? 0.9 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    return beats.map((b, i) => ({ ...b, durationSec: Math.round(((brief.durationSec * weights[i]) / total) * 10) / 10 }));
  }

  async justifyBeat({ beats }: DirectorContext, beatId: string): Promise<Justification> {
    const beat = beats?.find((b) => b.id === beatId);
    if (!beat) throw new Error(`Unknown beat ${beatId}`);
    const hasChange = beat.keyVisualChange.trim().length > 0 && beat.entryState.trim() !== beat.exitState.trim();
    const tooShort = beat.durationSec < 1.5;
    return {
      verdict: !hasChange ? "rework" : tooShort ? "merge" : "keep",
      justification: hasChange
        ? `“${beat.title}” exists to ${beat.purpose.replace(/\.$/, "").toLowerCase()}. It moves the frame from “${beat.entryState}” to “${beat.exitState}”.`
        : `“${beat.title}” has no visible state change, so it adds time without adding meaning.`,
      suggestion: !hasChange
        ? "Define a concrete key visual change (a zoom, a reveal, a state flip) or cut the beat."
        : tooShort
          ? "Under 1.5s the change will not read; merge it into the neighbouring beat or lengthen it."
          : "Keep. Check the on-screen text is the shortest version of the idea.",
    };
  }

  async film(ctx: DirectorContext, validate: (film: unknown) => { film?: Film; errors: string[] }): Promise<FilmResult> {
    const film = compileFilm({ brief: ctx.brief, style: ctx.style, assets: ctx.assets, beats: ctx.beats ?? [], fonts: chooseFonts(ctx.brief, ctx.assets) });
    const result = validate(film);
    if (!result.film) throw new Error(`Offline compiler produced an invalid program: ${result.errors.join("; ")}`);
    return { film: result.film, notes: "Compiled by the offline director from the approved beats (ui / data / type / logo templates).", attempts: 1 };
  }

  async critique(_ctx: DirectorContext, input: CritiqueInput): Promise<CritiqueFlag[]> {
    // Without a vision model the critique is the deterministic lint.
    return input.lint.map((i) => ({
      frame: i.frame ?? null,
      beat: i.beat ?? null,
      category: lintCategory(i.code),
      note: i.message,
    }));
  }

  async revise(ctx: DirectorContext, film: Film, flags: Flag[]): Promise<RevisionResult> {
    const ops: PatchOp[] = [];
    const notes: string[] = [];
    const beatOf = (flag: Flag) => film.beats.find((b) => b.id === flag.beat) ?? (flag.frame !== null ? film.beats.find((b) => flag.frame! >= b.start && flag.frame! < b.end) : undefined);
    const retimed = new Map<string, number>();

    for (const flag of flags) {
      const beat = beatOf(flag);
      const beatLayers = beat ? film.layers.filter((l) => l.beat === beat.id) : [];
      const text = flag.note.toLowerCase();
      switch (flag.category) {
        case "timing":
        case "readability": {
          if (!beat) break;
          const len = retimed.get(beat.id) ?? beat.end - beat.start;
          const faster = /fast(er)?|short(er)?|drag|slow|too long|tighten/.test(text) && !/too fast|rushed/.test(text);
          const next = Math.round(len * (faster ? 0.82 : 1.2));
          retimed.set(beat.id, next);
          notes.push(`${faster ? "Tightened" : "Extended"} “${beat.label}” to ${(next / film.fps).toFixed(1)}s.`);
          if (flag.category === "readability") {
            for (const l of beatLayers.filter((x) => x.type === "text")) {
              ops.push({ op: "set", layer: l.id, prop: "fontSize", value: Math.round((l.props.fontSize ?? 48) * 1.12) });
            }
            notes.push(`Enlarged text in “${beat.label}”.`);
          }
          break;
        }
        case "hierarchy": {
          if (!beat) break;
          const texts = beatLayers.filter((l) => l.type === "text").sort((a, b) => (b.props.fontSize ?? 0) - (a.props.fontSize ?? 0));
          texts.forEach((l, i) => ops.push({ op: "set", layer: l.id, prop: "fontSize", value: Math.round((l.props.fontSize ?? 48) * (i === 0 ? 1.1 : 0.85)) }));
          texts.slice(1).forEach((l) => ops.push({ op: "set", layer: l.id, prop: "opacity", value: 0.7 }));
          notes.push(`Strengthened the type hierarchy in “${beat.label}”.`);
          break;
        }
        case "weak-focus": {
          if (!beat) break;
          const img = beatLayers.find((l) => l.type === "image" && !l.parent);
          if (img) {
            const zoomTrack = img.tracks.find((t) => t.prop === "zoom");
            const peak = Math.max(1.6, ...(zoomTrack?.keys.map((k) => Number(k.v)) ?? [1]));
            const startAt = beat.start + Math.round((beat.end - beat.start) * 0.35);
            ops.push({ op: "track", layer: img.id, prop: "zoom", keys: [{ f: startAt, v: 1 }, { f: startAt + 18, v: Math.min(2.8, peak * 1.2), ease: "spring:gentle" }] });
            notes.push(`Pushed the zoom further into the screen in “${beat.label}”.`);
          }
          for (const l of beatLayers.filter((x) => x.priority === "secondary" && x.type !== "image")) {
            ops.push({ op: "set", layer: l.id, prop: "opacity", value: 0.55 });
          }
          break;
        }
        case "missing-asset": {
          const used = new Set(film.layers.filter((l) => l.type === "image").map((l) => l.props.asset));
          const missing = ctx.assets.filter((a) => a.confirmed && a.mustUseId && !used.has(a.id) && a.kind !== "font" && a.kind !== "reference");
          const target = beat ?? film.beats[film.beats.length - 1];
          missing.forEach((a, i) => {
            const w = a.kind === "logo" ? 320 : 760;
            const h = a.width && a.height ? Math.round((w * a.height) / a.width) : Math.round(w * 0.62);
            ops.push({
              op: "add",
              layerData: {
                id: `${target.id}-added-${a.id}`.slice(0, 60),
                type: "image",
                beat: target.id,
                class: "ui",
                from: target.start,
                to: target.end,
                props: { x: 1420 - i * 60, y: 540 + i * 40, w, h, asset: a.id, fit: a.kind === "logo" ? "contain" : "cover", radius: a.kind === "logo" ? 0 : 16, shadow: a.kind === "logo" ? "none" : "lifted" },
                tracks: [
                  { prop: "opacity", keys: [{ f: target.start + 6, v: 0 }, { f: target.start + 14, v: 1, ease: "out" }] },
                  { prop: "y", keys: [{ f: target.start + 6, v: 600 + i * 40 }, { f: target.start + 26, v: 540 + i * 40, ease: "spring:snappy" }] },
                ],
              },
            });
            notes.push(`Placed must-use asset “${a.label}” in “${target.label}”.`);
          });
          break;
        }
        case "generic": {
          for (const l of film.layers.filter((x) => x.type === "text" && x.props.align === "center" && !x.parent)) {
            ops.push({ op: "set", layer: l.id, prop: "align", value: "left" });
            ops.push({ op: "set", layer: l.id, prop: "anchorX", value: 0 });
            ops.push({ op: "set", layer: l.id, prop: "x", value: 160 });
            ops.push({ op: "set", layer: l.id, prop: "reveal", value: "words" });
            if (!l.tracks.some((t) => t.prop === "progress")) {
              ops.push({ op: "track", layer: l.id, prop: "progress", keys: [{ f: l.from + 4, v: 0 }, { f: l.from + 28, v: 1, ease: "linear" }] });
            }
          }
          notes.push("Moved centered headlines to a left-set editorial layout with word reveals.");
          break;
        }
        case "motion": {
          const calmer = /jitter|bouncy|wobbl|too much|busy|fast/.test(text);
          if (calmer) {
            ops.push({ op: "spring", spring: { name: "snappy", stiffness: 200, damping: 30, mass: 1 } });
            ops.push({ op: "ease", motionClass: "ui", value: "spring:snappy" });
            notes.push("Calmed the UI spring (more damping).");
          } else {
            ops.push({ op: "spring", spring: { name: "snappy", stiffness: 260, damping: 22, mass: 1 } });
            notes.push("Made the UI spring livelier.");
          }
          break;
        }
        default:
          notes.push(`Left for a human: “${flag.note}”.`);
      }
    }
    for (const [beat, frames] of retimed) ops.push({ op: "retime", beat, frames });
    return { ops, summary: notes.join(" ") || "No mechanical fix for these flags." };
  }
}

export function lintCategory(code: string): CritiqueFlag["category"] {
  switch (code) {
    case "must-use-missing":
      return "missing-asset";
    case "hold-short":
    case "contrast":
      return "readability";
    case "static-beat":
    case "fade-only":
      return "motion";
    case "generic-look":
      return "generic";
    case "crowded":
      return "hierarchy";
    case "focus":
      return "weak-focus";
    case "flash":
      return "timing";
    default:
      return "other";
  }
}
