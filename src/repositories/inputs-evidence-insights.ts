import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export type EvidenceInsightTier =
  | "broad_llm"
  | "top_performer_deep"
  | "top_performer_video"
  | "top_performer_carousel";

export interface EvidenceRowInsightRow {
  id: string;
  project_id: string;
  inputs_import_id: string;
  source_evidence_row_id: string;
  insights_id: string;
  analysis_tier: EvidenceInsightTier;
  pre_llm_score: string | null;
  llm_model: string | null;
  why_it_worked: string | null;
  primary_emotion: string | null;
  secondary_emotion: string | null;
  hook_type: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  cta_type: string | null;
  hashtags: string | null;
  caption_style: string | null;
  hook_text: string | null;
  risk_flags_json: unknown;
  aesthetic_analysis_json: unknown | null;
  raw_llm_json: unknown | null;
  /** Supabase copies of carousel slides / video frames used for vision (null if never archived). */
  stored_inspection_media_json: unknown | null;
  /** Denormalized `inputs_evidence_rows` rating snapshot for top_performer_* tiers (null for broad_llm). */
  evidence_performance_review_json: unknown | null;
  created_at: string;
  updated_at: string;
}

export interface EvidenceRowInsightEnrichedRow extends EvidenceRowInsightRow {
  evidence_kind: string;
  evidence_rating_score?: string | null;
  /** Set by API layer from `evidence_payload_json` (not stored on insight rows). */
  evidence_post_url?: string | null;
  /** Set by API layer: `instagram_carousel` / `instagram_video` vs bare `instagram_post` when payload indicates. */
  evidence_display_kind?: string;
}

export interface UpsertEvidenceInsightInput {
  project_id: string;
  inputs_import_id: string;
  source_evidence_row_id: string;
  insights_id: string;
  analysis_tier: EvidenceInsightTier;
  pre_llm_score: number | null;
  llm_model: string | null;
  why_it_worked: string | null;
  primary_emotion: string | null;
  secondary_emotion: string | null;
  hook_type: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  cta_type: string | null;
  hashtags: string | null;
  caption_style: string | null;
  hook_text: string | null;
  risk_flags_json: unknown[];
  aesthetic_analysis_json: Record<string, unknown> | null;
  raw_llm_json: Record<string, unknown> | null;
  /** When set (including null), upsert updates this column; omit to preserve existing on conflict. */
  stored_inspection_media_json?: Record<string, unknown> | null;
  /**
   * Evidence-row rating snapshot (performance review). Use null when unrated.
   * On conflict, null preserves any existing value; non-null overwrites.
   */
  evidence_performance_review_json?: Record<string, unknown> | null;
}

