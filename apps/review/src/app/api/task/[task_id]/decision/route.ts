import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { submitDecision } from "@/lib/caf-core-client";
import { decisionMethodNotAllowedJson, readJsonObjectBody } from "@/lib/decision-api";
import { decodeTaskIdParam } from "@/lib/task-id";

export const dynamic = "force-dynamic";

export function GET() {
  return decisionMethodNotAllowedJson();
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ task_id: string }> }) {
  try {
    const { task_id } = await params;
    const decodedId = decodeTaskIdParam(task_id);
    const parsed = await readJsonObjectBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const decision = String(body.decision ?? "").trim().toUpperCase();
    if (!["APPROVED", "NEEDS_EDIT", "REJECTED"].includes(decision)) {
      return NextResponse.json({ error: "decision must be APPROVED, NEEDS_EDIT, or REJECTED" }, { status: 400 });
    }
    const slug =
      (typeof body.project_slug === "string" && body.project_slug.trim()) ||
      (!reviewUsesAllProjects() ? PROJECT_SLUG : "") ||
      reviewQueueFallbackSlug();
    const result = await submitDecision(slug, decodedId, {
      decision,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      rejection_tags: Array.isArray(body.rejection_tags) ? body.rejection_tags.map((t) => String(t)) : undefined,
      validator: typeof body.validator === "string" ? body.validator : undefined,
      ...(body.final_title_override !== undefined && {
        final_title_override: typeof body.final_title_override === "string" ? body.final_title_override : String(body.final_title_override),
      }),
      ...(body.final_hook_override !== undefined && {
        final_hook_override: typeof body.final_hook_override === "string" ? body.final_hook_override : String(body.final_hook_override),
      }),
      ...(body.final_caption_override !== undefined && {
        final_caption_override:
          typeof body.final_caption_override === "string" ? body.final_caption_override : String(body.final_caption_override),
      }),
      ...(body.final_hashtags_override !== undefined && {
        final_hashtags_override:
          typeof body.final_hashtags_override === "string" ? body.final_hashtags_override : String(body.final_hashtags_override),
      }),
      ...(body.final_slides_json_override !== undefined && {
        final_slides_json_override:
          typeof body.final_slides_json_override === "string"
            ? body.final_slides_json_override
            : String(body.final_slides_json_override),
      }),
      ...(body.final_spoken_script_override !== undefined && {
        final_spoken_script_override:
          typeof body.final_spoken_script_override === "string"
            ? body.final_spoken_script_override
            : String(body.final_spoken_script_override),
      }),
      ...(body.heygen_avatar_id !== undefined && {
        heygen_avatar_id: typeof body.heygen_avatar_id === "string" ? body.heygen_avatar_id : String(body.heygen_avatar_id),
      }),
      ...(body.heygen_voice_id !== undefined && {
        heygen_voice_id: typeof body.heygen_voice_id === "string" ? body.heygen_voice_id : String(body.heygen_voice_id),
      }),
      ...(typeof body.heygen_force_rerender === "boolean" && { heygen_force_rerender: body.heygen_force_rerender }),
      ...(typeof body.rewrite_copy === "boolean" && { rewrite_copy: body.rewrite_copy }),
      ...(typeof body.skip_video_regeneration === "boolean" && {
        skip_video_regeneration: body.skip_video_regeneration,
      }),
      ...(typeof body.skip_image_regeneration === "boolean" && {
        skip_image_regeneration: body.skip_image_regeneration,
      }),
      ...(typeof body.regenerate === "boolean" && { regenerate: body.regenerate }),
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
    console.error("[api/task/.../decision]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
