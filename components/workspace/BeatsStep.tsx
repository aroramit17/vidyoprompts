"use client";

import { useEffect, useState } from "react";
import type { Beat } from "@/lib/studio/types";
import { api } from "../api";
import { useStudio } from "./context";
import { TextField } from "./fields";
import { GateBar } from "./GateBar";

const emptyState = { size: "", color: "", content: "", position: "" };

export function BeatsStep() {
  const { view, url, run, busy } = useStudio();
  const locked = view.gates.beats.status === "locked";
  const [beats, setBeats] = useState<Beat[]>(view.beats ?? []);
  useEffect(() => setBeats(view.beats ?? []), [view.beats]);
  const saved = JSON.stringify(beats) === JSON.stringify(view.beats ?? []);
  const total = beats.reduce((s, b) => s + (Number(b.durationSec) || 0), 0);
  const target = view.brief?.durationSec ?? 0;
  const confirmed = view.assets.filter((a) => a.confirmed && a.kind !== "font");

  const update = (i: number, patch: Partial<Beat>) => setBeats(beats.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= beats.length) return;
    const next = [...beats];
    [next[i], next[j]] = [next[j], next[i]];
    setBeats(next);
  };
  const save = () => run("Saving beats", () => api(url("beats"), { method: "PUT", json: { beats } }), { success: "Beats saved." });

  return (
    <div className="stack loose">
      <div className="section-head">
        <div>
          <span className="eyebrow">Gate 3</span>
          <h2>Beats, states &amp; shot list</h2>
          <p>The shot list is a contract. Each beat states why it exists and the one visible change that carries it. Edit, reorder, delete, or demand a justification. The program must keep these beats, in this order.</p>
        </div>
        <button className="btn primary" disabled={locked || !!busy} onClick={() => run("Writing beats", () => api(url("beats/generate"), { method: "POST" }), { success: "Beats ready for review." })}>
          {view.beats ? "Regenerate beats" : "Generate beats"}
        </button>
      </div>
      {locked && <div className="notice warn">Approve assets &amp; style first.</div>}

      {beats.length > 0 && (
        <div className="stack tight">
          <div className="timeline-bar">
            {beats.map((b, i) => (
              <div key={b.id} style={{ width: `${(b.durationSec / Math.max(total, 0.1)) * 100}%`, background: i % 2 ? "var(--panel-2)" : "var(--panel)" }} title={`${b.title} · ${b.durationSec}s`}>
                {i + 1}. {b.title}
              </div>
            ))}
          </div>
          <span className={`small ${Math.abs(total - target) > 0.5 ? "" : "muted"}`} style={Math.abs(total - target) > 0.5 ? { color: "var(--warn)" } : undefined}>
            Total {total.toFixed(1)}s · brief asks for {target}s
          </span>
        </div>
      )}

      <div className="stack">
        {beats.map((b, i) => (
          <div key={b.id} className="beat">
            <div className="beat-head">
              <span className="beat-num">{String(i + 1).padStart(2, "0")}</span>
              <input type="text" value={b.title} onChange={(e) => update(i, { title: e.target.value })} style={{ fontWeight: 700, maxWidth: 320 }} />
              <label className="row small" style={{ gap: 6 }}>
                <input type="number" step={0.1} min={0.5} max={30} value={b.durationSec} onChange={(e) => update(i, { durationSec: Number(e.target.value) })} style={{ width: 80 }} />s
              </label>
              <span className="spacer" />
              <button className="icon-btn" title="Move up" onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="icon-btn" title="Move down" onClick={() => move(i, 1)}>
                ↓
              </button>
              <button className="btn sm" disabled={!saved || !!busy} title={saved ? "" : "Save first"} onClick={() => run("Asking the director to justify this beat", () => api(url(`beats/${b.id}/justify`), { method: "POST" }))}>
                Justify
              </button>
              <button className="icon-btn" title="Delete beat" onClick={() => setBeats(beats.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            <div className="beat-body">
              <div className="full">
                <TextField label="Why it exists" value={b.purpose} onChange={(v) => update(i, { purpose: v })} />
              </div>
              <TextField label="Entry state" value={b.entryState} onChange={(v) => update(i, { entryState: v })} multiline />
              <TextField label="Exit state" value={b.exitState} onChange={(v) => update(i, { exitState: v })} multiline />
              <TextField label="Key visual change" value={b.keyVisualChange} onChange={(v) => update(i, { keyVisualChange: v })} />
              <TextField label="On-screen text" hint="real claims only" value={b.onScreenText} onChange={(v) => update(i, { onScreenText: v })} />
              <div className="full stack tight">
                <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>Assets in this beat</span>
                <div className="row wrap">
                  {confirmed.map((a) => (
                    <label key={a.id} className="badge" style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={b.assets.includes(a.id)}
                        onChange={(e) => update(i, { assets: e.target.checked ? [...b.assets, a.id] : b.assets.filter((x) => x !== a.id) })}
                      />
                      {a.label}
                    </label>
                  ))}
                  {confirmed.length === 0 && <span className="small muted">No confirmed assets.</span>}
                </div>
              </div>
              <div className="full stack tight">
                <div className="row">
                  <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>Component states (UI beats)</span>
                  <button className="btn sm ghost" onClick={() => update(i, { components: [...b.components, { name: "", entry: { ...emptyState }, exit: { ...emptyState } }] })}>
                    + component
                  </button>
                </div>
                {b.components.length > 0 && (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Component</th>
                        <th></th>
                        <th>Size</th>
                        <th>Color</th>
                        <th>Content</th>
                        <th>Position</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.components.flatMap((c, ci) =>
                        (["entry", "exit"] as const).map((phase) => (
                          <tr key={`${ci}-${phase}`}>
                            <td>
                              {phase === "entry" && (
                                <input type="text" value={c.name} onChange={(e) => update(i, { components: b.components.map((x, k) => (k === ci ? { ...x, name: e.target.value } : x)) })} />
                              )}
                            </td>
                            <td className="small muted">{phase}</td>
                            {(["size", "color", "content", "position"] as const).map((field) => (
                              <td key={field}>
                                <input
                                  type="text"
                                  value={c[phase][field]}
                                  onChange={(e) => update(i, { components: b.components.map((x, k) => (k === ci ? { ...x, [phase]: { ...x[phase], [field]: e.target.value } } : x)) })}
                                />
                              </td>
                            ))}
                            <td>
                              {phase === "entry" && (
                                <button className="icon-btn" onClick={() => update(i, { components: b.components.filter((_, k) => k !== ci) })}>
                                  ✕
                                </button>
                              )}
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                )}
              </div>
              {b.justification && (
                <div className="full notice">
                  <strong>Director:</strong> {b.justification}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="row">
        <button
          className="btn"
          disabled={locked}
          onClick={() =>
            setBeats([
              ...beats,
              { id: `b${Date.now().toString(36)}`, title: "New beat", durationSec: 2, purpose: "", entryState: "", exitState: "", keyVisualChange: "", onScreenText: "", assets: [], components: [], justification: "" },
            ])
          }
        >
          + Add beat
        </button>
        <button className="btn primary" disabled={saved || !!busy || beats.length === 0} onClick={save}>
          {saved ? "Saved" : "Save beats"}
        </button>
        {!saved && <span className="badge warn">Unsaved changes</span>}
      </div>

      <GateBar gate="beats" approveLabel="Approve shot list" next="film" />
    </div>
  );
}
