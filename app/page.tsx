import Link from "next/link";
import { HomeActions } from "@/components/HomeActions";
import { TopBar } from "@/components/TopBar";
import { listProjects } from "@/lib/server/store";
import { GATES, GATE_LABELS } from "@/lib/studio/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await listProjects();
  return (
    <>
      <TopBar />
      <main className="page stack loose">
        <section className="row wrap" style={{ alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
          <div className="stack tight" style={{ maxWidth: 640 }}>
            <span className="eyebrow">Studio</span>
            <h1 style={{ fontSize: 34 }}>Product films from decisions, not prompts.</h1>
            <p className="muted" style={{ fontSize: 15 }}>
              Brief → real assets → beats &amp; states → a deterministic frame program → contact-sheet review → export. Every decision lives in a file you can
              inspect, change and re-render locally.
            </p>
          </div>
          <HomeActions />
        </section>

        {projects.length === 0 ? (
          <div className="empty">
            <h3>No films yet</h3>
            <p style={{ marginTop: 6 }}>Create a project to start with a Director&apos;s Brief, or import a Studio package to continue from a previous film.</p>
          </div>
        ) : (
          <div className="grid3">
            {projects.map((p) => {
              const approved = GATES.filter((g) => p.approvals[g]);
              return (
                <Link key={p.id} href={`/p/${p.id}`} className="card project-card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3>{p.name}</h3>
                    <span className="badge">r{p.filmRevision}</span>
                  </div>
                  <div className="gate-pills" title={GATES.map((g) => `${GATE_LABELS[g]}: ${p.approvals[g] ? "approved" : "open"}`).join("\n")}>
                    {GATES.slice(0, 5).map((g) => (
                      <span key={g} className={`gate-pill ${p.approvals[g] ? "on" : ""}`} />
                    ))}
                  </div>
                  <span className="small muted">
                    {approved.length ? `Approved: ${approved.map((g) => GATE_LABELS[g]).join(", ")}` : "Nothing approved yet"} · updated {new Date(p.updatedAt).toLocaleString()}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
