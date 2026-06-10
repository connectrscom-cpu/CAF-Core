/**
 * NEEDS_EDIT → override-only, partial, or full rework (n8n CAF_REWORK_ORCHESTRATOR subset).
 * Full/partial rework keeps the same `task_id`, clears render/output state via `prepareContentJobForFullRerun`,
 * then runs the standard pipeline so `job_drafts` and assets accumulate per task.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { insertEditorialReview } from "../repositories/ops.js";
import { insertJobStateTransition } from "../repositories/transitions.js";
import {
  appendReworkHistory,
  prepareContentJobForFullRerun,
  prepareContentJobForCaptionsOnlyRerun,
  processContentJobById,
  rerenderCarouselAfterEditorialOverride,
  rerenderCarouselSlidesAtIndices,
  RenderNotReadyError,
} from "./job-pipeline.js";
import { isCarouselFlow } from "../decision_engine/flow-kind.js";
import { isOfflinePipelineFlow } from "./offline-flow-types.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import {
  reviewRequestsCarouselTemplateChange,
  setCarouselTemplateExcludeForNextRender,
  stripExplicitCarouselTemplateSelection,
} from "./carousel-render-pack.js";
import {
  applyEditorialFlatOverridesToGeneratedOutput,
  editorialOverrideRequestsCarouselRerender,
  hasEditorialCopyFlatOverrides,
  partitionEditorialOverrides,
} from "./editorial-copy-apply.js";
import { listPlatformConstraints } from "../repositories/project-config.js";
import { resolvePlatformConstraintsForPack } from "./llm-generator-helpers.js";
import {
  hasNonEmptyHeyGenIdOverrides,
  heygenForceRerenderRequested,
  isHeyGenSingleTakeReworkFlow,
  mergeHeyGenRequestIntoGenerationPayload,
} from "./editorial-heygen-overrides.js";
import { runHeygenForContentJob } from "./heygen-renderer.js";

/**
 * Rework modes:
 *  - OVERRIDE_ONLY: patch reviewer edits in place (no LLM, no render); HeyGen single-take may re-call HeyGen.
 *  - PARTIAL_NO_VIDEO: re-run LLM (typically to refresh caption + hashtags grounded in signal pack) but
 *    KEEP the existing rendered video + assets — no HeyGen / Sora credits spent.
 *  - PARTIAL_REWRITE: full LLM re-run + render (same task_id, assets replaced).
 *  - FULL_REWORK: same as PARTIAL_REWRITE today (kept for auditing / future divergence).
 */
export type ReworkMode =
  | "OVERRIDE_ONLY"
  | "PARTIAL_NO_VIDEO"
  | "FULL_REWORK"
  | "PARTIAL_REWRITE"
  | "SLIDE_PARTIAL_RENDER";

/** 1-based carousel slide indices for partial re-render (mimic Flux / carousel renderer). */
export function parseSlideReworkIndices(overrides: Record<string, unknown> | null | undefined): number[] {
  if (!overrides || typeof overrides !== "object") return [];
  const raw = overrides.slide_rework_indices ?? overrides.slide_rework_slides;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => Math.floor(Number(v))).filter((n) => Number.isFinite(n) && n >= 1))].sort(
    (a, b) => a - b
  );
}

