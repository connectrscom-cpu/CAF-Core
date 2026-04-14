/**
 * LLM review of human-APPROVED content only: multimodal (images + text) when assets exist,
 * scores output for learning signal, persists llm_approval_reviews + learning_observations,
 * optionally mints pending GENERATION_GUIDANCE from low scores.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { q } from "../db/queries.js";
import { insertLearningRule } from "../repositories/learning.js";
import { insertObservation } from "../repositories/learning-evidence.js";
import {
  hasLlmApprovalReviewSince,
  insertLlmApprovalReview,
  markLlmApprovalReviewMinted,
} from "../repositories/llm-approval-reviews.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { openaiChatMultimodal, type ChatContentPart } from "./openai-chat-multimodal.js";
import { buildApprovedContentTextBundle } from "./approved-content-text-bundle.js";
import { createSignedUrlForObjectKey, tryParseSupabasePublicObjectUrl } from "./supabase-storage.js";

export { buildApprovedContentTextBundle } from "./approved-content-text-bundle.js";

const SYSTEM_PROMPT = `You are an expert content QA model reviewing material that a human reviewer already APPROVED for publication.
Your job is to score and critique it so the automation system can learn what strong approved output looks like and where patterns drift.

Rules:
- Be specific and actionable. Prefer concrete observations over vague praise.
- If images are provided, judge visual clarity, readability of on-image text, brand/tone fit vs the copy, and slide-to-slide coherence for carousels.
- For video-related JSON (video_prompt, scene_bundle, spoken_script, video_script), judge plan coherence, pacing hints, and hook strength — you only see text plans, not rendered video.
- Scores are 0.0–1.0 (higher is better).
- Return a single JSON object only (no markdown), with this shape:
{
  "overall_score": number,
  "alignment_score": number,
  "visual_execution_score": number,
  "copy_structure_score": number,
  "video_plan_score": number,
  "strengths": string[],
  "weaknesses": string[],
  "improvement_bullets": string[],
  "risk_flags": string[],
  "summary": string
}
If a dimension does not apply (e.g. no images), set that score to null and explain in summary.`;

function isLikelyImageAsset(url: string, assetType: string | null): boolean {
  const u = url.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(u)) return true;
  const t = (assetType ?? "").toLowerCase();
  if (t.includes("image") || t.includes("carousel") || t.includes("slide") || t.includes("png")) return true;
  return false;
}

async function isReachableImageUrl(url: string): Promise<boolean> {
  try {
    // OpenAI must be able to fetch the URL from the public internet. We do a quick HEAD check here
    // to avoid hard failures on signed/blocked/hotlink-protected URLs.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const head = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
      if (!head.ok) return false;
      const ct = head.headers.get("content-type") ?? "";
      return ct.toLowerCase().startsWith("image/");
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Some hosts don't support HEAD; fall through to Range GET.
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { Range: "bytes=0-2047" },
        signal: controller.signal,
      });
      if (!res.ok) return false;
      const ct = res.headers.get("content-type") ?? "";
      return ct.toLowerCase().startsWith("image/");
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

async function filterReachableImageUrls(urls: string[], maxImages: number): Promise<string[]> {
  const out: string[] = [];
  for (const u of urls) {
    if (!u) continue;
    // eslint-disable-next-line no-await-in-loop
    const ok = await isReachableImageUrl(u);
    if (!ok) continue;
    out.push(u);
    if (out.length >= maxImages) break;
  }
  return out;
}

async function listImageUrlsForTask(
  db: Pool,
  config: AppConfig,
  projectId: string,
  taskId: string,
  maxImages: number
): Promise<string[]> {
  const rows = await q<{
    public_url: string;
    asset_type: string | null;
    bucket: string | null;
    object_path: string | null;
  }>(
    db,
    `SELECT public_url, asset_type, bucket, object_path FROM caf_core.assets
     WHERE project_id = $1 AND task_id = $2
       AND public_url IS NOT NULL
       AND public_url ~ '^https?://'
     ORDER BY position ASC NULLS LAST, created_at ASC
     LIMIT $3`,
    [projectId, taskId, Math.max(maxImages * 3, maxImages)]
  );
  const urls: string[] = [];
  for (const r of rows) {
    if (!isLikelyImageAsset(r.public_url, r.asset_type)) continue;
    let url = r.public_url;
    const parsed = tryParseSupabasePublicObjectUrl(url);
    if (parsed) {
      const signed = await createSignedUrlForObjectKey(config, parsed.bucket, parsed.objectPath, 7200);
      if ("signedUrl" in signed) url = signed.signedUrl;
    } else {
      const b = (r.bucket ?? "").trim();
      const key = (r.object_path ?? "").trim();
      if (b && key) {
        const signed = await createSignedUrlForObjectKey(config, b, key, 7200);
        if ("signedUrl" in signed) url = signed.signedUrl;
      }
    }
    urls.push(url);
    if (urls.length >= maxImages) break;
  }
  return urls;
}

interface ApprovedJobRow {
  task_id: string;
  run_id: string;
  flow_type: string | null;
  platform: string | null;
  generation_payload: Record<string, unknown>;
}

async function listApprovedJobs(
  db: Pool,
  projectId: string,
  opts: {
    limit: number;
    taskIds?: string[];
  }
): Promise<ApprovedJobRow[]> {
  const lim = Math.min(Math.max(opts.limit, 1), 50);
  if (opts.taskIds && opts.taskIds.length > 0) {
    return q<ApprovedJobRow>(
      db,
      `SELECT j.task_id, j.run_id, j.flow_type, j.platform, j.generation_payload
       FROM caf_core.content_jobs j
       LEFT JOIN LATERAL (
         SELECT decision FROM caf_core.editorial_reviews
         WHERE task_id = j.task_id AND project_id = j.project_id
         ORDER BY created_at DESC LIMIT 1
       ) lr ON true
       WHERE j.project_id = $1 AND lr.decision = 'APPROVED'
         AND j.task_id = ANY($2::text[])
       ORDER BY j.updated_at DESC
       LIMIT $3`,
      [projectId, opts.taskIds, lim]
    );
  }
  return q<ApprovedJobRow>(
    db,
    `SELECT j.task_id, j.run_id, j.flow_type, j.platform, j.generation_payload
     FROM caf_core.content_jobs j
     LEFT JOIN LATERAL (
       SELECT decision FROM caf_core.editorial_reviews
       WHERE task_id = j.task_id AND project_id = j.project_id
       ORDER BY created_at DESC LIMIT 1
     ) lr ON true
     WHERE j.project_id = $1 AND lr.decision = 'APPROVED'
     ORDER BY j.updated_at DESC
     LIMIT $2`,
    [projectId, lim]
  );
}

function asStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function clamp01(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, Math.round(n * 10000) / 10000));
}

export interface RunLlmApprovalReviewParams {
  limit?: number;
  task_ids?: string[];
  /** If > 0, skip tasks reviewed in the last N days unless force_rereview. */
  skip_if_reviewed_within_days?: number;
  force_rereview?: boolean;
  /**
   * When set (e.g. 0.55), scores below this are eligible for minting one pending
   * GENERATION_GUIDANCE rule per task from improvement_bullets.
   */
  mint_pending_hints_below_score?: number | null;
  /**
   * If true, mint pending generation guidance automatically during the run.
   * If false/omitted, the run returns eligibility + proposed bullets but does not create learning rules.
   */
  auto_mint_pending_hints?: boolean;
}

