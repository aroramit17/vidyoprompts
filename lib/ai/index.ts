import { ClaudeDirector } from "./claude";
import type { Director } from "./director";
import { OfflineDirector } from "./offline";

export * from "./director";

/** Claude when credentials are configured, the deterministic offline director otherwise. */
export function getDirector(): Director {
  const forced = process.env.STUDIO_DIRECTOR;
  if (forced === "offline") return new OfflineDirector();
  if (forced === "claude" || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return new ClaudeDirector();
  return new OfflineDirector();
}
