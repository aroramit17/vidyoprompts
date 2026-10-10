/**
 * Deterministic easing: cubic-bezier presets and closed-form damped springs.
 * Springs are evaluated analytically (no integration state), normalised so the
 * spring settles exactly at the end of its keyframe segment.
 */
import type { Spring } from "./schema";

export type EaseFn = (u: number) => number;

const PRESETS: Record<string, [number, number, number, number]> = {
  in: [0.32, 0, 0.67, 0],
  out: [0.33, 1, 0.68, 1],
  inOut: [0.65, 0, 0.35, 1],
  expoOut: [0.16, 1, 0.3, 1],
  backOut: [0.34, 1.56, 0.64, 1],
  snap: [0.2, 0, 0, 1],
};

export const EASE_NAMES = ["linear", "hold", ...Object.keys(PRESETS)];

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : sampleY(solveX(u)));
}

/** Position of a unit spring (0 → 1) released at rest, at time t seconds. */
export function springValue(s: Spring, t: number): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(s.stiffness / s.mass);
  const zeta = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const r = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - r);
  const r2 = -w0 * (zeta + r);
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

const settleCache = new Map<string, number>();

/** Time (seconds) after which the spring stays within 0.1% of its target. */
export function springSettleTime(s: Spring): number {
  const key = `${s.stiffness}/${s.damping}/${s.mass}`;
  const hit = settleCache.get(key);
  if (hit !== undefined) return hit;
  const dt = 1 / 240;
  const limit = 12;
  let last = 0;
  for (let t = 0; t <= limit; t += dt) {
    if (Math.abs(1 - springValue(s, t)) > 0.001) last = t;
  }
  const settle = Math.max(dt, last + dt);
  settleCache.set(key, settle);
  return settle;
}

const bezierCache = new Map<string, EaseFn>();

/**
 * Resolve an ease name to a function of normalised segment progress u ∈ [0,1].
 * Returns null for unknown names (the validator reports them).
 */
export function resolveEase(name: string, springs: Spring[]): EaseFn | null {
  if (name === "linear") return (u) => u;
  if (name === "hold") return (u) => (u >= 1 ? 1 : 0);
  const preset = PRESETS[name];
  if (preset) {
    let fn = bezierCache.get(name);
    if (!fn) {
      fn = cubicBezier(...preset);
      bezierCache.set(name, fn);
    }
    return fn;
  }
  if (name.startsWith("spring:")) {
    const spring = springs.find((s) => s.name === name.slice(7));
    if (!spring) return null;
    const settle = springSettleTime(spring);
    return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : springValue(spring, u * settle));
  }
  const m = /^cubic\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(name);
  if (m) {
    const nums = m.slice(1).map(Number) as [number, number, number, number];
    if (nums.some((n) => !Number.isFinite(n))) return null;
    let fn = bezierCache.get(name);
    if (!fn) {
      fn = cubicBezier(...nums);
      bezierCache.set(name, fn);
    }
    return fn;
  }
  return null;
}
