import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG } from "@/lib/env";
import { submitDecision } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ task_id: string }> }) {
  try {
    const { task_id } = await params;
    const decodedId = decodeURIComponent(task_id);
    const body = await request.json();
    const decision = (body.decision ?? "").trim().toUpperCase();
    if (!["APPROVED", "NEEDS_EDIT", "REJECTED"].includes(decision)) {
      return NextResponse.json({ error: "decision must be APPROVED, NEEDS_EDIT, or REJECTED" }, { status: 400 });
    }
    const ok = await submitDecision(PROJECT_SLUG, decodedId, {
      decision,
      notes: body.notes,
      rejection_tags: body.rejection_tags,
      validator: body.validator,
    });
    if (!ok) return NextResponse.json({ error: "Core API call failed" }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