export interface LlmApprovalReviewJobResult {
  task_id: string;
  ok: boolean;
  error?: string;
  review_id?: string;
  overall_score?: number | null;
  model?: string;
  minted_pending_rule?: boolean;
  hint_eligible?: boolean;
  improvement_bullets?: string[];
  strengths?: string[];
  weaknesses?: string[];
  risk_flags?: string[];
  summary?: string | null;
  images_used?: number;
  skipped?: boolean;
  reason?: string;
}

export async function runLlmApprovalReviewsForProject(
  db: Pool,
  config: AppConfig,
  projectId: string,
  projectSlug: string,
  params: RunLlmApprovalReviewParams
): Promise<{ results: LlmApprovalReviewJobResult[]; model: string }> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      results: [],
      model: config.OPENAI_APPROVAL_REVIEW_MODEL,
    };
  }

  const limit = params.limit ?? 5;
  const skipDays = params.force_rereview ? 0 : (params.skip_if_reviewed_within_days ?? 7);
  const model = config.OPENAI_APPROVAL_REVIEW_MODEL;
  const maxImages = config.LLM_APPROVAL_REVIEW_MAX_IMAGES;
  const maxText = config.LLM_APPROVAL_REVIEW_MAX_TEXT_CHARS;
  const mintBelow = params.mint_pending_hints_below_score;
  const autoMint = params.auto_mint_pending_hints === true;

  const jobs = await listApprovedJobs(db, projectId, { limit, taskIds: params.task_ids });
  const results: LlmApprovalReviewJobResult[] = [];

  for (const job of jobs) {
    if (skipDays > 0 && !params.force_rereview) {
      const recent = await hasLlmApprovalReviewSince(db, projectId, job.task_id, skipDays);
      if (recent) {
        results.push({
          task_id: job.task_id,
          ok: true,
          skipped: true,
          reason: `already reviewed within ${skipDays}d`,
        });
        continue;
      }
    }

    const reviewId = `llm_appr_${randomUUID().replace(/-/g, "").slice(0, 22)}`;
    const textBundle = buildApprovedContentTextBundle(job.generation_payload, maxText);
    const rawImageUrls = await listImageUrlsForTask(db, config, projectId, job.task_id, maxImages);
    const imageUrls = await filterReachableImageUrls(rawImageUrls, maxImages);

    const userParts: ChatContentPart[] = [
      {
        type: "text",
        text: [
          `task_id: ${job.task_id}`,
          `project: ${projectSlug}`,
          `flow_type: ${job.flow_type ?? "unknown"}`,
          `platform: ${job.platform ?? "unknown"}`,
          `attached_images: ${imageUrls.length}`,
          "",
          "--- Approved content bundle ---",
          textBundle,
        ].join("\n"),
      },
    ];
    for (const url of imageUrls) {
      userParts.push({
        type: "image_url",
        image_url: { url, detail: "low" },
      });
    }

    try {
      const call = async (content: ChatContentPart[]) =>
        openaiChatMultimodal(
          apiKey,
          {
            model,
            system_prompt: SYSTEM_PROMPT,
            user_content: content,
            max_tokens: 2500,
            response_format: "json_object",
          },
          {
            db,
            projectId,
            runId: job.run_id,
            taskId: job.task_id,
            signalPackId: null,
            step: "llm_post_approval_review",
          }
        );

      let llm;
      try {
        llm = await call(userParts);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // If OpenAI rejects any image URL, fall back to text-only so the review still completes.
        if (imageUrls.length > 0 && /invalid_image_url/i.test(msg)) {
          const textOnly = userParts.filter((p) => p.type !== "image_url");
          llm = await call(textOnly);
        } else {
          throw e;
        }
      }

      const parsed = parseJsonObjectFromLlmText(llm.content);
      if (!parsed) {
        results.push({
          task_id: job.task_id,
          ok: false,
          error: "model returned non-JSON",
          review_id: reviewId,
        });
        continue;
      }

      const overall = clamp01(parsed.overall_score) ?? 0.5;
      const strengths = asStrArray(parsed.strengths);
      const weaknesses = asStrArray(parsed.weaknesses);
      const improvementBullets = asStrArray(parsed.improvement_bullets);
      const riskFlags = asStrArray(parsed.risk_flags);
      const summary = typeof parsed.summary === "string" ? parsed.summary : null;

      const scoresJson: Record<string, unknown> = {
        alignment_score: clamp01(parsed.alignment_score),
        visual_execution_score: clamp01(parsed.visual_execution_score),
        copy_structure_score: clamp01(parsed.copy_structure_score),
        video_plan_score: clamp01(parsed.video_plan_score),
      };

      const eligible = mintBelow != null && overall < mintBelow && improvementBullets.length > 0;
      let minted = false;
      if (eligible && autoMint) {
        const ruleId = `llm_hint_${randomUUID().replace(/-/g, "").slice(0, 16)}_${Date.now()}`;
        await insertLearningRule(db, {
          rule_id: ruleId,
          project_id: projectId,
          trigger_type: "llm_post_approval_review",
          scope_flow_type: job.flow_type ?? null,
          scope_platform: job.platform ?? null,
          action_type: "GENERATION_GUIDANCE",
          action_payload: {
            bullets: improvementBullets.slice(0, 8),
            instruction: improvementBullets.slice(0, 5).join(" "),
            source_task_id: job.task_id,
            source_review_id: reviewId,
            llm_overall_score: overall,
          },
          confidence: Math.max(0.15, 1 - overall),
          source_entity_ids: [job.task_id],
          evidence_refs: [reviewId, job.task_id],
          rule_family: "generation",
          provenance: "llm_post_approval_review",
          created_by: "llm_approval_reviewer",
        });
        minted = true;
      }

      await insertLlmApprovalReview(db, {
        review_id: reviewId,
        project_id: projectId,
        task_id: job.task_id,
        run_id: job.run_id,
        flow_type: job.flow_type,
        platform: job.platform,
        model: llm.model,
        overall_score: overall,
        scores_json: scoresJson,
        strengths,
        weaknesses,
        improvement_bullets: improvementBullets,
        risk_flags: riskFlags,
        summary,
        raw_assistant_text: llm.content.slice(0, 24_000),
        vision_image_urls: imageUrls,
        text_bundle_chars: textBundle.length,
        minted_pending_rule: minted,
      });

      await insertObservation(db, {
        observation_id: reviewId,
        scope_type: "project",
        project_id: projectId,
        source_type: "llm_review",
        flow_type: job.flow_type ?? null,
        platform: job.platform ?? null,
        observation_type: "llm_post_approval_review",
        entity_ref: job.task_id,
        payload_json: {
          review_id: reviewId,
          overall_score: overall,
          scores: scoresJson,
          strengths,
          weaknesses,
          improvement_bullets: improvementBullets,
          risk_flags: riskFlags,
          summary,
          model: llm.model,
          images_used: imageUrls.length,
          minted_pending_rule: minted,
        },
        confidence: overall,
        observed_at: new Date().toISOString(),
      });

      results.push({
        task_id: job.task_id,
        ok: true,
        review_id: reviewId,
        overall_score: overall,
        model: llm.model,
        minted_pending_rule: minted,
        hint_eligible: eligible,
        improvement_bullets: improvementBullets,
        strengths,
        weaknesses,
        risk_flags: riskFlags,
        summary,
        images_used: imageUrls.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ task_id: job.task_id, ok: false, error: msg, review_id: reviewId });
    }
  }

  return { results, model };
}

