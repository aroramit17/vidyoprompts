"use client";

import { useState } from "react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    if (!res.ok) {
      setError("Wrong password.");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  };
  return (
    <main className="page" style={{ maxWidth: 420, paddingTop: 120 }}>
      <form className="card stack" onSubmit={submit}>
        <span className="brand">
          <span className="brand-mark" /> Studio
        </span>
        <label className="field">
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        {error && <div className="notice bad">{error}</div>}
        <button className="btn primary" type="submit">
          Sign in
        </button>
      </form>
    </main>
  );
}
