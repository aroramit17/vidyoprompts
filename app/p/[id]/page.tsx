import { TopBar } from "@/components/TopBar";
import { Workspace } from "@/components/workspace/Workspace";
import { getMeta } from "@/lib/server/store";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = await getMeta(id).catch(() => null);
  if (!meta) notFound();
  return (
    <>
      <TopBar>
        <span className="muted">/</span>
        <strong>{meta.name}</strong>
      </TopBar>
      <Suspense fallback={<main className="page muted">Loading project…</main>}>
        <Workspace id={id} />
      </Suspense>
    </>
  );
}
