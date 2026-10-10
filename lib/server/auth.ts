/**
 * Minimal single-team auth: set STUDIO_PASSWORD to require a password. The session cookie
 * holds an HMAC of a fixed message keyed by the password, so changing the password logs
 * everyone out. Without STUDIO_PASSWORD the studio is open (local, single-user use).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "studio_session";

export function authEnabled(): boolean {
  return !!process.env.STUDIO_PASSWORD;
}

export function sessionToken(): string {
  return createHmac("sha256", process.env.STUDIO_PASSWORD ?? "").update("studio-session-v1").digest("hex");
}

export function checkPassword(password: string): boolean {
  const expected = Buffer.from(process.env.STUDIO_PASSWORD ?? "");
  const given = Buffer.from(password);
  return expected.length > 0 && expected.length === given.length && timingSafeEqual(expected, given);
}

export function validSession(token: string | undefined): boolean {
  if (!authEnabled()) return true;
  if (!token) return false;
  const expected = Buffer.from(sessionToken());
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
