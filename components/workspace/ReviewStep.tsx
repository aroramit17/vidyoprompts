"use client";

import { useEffect, useMemo, useState } from "react";
import { frameToTimecode, type FormatId } from "@/lib/engine";
import { FLAG_CATEGORIES, type ContactSheet, type Flag, type FlagCategory } from "@/lib/studio/types";
import { api } from "../api";
import { useStudio } from "./context";
import { GateBar } from "./GateBar";

export function ReviewStep() {
  const { view, url, run, busy } = useStudio();
  const locked = view.gates.review.status === "locked";
  const [format, setFormat] = useState<FormatId>("16:9");
  const sheets = view.sheets.filter((s) => s.format === format);
  const [sheetRev, setSheetRev] = useState<number | null>(null);
  const sheet: ContactSheet | undefined = sheets.find((s) => s.revision === sheetRev) ?? sheets.at(-1);
  useEffect(() => setSheetRev(null), [view.sheets.length, format]);
  const [selected, setSelected] = useState<{ frame: number; beat: string } | null>(null);
  const [category, setCategory] = useState<FlagCategory>("timing");
  const [note, setNote] = useState("");
  const [lastFix, setLastFix] = useState<{ summary: string; applied: string[]; rejected: string[] } | null>(null);
  const film = view.film;
  const current = sheet && sheet.filmRevision === view.meta.filmRevision;
  const dir = sheet ? `${String(sheet.revision).padStart(3, "0")}-${sheet.format.replace(":", "x")}` : "";
  const openFlags = view.flags.filter((f) => f.status === "open");
  const flagsByFrame = useMemo(() => {
    const m = new Map<number, number>();
    for (const f of openFlags) if (f.frame !== null) m.set(f.frame, (m.get(f.frame) ?? 0) + 1);
    return m;
  }, [openFlags]);

  const render = () => run(`Rendering ${format} contact sheet`, () => api<ContactSheet>(url("sheets"), { method: "POST", json: { format } }));
  const addFlag = async () => {
    if (!note.trim()) return;
    const ok = await run("Adding flag", () => api(url("flags"), { method: "POST", json: { frame: selected?.frame ?? null, beat: selected?.beat ?? null, category, note } }));
    if (ok) setNote("");
  };
  const setFlag = (f: Flag, status: Flag["status"]) => run("Updating flag", () => api(url(`flags/${f.id}`), { method: "PATCH", json: { status } }));

  return (
    <div className="stack loose">
      <div className="section-head">
        <div>
          <span className="eyebrow">Gate 5</span>
          <h2>Contact-sheet review</h2>
          <p>Key frames at every beat (entry, middle, exit) plus strips around fast transitions, rendered by the same deterministic engine that exports the film. Flag what is wrong; fixes become local program edits and a new sheet. Export unlocks only after you approve a sheet of the current program.</p>
        </div>
      </div>
      {locked && <div className="notice warn">A valid film program is required first.</div>}

      <div className="card row wrap">
        {(["16:9", "9:16"] as const).map((f) => (
          <button key={f} className={`btn sm ${format === f ? "primary" : ""}`} onClick={() => setFormat(f)}>
            {f}
          </button>
        ))}
        <button className="btn primary" disabled={locked || !!busy} onClick={render}>
          Render contact sheet (r{view.meta.filmRevision})
        </button>
        {sheets.length > 1 && (
          <select value={sheet?.revision ?? ""} onChange={(e) => setSheetRev(Number(e.target.value))} style={{ width: 200 }}>
            {[...sheets].reverse().map((s) => (
              <option key={s.revision} value={s.revision}>
                Sheet #{s.revision} · program r{s.filmRevision}
              </option>
            ))}
          </select>
        )}
        {sheet && (
          <span className="small muted">
            {sheet.frames.length} frames · {sheet.rendered} rendered, {sheet.reused} reused from cache · {sheet.ms}ms
          </span>
        )}
        {sheet && !current && <span className="badge warn">Out of date: program is r{view.meta.filmRevision}</span>}
        <span className="spacer" />
        {sheet && (
          <a className="btn sm" href={url(`sheets/${dir}/${sheet.composites[0]}`)} target="_blank" rel="noreferrer">
            Composite
          </a>
        )}
      </div>

      {sheet && film ? (
        <div className="split">
          <div className="sheet">
            {film.beats.map((b, bi) => {
              const beat = view.beats?.find((x) => x.id === b.id);
              const frames = sheet.frames.filter((f) => f.beat === b.id);
              return (
                <div key={b.id} className="sheet-row">
                  <div className="sheet-beat stack tight">
                    <strong>
                      {bi + 1}. {b.label}
                    </strong>
                    <span className="muted mono">
                      {frameToTimecode(b.start, film.fps)}–{frameToTimecode(b.end, film.fps)} · {((b.end - b.start) / film.fps).toFixed(1)}s
                    </span>
                    {beat && (
                      <>
                        <span>{beat.purpose}</span>
                        <span className="muted">
                          <strong>Change:</strong> {beat.keyVisualChange}
                        </span>
                        <span className="muted">
                          <strong>Exit:</strong> {beat.exitState}
                        </span>
                      </>
                    )}
                  </div>
                  <div className={`sheet-frames ${format === "9:16" ? "vertical" : ""}`}>
                    {frames.map((f) => (
                      <div
                        key={f.frame}
                        className={`frame ${f.kind === "strip" ? "strip" : ""} ${selected?.frame === f.frame ? "selected" : ""}`}
                        onClick={() => setSelected({ frame: f.frame, beat: f.beat })}
                        title={`Frame ${f.frame} (${f.kind})`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url(`sheets/${dir}/${f.file}`)} alt={`frame ${f.frame}`} loading="lazy" />
                        <span className="frame-label">
                          f{f.frame} · {f.kind}
                        </span>
                        {!f.reused && sheet.revision > 1 && <span className="frame-new">changed</span>}
                        {flagsByFrame.get(f.frame) ? <span className="frame-flag">⚑ {flagsByFrame.get(f.frame)}</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="stack" style={{ position: "sticky", top: 70 }}>
            <div className="card stack tight">
              <h3>Flag an issue</h3>
              {selected ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${url("frame")}?f=${selected.frame}&format=${encodeURIComponent(format)}&scale=0.4&rev=${view.meta.filmRevision}`} alt="" style={{ width: "100%", borderRadius: 6 }} />
                  <span className="small muted">
                    Frame {selected.frame} · {frameToTimecode(selected.frame, film.fps)} · beat {selected.beat}
                  </span>
                </>
              ) : (
                <span className="small muted">Click a frame to attach the flag to it, or flag the whole film.</span>
              )}
              <select value={category} onChange={(e) => setCategory(e.target.value as FlagCategory)}>
                {FLAG_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <textarea rows={3} placeholder="What is wrong and what should change? e.g. “Hold the runway number longer.”" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row">
                <button className="btn sm primary" disabled={!note.trim() || !!busy} onClick={addFlag}>
                  Add flag
                </button>
                {selected && (
                  <button className="btn sm ghost" onClick={() => setSelected(null)}>
                    Clear frame
                  </button>
                )}
              </div>
            </div>

            <div className="card stack tight">
              <div className="row">
                <h3 style={{ flex: 1 }}>Flags</h3>
                <button className="btn sm" disabled={!current || !!busy || format !== "16:9"} title="Deterministic lint + AI critique of the 16:9 sheet" onClick={() => run("Critiquing contact sheet", () => api<{ added: number }>(url("critique"), { method: "POST" }), { success: "Critique done." })}>
                  Run critique
                </button>
                <button
                  className="btn sm primary"
                  disabled={openFlags.length === 0 || !!busy}
                  onClick={async () => {
                    const r = await run("Turning flags into local edits", () => api<{ summary: string; applied: string[]; rejected: string[] }>(url("flags/apply"), { method: "POST", json: {} }));
                    if (r) setLastFix(r);
                  }}
                >
                  Apply fixes ({openFlags.length})
                </button>
              </div>
              {lastFix && (
                <div className="notice ok small stack tight">
                  <span>{lastFix.summary}</span>
                  {lastFix.applied.length > 0 && <div className="diff">{lastFix.applied.join("\n")}</div>}
                  {lastFix.rejected.length > 0 && <div className="diff">{lastFix.rejected.map((r) => `rejected: ${r}`).join("\n")}</div>}
                </div>
              )}
              <div className="list">
                {view.flags.length === 0 && <div className="list-item small muted">No flags yet.</div>}
                {[...view.flags]
                  .sort((a, b) => Number(b.status === "open") - Number(a.status === "open"))
                  .map((f) => (
                    <div key={f.id} className={`flag ${f.status}`}>
                      <div className="row">
                        <span className={`badge ${f.status === "open" ? "warn" : f.status === "addressed" ? "ok" : ""}`}>{f.category}</span>
                        <span className="small muted">
                          {f.source}
                          {f.frame !== null ? ` · f${f.frame}` : ""}
                          {f.beat ? ` · ${f.beat}` : ""}
                        </span>
                        <span className="spacer" />
                        {f.status === "open" ? (
                          <button className="btn sm ghost" onClick={() => setFlag(f, "dismissed")}>
                            Dismiss
                          </button>
                        ) : (
                          <button className="btn sm ghost" onClick={() => setFlag(f, "open")}>
                            Reopen
                          </button>
                        )}
                      </div>
                      <span className="small">{f.note}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        !locked && <div className="empty">No {format} contact sheet yet. Render one to review the program.</div>
      )}

      <GateBar gate="review" approveLabel="Approve contact sheet" next="export" />
    </div>
  );
}
