import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { submitDecision } from "@/lib/caf-core-client";
import { decodeTaskIdParam } from "@/lib/task-id";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      task_id?: string;
      project_slug?: string;
      decision?: string;
      notes?: string;
      rejection_tags?: string[];
      validator?: string;
    };
    const rawTid = (body.task_id ?? "").trim();
    if (!rawTid) return NextResponse.json({ error: "task_id required in body" }, { status: 400 });
    const decodedId = decodeTaskIdParam(rawTid);
    const decision = (body.decision ?? "").trim().toUpperCase();
    if (!["APPROVED", "NEEDS_EDIT", "REJECTED"].includes(decision)) {
      return NextResponse.json({ error: "decision must be APPROVED, NEEDS_EDIT, or REJECTED" }, { status: 400 });
    }
    const slug =
      (typeof body.project_slug === "string" && body.project_slug.trim()) ||
      (!reviewUsesAllProjects() ? PROJECT_SLUG : "") ||
      reviewQueueFallbackSlug();
    const result = await submitDecision(slug, decodedId, {
      decision,
      notes: body.notes,
      rejection_tags: body.rejection_tags,
      validator: body.validator,
    });
    if (!result.ok) {
      const st =
        result.status === 400 || result.status === 404
          ? result.status
          : result.status === 401 || result.status === 403
            ? 401
            : 502;
      return NextResponse.json({ error: result.error || "Core API call failed" }, { status: st });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
