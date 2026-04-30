import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Browsers open API URLs with GET; our routes only support POST — return JSON instead of a blank 405 page. */
export function decisionMethodNotAllowedJson() {
  return NextResponse.json(
    {
      error:
        "Use POST with a JSON body (task_id, decision, optional project_slug, …). Opening this URL in a tab sends GET, which is not supported.",
    },
    { status: 405, headers: { Allow: "POST" } }
  );
}

export async function readJsonObjectBody(
  request: NextRequest
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid or empty JSON body" }, { status: 400 }),
    };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "JSON body must be an object" }, { status: 400 }),
    };
  }
  return { ok: true, body: raw as Record<string, unknown> };
}
