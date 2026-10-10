/**
 * End-to-end pipeline with the offline director: brief → assets → beats → program →
 * contact sheet → review → export → package → import. Exercises every gate.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dashboardPng, demoBrief, logoPng } from "../scripts/fixtures";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "studio-test-"));
process.env.STUDIO_DATA_DIR = dataDir;
process.env.STUDIO_DIRECTOR = "offline";
process.env.STUDIO_X264_PRESET = "ultrafast";

type Studio = typeof import("@/lib/server/studio");
type Store = typeof import("@/lib/server/store");
let studio: Studio;
let store: Store;
let pkg: typeof import("@/lib/server/package");
let id: string;

beforeAll(async () => {
  studio = await import("@/lib/server/studio");
  store = await import("@/lib/server/store");
  pkg = await import("@/lib/server/package");
  id = (await store.createProject("Ledgerly launch")).id;
});

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const gates = async () => (await studio.projectView(id)).gates;

describe("studio pipeline (offline director)", () => {
  it("gate 1: brief needs a production doc before approval", async () => {
    await studio.updateBrief(id, demoBrief);
    await expect(studio.approve(id, "brief")).rejects.toThrow(/production document/);
    const doc = await studio.generateProduction(id);
    expect(doc.memoryGoal).toBe(demoBrief.memoryGoal);
    expect(doc.assetBoundary.modelMayNotInvent.length).toBeGreaterThan(0);
    await studio.approve(id, "brief");
    expect((await gates()).brief.status).toBe("approved");
  });

  it("gate 2: blocks until required assets are uploaded, linked and confirmed", async () => {
    let g = await gates();
    expect(g.assets.blockers.join(" ")).toMatch(/Ledgerly logo/);
    const logo = await studio.addAsset(id, { filename: "logo.png", mime: "image/png", data: logoPng(), kind: "logo", mustUseId: "logo" });
    const screen = await studio.addAsset(id, { filename: "cashflow.png", mime: "image/png", data: dashboardPng(), kind: "screen", mustUseId: "cashflow" });
    expect(screen.width).toBe(1600);
    g = await gates();
    expect(g.assets.blockers.join(" ")).toMatch(/not confirmed/);
    await studio.updateAsset(id, logo.id, { confirmed: true });
    await studio.updateAsset(id, screen.id, { confirmed: true, regions: [{ label: "Runway KPI", x: 0.18, y: 0.14, w: 0.26, h: 0.15 }] });
    await expect(studio.approve(id, "assets")).rejects.toThrow(/style guide/);
    const style = await studio.generateStyle(id);
    expect(style.palette.some((p) => p.hex === "#18E299")).toBe(true);
    await studio.approve(id, "assets");
    expect((await gates()).assets.status).toBe("approved");
  });

  it("gate 3: beats are generated, editable and justified", async () => {
    const beats = await studio.generateBeats(id);
    expect(beats.length).toBeGreaterThanOrEqual(3);
    const total = beats.reduce((s, b) => s + b.durationSec, 0);
    expect(Math.abs(total - demoBrief.durationSec)).toBeLessThan(0.5);
    const j = await studio.justifyBeat(id, beats[0].id);
    expect(["keep", "merge", "cut", "rework"]).toContain(j.verdict);
    // Reorder (swap first two) and save: a user edit to the contract.
    const edited = [beats[1], beats[0], ...beats.slice(2)];
    await studio.updateBeats(id, edited);
    await studio.updateBeats(id, beats);
    await studio.approve(id, "beats");
  });

  it("gate 4: generates a valid film program that uses the real assets", async () => {
    await studio.generateFilm(id);
    const view = await studio.projectView(id);
    expect(view.gates.film.status).toBe("approved");
    expect(view.filmIssues.filter((i) => i.level === "error")).toEqual([]);
    const images = view.film!.layers.filter((l) => l.type === "image").map((l) => l.props.asset);
    for (const a of view.assets) if (a.kind !== "font") expect(images).toContain(a.id);
    expect(view.film!.beats.map((b) => b.id)).toEqual(view.beats!.map((b) => b.id));
  });

  it("gate 5: review requires a sheet of the current program and no open flags", async () => {
    await expect(studio.approve(id, "review")).rejects.toThrow(/contact sheet/);
    const sheet = await studio.renderSheet(id, "16:9");
    expect(sheet.frames.length).toBeGreaterThan(8);
    expect(sheet.rendered + sheet.reused).toBe(sheet.frames.length);

    await studio.addFlag(id, { frame: sheet.frames[2].frame, beat: null, category: "timing", note: "Let this hold a little longer." });
    await expect(studio.approve(id, "review")).rejects.toThrow(/open review flag/);
    const before = (await studio.projectView(id)).film!.duration;
    const result = await studio.applyFlags(id);
    expect(result.applied.length).toBeGreaterThan(0);
    const view = await studio.projectView(id);
    expect(view.film!.duration).toBeGreaterThan(before);
    expect(view.flags.every((f) => f.status !== "open")).toBe(true);
    expect(result.sheet!.reused).toBeGreaterThan(0); // unchanged frames come from the cache
    await studio.approve(id, "review");
    expect((await gates()).review.status).toBe("approved");
  });

  it("a local change re-renders only affected frames and re-opens review", async () => {
    const view = await studio.projectView(id);
    const lastBeat = view.film!.beats.at(-1)!;
    const target = view.film!.layers.find((l) => l.beat === lastBeat.id && l.type === "text")!;
    await studio.patchFilm(id, [{ op: "set", layer: target.id, prop: "color", value: "#0E1B2C" === target.props.color ? "#000000" : "#0E1B2C" }]);
    expect((await gates()).review.status).toBe("open");
    const sheet = await studio.renderSheet(id, "16:9");
    expect(sheet.reused).toBeGreaterThan(sheet.rendered);
    await studio.approve(id, "review");
  });

  it("gate 6: exports MP4s; 9:16 needs its own contact sheet", async () => {
    const { exportVideo } = await import("@/lib/server/render");
    const state = await studio.loadState(id);
    await expect(studio.startExport(id, "9:16")).rejects.toThrow(/9:16 contact sheet/);
    const info = await exportVideo(state.meta, state.film!, "16:9", () => {});
    expect(info.bytes).toBeGreaterThan(10_000);
    await studio.renderSheet(id, "9:16");
    const v = await exportVideo((await studio.loadState(id)).meta, state.film!, "9:16", () => {});
    expect(v.format).toBe("9:16");
  });

  it("packages the project and starts the next film from it", async () => {
    const { data } = await pkg.buildPackage(id);
    const zip = await JSZip.loadAsync(data);
    const names = Object.keys(zip.files).map((n) => n.split("/").slice(1).join("/"));
    for (const f of ["README.md", "brief.json", "production.md", "style.md", "shotlist.md", "film.json", "engine/evaluate.ts"]) expect(names).toContain(f);
    expect(names.some((n) => n.startsWith("contact-sheets/") && n.endsWith("sheet-1.png"))).toBe(true);
    expect(names.some((n) => n.startsWith("exports/") && n.endsWith(".mp4"))).toBe(true);

    const imported = await pkg.importPackage(data);
    const iv = await studio.projectView(imported.id);
    expect(iv.film).not.toBeNull();
    expect(iv.assets.length).toBe(2);
    expect(iv.gates.brief.status).toBe("open"); // approvals do not travel; files do

    const next = await pkg.forkProject(id);
    const nv = await studio.projectView(next.id);
    expect(nv.brief!.productName).toBe("Ledgerly");
    expect(nv.style).not.toBeNull();
    expect(nv.film).toBeNull();
  });
});
