"use client";

import { useEffect, useRef, useState } from "react";
import { missingMustUse } from "@/lib/studio/gates";
import { ASSET_KINDS, type Asset, type StyleGuide } from "@/lib/studio/types";
import { api } from "../api";
import { useStudio } from "./context";
import { LinesField, TextField } from "./fields";
import { GateBar } from "./GateBar";
import { RegionEditor } from "./RegionEditor";

export function AssetsStep() {
  const { view, url, run, busy } = useStudio();
  const locked = view.gates.assets.status === "locked";
  const brief = view.brief;
  const [kind, setKind] = useState<string>("screen");
  const [mustUseId, setMustUseId] = useState<string>("");
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [siteUrl, setSiteUrl] = useState(brief?.siteUrl ?? "");
  const [suggest, setSuggest] = useState<{ colors: { hex: string }[]; fonts: string[]; title: string } | null>(null);
  const [style, setStyle] = useState<StyleGuide | null>(view.style);
  useEffect(() => setStyle(view.style), [view.style]);
  const styleSaved = JSON.stringify(style) === JSON.stringify(view.style);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const form = new FormData();
    list.forEach((f) => form.append("file", f));
    form.set("kind", kind);
    if (mustUseId) form.set("mustUseId", mustUseId);
    await run(`Uploading ${list.length} file${list.length > 1 ? "s" : ""}`, () => api(url("assets"), { method: "POST", body: form }), { success: "Uploaded. Confirm each asset before it can be used." });
  };
  const patch = (a: Asset, body: Record<string, unknown>, label = "Saving asset") => run(label, () => api(url(`assets/${a.id}`), { method: "PATCH", json: body }));

  const missing = brief ? missingMustUse(brief, view.assets) : [];

  return (
    <div className="stack loose">
      <div className="section-head">
        <div>
          <span className="eyebrow">Gate 2</span>
          <h2>Assets &amp; references</h2>
          <p>Only real, confirmed assets reach the film. Uploads and site screenshots stay pending until a person confirms them. The style guide reads the actual images; nothing hallucinated passes this gate.</p>
        </div>
      </div>
      {locked && <div className="notice warn">Approve the brief first. You can still upload assets now.</div>}

      {brief && brief.mustUse.length > 0 && (
        <div className="card stack">
          <h3>Required by the brief</h3>
          <table className="table">
            <tbody>
              {brief.mustUse.map((m) => {
                const linked = view.assets.filter((a) => a.mustUseId === m.id);
                const ok = m.kind === "color" ? brief.brandColors.length > 0 : linked.some((a) => a.confirmed);
                return (
                  <tr key={m.id}>
                    <td style={{ width: 28 }}>{ok ? <span className="badge ok">✓</span> : <span className="badge bad">!</span>}</td>
                    <td>
                      <strong>{m.label}</strong> <span className="muted small">({m.kind})</span>
                      {m.note && <div className="small muted">{m.note}</div>}
                    </td>
                    <td className="small">
                      {m.kind === "color"
                        ? brief.brandColors.map((c) => <span key={c.hex} className="swatch" style={{ background: c.hex, display: "inline-block", marginRight: 4 }} title={`${c.name} ${c.hex}`} />)
                        : linked.length
                          ? linked.map((a) => `${a.label}${a.confirmed ? "" : " (unconfirmed)"}`).join(", ")
                          : <span style={{ color: "var(--bad)" }}>Missing — upload it and link it here</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {missing.length > 0 && <div className="notice bad">Hard stop: {missing.join(" · ")}</div>}
        </div>
      )}

      <div className="grid2">
        <div className="card stack">
          <h3>Upload</h3>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              Kind
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {ASSET_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 2 }}>
              Satisfies brief item
              <select value={mustUseId} onChange={(e) => setMustUseId(e.target.value)}>
                <option value="">— none —</option>
                {brief?.mustUse.filter((m) => m.kind !== "color").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className={`dropzone ${over ? "over" : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              upload(e.dataTransfer.files);
            }}
          >
            Drop PNG/JPG screenshots, logos, font files (TTF/OTF/WOFF) or reference clips — or click to choose.
          </div>
          <input ref={fileRef} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,.ttf,.otf,.woff,.woff2,video/*" onChange={(e) => e.target.files && upload(e.target.files)} />
        </div>
        <div className="card stack">
          <h3>Inspect live site</h3>
          <p className="small muted">Captures desktop and mobile screenshots for you to confirm, and suggests colors and fonts from the page CSS.</p>
          <div className="row">
            <input type="url" placeholder="https://yourproduct.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
            <button
              className="btn"
              disabled={!siteUrl || !!busy}
              onClick={async () => {
                const r = await run("Inspecting site", () => api<{ colors: { hex: string }[]; fonts: string[]; title: string }>(url("assets/inspect"), { method: "POST", json: { url: siteUrl } }));
                if (r) setSuggest(r);
              }}
            >
              Inspect
            </button>
          </div>
          {suggest && (
            <div className="stack tight small">
              <span>
                <strong>{suggest.title}</strong> — screenshots added as <em>pending</em> below.
              </span>
              <div className="row wrap">
                {suggest.colors.map((c) => (
                  <button
                    key={c.hex}
                    className="badge"
                    title={style ? "Add to style palette" : "Generate the style guide first to add colors"}
                    disabled={!style}
                    onClick={() => style && setStyle({ ...style, palette: [...style.palette, { name: "From site", hex: c.hex, usage: "Suggested from live site; confirm usage" }] })}
                  >
                    <span className="swatch" style={{ background: c.hex, width: 12, height: 12 }} /> {c.hex}
                  </button>
                ))}
              </div>
              {suggest.fonts.length > 0 && <span className="muted">Fonts on the site: {suggest.fonts.join(", ")}</span>}
            </div>
          )}
        </div>
      </div>

      {view.assets.length === 0 ? (
        <div className="empty">No assets yet. Upload the real logo and product screens.</div>
      ) : (
        <div className="asset-grid">
          {view.assets.map((a) => (
            <AssetCard key={a.id} asset={a} onPatch={patch} />
          ))}
        </div>
      )}

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h3>Style guide &amp; asset notes</h3>
            <p className="small muted">Generated from the approved production document and the confirmed images. Edit anything; the beats and program are built from this.</p>
          </div>
          <div className="row">
            {style && (
              <button className="btn sm" disabled={styleSaved || !!busy} onClick={() => run("Saving style guide", () => api(url("style"), { method: "PUT", json: style }), { success: "Style guide saved." })}>
                {styleSaved ? "Saved" : "Save edits"}
              </button>
            )}
            <button className="btn primary" disabled={locked || !!busy} onClick={() => run("Reading assets & writing the style guide", () => api(url("style/generate"), { method: "POST" }), { success: "Style guide ready." })}>
              {view.style ? "Regenerate" : "Generate style guide"}
            </button>
          </div>
        </div>
        {style && (
          <div className="stack">
            <TextField label="Summary" value={style.summary} onChange={(v) => setStyle({ ...style, summary: v })} multiline />
            <div className="stack tight">
              <span className="eyebrow">Palette</span>
              {style.palette.map((p, i) => (
                <div key={i} className="row">
                  <span className="swatch" style={{ background: p.hex }} />
                  <input type="text" value={p.hex} style={{ width: 100 }} onChange={(e) => setStyle({ ...style, palette: style.palette.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)) })} />
                  <input type="text" value={p.name} style={{ width: 140 }} onChange={(e) => setStyle({ ...style, palette: style.palette.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <input type="text" value={p.usage} onChange={(e) => setStyle({ ...style, palette: style.palette.map((x, j) => (j === i ? { ...x, usage: e.target.value } : x)) })} />
                  <button className="icon-btn" onClick={() => setStyle({ ...style, palette: style.palette.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="grid2">
              <label className="field">
                Display font
                <select value={style.typography.display} onChange={(e) => setStyle({ ...style, typography: { ...style.typography, display: e.target.value } })}>
                  {[...new Set([...view.fonts, style.typography.display])].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Body font
                <select value={style.typography.body} onChange={(e) => setStyle({ ...style, typography: { ...style.typography, body: e.target.value } })}>
                  {[...new Set([...view.fonts, style.typography.body])].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
            </div>
            <LinesField label="Typography rules" value={style.typography.rules} onChange={(v) => setStyle({ ...style, typography: { ...style.typography, rules: v } })} />
            <TextField label="Motion character" value={style.motionCharacter} onChange={(v) => setStyle({ ...style, motionCharacter: v })} multiline />
            <div className="grid2">
              <LinesField label="Composition" value={style.composition} onChange={(v) => setStyle({ ...style, composition: v })} rows={4} />
              <LinesField label="Do not" value={style.doNot} onChange={(v) => setStyle({ ...style, doNot: v })} rows={4} />
            </div>
          </div>
        )}
      </div>

      <GateBar gate="assets" approveLabel="Approve assets & style" next="beats" />
    </div>
  );
}

function AssetCard({ asset: a, onPatch }: { asset: Asset; onPatch: (a: Asset, body: Record<string, unknown>, label?: string) => Promise<unknown> }) {
  const { view, url, run, busy } = useStudio();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(a.label);
  const [regions, setRegions] = useState(a.regions);
  const [description, setDescription] = useState(a.description);
  useEffect(() => {
    setLabel(a.label);
    setRegions(a.regions);
    setDescription(a.description);
  }, [a]);
  const isImage = a.mime.startsWith("image/");
  const src = url(`assets/${a.id}/file`);

  return (
    <div className={`asset ${a.confirmed ? "" : "pending"}`}>
      <div className="asset-thumb">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={a.label} />
        ) : a.mime.startsWith("video/") ? (
          <video src={src} muted controls style={{ maxWidth: "100%", maxHeight: "100%" }} />
        ) : (
          <span style={{ fontFamily: a.fontFamily, fontSize: 28 }}>Aa {a.fontFamily}</span>
        )}
        {a.regions.map((r, i) => (
          <div key={i} className="region-box" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, pointerEvents: "none" }} />
        ))}
      </div>
      <div className="asset-body">
        <div className="row">
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== a.label && onPatch(a, { label })} />
        </div>
        <div className="row">
          <select value={a.kind} onChange={(e) => onPatch(a, { kind: e.target.value })}>
            {ASSET_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <select value={a.mustUseId ?? ""} onChange={(e) => onPatch(a, { mustUseId: e.target.value || null })}>
            <option value="">no brief link</option>
            {view.brief?.mustUse.filter((m) => m.kind !== "color").map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {a.kind === "font" && (
          <input type="text" placeholder="Font family name" defaultValue={a.fontFamily} onBlur={(e) => e.target.value !== a.fontFamily && onPatch(a, { fontFamily: e.target.value })} />
        )}
        <div className="row small muted">
          {a.width ? `${a.width}×${a.height}` : a.mime} · {a.source === "site" ? "from site" : a.source}
        </div>
        <div className="row">
          {a.confirmed ? (
            <button className="btn sm" onClick={() => onPatch(a, { confirmed: false })} disabled={!!busy}>
              <span className="badge ok">✓ Confirmed</span> Unconfirm
            </button>
          ) : (
            <button className="btn sm approve" onClick={() => onPatch(a, { confirmed: true }, "Confirming")} disabled={!!busy}>
              Confirm real asset
            </button>
          )}
          {isImage && a.kind !== "logo" && (
            <button className="btn sm ghost" onClick={() => setOpen(!open)}>
              Regions ({a.regions.length})
            </button>
          )}
          <span className="spacer" />
          <button className="icon-btn" title="Delete" onClick={() => confirm(`Delete ${a.label}?`) && run("Deleting asset", () => api(url(`assets/${a.id}`), { method: "DELETE" }))}>
            🗑
          </button>
        </div>
        {open && (
          <div className="stack tight">
            <RegionEditor src={src} regions={regions} onChange={setRegions} />
            <TextField label="What this shows" value={description} onChange={setDescription} multiline />
            <button className="btn sm primary" onClick={() => onPatch(a, { regions, description }, "Saving regions")} disabled={!!busy}>
              Save regions
            </button>
          </div>
        )}
        {!open && a.description && <p className="small muted">{a.description}</p>}
      </div>
    </div>
  );
}
