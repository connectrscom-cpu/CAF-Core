/**
 * Typed subset of `content_jobs.generation_payload` — the `qc_result` blob.
 *
 * `generation_payload` is a catch-all JSONB column today. This module carves
 * out the QC slice so writers and readers share a single shape validated by
 * Zod. It exists so engineers can find the contract without hunting for a
 * handful of ad-hoc `||` jsonb merges. Other payload keys (`generated_output`,
 * `video_*`, etc.) can follow the same pattern incrementally.
 *
 * Rules:
 *   - never throw at write time if the in-memory payload is slightly loose
 *     (we don't want QC rollouts to fail because of a new field); use
 *     `qcResultSchema.parse` at test/dev time and `pickStoredQcResult` at
 *     runtime.
 *   - the read helper tolerates pre-migration rows that only carry counts.
 */
import type { Pool } from "pg";
import { z } from "zod";

export const qcBlockingCheckSchema = z.object({
  check_id: z.string(),
  check_name: z.string().nullable(),
  failure_message: z.string().nullable(),
  details: z.string().nullish(),
  severity: z.string(),
});

export const qcBlockingRiskPolicySchema = z.object({
  policy_name: z.string(),
  severity: z.string(),
  matched_terms: z.array(z.string()),
});

export const qcResultSchema = z.object({
  passed: z.boolean(),
  score: z.number(),
  blocking_count: z.number().int().nonnegative(),
  risk_level: z.string(),
  risk_findings_count: z.number().int().nonnegative(),
  recommended_route: z.string(),
  reason_short: z.string().max(200).optional(),
  reasons: z.array(z.string()).optional(),
  blocking_checks: z.array(qcBlockingCheckSchema).optional(),
  blocking_risk_policies: z.array(qcBlockingRiskPolicySchema).optional(),
});

export type QcResultStored = z.infer<typeof qcResultSchema>;

/**
 * Permissive read: accepts pre-migration rows (only counts) by falling back
 * to a structural check. Returns null if nothing parseable is present.
 */
export function pickStoredQcResult(
  generationPayload: Record<string, unknown> | null | undefined
): QcResultStored | null {
  const qr = generationPayload?.qc_result;
  if (!qr || typeof qr !== "object" || Array.isArray(qr)) return null;
  const parsed = qcResultSchema.safeParse(qr);
  if (parsed.success) return parsed.data;
  return qr as QcResultStored;
}

/**
 * Merge a QC result blob into `content_jobs.generation_payload` and update
 * `qc_status` + `recommended_route` atomically. This is the single write
 * surface for QC output today; any other path is considered drift.
 *
 * We `parse` the payload so a bad shape fails loudly during tests; runtime
 * callers that already typed the input pay no extra validation cost worth
 * noting.
 */
export async function mergeGenerationPayloadQc(
  db: Pool,
  jobId: string,
  qc: QcResultStored,
  opts: { qc_status: "PASS" | "FAIL"; recommended_route: string }
): Promise<void> {
  const validated = qcResultSchema.parse(qc);
  await db.query(
    `UPDATE caf_core.content_jobs SET
       qc_status = $1,
       generation_payload = COALESCE(generation_payload, '{}'::jsonb) || $2::jsonb,
       recommended_route = $3,
       updated_at = now()
     WHERE id = $4`,
    [opts.qc_status, JSON.stringify({ qc_result: validated }), opts.recommended_route, jobId]
  );
}
