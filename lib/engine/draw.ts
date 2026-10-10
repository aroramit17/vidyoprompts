/**
 * Draws an evaluated frame onto any Canvas 2D context (browser canvas or @napi-rs/canvas).
 * Drawing is a pure function of the FrameState plus loaded resources.
 */
import type { DrawItem, FrameState } from "./evaluate";

/** The subset of CanvasRenderingContext2D the engine uses (browser + @napi-rs/canvas). */
export type Ctx = CanvasRenderingContext2D;

export interface ImageResource {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export interface Resources {
  images: Map<string, ImageResource>;
}

export function fontFamilyFor(state: Pick<FrameState, "fonts">, role: string | undefined): string {
  const fonts = state.fonts;
  const family = role === "body" ? fonts.body : role === "mono" ? fonts.mono : fonts.display;
  return `"${family}", "Inter", "DejaVu Sans", sans-serif`;
}

function roundedRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  if (rr <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function applyShadow(ctx: Ctx, kind: string | undefined, pxScale: number) {
  if (kind === "soft") {
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 30 * pxScale;
    ctx.shadowOffsetY = 12 * pxScale;
  } else if (kind === "lifted") {
    ctx.shadowColor = "rgba(0,0,0,0.30)";
    ctx.shadowBlur = 60 * pxScale;
    ctx.shadowOffsetY = 28 * pxScale;
  }
}

function clearShadow(ctx: Ctx) {
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** Clip to a wipe for non-text reveals. */
function applyWipe(ctx: Ctx, item: DrawItem, x: number, y: number, w: number, h: number) {
  const { reveal, progress } = item.props;
  if (!reveal || reveal === "none" || progress >= 1) return;
  if (!["left", "right", "up", "down"].includes(reveal)) return;
  const p = Math.max(0, Math.min(1, progress));
  ctx.beginPath();
  if (reveal === "left") ctx.rect(x, y, w * p, h);
  else if (reveal === "right") ctx.rect(x + w * (1 - p), y, w * p, h);
  else if (reveal === "down") ctx.rect(x, y, w, h * p);
  else ctx.rect(x, y + h * (1 - p), w, h * p);
  ctx.clip();
}

export function formatCounter(text: string, n: number, decimals: number): string {
  if (!text.includes("{n}")) return text;
  const fixed = n.toFixed(Math.max(0, Math.min(6, decimals)));
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return text.replaceAll("{n}", frac ? `${grouped}.${frac}` : grouped);
}

export function wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${line} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawText(ctx: Ctx, item: DrawItem, state: FrameState) {
  const p = item.props;
  const fontSize = Math.max(1, p.fontSize);
  ctx.font = `${Math.round(p.fontWeight)} ${fontSize}px ${fontFamilyFor(state, p.font)}`;
  const anyCtx = ctx as unknown as { letterSpacing?: string };
  if ("letterSpacing" in ctx) anyCtx.letterSpacing = `${p.letterSpacing}px`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = p.color ?? "#111111";

  const text = formatCounter(p.text ?? "", p.n, p.decimals);
  const lines = wrapText(ctx, text, p.w);
  const lineH = fontSize * p.lineHeight;
  const blockH = lines.length * lineH;
  const left = -p.w * p.anchorX;
  const top = -blockH * p.anchorY;
  const ascent = fontSize * 0.8;

  const reveal = p.reveal ?? "none";
  const progress = Math.max(0, Math.min(1, p.progress));

  // Units for staggered reveals.
  type Unit = { text: string; x: number; y: number };
  const units: Unit[] = [];
  lines.forEach((line, li) => {
    const lineW = ctx.measureText(line).width;
    const startX = p.align === "center" ? left + (p.w - lineW) / 2 : p.align === "right" ? left + p.w - lineW : left;
    const baseline = top + li * lineH + ascent + (lineH - fontSize) / 2;
    if (reveal === "words") {
      let cursor = startX;
      const parts = line.split(" ");
      parts.forEach((word, wi) => {
        units.push({ text: word, x: cursor, y: baseline });
        cursor += ctx.measureText(word + (wi < parts.length - 1 ? " " : "")).width;
      });
    } else if (reveal === "chars") {
      let cursor = startX;
      for (const ch of Array.from(line)) {
        units.push({ text: ch, x: cursor, y: baseline });
        cursor += ctx.measureText(ch).width;
      }
    } else {
      units.push({ text: line, x: startX, y: baseline });
    }
  });

  const staggered = reveal === "words" || reveal === "chars" || reveal === "lines";
  const n = units.length;
  const overlap = reveal === "chars" ? 6 : 2;
  units.forEach((u, i) => {
    let a = 1;
    let dy = 0;
    if (staggered && progress < 1) {
      const t = Math.max(0, Math.min(1, (progress * (n + overlap - 1) - i) / overlap));
      const eased = 1 - Math.pow(1 - t, 3);
      a = eased;
      dy = (1 - eased) * fontSize * 0.35;
    }
    if (a <= 0) return;
    ctx.globalAlpha = item.opacity * a;
    ctx.fillText(u.text, u.x, u.y + dy);
  });
  if ("letterSpacing" in ctx) anyCtx.letterSpacing = "0px";
}

function drawImage(ctx: Ctx, item: DrawItem, resources: Resources, pxScale: number) {
  const p = item.props;
  const x = -p.w * p.anchorX;
  const y = -p.h * p.anchorY;
  const res = p.asset ? resources.images.get(p.asset) : undefined;

  if (p.shadow && p.shadow !== "none") {
    ctx.save();
    applyShadow(ctx, p.shadow, pxScale);
    roundedRectPath(ctx, x, y, p.w, p.h, p.radius);
    ctx.fillStyle = p.fill ?? "#ffffff";
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  roundedRectPath(ctx, x, y, p.w, p.h, p.radius);
  ctx.clip();
  applyWipe(ctx, item, x, y, p.w, p.h);
  if (!res) {
    // Missing assets are drawn loudly so they can never pass review unnoticed.
    ctx.fillStyle = "#ff2d55";
    ctx.fillRect(x, y, p.w, p.h);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.max(12, Math.min(48, p.w / 12))}px "Inter", sans-serif`;
    ctx.fillText(`MISSING ASSET: ${p.asset ?? "?"}`, x + 16, y + 56);
    ctx.restore();
    return;
  }
  if (p.fill && p.fit === "contain") {
    ctx.fillStyle = p.fill;
    ctx.fillRect(x, y, p.w, p.h);
  }
  const imgAspect = res.width / res.height;
  const boxAspect = p.w / p.h;
  const zoom = Math.max(0.05, p.zoom);
  if (p.fit === "contain") {
    let dw = p.w;
    let dh = p.w / imgAspect;
    if (dh > p.h) {
      dh = p.h;
      dw = p.h * imgAspect;
    }
    // Zoom about the focus point: it stays where it sits in the unzoomed image.
    const fx = x + p.w / 2 + (p.focusX - 0.5) * dw;
    const fy = y + p.h / 2 + (p.focusY - 0.5) * dh;
    dw *= zoom;
    dh *= zoom;
    ctx.drawImage(res.source, fx - p.focusX * dw, fy - p.focusY * dh, dw, dh);
  } else {
    let sw = res.width;
    let sh = res.width / boxAspect;
    if (sh > res.height) {
      sh = res.height;
      sw = res.height * boxAspect;
    }
    sw /= Math.max(1, zoom);
    sh /= Math.max(1, zoom);
    let sx = p.focusX * res.width - sw / 2;
    let sy = p.focusY * res.height - sh / 2;
    sx = Math.max(0, Math.min(res.width - sw, sx));
    sy = Math.max(0, Math.min(res.height - sh, sy));
    ctx.drawImage(res.source, sx, sy, sw, sh, x, y, p.w, p.h);
  }
  ctx.restore();
  if (p.stroke && p.strokeWidth > 0) {
    roundedRectPath(ctx, x, y, p.w, p.h, p.radius);
    ctx.strokeStyle = p.stroke;
    ctx.lineWidth = p.strokeWidth;
    ctx.stroke();
  }
}

function drawShape(ctx: Ctx, item: DrawItem, pxScale: number) {
  const p = item.props;
  const x = -p.w * p.anchorX;
  const y = -p.h * p.anchorY;
  ctx.save();
  applyWipe(ctx, item, x, y, p.w, p.h);
  if (item.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + p.w / 2, y + p.h / 2, Math.abs(p.w / 2), Math.abs(p.h / 2), 0, 0, Math.PI * 2);
  } else {
    roundedRectPath(ctx, x, y, p.w, p.h, p.radius);
  }
  if (p.fill) {
    applyShadow(ctx, p.shadow, pxScale);
    ctx.fillStyle = p.fill;
    ctx.fill();
    clearShadow(ctx);
  }
  if (p.stroke && p.strokeWidth > 0) {
    ctx.strokeStyle = p.stroke;
    ctx.lineWidth = p.strokeWidth;
    ctx.stroke();
  }
  ctx.restore();
}

function drawLine(ctx: Ctx, item: DrawItem) {
  const p = item.props;
  const t = Math.max(0, Math.min(1, p.progress));
  if (t <= 0) return;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(p.x2 * t, p.y2 * t);
  ctx.strokeStyle = p.stroke ?? p.fill ?? "#111111";
  ctx.lineWidth = Math.max(1, p.strokeWidth || 4);
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawCursor(ctx: Ctx, item: DrawItem) {
  let press = 1;
  for (const d of item.clickPhases ?? []) {
    const t = d / 16;
    ctx.beginPath();
    ctx.arc(0, 0, 10 + 46 * t, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${(1 - t) * 0.9})`;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 10 + 46 * t, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,0,0,${(1 - t) * 0.35})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (d < 8) press = Math.min(press, 0.84 + 0.16 * (Math.abs(d - 3) / 4));
  }
  ctx.save();
  ctx.scale(press, press);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 34);
  ctx.lineTo(8, 26);
  ctx.lineTo(14, 40);
  ctx.lineTo(20, 37);
  ctx.lineTo(14, 24);
  ctx.lineTo(25, 24);
  ctx.closePath();
  ctx.fillStyle = item.props.fill ?? "#111111";
  ctx.strokeStyle = item.props.stroke ?? "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

/**
 * Render a frame. `scale` maps program pixels to output pixels (0.25 for thumbnails).
 */
export function drawFrame(ctx: Ctx, state: FrameState, resources: Resources, scale = 1) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  clearShadow(ctx);
  ctx.fillStyle = state.background;
  ctx.fillRect(0, 0, state.width * scale, state.height * scale);
  ctx.imageSmoothingEnabled = true;
  (ctx as unknown as { imageSmoothingQuality?: string }).imageSmoothingQuality = "high";

  for (const item of state.items) {
    const m = item.matrix;
    const pxScale = Math.hypot(m[0], m[1]) * scale;
    ctx.save();
    ctx.setTransform(m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale, m[5] * scale);
    ctx.globalAlpha = item.opacity;
    switch (item.type) {
      case "text":
        drawText(ctx, item, state);
        break;
      case "image":
        drawImage(ctx, item, resources, pxScale);
        break;
      case "rect":
      case "ellipse":
        drawShape(ctx, item, pxScale);
        break;
      case "line":
        drawLine(ctx, item);
        break;
      case "cursor":
        drawCursor(ctx, item);
        break;
    }
    ctx.restore();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}
