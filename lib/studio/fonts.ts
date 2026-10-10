import type { Asset, Brief } from "./types";

/** Fonts bundled with Studio (public/fonts, SIL OFL). Always available to the renderer. */
export const BUNDLED_FONTS: { family: string; file: string; weight: number }[] = [
  { family: "Inter", file: "Inter-Regular.otf", weight: 400 },
  { family: "Inter", file: "Inter-Medium.otf", weight: 500 },
  { family: "Inter", file: "Inter-SemiBold.otf", weight: 600 },
  { family: "Inter", file: "Inter-Bold.otf", weight: 700 },
  { family: "Inter Display", file: "InterDisplay-SemiBold.otf", weight: 600 },
  { family: "Inter Display", file: "InterDisplay-Bold.otf", weight: 700 },
  { family: "Inter Display", file: "InterDisplay-ExtraBold.otf", weight: 800 },
];

export const BUNDLED_FAMILIES = ["Inter", "Inter Display"];

/** Families the film may use: bundled fonts plus confirmed uploaded font files. */
export function allowedFonts(assets: Asset[]): string[] {
  const uploaded = assets.filter((a) => a.kind === "font" && a.confirmed && a.fontFamily).map((a) => a.fontFamily!);
  return [...new Set([...BUNDLED_FAMILIES, ...uploaded])];
}

/** Pick the families for each role: brief request if it is available, else bundled. */
export function chooseFonts(brief: Brief, assets: Asset[]) {
  const allowed = allowedFonts(assets);
  const pick = (role: "display" | "body" | "mono", fallback: string) => {
    const wanted = brief.fonts.find((f) => f.role === role)?.family;
    return wanted && allowed.includes(wanted) ? wanted : fallback;
  };
  return { display: pick("display", "Inter Display"), body: pick("body", "Inter"), mono: pick("mono", "Inter") };
}
