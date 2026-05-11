import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface CreativeSourceAssetRow {
  id: string;
  project_id: string;
  source_type: string;
  external_source_id: string | null;
  source_url: string | null;
  platform: string | null;
  media_type: string;
  asset_role: string;
  asset_url: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_sec: string | null;
  position_index: number;
  performance_metrics_json: Record<string, unknown>;
  source_metadata_json: Record<string, unknown>;
  source_group_id: string;
  ingest_batch_id: string | null;
  provenance_json: Record<string, unknown>;
  created_at: string;
}

export interface CreativeVisualAnalysisRow {
  id: string;
  project_id: string;
  source_asset_id: string | null;
  source_group_id: string | null;
  analysis_model: string | null;
  analysis_version: string;
  media_type: string | null;
  analysis_status: string;
  visual_summary: string | null;
  style_tags_json: unknown[];
  layout_json: Record<string, unknown> | null;
  color_palette_json: Record<string, unknown> | null;
  typography_json: Record<string, unknown> | null;
  composition_json: Record<string, unknown> | null;
  motion_json: Record<string, unknown> | null;
  editing_json: Record<string, unknown> | null;
  hook_visual_pattern: string | null;
  text_overlay_json: Record<string, unknown> | null;
  design_pattern: string | null;
  mimicry_notes: string | null;
  generation_guidance: string | null;
  confidence: string | null;
  raw_model_output_json: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
}

