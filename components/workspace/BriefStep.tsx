"use client";

import { useEffect, useState } from "react";
import type { Brief, MustUse, ProductionDoc } from "@/lib/studio/types";
import { api } from "../api";
import { useStudio } from "./context";
import { LinesField, TextField } from "./fields";
import { GateBar } from "./GateBar";

const EMPTY: Brief = {
  productName: "",
  memoryGoal: "",
  audience: "",
  durationSec: 20,
  mustUse: [
    { id: "logo", label: "Logo", kind: "logo", note: "" },
    { id: "screen-1", label: "Main product screen", kind: "screen", note: "" },
  ],
  brandColors: [],
  fonts: [
    { role: "display", family: "Inter Display" },
    { role: "body", family: "Inter" },
  ],
  forbidden: ["Big centered text over a gradient", "Fake or mocked-up product UI"],
  references: [],
  siteUrl: "",
  notes: "",
};

const newId = () => Math.random().toString(36).slice(2, 10);

export function BriefStep() {
  const { view, url, run, busy } = useStudio();
  const [brief, setBrief] = useState<Brief>(view.brief ?? EMPTY);
  const [doc, setDoc] = useState<ProductionDoc | null>(view.production);
  const saved = JSON.stringify(view.brief ?? EMPTY) === JSON.stringify(brief);
  const docSaved = JSON.stringify(view.production) === JSON.stringify(doc);

  useEffect(() => setDoc(view.production), [view.production]);
  useEffect(() => {
    if (view.brief) setBrief(view.brief);
  }, [view.brief]);

  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => setBrief((b) => ({ ...b, [k]: v }));
  const setMust = (i: number, patch: Partial<MustUse>) => set("mustUse", brief.mustUse.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  const save = () => run("Saving brief", () => api<Brief>(url("brief"), { method: "PUT", json: brief }), { success: "Brief saved." });
  const generate = async () => {
    if (!saved) {
      const ok = await run("Saving brief", () => api<Brief>(url("brief"), { method: "PUT", json: brief }));
      if (!ok) return;
    }
    await run("Writing the production document", () => api(url("production/generate"), { method: "POST" }), { success: "Production document ready for review." });
  };

  return (
    <div className="stack loose">
      <div className="section-head">
        <div>
          <span className="eyebrow">Gate 1</span>
          <h2>Director&apos;s Brief</h2>
          <p>Structured decisions, not a prompt. The director expands this into a production document you approve before any code is written. Anything left blank here is a gap the model would otherwise fill with a safe default.</p>
        </div>
      </div>

      <div className="card stack">
        <div className="grid2">
          <TextField label="Product name" value={brief.productName} onChange={(v) => set("productName", v)} placeholder="Ledgerly" />
          <label className="field">
            Duration (seconds)
            <input type="number" min={6} max={90} value={brief.durationSec} onChange={(e) => set("durationSec", Number(e.target.value))} />
          </label>
        </div>
        <TextField label="The one thing the viewer should remember" hint="one sentence" value={brief.memoryGoal} onChange={(v) => set("memoryGoal", v)} placeholder="Ledgerly tells you your runway before your accountant does." />
        <TextField label="Audience" value={brief.audience} onChange={(v) => set("audience", v)} placeholder="Who watches, and where" />
        <TextField label="Facts & claims you can stand behind" hint="real numbers only; the model may not invent any" multiline rows={3} value={brief.notes} onChange={(v) => set("notes", v)} />
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h3>Must-use real assets</h3>
            <p className="small muted">Each item must be satisfied by an uploaded, confirmed asset before the assets gate opens. The model may never replace these.</p>
          </div>
          <button className="btn sm" onClick={() => set("mustUse", [...brief.mustUse, { id: newId(), label: "", kind: "screen", note: "" }])}>
            + Add
          </button>
        </div>
        {brief.mustUse.length === 0 && <p className="small muted">None yet.</p>}
        {brief.mustUse.map((m, i) => (
          <div key={m.id} className="row">
            <select value={m.kind} onChange={(e) => setMust(i, { kind: e.target.value as MustUse["kind"] })} style={{ width: 130 }}>
              {["logo", "screen", "image", "font", "color", "other"].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <input type="text" placeholder="Label (e.g. Cash flow dashboard)" value={m.label} onChange={(e) => setMust(i, { label: e.target.value })} />
            <input type="text" placeholder="Note (what matters about it)" value={m.note} onChange={(e) => setMust(i, { note: e.target.value })} />
            <button className="icon-btn" title="Remove" onClick={() => set("mustUse", brief.mustUse.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="grid2">
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>Brand colors</h3>
            <button className="btn sm" onClick={() => set("brandColors", [...brief.brandColors, { name: "", hex: "#2B59FF" }])}>
              + Add
            </button>
          </div>
          {brief.brandColors.map((c, i) => (
            <div key={i} className="row">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "#000000"} onChange={(e) => set("brandColors", brief.brandColors.map((x, j) => (j === i ? { ...x, hex: e.target.value.toUpperCase() } : x)))} />
              <input type="text" value={c.hex} style={{ width: 110 }} onChange={(e) => set("brandColors", brief.brandColors.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))} />
              <input type="text" placeholder="Name" value={c.name} onChange={(e) => set("brandColors", brief.brandColors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <button className="icon-btn" onClick={() => set("brandColors", brief.brandColors.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          {brief.brandColors.length === 0 && <p className="small muted">Add the real brand colors. Inspecting the live site (next step) can suggest them.</p>}
        </div>
        <div className="card stack">
          <h3>Fonts</h3>
          {(["display", "body"] as const).map((role) => (
            <label key={role} className="field">
              {role === "display" ? "Display" : "Body"} family
              <input
                type="text"
                list="font-families"
                value={brief.fonts.find((f) => f.role === role)?.family ?? ""}
                onChange={(e) => set("fonts", [...brief.fonts.filter((f) => f.role !== role), { role, family: e.target.value }])}
              />
            </label>
          ))}
          <datalist id="font-families">
            {view.fonts.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <p className="small muted">Available to the renderer: {view.fonts.join(", ")}. Upload brand font files on the next step to use them.</p>
        </div>
      </div>

      <div className="grid2">
        <div className="card stack">
          <LinesField label="Forbidden / unacceptable outcomes" hint="one per line" value={brief.forbidden} onChange={(v) => set("forbidden", v)} rows={4} />
        </div>
        <div className="card stack">
          <TextField label="Live site (optional)" value={brief.siteUrl} onChange={(v) => set("siteUrl", v)} placeholder="https://…" />
          <LinesField
            label="Visual references"
            hint="links or notes, one per line"
            value={brief.references.map((r) => r.value)}
            onChange={(v) => set("references", v.map((value) => ({ kind: /^https?:\/\//.test(value) ? "url" : "note", value, note: "" })))}
            rows={3}
          />
        </div>
      </div>

      <div className="row">
        <button className="btn" onClick={save} disabled={saved || !!busy}>
          {saved ? "Saved" : "Save brief"}
        </button>
        <button className="btn primary" onClick={generate} disabled={!!busy || !brief.productName || !brief.memoryGoal}>
          {view.production ? "Regenerate production document" : "Generate production document"}
        </button>
        {!saved && <span className="badge warn">Unsaved changes</span>}
      </div>

      {doc && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <span className="eyebrow">Production document · review before approving</span>
              <h3 style={{ marginTop: 4 }}>{doc.logline}</h3>
            </div>
            <button className="btn sm" disabled={docSaved || !!busy} onClick={() => run("Saving document", () => api(url("production"), { method: "PUT", json: doc }), { success: "Production document saved." })}>
              {docSaved ? "Saved" : "Save edits"}
            </button>
          </div>
          <div className="grid2">
            <TextField label="Logline" value={doc.logline} onChange={(v) => setDoc({ ...doc, logline: v })} multiline />
            <TextField label="Memory goal" value={doc.memoryGoal} onChange={(v) => setDoc({ ...doc, memoryGoal: v })} multiline />
          </div>
          <LinesField label="Narrative arc" value={doc.narrativeArc} onChange={(v) => setDoc({ ...doc, narrativeArc: v })} rows={5} />
          <div className="grid2">
            <TextField label="Tone & pacing" value={doc.toneAndPacing} onChange={(v) => setDoc({ ...doc, toneAndPacing: v })} multiline rows={3} />
            <TextField label="Visual approach" value={doc.visualApproach} onChange={(v) => setDoc({ ...doc, visualApproach: v })} multiline rows={3} />
          </div>
          <LinesField label="Motion principles" value={doc.motionPrinciples} onChange={(v) => setDoc({ ...doc, motionPrinciples: v })} rows={4} />
          <div className="grid3">
            <LinesField label="Must use (real)" value={doc.assetBoundary.mustUse} onChange={(v) => setDoc({ ...doc, assetBoundary: { ...doc.assetBoundary, mustUse: v } })} rows={4} />
            <LinesField label="Model may invent" value={doc.assetBoundary.modelMayInvent} onChange={(v) => setDoc({ ...doc, assetBoundary: { ...doc.assetBoundary, modelMayInvent: v } })} rows={4} />
            <LinesField label="Model may NOT invent" value={doc.assetBoundary.modelMayNotInvent} onChange={(v) => setDoc({ ...doc, assetBoundary: { ...doc.assetBoundary, modelMayNotInvent: v } })} rows={4} />
          </div>
          <div className="grid2">
            <LinesField label="Forbidden" value={doc.forbidden} onChange={(v) => setDoc({ ...doc, forbidden: v })} rows={3} />
            <LinesField label="Open questions" hint="answer these in the brief, then regenerate" value={doc.openQuestions} onChange={(v) => setDoc({ ...doc, openQuestions: v })} rows={3} />
          </div>
        </div>
      )}

      <GateBar gate="brief" approveLabel="Approve production document" next="assets" />
    </div>
  );
}
