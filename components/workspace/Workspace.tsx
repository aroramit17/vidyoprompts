"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { firstIncompleteGate } from "@/lib/studio/gates";
import { GATES, GATE_LABELS, type GateId } from "@/lib/studio/types";
import { api, projectApi, type ProjectView } from "../api";
import { StudioContext, type StudioCtx } from "./context";
import { BriefStep } from "./BriefStep";
import { AssetsStep } from "./AssetsStep";
import { BeatsStep } from "./BeatsStep";
import { FilmStep } from "./FilmStep";
import { ReviewStep } from "./ReviewStep";
import { ExportStep } from "./ExportStep";

const SUBTITLES: Record<GateId, string> = {
  brief: "Facts, memory goal, boundaries",
  assets: "Real assets only, style notes",
  beats: "The shot list contract",
  film: "Deterministic frame program",
  review: "Contact-sheet evidence",
  export: "MP4s + studio package",
};

export function Workspace({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState<ProjectView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: "ok" | "bad" | "warn" } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const url = useMemo(() => projectApi(id), [id]);

  const reload = useCallback(async () => {
    try {
      setView(await api<ProjectView>(url()));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [url]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "bad" ? 9000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((message: string, kind: "ok" | "bad" | "warn" = "ok") => setToast({ message, kind }), []);

  const run = useCallback<StudioCtx["run"]>(
    async (label, fn, opts = {}) => {
      setBusy(label);
      try {
        const result = await fn();
        if (opts.reload !== false) await reload();
        if (opts.success) notify(opts.success, "ok");
        return result;
      } catch (e) {
        notify((e as Error).message, "bad");
        await reload();
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [reload, notify],
  );

  const step = (params.get("step") as GateId | null) ?? (view ? firstIncompleteGate(view.gates) : "brief");
  const goto = useCallback((s: GateId) => router.push(`/p/${id}?step=${s}`, { scroll: true }), [router, id]);

  if (loadError) return <main className="page"><div className="notice bad">{loadError}</div></main>;
  if (!view) return <main className="page muted">Loading project…</main>;

  const ctx: StudioCtx = { id, view, url, run, busy, reload, goto, notify };
  const Step = { brief: BriefStep, assets: AssetsStep, beats: BeatsStep, film: FilmStep, review: ReviewStep, export: ExportStep }[step] ?? BriefStep;

  return (
    <StudioContext.Provider value={ctx}>
      <div className="workspace">
        <aside className="sidebar">
          <span className="eyebrow" style={{ paddingLeft: 10 }}>Production gates</span>
          <nav className="steps">
            {GATES.map((g, i) => {
              const info = view.gates[g];
              return (
                <button key={g} className={`step ${info.status} ${step === g ? "active" : ""}`} onClick={() => goto(g)} title={info.blockers.join("\n")}>
                  <span className="step-dot">{info.status === "approved" ? "✓" : info.status === "locked" ? "🔒" : i + 1}</span>
                  <span>
                    <div className="step-title">{GATE_LABELS[g]}</div>
                    <div className="step-sub">{info.status === "locked" ? "Locked" : SUBTITLES[g]}</div>
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="divider" />
          <div className="stack tight small" style={{ padding: "0 10px" }}>
            <span className="muted">Program revision</span>
            <strong>r{view.meta.filmRevision}</strong>
            <span className="muted" style={{ marginTop: 8 }}>Project files</span>
            <code style={{ wordBreak: "break-all" }}>data/projects/{id}/</code>
            <a className="btn sm" href={url("package")} style={{ marginTop: 10, alignSelf: "flex-start" }}>
              Download package
            </a>
          </div>
        </aside>
        <main className="main">
          <Step />
        </main>
      </div>
      {busy && (
        <div className="toast notice" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="spinner" /> {busy}…
        </div>
      )}
      {!busy && toast && (
        <div className={`toast notice ${toast.kind}`} onClick={() => setToast(null)}>
          {toast.message}
        </div>
      )}
    </StudioContext.Provider>
  );
}
