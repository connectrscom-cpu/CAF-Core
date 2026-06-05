/**
 * Run-level post-generation carousel analysis (Document AI text + Nemotron visual).
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { isCarouselFlow } from "../decision_engine/flow-kind.js";
import { CAROUSEL_RUN_OUTPUT_ANALYSIS_SCHEMA, type RunCarouselOutputAnalysisV1 } from "../domain/carousel-slide-analysis.js";
import { pickMimicPayload } from "../domain/mimic-payload.js";
import { q } from "../db/queries.js";
import { listAssetsByTask } from "../repositories/assets.js";
import { patchRun } from "../repositories/runs.js";
import { getInputsProcessingProfile } from "../repositories/inputs-processing-profile.js";
import { documentAiEnabled } from "./document-ai-auth.js";
import { processCarouselSlideUrlWithDocumentAi } from "./document-ai-enterprise-ocr.js";
import { buildCarouselOutputIntended } from "./carousel-output-intended.js";
import { compareCarouselOutputText } from "./carousel-output-text-qa.js";
import { runCarouselOutputNemotronVisualReview } from "./carousel-output-nemotron-visual.js";
import { resolveProcessingVisionCall } from "./processing-vision-client.js";
import { createSignedUrlForObjectKey } from "./supabase-storage.js";

const ANALYZABLE_STATUSES = new Set(["IN_REVIEW", "APPROVED"]);

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function isRenderableCarouselAsset(assetType: string | null, publicUrl: string | null): boolean {
  if (!publicUrl?.trim()) return false;
  const t = (assetType ?? "").toUpperCase();
  if (t.includes("CAROUSEL") || t.includes("SLIDE") || t.includes("STATIC") || t.includes("IMAGE")) {
    return true;
  }
  if (/\.(png|jpe?g|webp)(\?|#|$)/i.test(publicUrl)) return true;
  return false;
}

function referenceUrlForSlide(mimic: ReturnType<typeof pickMimicPayload>, slideIndex: number): string | null {
  if (!mimic) return null;
  const item =
    mimic.reference_items.find((r) => r.index === slideIndex) ??
    mimic.reference_items[slideIndex - 1];
  return item?.vision_fetch_url?.trim() || null;
}

async function resolveAssetPublicUrl(
  config: AppConfig,
  asset: { public_url: string | null; bucket: string | null; object_path: string | null }
): Promise<string | null> {
  const direct = asset.public_url?.trim();
  if (direct) return direct;
  const path = asset.object_path?.trim();
  if (!path) return null;
  const bucket = asset.bucket?.trim() || config.SUPABASE_ASSETS_BUCKET;
  const signed = await createSignedUrlForObjectKey(config, bucket, path, 3600);
  if ("signedUrl" in signed) return signed.signedUrl;
  return null;
}

function carouselModelFromProfile(criteria: Record<string, unknown>): string {
  const ins = criteria.inputs_insights;
  const obj = ins && typeof ins === "object" && !Array.isArray(ins) ? (ins as Record<string, unknown>) : null;
  const m = obj?.carousel_llm_model ?? obj?.top_performer_carousel_model;
  return typeof m === "string" && m.trim() ? m.trim() : "";
}

export async function runCarouselOutputAnalysisForRun(
  db: Pool,
  config: AppConfig,
  projectId: string,
  projectSlug: string,
  runId: string,
  opts?: { statuses?: string[]; persist?: boolean }
): Promise<RunCarouselOutputAnalysisV1> {
  const started = Date.now();
  const statusFilter = (opts?.statuses?.length ? opts.statuses : ["IN_REVIEW", "APPROVED"]).map((s) =>
    s.toUpperCase()
  );

  if (!documentAiEnabled(config)) {
    throw new Error("Document AI Enterprise OCR is not configured (required for carousel output analysis)");
  }

  const visionCall = resolveProcessingVisionCall(config, config.PROCESSING_VISION_NVIDIA_MODEL);
  if (!visionCall.apiKey) {
    throw new Error(
      visionCall.provider === "nvidia"
        ? "NVIDIA_NIM_API_KEY required for Nemotron visual output review"
        : "OPENAI_API_KEY required for visual output review"
    );
  }

  const profile = await getInputsProcessingProfile(db, projectId);
  const criteria = (profile?.criteria_json ?? {}) as Record<string, unknown>;
  const profileModel = carouselModelFromProfile(criteria) || config.PROCESSING_VISION_NVIDIA_MODEL;

  const jobs = await q<{
    id: string;
    task_id: string;
    flow_type: string;
    platform: string | null;
    status: string;
    generation_payload: Record<string, unknown>;
  }>(
    db,
    `SELECT id, task_id, flow_type, platform, status, generation_payload
     FROM caf_core.content_jobs
     WHERE project_id = $1 AND run_id = $2 AND status = ANY($3::text[])
     ORDER BY task_id ASC`,
    [projectId, runId, statusFilter]
  );

  const carouselJobs = jobs.filter((j) => isCarouselFlow(j.flow_type));

  let textPass = 0;
  let textFail = 0;
  let visualWarn = 0;
  let blockingCount = 0;
  let assetsAnalyzed = 0;
  let assetsFailed = 0;

  const jobResults = [];

  for (const job of carouselJobs) {
    const gp = job.generation_payload ?? {};
    const mimic = pickMimicPayload(gp);
    const jobBlocking: string[] = [];
    const jobWarnings: string[] = [];
    const assetResults = [];

    const assets = await listAssetsByTask(db, projectId, job.task_id);
    const imageAssets = assets.filter((a) => isRenderableCarouselAsset(a.asset_type, a.public_url));

    if (imageAssets.length === 0) {
      jobResults.push({
        task_id: job.task_id,
        job_id: job.id,
        flow_type: job.flow_type,
        platform: job.platform,
        status: job.status,
        mimic_mode: mimic?.mode ?? null,
        source_insights_id: mimic?.source_insights_id ?? null,
        intended: null,
        assets: [],
        job_verdict: "skipped" as const,
        job_blocking_issues: ["no_image_assets"],
        job_warnings: [],
        error: null,
      });
      continue;
    }

    for (const asset of imageAssets) {
      const slideIndex = Math.max(1, Number(asset.position) || 1);
      const publicUrl = await resolveAssetPublicUrl(config, asset);
      if (!publicUrl) {
        assetsFailed++;
        assetResults.push({
          asset_id: null,
          asset_type: asset.asset_type,
          slide_index: slideIndex,
          public_url: null,
          reference_asset_url: null,
          document_ai: null,
          document_ai_error: "no_public_url",
          text_qa: null,
          nemotron_visual: null,
          nemotron_error: null,
          asset_verdict: "skipped" as const,
          blocking_issues: [],
          warnings: [],
        });
        continue;
      }

      const intended = buildCarouselOutputIntended(gp, slideIndex);
      const refUrl = referenceUrlForSlide(mimic, slideIndex);

      let document_ai = null;
      let document_ai_error: string | null = null;
      let text_qa = null;
      let nemotron_visual = null;
      let nemotron_error: string | null = null;
      const blocking: string[] = [];
      const warnings: string[] = [];

      try {
        document_ai = await processCarouselSlideUrlWithDocumentAi(config, publicUrl, slideIndex);
        text_qa = compareCarouselOutputText(intended, document_ai);
        if (text_qa.text_check_pass) textPass++;
        else textFail++;
        if (!text_qa.expected_text_present) blocking.push("MISSING_EXPECTED_TEXT");
        if (text_qa.extra_text.length > 0) blocking.push("EXTRA_DETECTED_TEXT");
        if (text_qa.forbidden_text_hits.length > 0) blocking.push("FORBIDDEN_TEXT");
        if (text_qa.text_in_art_only_zone) blocking.push("ART_ONLY_TEXT_VIOLATION");
        if (text_qa.contrast_pass === false) warnings.push("LOW_CONTRAST");
        if (text_qa.within_safe_margins === false) warnings.push("OUTSIDE_SAFE_MARGINS");
      } catch (e) {
        document_ai_error = e instanceof Error ? e.message : String(e);
        assetsFailed++;
        blocking.push("DOCUMENT_AI_FAILED");
      }

      try {
        const nv = await runCarouselOutputNemotronVisualReview({
          config,
          profileModel,
          renderedImageUrl: publicUrl,
          referenceImageUrl: refUrl,
          intended,
          taskId: job.task_id,
          projectId,
          runId,
          db,
        });
        nemotron_visual = nv.result;
        if (nemotron_visual.recommended_action !== "approve") visualWarn++;
        if (nemotron_visual.unwanted_text_in_image) warnings.push("UNWANTED_TEXT_IN_IMAGE_LAYER");
        if (nemotron_visual.visual_artifacts.length > 0) {
          warnings.push(...nemotron_visual.visual_artifacts.slice(0, 3).map((a) => `ARTIFACT:${a}`));
        }
        if (nemotron_visual.recommended_action === "regenerate_background") {
          warnings.push("NEMOTRON_REGENERATE_BACKGROUND");
        }
      } catch (e) {
        nemotron_error = e instanceof Error ? e.message : String(e);
        warnings.push("NEMOTRON_VISUAL_FAILED");
      }

      const asset_verdict =
        blocking.length > 0 ? ("fail" as const) : warnings.length > 0 ? ("warn" as const) : ("pass" as const);
      if (asset_verdict === "fail") blockingCount += blocking.length;
      assetsAnalyzed++;

      assetResults.push({
        asset_id: null,
        asset_type: asset.asset_type,
        slide_index: slideIndex,
        public_url: publicUrl,
        reference_asset_url: refUrl,
        document_ai,
        document_ai_error,
        text_qa,
        nemotron_visual,
        nemotron_error,
        asset_verdict,
        blocking_issues: blocking,
        warnings,
      });
    }

    const anyFail = assetResults.some((a) => a.asset_verdict === "fail");
    const anyWarn = assetResults.some((a) => a.asset_verdict === "warn");
    const job_verdict: "pass" | "warn" | "fail" = anyFail ? "fail" : anyWarn ? "warn" : "pass";
    for (const a of assetResults) {
      jobBlocking.push(...a.blocking_issues);
      jobWarnings.push(...a.warnings);
    }

    jobResults.push({
      task_id: job.task_id,
      job_id: job.id,
      flow_type: job.flow_type,
      platform: job.platform,
      status: job.status,
      mimic_mode: mimic?.mode ?? null,
      source_insights_id: mimic?.source_insights_id ?? null,
      intended: null,
      assets: assetResults,
      job_verdict,
      job_blocking_issues: [...new Set(jobBlocking)],
      job_warnings: [...new Set(jobWarnings)],
      error: null,
    });
  }

  const result: RunCarouselOutputAnalysisV1 = {
    schema_version: CAROUSEL_RUN_OUTPUT_ANALYSIS_SCHEMA,
    run_id: runId,
    project_id: projectId,
    analyzed_at: new Date().toISOString(),
    status_filter: statusFilter,
    providers: {
      document_ai: {
        project_id: config.DOCUMENT_AI_PROJECT_ID!.trim(),
        location: config.DOCUMENT_AI_LOCATION.trim(),
        processor_id: config.DOCUMENT_AI_PROCESSOR_ID!.trim(),
      },
      nemotron: { model: profileModel, provider: visionCall.provider },
    },
    summary: {
      jobs_total: carouselJobs.length,
      jobs_analyzed: jobResults.filter((j) => j.job_verdict !== "skipped").length,
      jobs_skipped: jobResults.filter((j) => j.job_verdict === "skipped").length,
      assets_analyzed: assetsAnalyzed,
      assets_failed: assetsFailed,
      text_pass: textPass,
      text_fail: textFail,
      visual_warn: visualWarn,
      blocking_count: blockingCount,
    },
    duration_ms: Date.now() - started,
    jobs: jobResults,
  };

  if (opts?.persist !== false) {
    const runRow = await q<{ id: string }>(
      db,
      `SELECT id FROM caf_core.runs WHERE project_id = $1 AND run_id = $2 LIMIT 1`,
      [projectId, runId]
    );
    const uuid = runRow[0]?.id;
    if (uuid) {
      await patchRun(db, uuid, {
        metadata_json: { [CAROUSEL_RUN_OUTPUT_ANALYSIS_SCHEMA]: result, run_output_analysis_at: result.analyzed_at },
      });
    }
  }

  void projectSlug;
  return result;
}