export async function upsertEvidenceRowInsight(db: Pool, row: UpsertEvidenceInsightInput): Promise<{ id: string }> {
  const out = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.inputs_evidence_row_insights (
       project_id, inputs_import_id, source_evidence_row_id, insights_id, analysis_tier,
       pre_llm_score, llm_model,
       why_it_worked, primary_emotion, secondary_emotion, hook_type,
       custom_label_1, custom_label_2, custom_label_3,
       cta_type, hashtags, caption_style, hook_text,
       risk_flags_json, aesthetic_analysis_json, raw_llm_json,
       stored_inspection_media_json, evidence_performance_review_json
     ) VALUES (
       $1,$2,$3::bigint,$4,$5,
       $6,$7,
       $8,$9,$10,$11,
       $12,$13,$14,
       $15,$16,$17,$18,
       $19::jsonb,$20::jsonb,$21::jsonb,
       $22::jsonb, $23::jsonb
     )
     ON CONFLICT (inputs_import_id, source_evidence_row_id, analysis_tier)
     DO UPDATE SET
       insights_id = EXCLUDED.insights_id,
       pre_llm_score = EXCLUDED.pre_llm_score,
       llm_model = EXCLUDED.llm_model,
       why_it_worked = EXCLUDED.why_it_worked,
       primary_emotion = EXCLUDED.primary_emotion,
       secondary_emotion = EXCLUDED.secondary_emotion,
       hook_type = EXCLUDED.hook_type,
       custom_label_1 = EXCLUDED.custom_label_1,
       custom_label_2 = EXCLUDED.custom_label_2,
       custom_label_3 = EXCLUDED.custom_label_3,
       cta_type = EXCLUDED.cta_type,
       hashtags = EXCLUDED.hashtags,
       caption_style = EXCLUDED.caption_style,
       hook_text = EXCLUDED.hook_text,
       risk_flags_json = EXCLUDED.risk_flags_json,
       aesthetic_analysis_json = EXCLUDED.aesthetic_analysis_json,
       raw_llm_json = EXCLUDED.raw_llm_json,
       stored_inspection_media_json = COALESCE(EXCLUDED.stored_inspection_media_json, caf_core.inputs_evidence_row_insights.stored_inspection_media_json),
       evidence_performance_review_json = COALESCE(
         EXCLUDED.evidence_performance_review_json,
         caf_core.inputs_evidence_row_insights.evidence_performance_review_json
       ),
       updated_at = now()
     RETURNING id`,
    [
      row.project_id,
      row.inputs_import_id,
      row.source_evidence_row_id,
      row.insights_id,
      row.analysis_tier,
      row.pre_llm_score,
      row.llm_model,
      row.why_it_worked,
      row.primary_emotion,
      row.secondary_emotion,
      row.hook_type,
      row.custom_label_1,
      row.custom_label_2,
      row.custom_label_3,
      row.cta_type,
      row.hashtags,
      row.caption_style,
      row.hook_text,
      JSON.stringify(row.risk_flags_json ?? []),
      row.aesthetic_analysis_json ? JSON.stringify(row.aesthetic_analysis_json) : null,
      row.raw_llm_json ? JSON.stringify(row.raw_llm_json) : null,
      row.stored_inspection_media_json !== undefined
        ? row.stored_inspection_media_json === null
          ? null
          : JSON.stringify(row.stored_inspection_media_json)
        : null,
      row.evidence_performance_review_json !== undefined
        ? row.evidence_performance_review_json === null
          ? null
          : JSON.stringify(row.evidence_performance_review_json)
        : null,
    ]
  );
  if (!out) throw new Error("upsertEvidenceRowInsight failed");
  return out;
}

export async function listEvidenceRowInsightIdsByImportTier(
  db: Pool,
  importId: string,
  tier: EvidenceInsightTier
): Promise<Set<string>> {
  const rows = await q<{ id: string }>(
    db,
    `SELECT source_evidence_row_id::text AS id
       FROM caf_core.inputs_evidence_row_insights
      WHERE inputs_import_id = $1 AND analysis_tier = $2`,
    [importId, tier]
  );
  return new Set(rows.map((r) => r.id));
}

export type EvidenceInsightMechanismSlice = Pick<
  EvidenceRowInsightRow,
  | "primary_emotion"
  | "secondary_emotion"
  | "caption_style"
  | "custom_label_1"
  | "custom_label_2"
  | "custom_label_3"
  | "hashtags"
>;

/** Mechanism columns from an earlier tier (e.g. broad_llm) keyed by evidence row id. */
export async function listEvidenceRowInsightMechanismByRowIds(
  db: Pool,
  importId: string,
  tier: EvidenceInsightTier,
  rowIds: string[]
): Promise<Map<string, EvidenceInsightMechanismSlice>> {
  const ids = [...new Set(rowIds.map((id) => String(id ?? "").trim()).filter((id) => /^\d+$/.test(id)))];
  if (ids.length === 0) return new Map();

  const rows = await q<{ id: string } & EvidenceInsightMechanismSlice>(
    db,
    `SELECT source_evidence_row_id::text AS id,
            primary_emotion, secondary_emotion, caption_style,
            custom_label_1, custom_label_2, custom_label_3, hashtags
       FROM caf_core.inputs_evidence_row_insights
      WHERE inputs_import_id = $1
        AND analysis_tier = $2
        AND source_evidence_row_id::text = ANY($3::text[])`,
    [importId, tier, ids]
  );

  const out = new Map<string, EvidenceInsightMechanismSlice>();
  for (const row of rows) {
    out.set(row.id, {
      primary_emotion: row.primary_emotion,
      secondary_emotion: row.secondary_emotion,
      caption_style: row.caption_style,
      custom_label_1: row.custom_label_1,
      custom_label_2: row.custom_label_2,
      custom_label_3: row.custom_label_3,
      hashtags: row.hashtags,
    });
  }
  return out;
}

export async function listEvidenceRowInsights(
  db: Pool,
  projectId: string,
  importId: string,
  tier: EvidenceInsightTier | null,
  limit: number,
  offset: number
): Promise<EvidenceRowInsightRow[]> {
  const lim = Math.min(Math.max(limit, 1), 200);
  const off = Math.max(offset, 0);
  if (tier) {
    return q(
      db,
      `SELECT id::text, project_id::text, inputs_import_id::text, source_evidence_row_id::text, insights_id, analysis_tier,
              pre_llm_score::text, llm_model,
              why_it_worked, primary_emotion, secondary_emotion, hook_type,
              custom_label_1, custom_label_2, custom_label_3,
              cta_type, hashtags, caption_style, hook_text,
              risk_flags_json, aesthetic_analysis_json, raw_llm_json, stored_inspection_media_json,
              evidence_performance_review_json,
              created_at::text, updated_at::text
         FROM caf_core.inputs_evidence_row_insights
        WHERE project_id = $1 AND inputs_import_id = $2 AND analysis_tier = $3
        ORDER BY updated_at DESC
        LIMIT $4 OFFSET $5`,
      [projectId, importId, tier, lim, off]
    );
  }
  return q(
    db,
    `SELECT id::text, project_id::text, inputs_import_id::text, source_evidence_row_id::text, insights_id, analysis_tier,
            pre_llm_score::text, llm_model,
            why_it_worked, primary_emotion, secondary_emotion, hook_type,
            custom_label_1, custom_label_2, custom_label_3,
            cta_type, hashtags, caption_style, hook_text,
            risk_flags_json, aesthetic_analysis_json, raw_llm_json, stored_inspection_media_json,
            evidence_performance_review_json,
            created_at::text, updated_at::text
       FROM caf_core.inputs_evidence_row_insights
      WHERE project_id = $1 AND inputs_import_id = $2
      ORDER BY analysis_tier ASC, updated_at DESC
      LIMIT $3 OFFSET $4`,
    [projectId, importId, lim, off]
  );
}

export async function countEvidenceRowInsightsByImportTier(
  db: Pool,
  importId: string,
  tier: EvidenceInsightTier
): Promise<number> {
  const row = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(*)::text AS n FROM caf_core.inputs_evidence_row_insights
      WHERE inputs_import_id = $1 AND analysis_tier = $2`,
    [importId, tier]
  );
  return parseInt(row?.n ?? "0", 10) || 0;
}

