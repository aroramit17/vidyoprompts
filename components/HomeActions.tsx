"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

export function HomeActions() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    setBusy("create");
    setError(null);
    try {
      const { project } = await api<{ project: { id: string } }>("/api/projects", { method: "POST", json: { name: name || "Untitled film" } });
      router.push(`/p/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const importPkg = async (file: File) => {
    setBusy("import");
    setError(null);
    try {
      const form = new FormData();
      form.set("package", file);
      const { project } = await api<{ project: { id: string } }>("/api/projects", { method: "POST", body: form });
      router.push(`/p/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="card stack" style={{ minWidth: 340 }}>
      <label className="field">
        New film
        <input type="text" placeholder="e.g. Ledgerly — runway launch" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
      </label>
      <div className="row">
        <button className="btn primary" onClick={create} disabled={!!busy}>
          {busy === "create" ? <span className="spinner" /> : null} Create project
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>
          {busy === "import" ? <span className="spinner" /> : null} Start from a package
        </button>
        <input ref={fileRef} type="file" accept=".zip" hidden onChange={(e) => e.target.files?.[0] && importPkg(e.target.files[0])} />
      </div>
      {error && <div className="notice bad">{error}</div>}
    </div>
  );
}
