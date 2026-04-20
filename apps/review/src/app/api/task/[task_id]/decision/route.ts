import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { submitDecision } from "@/lib/caf-core-client";
import { decodeTaskIdParam } from "@/lib/task-id";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ task_id: string }> }) {
  try {
    const { task_id } = await params;
    const decodedId = decodeTaskIdParam(task_id);
    const body = await request.json() as {
      project_slug?: string;
      decision?: string;
      notes?: string;
      rejection_tags?: string[];
      validator?: string;
      final_title_override?: string;
      final_hook_override?: string;
      final_caption_override?: string;
      final_hashtags_override?: string;
      final_slides_json_override?: string;
      final_spoken_script_override?: string;
      heygen_avatar_id?: string;
      heygen_voice_id?: string;
      heygen_force_rerender?: boolean;
      rewrite_copy?: boolean;
      skip_video_regeneration?: boolean;
    };
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
      ...(body.final_title_override !== undefined && { final_title_override: body.final_title_override }),
      ...(body.final_hook_override !== undefined && { final_hook_override: body.final_hook_override }),
      ...(body.final_caption_override !== undefined && { final_caption_override: body.final_caption_override }),
      ...(body.final_hashtags_override !== undefined && { final_hashtags_override: body.final_hashtags_override }),
      ...(body.final_slides_json_override !== undefined && {
        final_slides_json_override: body.final_slides_json_override,
      }),
      ...(body.final_spoken_script_override !== undefined && {
        final_spoken_script_override: body.final_spoken_script_override,
      }),
      ...(body.heygen_avatar_id !== undefined && { heygen_avatar_id: body.heygen_avatar_id }),
      ...(body.heygen_voice_id !== undefined && { heygen_voice_id: body.heygen_voice_id }),
      ...(body.heygen_force_rerender !== undefined && { heygen_force_rerender: body.heygen_force_rerender }),
      ...(body.rewrite_copy !== undefined && { rewrite_copy: body.rewrite_copy }),
      ...(body.skip_video_regeneration !== undefined && {
        skip_video_regeneration: body.skip_video_regeneration,
      }),
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
