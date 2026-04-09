import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { submitDecision } from "@/lib/caf-core-client";
import { decodeTaskIdParam } from "@/lib/task-id";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ task_id: string }> }) {
  try {
    const { task_id } = await params;
    const decodedId = decodeTaskIdParam(task_id);
    const body = await request.json() as { project_slug?: string; decision?: string; notes?: string; rejection_tags?: string[]; validator?: string };
    const decision = (body.decision ?? "").trim().toUpperCase();
    if (!["APPROVED", "NEEDS_EDIT", "REJECTED"].includes(decision)) {
      return NextResponse.json({ error: "decision must be APPROVED, NEEDS_EDIT, or REJECTED" }, { status: 400 });
    }
    const slug =
      (typeof body.project_slug === "string" && body.project_slug.trim()) ||
      (!reviewUsesAllProjects() ? PROJECT_SLUG : "") ||
      reviewQueueFallbackSlug();
    const ok = await submitDecision(slug, decodedId, {
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
