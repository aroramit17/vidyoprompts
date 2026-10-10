"use client";

export function SignOut() {
  return (
    <button
      className="btn ghost sm"
      onClick={async () => {
        await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ logout: true }) });
        window.location.href = "/login";
      }}
    >
      Sign out
    </button>
  );
}
