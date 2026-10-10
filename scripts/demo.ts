/**
 * Seed a demo project ("Ledgerly") and walk it to a rendered contact sheet.
 *   npm run demo            # stops at the review gate
 *   npm run demo -- --brief # stops after the brief, for walking the UI yourself
 */
import { dashboardPng, demoBrief, logoPng } from "./fixtures";

async function main() {
  const onlyBrief = process.argv.includes("--brief");
  const studio = await import("../lib/server/studio");
  const store = await import("../lib/server/store");
  const meta = await store.createProject("Ledgerly — runway launch film");
  const id = meta.id;
  await studio.updateBrief(id, demoBrief);
  const logo = await studio.addAsset(id, { filename: "ledgerly-logo.png", mime: "image/png", data: logoPng(), kind: "logo", mustUseId: "logo", label: "Ledgerly logo" });
  const screen = await studio.addAsset(id, { filename: "cash-flow.png", mime: "image/png", data: dashboardPng(), kind: "screen", mustUseId: "cashflow", label: "Cash flow dashboard" });
  if (onlyBrief) {
    console.log(`Created ${id} (brief + unconfirmed assets). Open /p/${id}`);
    return;
  }
  await studio.generateProduction(id);
  await studio.approve(id, "brief");
  await studio.updateAsset(id, logo.id, { confirmed: true });
  await studio.updateAsset(id, screen.id, { confirmed: true, regions: [{ label: "Runway KPI", x: 0.18, y: 0.14, w: 0.26, h: 0.15 }] });
  await studio.generateStyle(id);
  await studio.approve(id, "assets");
  await studio.generateBeats(id);
  await studio.approve(id, "beats");
  await studio.generateFilm(id);
  const sheet = await studio.renderSheet(id, "16:9");
  console.log(`Created ${id}: contact sheet r${sheet.revision} with ${sheet.frames.length} frames in ${sheet.ms}ms. Open /p/${id}`);
  console.log(store.projectPath(id, "sheets", `${String(sheet.revision).padStart(3, "0")}-16x9`, "sheet-1.png"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
