"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EASE_NAMES, evaluateFrame, type Film, type FormatId, type Layer, type Motion } from "@/lib/engine";
import { Player } from "../Player";
import { api } from "../api";
import { useStudio } from "./context";
import { GateBar } from "./GateBar";

export function FilmStep() {
  const { view, url, run, busy } = useStudio();
  const locked = view.gates.film.status === "locked";
  const film = view.film;
  const [format, setFormat] = useState<FormatId>("16:9");
  const [frame, setFrame] = useState(0);
  const assetUrl = useCallback((assetId: string) => url(`assets/${assetId}/file`), [url]);
  const last = view.revisions.at(-1);
  const stale = view.gates.film.blockers.find((b) => b.includes("beats changed"));

  return (
    <div className="stack loose">
      <div className="section-head">
        <div>
          <span className="eyebrow">Gate 4</span>
          <h2>Film program</h2>
          <p>The director writes a program, not pixels: layers, keyframes and motion rules evaluated as a pure function of the frame number. Every image layer must point at a confirmed asset or the program is rejected.</p>
        </div>
        <button className="btn primary" disabled={locked || !!busy} onClick={() => run("Writing the film program", () => api(url("film/generate"), { method: "POST" }), { success: "Program generated and validated." })}>
          {film ? "Regenerate program" : "Generate program"}
        </button>
      </div>
      {locked && <div className="notice warn">Approve the beats first.</div>}
      {stale && <div className="notice warn">{stale}</div>}

      {film && (
        <>
          {last && (
            <div className="notice">
              <strong>r{last.revision}</strong> · {last.source} · {last.summary}
            </div>
          )}
          <div className="split">
            <div className="stack">
              <div className="row">
                {(["16:9", "9:16"] as const).map((f) => (
                  <button key={f} className={`btn sm ${format === f ? "primary" : ""}`} onClick={() => setFormat(f)}>
                    {f}
                  </button>
                ))}
                <span className="small muted">
                  {film.duration} frames · {(film.duration / film.fps).toFixed(1)}s · {film.layers.length} layers
                </span>
                <span className="spacer" />
                <a className="btn sm" href={`${url("frame")}?f=${frame}&format=${encodeURIComponent(format)}&scale=1`} target="_blank" rel="noreferrer">
                  Server render of f{frame}
                </a>
              </div>
              <Player film={film} assets={view.assets} assetUrl={assetUrl} format={format} frame={frame} onFrame={setFrame} />
              <LayerInspector film={film} frame={frame} />
            </div>
            <div className="stack">
              <Issues />
              <BeatTiming film={film} />
              <MotionPanel film={film} />
            </div>
          </div>
          <Revisions />
          <JsonEditor film={film} />
        </>
      )}

      <GateBar gate="film" next="review" />
    </div>
  );
}

function Issues() {
  const { view } = useStudio();
  const errors = view.filmIssues.filter((i) => i.level === "error");
  const warnings = view.filmIssues.filter((i) => i.level === "warning");
  return (
    <div className="card stack tight">
      <h3>Validation</h3>
      {errors.length === 0 && <div className="notice ok">No errors. Assets, fonts, colors and beats check out.</div>}
      {errors.map((e, i) => (
        <div key={i} className="notice bad small">
          {e.message}
        </div>
      ))}
      {warnings.map((e, i) => (
        <div key={i} className="notice warn small">
          {e.message}
        </div>
      ))}
    </div>
  );
}

function BeatTiming({ film }: { film: Film }) {
  const { url, run, busy } = useStudio();
  const [lens, setLens] = useState<Record<string, number>>({});
  useEffect(() => setLens({}), [film]);
  return (
    <div className="card stack tight">
      <h3>Beat timing</h3>
      <p className="small muted">Retiming stretches one beat and shifts everything after it. Nothing else changes.</p>
      {film.beats.map((b) => {
        const len = b.end - b.start;
        const value = lens[b.id] ?? len;
        return (
          <div key={b.id} className="row small">
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.label}</span>
            <input type="number" min={6} value={value} style={{ width: 80 }} onChange={(e) => setLens({ ...lens, [b.id]: Number(e.target.value) })} />
            <span className="muted" style={{ width: 44 }}>{(value / film.fps).toFixed(1)}s</span>
            <button className="btn sm" disabled={value === len || !!busy} onClick={() => run("Retiming", () => api(url("film/retime"), { method: "POST", json: { beat: b.id, frames: value } }), { success: "Beat retimed." })}>
              Apply
            </button>
          </div>
        );
      })}
    </div>
  );
}

