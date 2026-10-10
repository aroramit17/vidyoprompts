import { NextResponse } from "next/server";
import { authEnabled, checkPassword, SESSION_COOKIE, sessionToken } from "@/lib/server/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { password?: string; logout?: boolean };
  if (body.logout) {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }
  if (!authEnabled()) return NextResponse.json({ ok: true });
  if (!checkPassword(String(body.password ?? ""))) return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.STUDIO_INSECURE_COOKIE !== "1",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