/** Hard-delete all insights of one tier for an import (admin / cleanup). Returns rows removed. */
export async function deleteEvidenceRowInsightsForImportTier(
  db: Pool,
  projectId: string,
  importId: string,
  tier: EvidenceInsightTier
): Promise<number> {
  const r = await db.query(
    `DELETE FROM caf_core.inputs_evidence_row_insights
      WHERE project_id = $1 AND inputs_import_id = $2 AND analysis_tier = $3`,
    [projectId, importId, tier]
  );
  return r.rowCount ?? 0;
}

/** Hard-delete insights for several tiers in one statement (admin cleanup). Returns total rows removed. */
export async function deleteEvidenceRowInsightsForImportTiers(
  db: Pool,
  projectId: string,
  importId: string,
  tiers: EvidenceInsightTier[]
): Promise<number> {
  if (tiers.length === 0) return 0;
  const r = await db.query(
    `DELETE FROM caf_core.inputs_evidence_row_insights
      WHERE project_id = $1 AND inputs_import_id = $2 AND analysis_tier = ANY($3::text[])`,
    [projectId, importId, tiers]
  );
  return r.rowCount ?? 0;
}

/** Count insights for one analysis tier restricted to rows of a single evidence_kind (joins evidence rows). */
export async function countEvidenceRowInsightsByImportTierAndKind(
  db: Pool,
  projectId: string,
  importId: string,
  tier: EvidenceInsightTier,
  evidenceKind: string
): Promise<number> {
  const kind = String(evidenceKind ?? "").trim();
  if (!kind) return 0;
  const row = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(*)::text AS n
       FROM caf_core.inputs_evidence_row_insights i
       INNER JOIN caf_core.inputs_evidence_rows r
         ON r.id = i.source_evidence_row_id
        AND r.import_id = i.inputs_import_id
        AND r.project_id = i.project_id
      WHERE i.inputs_import_id = $1
        AND i.project_id = $2
        AND i.analysis_tier = $3
        AND r.evidence_kind = $4`,
    [importId, projectId, tier, kind]
  );
  return parseInt(row?.n ?? "0", 10) || 0;
}

const INSIGHT_SELECT_ENRICHED_CORE = `SELECT i.id::text, i.project_id::text, i.inputs_import_id::text, i.source_evidence_row_id::text, i.insights_id, i.analysis_tier,
       i.pre_llm_score::text, i.llm_model,
       i.why_it_worked, i.primary_emotion, i.secondary_emotion, i.hook_type,
       i.custom_label_1, i.custom_label_2, i.custom_label_3,
       i.cta_type, i.hashtags, i.caption_style, i.hook_text,
       i.risk_flags_json, i.aesthetic_analysis_json, i.raw_llm_json, i.stored_inspection_media_json,
       i.evidence_performance_review_json,
       i.created_at::text, i.updated_at::text,
       r.evidence_kind,
       r.rating_score::text AS evidence_rating_score`;

/** Same as CORE plus evidence row payload (admin evidence-insights only — avoid in bulk LLM fetches). */
const INSIGHT_SELECT_ENRICHED_WITH_PAYLOAD = `${INSIGHT_SELECT_ENRICHED_CORE},
       r.payload_json AS evidence_payload_json`;

const INSIGHT_JOIN = `FROM caf_core.inputs_evidence_row_insights i
 INNER JOIN caf_core.inputs_evidence_rows r
   ON r.id = i.source_evidence_row_id
  AND r.import_id = i.inputs_import_id
  AND r.project_id = i.project_id`;

export async function listEvidenceRowInsightsEnriched(
  db: Pool,
  projectId: string,
  importId: string,
  opts: { tier: EvidenceInsightTier | null; evidence_kind: string | null; limit: number; offset: number }
): Promise<EvidenceRowInsightEnrichedRow[]> {
  const lim = Math.min(Math.max(opts.limit, 1), 200);
  const off = Math.max(opts.offset, 0);
  const tier = opts.tier;
  const kind = opts.evidence_kind?.trim() || null;

  if (tier && kind) {
    return q(
      db,
      `${INSIGHT_SELECT_ENRICHED_WITH_PAYLOAD}
       ${INSIGHT_JOIN}
       WHERE i.project_id = $1 AND i.inputs_import_id = $2 AND i.analysis_tier = $3 AND r.evidence_kind = $4
       ORDER BY i.updated_at DESC
       LIMIT $5 OFFSET $6`,
      [projectId, importId, tier, kind, lim, off]
    );
  }
  if (tier) {
    return q(
      db,
      `${INSIGHT_SELECT_ENRICHED_WITH_PAYLOAD}
       ${INSIGHT_JOIN}
       WHERE i.project_id = $1 AND i.inputs_import_id = $2 AND i.analysis_tier = $3
       ORDER BY i.updated_at DESC
       LIMIT $4 OFFSET $5`,
      [projectId, importId, tier, lim, off]
    );
  }
  if (kind) {
    return q(
      db,
      `${INSIGHT_SELECT_ENRICHED_WITH_PAYLOAD}
       ${INSIGHT_JOIN}
       WHERE i.project_id = $1 AND i.inputs_import_id = $2 AND r.evidence_kind = $3
       ORDER BY i.analysis_tier ASC, i.updated_at DESC
       LIMIT $4 OFFSET $5`,
      [projectId, importId, kind, lim, off]
    );
  }
  return q(
    db,
    `${INSIGHT_SELECT_ENRICHED_WITH_PAYLOAD}
     ${INSIGHT_JOIN}
     WHERE i.project_id = $1 AND i.inputs_import_id = $2
     ORDER BY i.analysis_tier ASC, i.updated_at DESC
     LIMIT $3 OFFSET $4`,
    [projectId, importId, lim, off]
  );
}

const BROAD_WITH_RATING_SELECT = INSIGHT_SELECT_ENRICHED_CORE;

/** Broad LLM insights joined with evidence row rating (for ideas-from-insights context ordering). */
export interface BroadInsightWithRating extends EvidenceRowInsightEnrichedRow {
  evidence_rating_score: string | null;
}

export async function listBroadInsightsWithEvidenceRating(
  db: Pool,
  projectId: string,
  importId: string,
  limit: number
): Promise<BroadInsightWithRating[]> {
  const lim = Math.min(Math.max(limit, 1), 3000);
  return q(
    db,
    `${BROAD_WITH_RATING_SELECT}
     ${INSIGHT_JOIN}
     WHERE i.project_id = $1 AND i.inputs_import_id = $2 AND i.analysis_tier = 'broad_llm'
     ORDER BY r.rating_score DESC NULLS LAST, i.updated_at DESC
     LIMIT $3`,
    [projectId, importId, lim]
  );
}

/** All top-performer tier insights for an import (may be multiple rows per evidence row). */
export async function listTopPerformerInsightsEnriched(
  db: Pool,
  projectId: string,
  importId: string,
  limit: number
): Promise<EvidenceRowInsightEnrichedRow[]> {
  const lim = Math.min(Math.max(limit, 1), 3000);
  return q(
    db,
    `${INSIGHT_SELECT_ENRICHED_CORE}
     ${INSIGHT_JOIN}
     WHERE i.project_id = $1 AND i.inputs_import_id = $2
       AND i.analysis_tier IN ('top_performer_deep', 'top_performer_video', 'top_performer_carousel')
     ORDER BY r.rating_score DESC NULLS LAST, i.updated_at DESC
     LIMIT $3`,
    [projectId, importId, lim]
  );
}

/**
 * Resolve DB primary keys for insight rows by their public `insights_id` strings.
 * Used by stage-3 idea grounding links (ideas store grounding_insight_ids).
 */
export async function getInsightRowUuidsByInsightsIds(
  db: Pool,
  projectId: string,
  insightsIds: string[]
): Promise<Map<string, string>> {
  const ids = (insightsIds ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 500);
  if (ids.length === 0) return new Map();
  const rows = await q<{ insights_id: string; id: string }>(
    db,
    `SELECT insights_id, id::text AS id
       FROM caf_core.inputs_evidence_row_insights
      WHERE project_id = $1 AND insights_id = ANY($2::text[])`,
    [projectId, ids]
  );
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.insights_id || !r.id) continue;
    out.set(r.insights_id, r.id);
  }
  return out;
}

/**
 * After evidence rows are rated (signal-pack build), copy rating snapshots onto top_performer_* insight rows.
 */
export async function backfillTopPerformerInsightPerformanceReviews(
  db: Pool,
  projectId: string,
  importId: string
): Promise<number> {
  const r = await db.query(
    `UPDATE caf_core.inputs_evidence_row_insights i
        SET evidence_performance_review_json = jsonb_strip_nulls(
             jsonb_build_object(
               'version', 1,
               'rating_score', r.rating_score,
               'rating_components_json', COALESCE(r.rating_components_json, '{}'::jsonb),
               'rating_rationale', r.rating_rationale,
               'rated_at', r.rated_at,
               'source', 'inputs_evidence_row'
             )
           ),
        updated_at = now()
       FROM caf_core.inputs_evidence_rows r
      WHERE r.id = i.source_evidence_row_id
        AND r.import_id = i.inputs_import_id
        AND r.project_id = i.project_id
        AND i.project_id = $1
        AND i.inputs_import_id = $2
        AND i.analysis_tier = ANY(ARRAY['top_performer_deep','top_performer_video','top_performer_carousel']::text[])
        AND r.rating_score IS NOT NULL`,
    [projectId, importId]
  );
  return r.rowCount ?? 0;
}

export interface InsightRefForEvidence {
  id: string;
  insights_id: string;
  analysis_tier: EvidenceInsightTier;
  title: string | null;
}

/** Lightweight links from one evidence row to all insight rows (traceability). */
export async function listInsightRefsForEvidenceRow(
  db: Pool,
  projectId: string,
  evidenceRowId: string
): Promise<InsightRefForEvidence[]> {
  const rid = String(evidenceRowId ?? "").trim();
  if (!/^\d+$/.test(rid)) return [];
  return q(
    db,
    `SELECT i.id::text,
            i.insights_id,
            i.analysis_tier,
            COALESCE(NULLIF(trim(i.hook_text),''), NULLIF(trim(i.hook_type),''), NULLIF(trim(i.primary_emotion),''), LEFT(COALESCE(i.why_it_worked,''),120)) AS title
       FROM caf_core.inputs_evidence_row_insights i
      WHERE i.project_id = $1 AND i.source_evidence_row_id = $2::bigint
      ORDER BY i.updated_at DESC`,
    [projectId, rid]
  );
}

export async function getEvidenceRowInsightById(
  db: Pool,
  projectId: string,
  insightRowId: string
): Promise<(EvidenceRowInsightEnrichedRow & { evidence_payload_json?: Record<string, unknown> }) | null> {
  const id = String(insightRowId ?? "").trim();
  if (!/^\d+$/.test(id)) return null;
  return qOne(
    db,
    `${INSIGHT_SELECT_ENRICHED_WITH_PAYLOAD}
     ${INSIGHT_JOIN}
     WHERE i.project_id = $1 AND i.id = $2::bigint`,
    [projectId, id]
  );
}

/** Full vision row for a single top-performer insight (mimic per-job grounding at plan time). */
export async function getEvidenceRowInsightByInsightsId(
  db: Pool,
  projectId: string,
  insightsId: string
): Promise<EvidenceRowInsightRow | null> {
  const iid = String(insightsId ?? "").trim();
  if (!iid) return null;
  return qOne(
    db,
    `SELECT id::text, project_id::text, inputs_import_id::text, source_evidence_row_id::text, insights_id, analysis_tier,
            pre_llm_score::text, llm_model,
            why_it_worked, primary_emotion, secondary_emotion, hook_type,
            custom_label_1, custom_label_2, custom_label_3,
            cta_type, hashtags, caption_style, hook_text,
            risk_flags_json, aesthetic_analysis_json, raw_llm_json, stored_inspection_media_json,
            evidence_performance_review_json,
            created_at::text, updated_at::text
       FROM caf_core.inputs_evidence_row_insights
      WHERE project_id = $1 AND insights_id = $2
      ORDER BY updated_at DESC
      LIMIT 1`,
    [projectId, iid]
  );
}