function MotionPanel({ film }: { film: Film }) {
  const { url, run, busy } = useStudio();
  const [motion, setMotion] = useState<Motion>(film.motion);
  useEffect(() => setMotion(film.motion), [film.motion]);
  const dirty = JSON.stringify(motion) !== JSON.stringify(film.motion);
  const eases = [...EASE_NAMES, ...motion.springs.map((s) => `spring:${s.name}`)];
  return (
    <div className="card stack tight">
      <h3>Motion rules</h3>
      <p className="small muted">Object-class easing: each layer moves with its class&apos;s ease unless a keyframe overrides it.</p>
      {(Object.keys(motion.classes) as (keyof Motion["classes"])[]).map((cls) => (
        <label key={cls} className="row small">
          <span style={{ width: 70, fontWeight: 600 }}>{cls}</span>
          <select value={motion.classes[cls]} onChange={(e) => setMotion({ ...motion, classes: { ...motion.classes, [cls]: e.target.value } })}>
            {[...new Set([...eases, motion.classes[cls]])].map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
      ))}
      <div className="divider" style={{ margin: "6px 0" }} />
      <span className="small" style={{ fontWeight: 600 }}>Springs (stiffness / damping / mass)</span>
      {motion.springs.map((s, i) => (
        <div key={s.name} className="row small">
          <span style={{ width: 70 }}>{s.name}</span>
          {(["stiffness", "damping", "mass"] as const).map((k) => (
            <input
              key={k}
              type="number"
              step={k === "mass" ? 0.1 : 1}
              min={0.1}
              value={s[k]}
              onChange={(e) => setMotion({ ...motion, springs: motion.springs.map((x, j) => (j === i ? { ...x, [k]: Number(e.target.value) } : x)) })}
            />
          ))}
        </div>
      ))}
      <label className="row small">
        <span style={{ flex: 1 }}>Minimum readable hold (frames)</span>
        <input type="number" min={0} value={motion.minHoldFrames} style={{ width: 80 }} onChange={(e) => setMotion({ ...motion, minHoldFrames: Number(e.target.value) })} />
      </label>
      <button className="btn sm primary" disabled={!dirty || !!busy} onClick={() => run("Applying motion rules", () => api(url("film/motion"), { method: "POST", json: { motion } }), { success: "Motion rules updated." })}>
        Apply motion rules
      </button>
    </div>
  );
}

const EDITABLE: Record<string, string[]> = {
  text: ["text", "fontSize", "fontWeight", "color", "x", "y", "w"],
  image: ["zoom", "focusX", "focusY", "radius", "x", "y", "w", "h"],
  rect: ["fill", "stroke", "strokeWidth", "radius", "x", "y", "w", "h"],
  ellipse: ["fill", "x", "y", "w", "h"],
  line: ["stroke", "strokeWidth", "x", "y", "x2", "y2"],
  cursor: ["x", "y"],
  group: ["x", "y", "scale"],
};

function LayerInspector({ film, frame }: { film: Film; frame: number }) {
  const { url, run, busy } = useStudio();
  const visible = useMemo(() => new Set(evaluateFrame(film, frame).items.map((i) => i.id)), [film, frame]);
  const [selected, setSelected] = useState<string | null>(null);
  const layer = film.layers.find((l) => l.id === selected) ?? null;
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => setDraft({}), [selected, film]);
  const layers = film.layers.filter((l) => visible.has(l.id));

  const apply = (l: Layer) => {
    const ops = Object.entries(draft).map(([prop, raw]) => {
      const current = (l.props as Record<string, unknown>)[prop];
      const numeric = typeof current === "number" || (current === undefined && !["text", "color", "fill", "stroke"].includes(prop));
      return { op: "set", layer: l.id, prop, value: numeric ? Number(raw) : raw };
    });
    return run("Applying change", () => api(url("film/patch"), { method: "POST", json: { ops, summary: `Edited ${l.id} in the inspector.` } }), { success: "Saved as a new revision." });
  };

  return (
    <div className="card stack tight">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>Layers at f{frame}</h3>
        <span className="small muted">Change one value → only affected frames re-render.</span>
      </div>
      <div className="row wrap">
        {layers.map((l) => (
          <button key={l.id} className={`btn sm ${selected === l.id ? "primary" : ""}`} onClick={() => setSelected(l.id)}>
            {l.type} · {l.id}
          </button>
        ))}
        {layers.length === 0 && <span className="small muted">Nothing visible on this frame.</span>}
      </div>
      {layer && (
        <div className="stack tight">
          <div className="grid3">
            {EDITABLE[layer.type].map((prop) => {
              const animated = layer.tracks.some((t) => t.prop === prop);
              const current = (layer.props as Record<string, unknown>)[prop];
              return (
                <label key={prop} className="field">
                  <span>
                    {prop} {animated && <span className="hint">(animated by a track)</span>}
                  </span>
                  <input type="text" value={draft[prop] ?? (current === undefined ? "" : String(current))} onChange={(e) => setDraft({ ...draft, [prop]: e.target.value })} />
                </label>
              );
            })}
          </div>
          {layer.tracks.length > 0 && (
            <div className="diff">
              {layer.tracks.map((t) => `${t.prop}: ${t.keys.map((k) => `f${k.f}=${k.v}${k.ease ? ` (${k.ease})` : ""}`).join(" → ")}`).join("\n")}
            </div>
          )}
          <div className="row">
            <button className="btn sm primary" disabled={Object.keys(draft).length === 0 || !!busy} onClick={() => apply(layer)}>
              Apply {Object.keys(draft).length || ""} change{Object.keys(draft).length === 1 ? "" : "s"}
            </button>
            <span className="small muted">
              class {layer.class ?? "default"} · visible f{layer.from}–{layer.to} · {layer.priority ?? "primary"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Revisions() {
  const { view, url, run, busy } = useStudio();
  return (
    <details className="card">
      <summary>Revision history ({view.revisions.length})</summary>
      <div className="list" style={{ marginTop: 12 }}>
        {[...view.revisions].reverse().map((r) => (
          <div key={r.revision} className="list-item stack tight">
            <div className="row">
              <strong>r{r.revision}</strong>
              <span className="badge">{r.source}</span>
              <span className="small muted">{new Date(r.createdAt).toLocaleString()}</span>
              <span className="spacer" />
              {r.revision !== view.meta.filmRevision && (
                <button className="btn sm" disabled={!!busy} onClick={() => run("Reverting", () => api(url("film/revert"), { method: "POST", json: { revision: r.revision } }))}>
                  Restore
                </button>
              )}
            </div>
            <span className="small">{r.summary}</span>
            {r.changes.length > 0 && <div className="diff">{r.changes.join("\n")}</div>}
          </div>
        ))}
      </div>
    </details>
  );
}

function JsonEditor({ film }: { film: Film }) {
  const { url, run, busy } = useStudio();
  const [text, setText] = useState(() => JSON.stringify(film, null, 2));
  useEffect(() => setText(JSON.stringify(film, null, 2)), [film]);
  let parseError: string | null = null;
  try {
    JSON.parse(text);
  } catch (e) {
    parseError = (e as Error).message;
  }
  return (
    <details className="card">
      <summary>Program source (film.json)</summary>
      <div className="stack tight" style={{ marginTop: 12 }}>
        <textarea className="mono" rows={24} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <div className="row">
          <button className="btn sm primary" disabled={!!parseError || !!busy || text === JSON.stringify(film, null, 2)} onClick={() => run("Validating & saving program", () => api(url("film"), { method: "PUT", json: JSON.parse(text) }), { success: "Program saved." })}>
            Validate &amp; save
          </button>
          {parseError && <span className="small" style={{ color: "var(--bad)" }}>{parseError}</span>}
        </div>
      </div>
    </details>
  );
}
