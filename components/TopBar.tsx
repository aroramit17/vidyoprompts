import Link from "next/link";
import { authEnabled } from "@/lib/server/auth";
import { getDirector } from "@/lib/ai";
import { CLAUDE_MODEL } from "@/lib/ai/claude";
import { SignOut } from "./SignOut";

export function TopBar({ children }: { children?: React.ReactNode }) {
  const director = getDirector().name;
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="brand-mark" />
        Studio
      </Link>
      {children}
      <span className="spacer" />
      <span className={`badge ${director === "claude" ? "accent" : "warn"}`} title={director === "claude" ? CLAUDE_MODEL : "Set ANTHROPIC_API_KEY to use Claude"}>
        Director: {director === "claude" ? `Claude (${CLAUDE_MODEL})` : "offline (no API key)"}
      </span>
      {authEnabled() && <SignOut />}
    </header>
  );
}
