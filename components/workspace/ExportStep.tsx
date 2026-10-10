"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormatId } from "@/lib/engine";
import { latestSheet } from "@/lib/studio/gates";
import type { Job } from "@/lib/studio/types";
import { api } from "../api";
import { useStudio } from "./context";
import { GateBar } from "./GateBar";

export function ExportStep() {
  const { view, url, run, busy, reload, notify } = useStudio();
  const router = useRouter();
  const locked = view.gates.export.status === "locked";
  const [jobs, setJobs] = useState<Record<string, Job>>({});

  // Poll running jobs.
  useEffect(() => {
    const running = Object.values(jobs).filter((j) => j.status === "running");
    if (running.length === 0) return;
    const t = setInterval(async () => {
      for (const j of running) {
        const next = await api<Job>(url(`jobs/${j.id}`)).catch(() => null);
        if (!next) continue;
        setJobs((prev) => ({ ...prev, [next.format]: next }));
        if (next.status === "done") {
          notify(`${next.format} export finished.`);
          reload();
        } else if (next.status === "error") notify(next.message, "bad");
      }
    }, 1000);
    return () => clearInterval(t);
  }, [jobs, url, reload, notify]);

  // Pick up jobs started before a reload.
  useEffect(() => {
    api<{ jobs: Job[] }>(url("jobs"))
      .then(({ jobs: list }) => {
        const running = list.filter((j) => j.kind === "export" && j.status === "running");
        if (running.length) setJobs(Object.fromEntries(running.map((j) => [j.format, j])));
      })
      .catch(() => undefined);
  }, [url]);

  const start = async (format: FormatId) => {
    const job = await run(`Starting ${format} export`, () => api<Job>(url("export"), { method: "POST", json: { format } }), { reload: false });
    if (job) setJobs((prev) => ({ ...prev, [format]: job }));
  };

  const vSheet = latestSheet(view, "9:16");
  const vReady = vSheet && vSheet.filmRevision === view.meta.filmRevision;

  return (
    <div className="stack loose">
      <div className="section-head">
        <div>
          <span className="eyebrow">Gate 6</span>
          <h2>Export &amp; package</h2>
          <p>MP4s render from the same deterministic program you reviewed. The 9:16 cut reuses the assets, timeline and states with vertical layout rules (larger type, fewer simultaneous elements). The package is the base for your next film.</p>
        </div>
      </div>
      {locked && <div className="notice warn">Approve the contact sheet of the current program first. {view.gates.review.blockers[0]}</div>}

      <div className="grid2">
        {(["16:9", "9:16"] as const).map((format) => {
          const done = view.exports.find((e) => e.format === format);
          const job = jobs[format];
          const upToDate = done && done.filmRevision === view.meta.filmRevision;
          return (
            <div key={format} className="card stack">
              <div className="row">
                <h3 style={{ flex: 1 }}>{format === "16:9" ? "16:9 master (1920×1080)" : "9:16 vertical (1080×1920)"}</h3>
                {done && <span className={`badge ${upToDate ? "ok" : "warn"}`}>r{done.filmRevision}</span>}
              </div>
              {format === "9:16" && !vReady && <div className="notice warn small">Render and look at the 9:16 contact sheet of this revision on the review step first.</div>}
              {job?.status === "running" ? (
                <div className="stack tight">
                  <div className="progress">
                    <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
                  </div>
                  <span className="small muted">{job.message}</span>
                </div>
              ) : (
                <button className="btn primary" disabled={locked || !!busy || (format === "9:16" && !vReady)} onClick={() => start(format)}>
                  {done ? "Re-export" : "Export"} MP4
                </button>
              )}
              {done && (
                <>
                  <video src={url(`exports/${done.file}`)} controls style={{ width: "100%", maxHeight: format === "9:16" ? 520 : undefined, background: "#000", borderRadius: 8 }} />
                  <div className="row small">
                    <a className="btn sm" href={url(`exports/${done.file}`)} download>
                      Download
                    </a>
                    <span className="muted">
                      {(done.bytes / 1024 / 1024).toFixed(1)} MB · {done.frames} frames · {new Date(done.createdAt).toLocaleString()}
                    </span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="card stack">
        <h3>Studio package</h3>
        <p className="small muted">
          Production brief, style notes, shot list, confirmed assets, film program and every revision, contact sheets, exports and the renderer source, as one zip. Import it on the home page to start the next film from this base.
        </p>
        <div className="row">
          <a className="btn primary" href={url("package")}>
            Download package (.zip)
          </a>
          <button
            className="btn"
            disabled={!!busy}
            onClick={async () => {
              const r = await run("Creating next project", () => api<{ project: { id: string } }>(url("fork"), { method: "POST", json: {} }), { reload: false });
              if (r) router.push(`/p/${r.project.id}`);
            }}
          >
            Start next film from this project
          </button>
        </div>
      </div>
      <GateBar gate="export" />
    </div>
  );
}
