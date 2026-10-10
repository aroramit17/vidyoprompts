/**
 * Synthetic product assets for tests and the demo project ("Ledgerly", a fictional
 * finance dashboard). They stand in for a user's real screenshots and logo.
 */
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

let fontsReady = false;
function fonts() {
  if (fontsReady) return;
  const dir = path.join(__dirname, "..", "public", "fonts");
  for (const f of ["Inter-Regular.otf", "Inter-SemiBold.otf", "Inter-Bold.otf", "InterDisplay-Bold.otf"]) GlobalFonts.registerFromPath(path.join(dir, f));
  fontsReady = true;
}

export function dashboardPng(): Buffer {
  fonts();
  const c = createCanvas(1600, 1000);
  const g = c.getContext("2d");
  g.fillStyle = "#FFFFFF";
  g.fillRect(0, 0, 1600, 1000);
  // sidebar
  g.fillStyle = "#0E1B2C";
  g.fillRect(0, 0, 260, 1000);
  g.fillStyle = "#18E299";
  g.fillRect(32, 36, 28, 28);
  g.fillStyle = "#FFFFFF";
  g.font = '700 24px "Inter"';
  g.fillText("Ledgerly", 72, 60);
  g.font = '500 18px "Inter"';
  ["Overview", "Cash flow", "Invoices", "Forecast", "Settings"].forEach((t, i) => {
    g.fillStyle = i === 1 ? "#18E299" : "#9AA7B8";
    g.fillText(t, 36, 140 + i * 48);
  });
  // header
  g.fillStyle = "#0E1B2C";
  g.font = '700 34px "Inter"';
  g.fillText("Cash flow", 300, 80);
  g.fillStyle = "#6B7685";
  g.font = '400 18px "Inter"';
  g.fillText("Last 12 months · All accounts", 300, 112);
  // KPI cards
  [["Runway", "26 mo"], ["Burn", "$84k"], ["Cash", "$2.18M"]].forEach(([k, v], i) => {
    const x = 300 + i * 420;
    g.fillStyle = "#F3F5F8";
    g.beginPath();
    g.roundRect(x, 150, 390, 140, 14);
    g.fill();
    g.fillStyle = "#6B7685";
    g.font = '500 18px "Inter"';
    g.fillText(k, x + 24, 192);
    g.fillStyle = i === 0 ? "#0BAA6F" : "#0E1B2C";
    g.font = '700 44px "Inter"';
    g.fillText(v, x + 24, 255);
  });
  // chart
  g.fillStyle = "#F3F5F8";
  g.beginPath();
  g.roundRect(300, 320, 1250, 620, 14);
  g.fill();
  g.fillStyle = "#0E1B2C";
  g.font = '600 22px "Inter"';
  g.fillText("Projected balance", 330, 365);
  const vals = [40, 46, 44, 52, 58, 55, 63, 70, 74, 80, 86, 95];
  vals.forEach((v, i) => {
    const h = v * 5.2;
    g.fillStyle = i === vals.length - 1 ? "#18E299" : "#C9D3DF";
    g.fillRect(340 + i * 98, 900 - h, 64, h);
  });
  return c.toBuffer("image/png");
}

export function logoPng(): Buffer {
  fonts();
  const c = createCanvas(720, 200);
  const g = c.getContext("2d");
  g.clearRect(0, 0, 720, 200);
  g.fillStyle = "#18E299";
  g.beginPath();
  g.roundRect(10, 40, 120, 120, 28);
  g.fill();
  g.fillStyle = "#0E1B2C";
  g.font = '700 110px "Inter"';
  g.fillText("Ledgerly", 160, 140);
  return c.toBuffer("image/png");
}

export const demoBrief = {
  productName: "Ledgerly",
  memoryGoal: "Ledgerly tells you your runway before your accountant does.",
  audience: "Seed to Series B founders who manage cash in spreadsheets.",
  durationSec: 14,
  mustUse: [
    { id: "logo", label: "Ledgerly logo", kind: "logo" as const, note: "Green mark + wordmark" },
    { id: "cashflow", label: "Cash flow dashboard", kind: "screen" as const, note: "The runway KPI is the hero" },
    { id: "colors", label: "Brand colors", kind: "color" as const, note: "" },
  ],
  brandColors: [
    { name: "Ink", hex: "#0E1B2C" },
    { name: "Mint", hex: "#18E299" },
    { name: "Paper", hex: "#F6F7F4" },
  ],
  fonts: [
    { role: "display" as const, family: "Inter Display" },
    { role: "body" as const, family: "Inter" },
  ],
  forbidden: ["Stock footage of people pointing at laptops", "Gradient backgrounds", "Invented customer logos"],
  references: [],
  siteUrl: "",
  notes: "Spreadsheets hide your runway until it is too late. Teams find 26 months of runway they did not know they had.",
};
