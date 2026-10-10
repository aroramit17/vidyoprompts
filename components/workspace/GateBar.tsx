"use client";

import type { GateId } from "@/lib/studio/types";
import { api } from "../api";
import { useStudio } from "./context";

/** The hard stop at the bottom of every step: what blocks approval, and the approve button. */
export function GateBar({ gate, approveLabel, next, children }: { gate: GateId; approveLabel?: string; next?: GateId; children?: React.ReactNode }) {
  const { view, run, busy, url, goto } = useStudio();
  const info = view.gates[gate];
  const approvable = gate === "brief" || gate === "assets" || gate === "beats" || gate === "review";
  return (
    <div className="gatebar">
      <div style={{ flex: 1, minWidth: 0 }}>
        {info.status === "approved" ? (
          <span className="badge ok">✓ Approved{view.meta.approvals[gate] ? ` ${new Date(view.meta.approvals[gate]!).toLocaleString()}` : ""}</span>
        ) : info.blockers.length ? (
          <div className="small" style={{ color: "var(--warn)" }}>
            <strong>Hard stop:</strong> {info.blockers.slice(0, 3).join(" · ")}
            {info.blockers.length > 3 ? ` · +${info.blockers.length - 3} more` : ""}
          </div>
        ) : (
          <span className="small muted">{approvable ? "Ready for approval." : "Unlocked."}</span>
        )}
      </div>
      {children}
      {approvable && info.status === "approved" && (
        <button className="btn ghost" disabled={!!busy} onClick={() => run("Reopening", () => api(url(`reopen/${gate}`), { method: "POST" }))}>
          Reopen
        </button>
      )}
      {approvable && info.status !== "approved" && (
        <button
          className="btn approve"
          disabled={!!busy || info.status === "locked" || info.blockers.length > 0}
          onClick={async () => {
            const ok = await run("Approving", () => api(url(`approve/${gate}`), { method: "POST" }), { success: "Approved." });
            if (ok && next) goto(next);
          }}
        >
          {approveLabel ?? "Approve"}
        </button>
      )}
      {info.status === "approved" && next && (
        <button className="btn primary" onClick={() => goto(next)}>
          Continue →
        </button>
      )}
    </div>
  );
}

export function Busy({ label }: { label: string }) {
  const { busy } = useStudio();
  return busy === label ? <span className="spinner" /> : null;
}