export function inferReworkMode(review: {
  rejection_tags?: unknown;
  notes?: string | null;
  overrides_json?: Record<string, unknown> | null;
}): ReworkMode {
  const ov = review.overrides_json ?? {};
  const tags = Array.isArray(review.rejection_tags)
    ? (review.rejection_tags as unknown[]).map((t) => String(t).toLowerCase())
    : [];
  const notes = (review.notes ?? "").toLowerCase();
  /**
   * Explicit routing: `regenerate=false` means "copy-only" — never call LLM/render/provider.
   * We treat this as OVERRIDE_ONLY (patch in place) even if reviewer didn't set `rewrite_copy`.
   */
  if (ov.regenerate === false) {
    return "OVERRIDE_ONLY";
  }
  /**
   * Reviewer asked to keep the existing video (skip HeyGen / Sora render) — wins over every other
   * route. Only makes sense with rewrite_copy !== false (we do re-run the LLM); if reviewer also
   * unchecked rewrite_copy we fall through to OVERRIDE_ONLY which already skips render.
   */
  if (ov.skip_video_regeneration === true && ov.rewrite_copy !== false) {
    return "PARTIAL_NO_VIDEO";
  }
  if (tags.some((t) => t.includes("full") || t.includes("regenerate"))) return "FULL_REWORK";
  if (notes.includes("full rewrite") || notes.includes("start over")) return "FULL_REWORK";
  if (tags.length >= 3) return "FULL_REWORK";
  const rewriteCopy = ov.rewrite_copy;
  if (rewriteCopy === false && (hasEditorialCopyFlatOverrides(ov) || hasNonEmptyHeyGenIdOverrides(ov))) {
    return "OVERRIDE_ONLY";
  }
  if (tags.some((t) => t.includes("override") || t.includes("typo")) || notes.includes("override only")) {
    return "OVERRIDE_ONLY";
  }
  return "PARTIAL_REWRITE";
}

/** True if editorial `overrides_json` has at least one non-empty field worth merging into `generated_output`. */
export function hasMeaningfulOverrides(overrides: Record<string, unknown> | null | undefined): boolean {
  if (overrides == null || typeof overrides !== "object") return false;
  return Object.keys(overrides).some((k) => {
    if (k === "rewrite_copy") return false;
    const v = (overrides as Record<string, unknown>)[k];
    if (v == null) return false;
    if (typeof v === "string") return v.trim() !== "";
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v as object).length > 0;
    return true;
  });
}

export interface ReworkResult {
  ok: boolean;
  mode: ReworkMode;
  /** Canonical job key; same as input for FULL/PARTIAL in-place rework. */
  task_id?: string;
  error?: string;
}

/**
 * Latest `editorial_reviews` row wins for queue tabs. After rework, insert a row with `decision` NULL so the
 * job leaves the NEEDS_EDIT tab while keeping full history; `task_id` never changes.
 */
async function insertReworkSupersedingReview(
  db: Pool,
  projectId: string,
  job: { task_id: string; candidate_id: string | null; run_id: string },
  mode: ReworkMode
): Promise<void> {
  await insertEditorialReview(db, {
    task_id: job.task_id,
    project_id: projectId,
    candidate_id: job.candidate_id,
    run_id: job.run_id,
    review_status: "REWORK_SUPERSEDED",
    decision: null,
    notes: `Prior NEEDS_EDIT cycle closed by ${mode} rework (same task_id). Older reviews and job_drafts remain for audit; this row resets queue routing.`,
    rejection_tags: [],
    overrides_json: {},
    validator: "rework-orchestrator",
    submit: false,
  });
}

/**
 * Uses latest NEEDS_EDIT review on the job. For FULL/PARTIAL resets the same task_id, appends a new
 * `job_drafts` row via the normal LLM path, and runs the full pipeline through render.
 */
