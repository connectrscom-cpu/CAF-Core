import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";
import type { UpstreamRecommendation } from "../domain/upstream-recommendations.js";

export async function insertLlmApprovalReview(
  db: Pool,
  row: {
    review_id: string;
    project_id: string;
    task_id: string;
    run_id?: string | null;
    flow_type?: string | null;
    platform?: string | null;
    model: string;
    overall_score: number | null;
    scores_json: Record<string, unknown>;
    strengths: unknown[];
    weaknesses: unknown[];
    improvement_bullets: unknown[];
    risk_flags: unknown[];
    summary?: string | null;
    raw_assistant_text?: string | null;
    vision_image_urls: string[];
    text_bundle_chars: number;
    minted_pending_rule: boolean;
    minted_pending_positive_rule?: boolean;
    /**
     * Structured "what to change upstream" suggestions emitted by the LLM.
     * Empty array is the canonical "no recommendations" value (not null).
     * See `src/domain/upstream-recommendations.ts`.
     */
    upstream_recommendations?: UpstreamRecommendation[];
  }
): Promise<void> {
  const mintedPos = row.minted_pending_positive_rule ?? false;
  const upstream = row.upstream_recommendations ?? [];
  await db.query(
    `INSERT INTO caf_core.llm_approval_reviews (
       review_id, project_id, task_id, run_id, flow_type, platform, model,
       overall_score, scores_json, strengths, weaknesses, improvement_bullets,
       risk_flags, summary, raw_assistant_text, vision_image_urls, text_bundle_chars,
       minted_pending_rule, minted_pending_positive_rule, upstream_recommendations
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16::jsonb,$17,$18,$19,$20::jsonb)
     ON CONFLICT (project_id, review_id) DO UPDATE SET
       model = EXCLUDED.model,
       overall_score = EXCLUDED.overall_score,
       scores_json = EXCLUDED.scores_json,
       strengths = EXCLUDED.strengths,
       weaknesses = EXCLUDED.weaknesses,
       improvement_bullets = EXCLUDED.improvement_bullets,
       risk_flags = EXCLUDED.risk_flags,
       summary = EXCLUDED.summary,
       raw_assistant_text = EXCLUDED.raw_assistant_text,
       vision_image_urls = EXCLUDED.vision_image_urls,
       text_bundle_chars = EXCLUDED.text_bundle_chars,
       minted_pending_rule = EXCLUDED.minted_pending_rule,
       minted_pending_positive_rule = EXCLUDED.minted_pending_positive_rule,
       upstream_recommendations = EXCLUDED.upstream_recommendations`,
    [
      row.review_id,
      row.project_id,
      row.task_id,
      row.run_id ?? null,
      row.flow_type ?? null,
      row.platform ?? null,
      row.model,
      row.overall_score,
      JSON.stringify(row.scores_json),
      JSON.stringify(row.strengths),
      JSON.stringify(row.weaknesses),
      JSON.stringify(row.improvement_bullets),
      JSON.stringify(row.risk_flags),
      row.summary ?? null,
      row.raw_assistant_text ?? null,
      JSON.stringify(row.vision_image_urls),
      row.text_bundle_chars,
      row.minted_pending_rule,
      mintedPos,
      JSON.stringify(upstream),
    ]
  );
}

export async function hasLlmApprovalReviewSince(
  db: Pool,
  projectId: string,
  taskId: string,
  withinDays: number
): Promise<boolean> {
  const row = await qOne<{ ok: string }>(
    db,
    `SELECT 1::text AS ok FROM caf_core.llm_approval_reviews
     WHERE project_id = $1 AND task_id = $2
       AND created_at >= now() - ($3::integer * interval '1 day')
     LIMIT 1`,
    [projectId, taskId, withinDays]
  );
  return Boolean(row);
}

export async function listLlmApprovalReviews(
  db: Pool,
  projectId: string,
  limit = 50
): Promise<Record<string, unknown>[]> {
  return q(
    db,
    `SELECT * FROM caf_core.llm_approval_reviews
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [projectId, Math.min(limit, 200)]
  );
}

/** Recent reviews joined to jobs for anti-repetition context (same flow + platform lane as current job). */
export async function listLlmApprovalReviewsForAntiRepetition(
  db: Pool,
  projectId: string,
  flowType: string,
  platform: string | null,
  opts: { excludeTaskId?: string | null; limit: number }
): Promise<
  Array<{
    task_id: string;
    overall_score: string | number | null;
    summary: string | null;
    strengths: unknown;
    generation_payload: Record<string, unknown>;
  }>
> {
  const lim = Math.min(Math.max(1, opts.limit), 40);
  const exclude = (opts.excludeTaskId ?? "").trim();
  const params: unknown[] = [projectId, flowType.trim()];
  let sql = `
    SELECT r.task_id, r.overall_score, r.summary, r.strengths, j.generation_payload
    FROM caf_core.llm_approval_reviews r
    INNER JOIN caf_core.content_jobs j
      ON j.project_id = r.project_id AND j.task_id = r.task_id
    WHERE r.project_id = $1
      AND j.flow_type IS NOT DISTINCT FROM $2
      AND r.overall_score IS NOT NULL
      AND r.overall_score >= 0.5`;
  if (platform != null && String(platform).trim() !== "") {
    sql += ` AND j.platform IS NOT DISTINCT FROM $${params.length + 1}`;
    params.push(String(platform).trim());
  }
  if (exclude) {
    sql += ` AND r.task_id <> $${params.length + 1}`;
    params.push(exclude);
  }
  sql += ` ORDER BY r.created_at DESC LIMIT $${params.length + 1}`;
  params.push(lim);
  const rows = await q<{
    task_id: string;
    overall_score: string | number | null;
    summary: string | null;
    strengths: unknown;
    generation_payload: Record<string, unknown>;
  }>(db, sql, params);
  return rows;
}

export async function markLlmApprovalReviewMinted(
  db: Pool,
  projectId: string,
  reviewId: string,
  minted: boolean
): Promise<void> {
  await db.query(
    `UPDATE caf_core.llm_approval_reviews
     SET minted_pending_rule = $3
     WHERE project_id = $1 AND review_id = $2`,
    [projectId, reviewId, minted]
  );
}

export async function markLlmApprovalReviewPositiveMinted(
  db: Pool,
  projectId: string,
  reviewId: string,
  minted: boolean
): Promise<void> {
  await db.query(
    `UPDATE caf_core.llm_approval_reviews
     SET minted_pending_positive_rule = $3
     WHERE project_id = $1 AND review_id = $2`,
    [projectId, reviewId, minted]
  );
}
