import { NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import {
  getJobDetail,
  getJobDetailAll,
  getQueueTab,
  getQueueTabAll,
  type ReviewJobDetail,
  type ReviewTab,
} from "@/lib/caf-core-client";
import { jobGeneratedSlidesJson } from "@/lib/job-generated-slides";
import { previewFieldsFromJob } from "@/lib/job-preview-fields";
import { isVideoUrl } from "@/lib/media-url";

function stringVal(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function optionalTrimmedString(v: unknown): string | undefined {
  const s = stringVal(v).trim();
  return s || undefined;
}

function recordVal(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function arrayVal(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function pickFromNestedCaptionObjects(root: Record<string, unknown> | null): string {
  if (!root) return "";
  const direct = stringVal(root.caption) || stringVal(root.post_caption) || stringVal(root.description);
  if (direct.trim()) return direct.trim();

  // Common nesting patterns across flows
  for (const k of ["content", "publish", "publication", "post", "video", "result", "output", "data"]) {
    const nest = recordVal(root[k]);
    if (!nest) continue;
    const v = stringVal(nest.caption) || stringVal(nest.post_caption) || stringVal(nest.description);
    if (v.trim()) return v.trim();
  }
  return "";
}

/**
 * Carousel caption can live in multiple legacy/new shapes.
 * Prefer explicit "caption" / "generated_caption", then fall back to
 * CAF Core generator outputs (e.g. `generated_output.carousel.caption`).
 */
export function pickCaptionFromGenerationPayload(payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? undefined;
  const direct =
    stringVal(p?.caption) ||
    stringVal(p?.generated_caption) ||
    stringVal(p?.post_caption) ||
    stringVal(p?.final_caption) ||
    stringVal(p?.final_caption_override);
  if (direct.trim()) return direct.trim();

  const generatedOutput = recordVal(p?.generated_output);
  const goDirect = pickFromNestedCaptionObjects(generatedOutput) || stringVal(generatedOutput?.generated_caption);
  if (goDirect.trim()) return goDirect.trim();

  const carousel = recordVal(generatedOutput?.carousel);
  const carouselCaption = pickFromNestedCaptionObjects(carousel);
  if (carouselCaption.trim()) return carouselCaption.trim();

  const variations = arrayVal(generatedOutput?.variations);
  const firstVar = variations?.[0] ? recordVal(variations[0]) : null;
  const varCaption = pickFromNestedCaptionObjects(firstVar);
  if (varCaption.trim()) return varCaption.trim();

  return "";
}

export interface TaskDetailResponseOptions {
  /** Include full `job` (generation_payload, assets) for Publish / tooling. */
  includeJob?: boolean;
}

/** Long n8n-style task ids break some hosts when used as a single path segment; prefer ?task_id= for API too. */
export async function jsonTaskDetailResponse(
  decodedId: string,
  projectQs: string | undefined,
  opts?: TaskDetailResponseOptions
): Promise<NextResponse> {
  try {
    const job = reviewUsesAllProjects()
      ? await getJobDetailAll(decodedId, projectQs)
      : await getJobDetail(PROJECT_SLUG, decodedId);
    if (!job) {
      const row = await lookupQueueRowByTaskId(decodedId, projectQs);
      if (!row) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      return NextResponse.json({ rowIndex: 0, data: row });
    }
    const { preview_url, video_url } = previewFieldsFromJob(job);
    const generationPayload = (job.generation_payload ?? {}) as Record<string, unknown>;
    const latestOv = recordVal(job.latest_overrides_json as Record<string, unknown> | null) ?? {};
    const data: Record<string, string | undefined> = {
      task_id: job.task_id,
      project: (job.project_slug ?? PROJECT_SLUG ?? reviewQueueFallbackSlug()).trim(),
      run_id: job.run_id,
      platform: job.platform ?? "",
      flow_type: job.flow_type ?? "",
      preview_url,
      video_url,
      review_status: job.status ?? "",
      decision: job.latest_decision ?? "",
      notes: job.latest_notes ?? "",
      recommended_route: job.recommended_route ?? "",
      qc_status: job.qc_status ?? "",
      risk_score: job.pre_gen_score ?? "",
      generated_title: (job.generation_payload?.title ?? job.generation_payload?.generated_title ?? "") as string,
      generated_hook: (job.generation_payload?.hook ?? job.generation_payload?.generated_hook ?? "") as string,
      generated_caption: pickCaptionFromGenerationPayload(generationPayload),
      generated_slides_json: jobGeneratedSlidesJson(job),
      validator: job.latest_validator ?? "",
      final_title_override: optionalTrimmedString(latestOv.final_title_override),
      final_hook_override: optionalTrimmedString(latestOv.final_hook_override),
      final_caption_override: optionalTrimmedString(latestOv.final_caption_override),
      final_hashtags_override: optionalTrimmedString(latestOv.final_hashtags_override),
      final_slides_json_override: optionalTrimmedString(latestOv.final_slides_json_override),
      rewrite_copy: latestOv.rewrite_copy === false ? "false" : "true",
    };
    const body: Record<string, unknown> = { rowIndex: 0, data };
    if (opts?.includeJob) body.job = job;
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function jsonTaskAssetsResponse(
  decodedId: string,
  projectQs: string | undefined
): Promise<NextResponse> {
  try {
    const job = reviewUsesAllProjects()
      ? await getJobDetailAll(decodedId, projectQs)
      : await getJobDetail(PROJECT_SLUG, decodedId);
    if (!job) return NextResponse.json({ assets: [] });
    return NextResponse.json({ assets: job.assets ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

/** Lighter payload for approved / content-only view. */
export async function jsonContentDetailResponse(
  decodedId: string,
  projectQs: string | undefined
): Promise<NextResponse> {
  try {
    const job = reviewUsesAllProjects()
      ? await getJobDetailAll(decodedId, projectQs)
      : await getJobDetail(PROJECT_SLUG, decodedId);
    if (!job) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    const { preview_url, video_url } = previewFieldsFromJob(job);
    const generationPayload = (job.generation_payload ?? {}) as Record<string, unknown>;
    const data: Record<string, string | undefined> = {
      task_id: job.task_id,
      project: (job.project_slug ?? PROJECT_SLUG ?? reviewQueueFallbackSlug()).trim(),
      run_id: job.run_id,
      platform: job.platform ?? "",
      flow_type: job.flow_type ?? "",
      preview_url,
      video_url,
      review_status: job.status ?? "",
      decision: job.latest_decision ?? "",
      generated_title: (job.generation_payload?.title ?? job.generation_payload?.generated_title ?? "") as string,
      generated_hook: (job.generation_payload?.hook ?? job.generation_payload?.generated_hook ?? "") as string,
      generated_caption: pickCaptionFromGenerationPayload(generationPayload),
      generated_slides_json: jobGeneratedSlidesJson(job),
    };
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

function generationVal(payload: Record<string, unknown> | null | undefined, key: string): string {
  const v = payload?.[key];
  return typeof v === "string" ? v : "";
}

async function lookupQueueRowByTaskId(
  taskId: string,
  projectSlug?: string
): Promise<Record<string, string | undefined> | null> {
  const tid = taskId.trim();
  if (!tid) return null;

  const tabs: ReviewTab[] = ["in_review", "approved", "rejected", "needs_edit"];
  for (const tab of tabs) {
    const { jobs } = reviewUsesAllProjects()
      ? await getQueueTabAll(tab, {
          search: tid,
          project_slug: projectSlug?.trim() || undefined,
          limit: "50",
          offset: "0",
        })
      : await getQueueTab(PROJECT_SLUG, tab, { search: tid, limit: "50", offset: "0" });

    const match = (jobs ?? []).find((j) => (j.task_id ?? "").trim() === tid) ?? (jobs ?? [])[0];
    if (!match) continue;

    const gen = (match.generation_payload ?? {}) as Record<string, unknown>;
    const project = (match.project_slug ?? PROJECT_SLUG ?? reviewQueueFallbackSlug()).trim();
    const preview_url = (match.preview_thumb_url ?? "").trim();
    const detailLike = {
      ...match,
      review_slides_json: null,
      assets: [],
      reviews: [],
      auto_validation: null,
    } as ReviewJobDetail;

    return {
      task_id: (match.task_id ?? "").trim(),
      project,
      run_id: match.run_id,
      platform: match.platform ?? "",
      flow_type: match.flow_type ?? "",
      preview_url,
      video_url: isVideoUrl(preview_url) ? preview_url : "",
      review_status: match.status ?? "",
      decision: match.latest_decision ?? "",
      notes: match.latest_notes ?? "",
      recommended_route: match.recommended_route ?? "",
      qc_status: match.qc_status ?? "",
      risk_score: match.pre_gen_score ?? "",
      generated_title: generationVal(gen, "title") || generationVal(gen, "generated_title"),
      generated_hook: generationVal(gen, "hook") || generationVal(gen, "generated_hook"),
      generated_caption: pickCaptionFromGenerationPayload(gen),
      generated_slides_json: jobGeneratedSlidesJson(detailLike),
      validator: match.latest_validator ?? "",
    };
  }
  return null;
}