export async function executeRework(
  db: Pool,
  config: AppConfig,
  projectId: string,
  taskId: string
): Promise<ReworkResult> {
  const job = await qOne<{
    id: string;
    task_id: string;
    run_id: string;
    candidate_id: string | null;
    variation_name: string | null;
    flow_type: string | null;
    platform: string | null;
    status: string | null;
    generation_payload: Record<string, unknown>;
  }>(
    db,
    `SELECT id, task_id, run_id, candidate_id, variation_name, flow_type, platform, status, generation_payload
     FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
    [projectId, taskId]
  );
  if (!job) return { ok: false, mode: "OVERRIDE_ONLY", error: "job not found" };

  type RevRow = {
    decision: string | null;
    rejection_tags: unknown;
    notes: string | null;
    overrides_json: Record<string, unknown>;
  };

  let rev: RevRow | null = await qOne<RevRow>(
    db,
    `SELECT decision, rejection_tags, notes, overrides_json FROM caf_core.editorial_reviews
     WHERE project_id = $1 AND task_id = $2 AND decision = 'NEEDS_EDIT'
     ORDER BY created_at DESC LIMIT 1`,
    [projectId, taskId]
  );

  /** QC / validation-router can set `content_jobs.status = NEEDS_EDIT` (REWORK_REQUIRED) with no editorial row. */
  if (!rev) {
    if (String(job.status ?? "").trim() !== "NEEDS_EDIT") {
      return { ok: false, mode: "OVERRIDE_ONLY", error: "no NEEDS_EDIT review found" };
    }
    const gp = job.generation_payload ?? {};
    const qc = gp.qc_result;
    let note =
      "System routing: job is NEEDS_EDIT (e.g. QC REWORK_REQUIRED) with no human NEEDS_EDIT review row — running partial rework.";
    if (qc && typeof qc === "object" && qc !== null) {
      const rs = String((qc as Record<string, unknown>).reason_short ?? "").trim();
      if (rs) note = `QC / system NEEDS_EDIT: ${rs}`;
    }
    rev = {
      decision: "NEEDS_EDIT",
      rejection_tags: [],
      notes: note,
      overrides_json: {},
    };
  }

  const slideReworkIndices = parseSlideReworkIndices(rev.overrides_json);
  let mode = inferReworkMode(rev);
  if (
    slideReworkIndices.length > 0 &&
    job.flow_type &&
    isCarouselFlow(job.flow_type) &&
    !isOfflinePipelineFlow(job.flow_type)
  ) {
    mode = "SLIDE_PARTIAL_RENDER";
  } else if (mode === "OVERRIDE_ONLY" && !hasMeaningfulOverrides(rev.overrides_json)) {
    mode = "PARTIAL_REWRITE";
  }
  /** Editorial “change template” requires a full carousel regen; override-only cannot swap `.hbs`. */
  if (
    mode === "OVERRIDE_ONLY" &&
    job.flow_type &&
    isCarouselFlow(job.flow_type) &&
    reviewRequestsCarouselTemplateChange(rev)
  ) {
    mode = "PARTIAL_REWRITE";
  }

  if (mode === "SLIDE_PARTIAL_RENDER") {
    const gp: Record<string, unknown> = { ...(job.generation_payload ?? {}) };
    const overrides = rev.overrides_json ?? {};
    const gen = pickGeneratedOutputOrEmpty(gp);
    const { structural, flat } = partitionEditorialOverrides(overrides);
    const carouselOverride = Boolean(job.flow_type && isCarouselFlow(job.flow_type));
    const platformRows = carouselOverride ? await listPlatformConstraints(db, projectId) : [];
    const platformSlice = carouselOverride
      ? resolvePlatformConstraintsForPack(platformRows, job.platform, job.flow_type)
      : undefined;
    let mergedOutput = applyEditorialFlatOverridesToGeneratedOutput(
      { ...gen, ...structural },
      flat,
      platformSlice
    );
    appendReworkHistory(gp, {
      kind: "before_slide_partial_rework",
      draft_id: gp.draft_id ?? null,
      generated_output: gen,
      qc_result: gp.qc_result ?? null,
      slide_rework_indices: slideReworkIndices,
    });
    gp.generated_output = mergedOutput;
    gp.generation_reason = "REWORK_SLIDE_PARTIAL_RENDER";
    await db.query(
      `UPDATE caf_core.content_jobs SET
        generation_payload = generation_payload || $1::jsonb,
        status = 'RENDERING',
        updated_at = now()
       WHERE id = $2`,
      [
        JSON.stringify({
          generated_output: mergedOutput,
          generation_reason: "REWORK_SLIDE_PARTIAL_RENDER",
          rework_history: gp.rework_history,
          human_feedback: {
            notes: rev.notes,
            rejection_tags: rev.rejection_tags,
            editorial_overrides_json: overrides,
            slide_rework_indices: slideReworkIndices,
          },
        }),
        job.id,
      ]
    );
    try {
      await rerenderCarouselSlidesAtIndices(db, config, job.id, slideReworkIndices);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, mode, error: `Slide partial rework failed: ${msg}`, task_id: job.task_id };
    }
    await db.query(`UPDATE caf_core.content_jobs SET status = 'IN_REVIEW', updated_at = now() WHERE id = $1`, [
      job.id,
    ]);
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: projectId,
      from_state: "NEEDS_EDIT",
      to_state: "IN_REVIEW",
      triggered_by: "human",
      actor: "rework-orchestrator",
    });
    await insertReworkSupersedingReview(db, projectId, job, mode);
    return { ok: true, mode, task_id: job.task_id };
  }

  if (mode === "OVERRIDE_ONLY") {
    const gp: Record<string, unknown> = { ...(job.generation_payload ?? {}) };
    const gen = pickGeneratedOutputOrEmpty(gp);
    const overrides = rev.overrides_json ?? {};
    mergeHeyGenRequestIntoGenerationPayload(gp, overrides);
    const { structural, flat } = partitionEditorialOverrides(overrides);
    let mergedOutput = { ...gen, ...structural };
    const carouselOverride = Boolean(job.flow_type && isCarouselFlow(job.flow_type));
    const platformRows = carouselOverride ? await listPlatformConstraints(db, projectId) : [];
    const platformSlice = carouselOverride
      ? resolvePlatformConstraintsForPack(platformRows, job.platform, job.flow_type)
      : undefined;
    mergedOutput = applyEditorialFlatOverridesToGeneratedOutput(mergedOutput, flat, platformSlice);
    const scriptBefore = `${String(gen.spoken_script ?? gen.script ?? "").trim()}`;
    const scriptAfter = `${String(mergedOutput.spoken_script ?? mergedOutput.script ?? "").trim()}`;
    const spokenScriptChanged = scriptBefore !== scriptAfter;
    let genSnapshot: unknown = gen;
    try {
      genSnapshot = JSON.parse(JSON.stringify(gen)) as unknown;
    } catch {
      /* non-JSON-serializable generated_output: keep shallow ref in history */
    }
    appendReworkHistory(gp, {
      kind: "before_override_rework",
      draft_id: gp.draft_id ?? null,
      generated_output: genSnapshot,
      qc_result: gp.qc_result ?? null,
    });
    gp.generated_output = mergedOutput;
    gp.generation_reason = "REWORK_OVERRIDE_ONLY";
    /**
     * Keep `NEEDS_EDIT` until override + optional HeyGen finish. If we promoted to `IN_REVIEW` before HeyGen and
     * HeyGen failed, we returned early without `insertReworkSupersedingReview` — leaving `IN_REVIEW` + latest
     * `NEEDS_EDIT` (queue tabs disagree).
     */
    await db.query(
      `UPDATE caf_core.content_jobs SET
        generation_payload = generation_payload || $1::jsonb,
        status = 'NEEDS_EDIT',
        updated_at = now()
       WHERE id = $2`,
      [
        JSON.stringify({
          generated_output: mergedOutput,
          generation_reason: "REWORK_OVERRIDE_ONLY",
          rework_history: gp.rework_history,
          heygen_request: gp.heygen_request,
        }),
        job.id,
      ]
    );
    const runHeyGenAfterOverride =
      isHeyGenSingleTakeReworkFlow(job.flow_type) &&
      (heygenForceRerenderRequested(overrides) ||
        hasNonEmptyHeyGenIdOverrides(overrides) ||
        spokenScriptChanged);
    if (runHeyGenAfterOverride) {
      try {
        await runHeygenForContentJob(db, config, {
          id: job.id,
          task_id: job.task_id,
          project_id: projectId,
          run_id: job.run_id,
          flow_type: job.flow_type ?? "",
          platform: job.platform,
          generation_payload: gp,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, mode, error: `HeyGen re-render after override failed: ${msg}`, task_id: job.task_id };
      }
    }

    /**
     * Carousel slide PNGs must reflect typography/font_scale from overrides. Independent of `rewrite_copy`
     * (LLM) and of `regenerate` (general asset billing flag): a reviewer who sets px or scale is asking for
     * updated slide images; skipping rerender left stale thumbnails (OVERRIDE_ONLY alone patches JSON only).
     */
    const runCarouselRerenderAfterTypography =
      Boolean(job.flow_type && isCarouselFlow(job.flow_type)) &&
      editorialOverrideRequestsCarouselRerender(overrides);

    if (runCarouselRerenderAfterTypography) {
      try {
        await rerenderCarouselAfterEditorialOverride(db, config, job.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, mode, error: `Carousel re-render after override failed: ${msg}`, task_id: job.task_id };
      }
    } else {
      await db.query(`UPDATE caf_core.content_jobs SET status = 'IN_REVIEW', updated_at = now() WHERE id = $1`, [
        job.id,
      ]);
    }
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: projectId,
      from_state: "NEEDS_EDIT",
      to_state: "IN_REVIEW",
      triggered_by: "human",
      actor: "rework-orchestrator",
    });
    await insertReworkSupersedingReview(db, projectId, job, mode);
    return { ok: true, mode, task_id: job.task_id };
  }

  if (
    job.flow_type &&
    isCarouselFlow(job.flow_type) &&
    reviewRequestsCarouselTemplateChange(rev)
  ) {
    const gpStrip: Record<string, unknown> = { ...(job.generation_payload ?? {}) };
    const prev = stripExplicitCarouselTemplateSelection(gpStrip);
    setCarouselTemplateExcludeForNextRender(gpStrip, prev);
    await db.query(
      `UPDATE caf_core.content_jobs SET generation_payload = $1::jsonb, updated_at = now() WHERE id = $2`,
      [JSON.stringify(gpStrip), job.id]
    );
  }

  const prep = mode === "PARTIAL_NO_VIDEO"
    ? await prepareContentJobForCaptionsOnlyRerun(db, projectId, taskId)
    : await prepareContentJobForFullRerun(db, projectId, taskId);
  if (!prep.ok) return { ok: false, mode, error: prep.error };

  const snapAfter = await qOne<{ generation_payload: Record<string, unknown> }>(
    db,
    `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
    [job.id]
  );
  const gpForHeygen: Record<string, unknown> = { ...(snapAfter?.generation_payload ?? {}) };
  mergeHeyGenRequestIntoGenerationPayload(gpForHeygen, rev.overrides_json ?? {});

  const generationReason =
    mode === "PARTIAL_NO_VIDEO"
      ? "REWORK_PARTIAL_NO_VIDEO"
      : mode === "PARTIAL_REWRITE"
        ? "REWORK_PARTIAL"
        : "REWORK_FULL";

  await db.query(
    `UPDATE caf_core.content_jobs SET
      rework_parent_task_id = NULL,
      generation_payload = generation_payload || $1::jsonb,
      updated_at = now()
     WHERE id = $2`,
    [
      JSON.stringify({
        rework_mode: mode,
        ...(typeof rev.overrides_json?.carousel_body_char_scale !== "undefined"
          ? { carousel_body_char_scale: rev.overrides_json.carousel_body_char_scale }
          : {}),
        human_feedback: {
          notes: rev.notes,
          rejection_tags: rev.rejection_tags,
          rewrite_copy: rev.overrides_json?.rewrite_copy,
          skip_video_regeneration: rev.overrides_json?.skip_video_regeneration,
          editorial_overrides_json: rev.overrides_json ?? {},
        },
        generation_reason: generationReason,
        /** Pipeline flag: `processJobUpToRender` sees this and short-circuits the video render lane. */
        ...(mode === "PARTIAL_NO_VIDEO" ? { skip_video_render: true } : {}),
        heygen_request: gpForHeygen.heygen_request,
      }),
      job.id,
    ]
  );

  try {
    await processContentJobById(db, config, job.id);
  } catch (err) {
    if (err instanceof RenderNotReadyError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, mode, error: msg, task_id: job.task_id };
  }

  await insertReworkSupersedingReview(db, projectId, job, mode);

  return { ok: true, mode, task_id: job.task_id };
}
