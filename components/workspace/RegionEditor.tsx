"use client";

import { useRef, useState } from "react";
import type { Region } from "@/lib/studio/types";

/** Drag on the screenshot to mark regions the film may zoom into. */
export function RegionEditor({ src, regions, onChange }: { src: string; regions: Region[]; onChange: (r: Region[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };

  const box = draft && {
    x: Math.min(draft.x0, draft.x1),
    y: Math.min(draft.y0, draft.y1),
    w: Math.abs(draft.x1 - draft.x0),
    h: Math.abs(draft.y1 - draft.y0),
  };

  return (
    <div className="stack tight">
      <div
        ref={ref}
        className="region-editor"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          const p = pos(e);
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => draft && setDraft({ ...draft, x1: pos(e).x, y1: pos(e).y })}
        onPointerUp={() => {
          if (box && box.w > 0.02 && box.h > 0.02) onChange([...regions, { label: `Focus ${regions.length + 1}`, ...box }]);
          setDraft(null);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" draggable={false} />
        {regions.map((r, i) => (
          <div key={i} className="region-box" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}>
            <span>{r.label}</span>
          </div>
        ))}
        {box && <div className="region-box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />}
      </div>
      {regions.map((r, i) => (
        <div key={i} className="row">
          <input type="text" value={r.label} onChange={(e) => onChange(regions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <span className="small muted mono" style={{ whiteSpace: "nowrap" }}>
            {r.x.toFixed(2)},{r.y.toFixed(2)} {r.w.toFixed(2)}×{r.h.toFixed(2)}
          </span>
          <button className="icon-btn" onClick={() => onChange(regions.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <p className="small muted">Drag on the image to add a zoom region. The first region is the default focus.</p>
    </div>
  );
}
