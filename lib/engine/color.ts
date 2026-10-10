export type RGBA = [number, number, number, number];

export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (s === "transparent") return [0, 0, 0, 0];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const c = h.split("").map((ch) => parseInt(ch + ch, 16));
      return [c[0], c[1], c[2], h.length === 4 ? c[3] / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const c = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      return [c[0], c[1], c[2], h.length === 8 ? c[3] / 255 : 1];
    }
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  return null;
}

export function isColor(input: unknown): input is string {
  return typeof input === "string" && parseColor(input) !== null;
}

export function formatColor([r, g, b, a]: RGBA): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const alpha = Math.max(0, Math.min(1, Math.round(a * 1000) / 1000));
  return `rgba(${c(r)},${c(g)},${c(b)},${alpha})`;
}

export function lerpColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return t < 0.5 ? a : b;
  return formatColor([
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
    ca[3] + (cb[3] - ca[3]) * t,
  ]);
}

/** Relative luminance (WCAG). */
export function luminance(color: string): number {
  const c = parseColor(color);
  if (!c) return 0;
  const [r, g, b] = c.slice(0, 3).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Distance in RGB space, 0..441. */
export function colorDistance(a: string, b: string): number {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return 999;
  return Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]);
}
