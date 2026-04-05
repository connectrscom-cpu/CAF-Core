import { NextResponse } from "next/server";
import { REVIEW_WRITE_TOKEN } from "@/lib/env";
import { submitDecision } from "@/lib/caf-core-client";

export async function POST(req: Request) {
  if (REVIEW_WRITE_TOKEN) {
    const token = req.headers.get("x-review-token") ?? req.headers.get("authorization")?.replace("Bearer ", "");
    if (token !== REVIEW_WRITE_TOKEN) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const body = await req.json();
  const { project_slug, task_id, decision, notes, rejection_tags, validator } = body;

  if (!project_slug || !task_id) {
    return NextResponse.json({ ok: false, error: "project_slug and task_id required" }, { status: 400 });
  }
  if (!decision || !["APPROVED", "NEEDS_EDIT", "REJECTED"].includes(decision)) {
    return NextResponse.json({ ok: false, error: "invalid decision" }, { status: 400 });
  }

  const ok = await submitDecision(project_slug, task_id, {
    decision,
    notes,
    rejection_tags,
    validator,
  });

  if (!ok) {
    return NextResponse.json({ ok: false, error: "Core API call failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
