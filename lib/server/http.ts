import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./store";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
  if (e instanceof ZodError) {
    return NextResponse.json({ error: e.issues.slice(0, 8).map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
  }
  const err = e as Error & { status?: number };
  console.error(err);
  // Anthropic SDK errors carry an HTTP status; surface them clearly.
  if (typeof err.status === "number") return NextResponse.json({ error: `AI request failed (${err.status}): ${err.message}` }, { status: 502 });
  return NextResponse.json({ error: err.message || "Unexpected error" }, { status: 500 });
}

export async function handle(fn: () => Promise<Response | unknown>): Promise<Response> {
  try {
    const result = await fn();
    return result instanceof Response ? result : json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