export interface CreativeInsightRow {
  id: string;
  project_id: string;
  insight_ref: string;
  scope_platform: string | null;
  scope_media_type: string | null;
  scope_content_format: string | null;
  insight_type: string;
  title: string;
  summary: string | null;
  guidance: string | null;
  evidence_asset_ids_json: unknown[];
  evidence_analysis_ids_json: unknown[];
  evidence_source_urls_json: unknown[];
  support_count: number;
  confidence: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function insertCreativeSourceAsset(
  db: Pool,
  row: {
    project_id: string;
    source_type: string;
    external_source_id?: string | null;
    source_url?: string | null;
    platform?: string | null;
    media_type: string;
    asset_role: string;
    asset_url?: string | null;
    storage_bucket?: string | null;
    storage_key?: string | null;
    mime_type?: string | null;
    width?: number | null;
    height?: number | null;
    duration_sec?: number | null;
    position_index?: number;
    performance_metrics_json?: Record<string, unknown>;
    source_metadata_json?: Record<string, unknown>;
    source_group_id: string;
    ingest_batch_id?: string | null;
    provenance_json?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const r = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.creative_source_assets (
       project_id, source_type, external_source_id, source_url, platform, media_type, asset_role,
       asset_url, storage_bucket, storage_key, mime_type, width, height, duration_sec, position_index,
       performance_metrics_json, source_metadata_json, source_group_id, ingest_batch_id, provenance_json
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19,$20::jsonb
     ) RETURNING id`,
    [
      row.project_id,
      row.source_type,
      row.external_source_id ?? null,
      row.source_url ?? null,
      row.platform ?? null,
      row.media_type,
      row.asset_role,
      row.asset_url ?? null,
      row.storage_bucket ?? null,
      row.storage_key ?? null,
      row.mime_type ?? null,
      row.width ?? null,
      row.height ?? null,
      row.duration_sec ?? null,
      row.position_index ?? 0,
      JSON.stringify(row.performance_metrics_json ?? {}),
      JSON.stringify(row.source_metadata_json ?? {}),
      row.source_group_id,
      row.ingest_batch_id ?? null,
      JSON.stringify(row.provenance_json ?? {}),
    ]
  );
  if (!r) throw new Error("insertCreativeSourceAsset failed");
  return r;
}

export async function listCreativeSourceAssets(
  db: Pool,
  projectId: string,
  opts?: { limit?: number; source_group_id?: string | null }
): Promise<CreativeSourceAssetRow[]> {
  const lim = Math.min(Math.max(opts?.limit ?? 80, 1), 500);
  if (opts?.source_group_id) {
    return q<CreativeSourceAssetRow>(
      db,
      `SELECT * FROM caf_core.creative_source_assets
       WHERE project_id = $1 AND source_group_id = $2::uuid
       ORDER BY position_index ASC, created_at ASC
       LIMIT $3`,
      [projectId, opts.source_group_id, lim]
    );
  }
  return q<CreativeSourceAssetRow>(
    db,
    `SELECT * FROM caf_core.creative_source_assets
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [projectId, lim]
  );
}

export async function insertCreativeVisualAnalysis(
  db: Pool,
  row: {
    project_id: string;
    source_asset_id?: string | null;
    source_group_id?: string | null;
    analysis_model?: string | null;
    analysis_version?: string;
    media_type?: string | null;
    analysis_status?: string;
    visual_summary?: string | null;
    style_tags_json?: unknown[];
    layout_json?: Record<string, unknown> | null;
    color_palette_json?: Record<string, unknown> | null;
    typography_json?: Record<string, unknown> | null;
    composition_json?: Record<string, unknown> | null;
    motion_json?: Record<string, unknown> | null;
    editing_json?: Record<string, unknown> | null;
    hook_visual_pattern?: string | null;
    text_overlay_json?: Record<string, unknown> | null;
    design_pattern?: string | null;
    mimicry_notes?: string | null;
    generation_guidance?: string | null;
    confidence?: number | null;
    raw_model_output_json?: Record<string, unknown> | null;
    error_message?: string | null;
  }
): Promise<{ id: string }> {
  const r = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.creative_visual_analyses (
       project_id, source_asset_id, source_group_id, analysis_model, analysis_version, media_type, analysis_status,
       visual_summary, style_tags_json, layout_json, color_palette_json, typography_json, composition_json,
       motion_json, editing_json, hook_visual_pattern, text_overlay_json, design_pattern, mimicry_notes,
       generation_guidance, confidence, raw_model_output_json, error_message
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,
       $16,$17::jsonb,$18,$19,$20,$21,$22::jsonb,$23
     ) RETURNING id`,
    [
      row.project_id,
      row.source_asset_id ?? null,
      row.source_group_id ?? null,
      row.analysis_model ?? null,
      row.analysis_version ?? "1",
      row.media_type ?? null,
      row.analysis_status ?? "pending",
      row.visual_summary ?? null,
      JSON.stringify(row.style_tags_json ?? []),
      row.layout_json ? JSON.stringify(row.layout_json) : null,
      row.color_palette_json ? JSON.stringify(row.color_palette_json) : null,
      row.typography_json ? JSON.stringify(row.typography_json) : null,
      row.composition_json ? JSON.stringify(row.composition_json) : null,
      row.motion_json ? JSON.stringify(row.motion_json) : null,
      row.editing_json ? JSON.stringify(row.editing_json) : null,
      row.hook_visual_pattern ?? null,
      row.text_overlay_json ? JSON.stringify(row.text_overlay_json) : null,
      row.design_pattern ?? null,
      row.mimicry_notes ?? null,
      row.generation_guidance ?? null,
      row.confidence ?? null,
      row.raw_model_output_json ? JSON.stringify(row.raw_model_output_json) : null,
      row.error_message ?? null,
    ]
  );
  if (!r) throw new Error("insertCreativeVisualAnalysis failed");
  return r;
}

export async function updateCreativeVisualAnalysis(
  db: Pool,
  id: string,
  patch: Partial<{
    analysis_status: string;
    visual_summary: string | null;
    style_tags_json: unknown[];
    layout_json: Record<string, unknown> | null;
    color_palette_json: Record<string, unknown> | null;
    typography_json: Record<string, unknown> | null;
    composition_json: Record<string, unknown> | null;
    motion_json: Record<string, unknown> | null;
    editing_json: Record<string, unknown> | null;
    hook_visual_pattern: string | null;
    text_overlay_json: Record<string, unknown> | null;
    design_pattern: string | null;
    mimicry_notes: string | null;
    generation_guidance: string | null;
    confidence: number | null;
    raw_model_output_json: Record<string, unknown> | null;
    error_message: string | null;
  }>
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let p = 1;
  const add = (col: string, v: unknown) => {
    sets.push(`${col} = $${p++}`);
    vals.push(v);
  };
  if (patch.analysis_status != null) add("analysis_status", patch.analysis_status);
  if (patch.visual_summary !== undefined) add("visual_summary", patch.visual_summary);
  if (patch.style_tags_json !== undefined) add("style_tags_json", JSON.stringify(patch.style_tags_json));
  if (patch.layout_json !== undefined) add("layout_json", patch.layout_json ? JSON.stringify(patch.layout_json) : null);
  if (patch.color_palette_json !== undefined)
    add("color_palette_json", patch.color_palette_json ? JSON.stringify(patch.color_palette_json) : null);
  if (patch.typography_json !== undefined)
    add("typography_json", patch.typography_json ? JSON.stringify(patch.typography_json) : null);
  if (patch.composition_json !== undefined)
    add("composition_json", patch.composition_json ? JSON.stringify(patch.composition_json) : null);
  if (patch.motion_json !== undefined) add("motion_json", patch.motion_json ? JSON.stringify(patch.motion_json) : null);
  if (patch.editing_json !== undefined) add("editing_json", patch.editing_json ? JSON.stringify(patch.editing_json) : null);
  if (patch.hook_visual_pattern !== undefined) add("hook_visual_pattern", patch.hook_visual_pattern);
  if (patch.text_overlay_json !== undefined)
    add("text_overlay_json", patch.text_overlay_json ? JSON.stringify(patch.text_overlay_json) : null);
  if (patch.design_pattern !== undefined) add("design_pattern", patch.design_pattern);
  if (patch.mimicry_notes !== undefined) add("mimicry_notes", patch.mimicry_notes);
  if (patch.generation_guidance !== undefined) add("generation_guidance", patch.generation_guidance);
  if (patch.confidence !== undefined) add("confidence", patch.confidence);
  if (patch.raw_model_output_json !== undefined)
    add("raw_model_output_json", patch.raw_model_output_json ? JSON.stringify(patch.raw_model_output_json) : null);
  if (patch.error_message !== undefined) add("error_message", patch.error_message);
  if (sets.length === 0) return;
  vals.push(id);
  await db.query(
    `UPDATE caf_core.creative_visual_analyses SET ${sets.join(", ")} WHERE id = $${p}::uuid`,
    vals
  );
}

export async function listCreativeVisualAnalyses(
  db: Pool,
  projectId: string,
  opts?: { limit?: number; status?: string | null; platform?: string | null }
): Promise<CreativeVisualAnalysisRow[]> {
  const lim = Math.min(Math.max(opts?.limit ?? 80, 1), 500);
  const st = opts?.status?.trim();
  if (st) {
    return q<CreativeVisualAnalysisRow>(
      db,
      `SELECT * FROM caf_core.creative_visual_analyses
       WHERE project_id = $1 AND analysis_status = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [projectId, st, lim]
    );
  }
  return q<CreativeVisualAnalysisRow>(
    db,
    `SELECT * FROM caf_core.creative_visual_analyses
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [projectId, lim]
  );
}

export async function getCreativeVisualAnalysis(
  db: Pool,
  projectId: string,
  id: string
): Promise<CreativeVisualAnalysisRow | null> {
  return qOne<CreativeVisualAnalysisRow>(
    db,
    `SELECT * FROM caf_core.creative_visual_analyses WHERE project_id = $1 AND id = $2::uuid`,
    [projectId, id]
  );
}

export async function insertCreativeInsight(
  db: Pool,
  row: {
    project_id: string;
    insight_ref: string;
    scope_platform?: string | null;
    scope_media_type?: string | null;
    scope_content_format?: string | null;
    insight_type: string;
    title: string;
    summary?: string | null;
    guidance?: string | null;
    evidence_asset_ids_json?: unknown[];
    evidence_analysis_ids_json?: unknown[];
    evidence_source_urls_json?: unknown[];
    support_count?: number;
    confidence?: number | null;
    status?: string;
  }
): Promise<{ id: string }> {
  const r = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.creative_insights (
       project_id, insight_ref, scope_platform, scope_media_type, scope_content_format, insight_type,
       title, summary, guidance, evidence_asset_ids_json, evidence_analysis_ids_json, evidence_source_urls_json,
       support_count, confidence, status
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15
     )
     ON CONFLICT (project_id, insight_ref) DO UPDATE SET
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       guidance = EXCLUDED.guidance,
       evidence_asset_ids_json = EXCLUDED.evidence_asset_ids_json,
       evidence_analysis_ids_json = EXCLUDED.evidence_analysis_ids_json,
       evidence_source_urls_json = EXCLUDED.evidence_source_urls_json,
       support_count = EXCLUDED.support_count,
       confidence = EXCLUDED.confidence,
       status = EXCLUDED.status,
       updated_at = now()
     RETURNING id`,
    [
      row.project_id,
      row.insight_ref,
      row.scope_platform ?? null,
      row.scope_media_type ?? null,
      row.scope_content_format ?? null,
      row.insight_type,
      row.title,
      row.summary ?? null,
      row.guidance ?? null,
      JSON.stringify(row.evidence_asset_ids_json ?? []),
      JSON.stringify(row.evidence_analysis_ids_json ?? []),
      JSON.stringify(row.evidence_source_urls_json ?? []),
      row.support_count ?? 1,
      row.confidence ?? null,
      row.status ?? "active",
    ]
  );
  if (!r) throw new Error("insertCreativeInsight failed");
  return r;
}

