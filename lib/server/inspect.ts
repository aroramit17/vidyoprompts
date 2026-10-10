/**
 * "Inspect site" helper: screenshots a live URL with headless Chromium and suggests brand
 * colors and fonts. Screenshots come back as UNCONFIRMED assets: a person must confirm each
 * one before it can reach the film.
 */
import { promises as dns } from "node:dns";
import { existsSync, readdirSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { HttpError } from "./store";

function findChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), ".cache", "ms-playwright")].filter(Boolean) as string[];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse();
    for (const d of dirs) {
      for (const rel of ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-win/chrome.exe"]) {
        const p = path.join(/*turbopackIgnore: true*/ root, d, rel);
        if (existsSync(/*turbopackIgnore: true*/ p)) return p;
      }
    }
  }
  return undefined;
}

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("::ffff:127.") || v6 === "::";
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new HttpError(400, "That is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "Only http(s) URLs can be inspected.");
  if (process.env.STUDIO_ALLOW_PRIVATE_URLS === "1") return url;
  const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new HttpError(400, `Could not resolve ${url.hostname}.`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new HttpError(400, "Private and local network addresses cannot be inspected.");
  return url;
}

export interface SiteCapture {
  url: string;
  title: string;
  shots: { label: string; png: Buffer }[];
  colors: { hex: string; weight: number }[];
  fonts: string[];
}

export async function inspectSite(raw: string): Promise<SiteCapture> {
  const url = await assertPublicUrl(raw);
  const { chromium } = await import("playwright-core");
  const executablePath = findChromium();
  const browser = await chromium.launch({ headless: true, executablePath }).catch((e: Error) => {
    throw new HttpError(503, `Headless Chromium is not available (${e.message.split("\n")[0]}). Set CHROMIUM_PATH.`);
  });
  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await desktop.goto(url.toString(), { waitUntil: "networkidle", timeout: 30_000 }).catch(() => desktop.waitForLoadState("domcontentloaded"));
    await desktop.waitForTimeout(800);
    const title = await desktop.title();
    const shots: SiteCapture["shots"] = [];
    shots.push({ label: "Desktop — top", png: await desktop.screenshot({ type: "png" }) });
    const height = await desktop.evaluate(() => document.documentElement.scrollHeight);
    for (const [i, y] of [900, 1800].entries()) {
      if (height <= y + 200) break;
      await desktop.evaluate((top) => window.scrollTo(0, top), y);
      await desktop.waitForTimeout(500);
      shots.push({ label: `Desktop — section ${i + 2}`, png: await desktop.screenshot({ type: "png" }) });
    }
    await desktop.evaluate(() => window.scrollTo(0, 0));
    const { colors, fonts } = await desktop.evaluate(() => {
      const weights = new Map<string, number>();
      const fontSet = new Map<string, number>();
      const toHex = (c: string) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = "1"] = m[1].split(",").map((s) => s.trim());
        if (Number(a) < 0.5) return null;
        return "#" + [r, g, b].map((v) => Number(v).toString(16).padStart(2, "0")).join("").toUpperCase();
      };
      const els = Array.from(document.querySelectorAll("body, body *")).slice(0, 4000) as HTMLElement[];
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || rect.top > 3000) continue;
        const style = getComputedStyle(el);
        const area = Math.min(rect.width * rect.height, 1440 * 900);
        const bg = toHex(style.backgroundColor);
        if (bg) weights.set(bg, (weights.get(bg) ?? 0) + area);
        if (el.childNodes.length && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim())) {
          const fg = toHex(style.color);
          if (fg) weights.set(fg, (weights.get(fg) ?? 0) + area * 0.3);
          const fam = style.fontFamily.split(",")[0].replace(/["']/g, "").trim();
          fontSet.set(fam, (fontSet.get(fam) ?? 0) + 1);
        }
      }
      return {
        colors: [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([hex, weight]) => ({ hex, weight })),
        fonts: [...fontSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f]) => f),
      };
    });
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
    await mobile.goto(url.toString(), { waitUntil: "networkidle", timeout: 30_000 }).catch(() => mobile.waitForLoadState("domcontentloaded"));
    await mobile.waitForTimeout(600);
    shots.push({ label: "Mobile — top", png: await mobile.screenshot({ type: "png" }) });
    return { url: url.toString(), title, shots, colors, fonts };
  } finally {
    await browser.close();
  }
}
