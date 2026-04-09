import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

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
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.llm_approval_reviews (
       review_id, project_id, task_id, run_id, flow_type, platform, model,
       overall_score, scores_json, strengths, weaknesses, improvement_bullets,
       risk_flags, summary, raw_assistant_text, vision_image_urls, text_bundle_chars,
       minted_pending_rule
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16::jsonb,$17,$18)
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
       minted_pending_rule = EXCLUDED.minted_pending_rule`,
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