export async function listCreativeInsights(
  db: Pool,
  projectId: string,
  opts?: { limit?: number; status?: string | null }
): Promise<CreativeInsightRow[]> {
  const lim = Math.min(Math.max(opts?.limit ?? 80, 1), 500);
  const st = opts?.status?.trim();
  if (st) {
    return q<CreativeInsightRow>(
      db,
      `SELECT * FROM caf_core.creative_insights
       WHERE project_id = $1 AND status = $2
       ORDER BY updated_at DESC
       LIMIT $3`,
      [projectId, st, lim]
    );
  }
  return q<CreativeInsightRow>(
    db,
    `SELECT * FROM caf_core.creative_insights
     WHERE project_id = $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [projectId, lim]
  );
}

export async function getCreativeInsightByRef(
  db: Pool,
  projectId: string,
  insightRef: string
): Promise<CreativeInsightRow | null> {
  return qOne<CreativeInsightRow>(
    db,
    `SELECT * FROM caf_core.creative_insights WHERE project_id = $1 AND insight_ref = $2`,
    [projectId, insightRef]
  );
}

export async function getCreativeInsight(
  db: Pool,
  projectId: string,
  id: string
): Promise<CreativeInsightRow | null> {
  return qOne<CreativeInsightRow>(
    db,
    `SELECT * FROM caf_core.creative_insights WHERE project_id = $1 AND id = $2::uuid`,
    [projectId, id]
  );
}

/** Set carousel template on job generation_payload (mirrors job-pipeline render keys). */
export async function applyCarouselTemplateToContentJob(
  db: Pool,
  projectId: string,
  taskId: string,
  templateBaseName: string
): Promise<boolean> {
  const base = templateBaseName.replace(/\.hbs$/i, "").trim();
  if (!base) return false;
  const htmlName = `${base}.hbs`;
  const { rowCount } = await db.query(
    `UPDATE caf_core.content_jobs SET
      generation_payload = jsonb_set(
        jsonb_set(
          COALESCE(generation_payload, '{}'::jsonb),
          '{template}', to_jsonb($3::text), true
        ),
        '{generated_output}',
        COALESCE(generation_payload->'generated_output', '{}'::jsonb)
          || jsonb_build_object(
               'render',
               COALESCE(generation_payload->'generated_output'->'render', '{}'::jsonb)
                 || jsonb_build_object(
                      'html_template_name', to_jsonb($4::text),
                      'template_key', to_jsonb($3::text)
                    )
             ),
        true
      ),
      updated_at = now()
     WHERE project_id = $1::uuid AND task_id = $2`,
    [projectId, taskId, base, htmlName]
  );
  return (rowCount ?? 0) > 0;
}

export async function insertCreativeCarouselMimicTemplate(
  db: Pool,
  row: {
    project_id: string;
    creative_insight_id?: string | null;
    source_group_id?: string | null;
    template_file_name: string;
    hbs_source: string;
    metadata_json?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const r = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.creative_carousel_mimic_templates (
       project_id, creative_insight_id, source_group_id, template_file_name, hbs_source, metadata_json
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT (project_id, template_file_name) DO UPDATE SET
       hbs_source = EXCLUDED.hbs_source,
       creative_insight_id = EXCLUDED.creative_insight_id,
       source_group_id = EXCLUDED.source_group_id,
       metadata_json = EXCLUDED.metadata_json
     RETURNING id`,
    [
      row.project_id,
      row.creative_insight_id ?? null,
      row.source_group_id ?? null,
      row.template_file_name,
      row.hbs_source,
      JSON.stringify(row.metadata_json ?? {}),
    ]
  );
  if (!r) throw new Error("insertCreativeCarouselMimicTemplate failed");
  return r;
}