export async function mintPendingHintsFromApprovalReviews(
  db: Pool,
  projectId: string,
  reviewIds: string[],
  mintBelow: number
): Promise<{ minted: number; skipped: number; errors: Array<{ review_id: string; error: string }> }> {
  const ids = (reviewIds ?? []).map((x) => String(x)).filter(Boolean).slice(0, 200);
  const threshold = Math.min(1, Math.max(0, mintBelow));
  if (ids.length === 0) return { minted: 0, skipped: 0, errors: [] };

  const rows = await q<{
    review_id: string;
    task_id: string;
    flow_type: string | null;
    platform: string | null;
    overall_score: number | null;
    improvement_bullets: unknown;
    minted_pending_rule: boolean | null;
  }>(
    db,
    `SELECT review_id, task_id, flow_type, platform, overall_score, improvement_bullets, minted_pending_rule
     FROM caf_core.llm_approval_reviews
     WHERE project_id = $1 AND review_id = ANY($2::text[])`,
    [projectId, ids]
  );

  let minted = 0;
  let skipped = 0;
  const errors: Array<{ review_id: string; error: string }> = [];

  for (const r of rows) {
    try {
      if (r.minted_pending_rule) {
        skipped++;
        continue;
      }
      const score = typeof r.overall_score === "number" ? r.overall_score : null;
      if (score == null || !Number.isFinite(score) || score >= threshold) {
        skipped++;
        continue;
      }
      const bullets = Array.isArray(r.improvement_bullets)
        ? r.improvement_bullets.map((x) => String(x).trim()).filter(Boolean)
        : [];
      if (bullets.length === 0) {
        skipped++;
        continue;
      }

      const ruleId = `llm_hint_${randomUUID().replace(/-/g, "").slice(0, 16)}_${Date.now()}`;
      await insertLearningRule(db, {
        rule_id: ruleId,
        project_id: projectId,
        trigger_type: "llm_post_approval_review",
        scope_flow_type: r.flow_type ?? null,
        scope_platform: r.platform ?? null,
        action_type: "GENERATION_GUIDANCE",
        action_payload: {
          bullets: bullets.slice(0, 8),
          instruction: bullets.slice(0, 5).join(" "),
          source_task_id: r.task_id,
          source_review_id: r.review_id,
          llm_overall_score: score,
        },
        confidence: Math.max(0.15, 1 - score),
        source_entity_ids: [r.task_id],
        evidence_refs: [r.review_id, r.task_id],
        rule_family: "generation",
        provenance: "llm_post_approval_review",
        created_by: "llm_approval_reviewer",
      });

      await markLlmApprovalReviewMinted(db, projectId, r.review_id, true);
      minted++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ review_id: r.review_id, error: msg || "mint_failed" });
    }
  }

  return { minted, skipped, errors };
}
