import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface SignalPackRow {
  id: string;
  run_id: string;
  project_id: string;
  source_window: string | null;
  /** Planner-facing rows (synth / XLSX); see `ideas_json` for insight-backed ideas. */
  overall_candidates_json: unknown[];
  /** Curated ideas from inputs Processing; preferred at run start when non-empty. */
  ideas_json?: unknown[] | null;
  /**
   * Deprecated. Kept for backward compatibility with one iteration where we introduced a parallel rich idea list.
   * Do not write new data here — use `ideas_json` as the canonical rich idea contract.
   */
  ideas_v2_json?: unknown[] | null;
  /** Ordered list of selected idea IDs (stage 4). */
  selected_idea_ids_json?: unknown[] | null;
  /** Optional link to a specific inputs idea list used to build this pack. */
  source_inputs_idea_list_id?: string | null;
  ig_summary_json: unknown | null;
  tiktok_summary_json: unknown | null;
  reddit_summary_json: unknown | null;
  fb_summary_json: unknown | null;
  html_summary_json: unknown | null;
  ig_archetypes_json: unknown | null;
  ig_7day_plan_json: unknown | null;
  ig_top_examples_json: unknown | null;
  tiktok_archetypes_json: unknown | null;
  tiktok_7day_plan_json: unknown | null;
  tiktok_top_examples_json: unknown | null;
  reddit_archetypes_json: unknown | null;
  reddit_top_examples_json: unknown | null;
  html_findings_raw_json: unknown | null;
  reddit_subreddit_insights_json: unknown | null;
  derived_globals_json: Record<string, unknown>;
  upload_filename: string | null;
  notes: string | null;
  source_inputs_import_id?: string | null;
  created_at: string;
}

export async function insertSignalPack(
  db: Pool,
  data: {
    run_id: string;
    project_id: string;
    source_window?: string | null;
    overall_candidates_json: unknown[];
    ideas_json?: unknown[];
    ideas_v2_json?: unknown[];
    selected_idea_ids_json?: unknown[];
    source_inputs_idea_list_id?: string | null;
    ig_summary_json?: unknown;
    tiktok_summary_json?: unknown;
    reddit_summary_json?: unknown;
    fb_summary_json?: unknown;
    html_summary_json?: unknown;
    ig_archetypes_json?: unknown;
    ig_7day_plan_json?: unknown;
    ig_top_examples_json?: unknown;
    tiktok_archetypes_json?: unknown;
    tiktok_7day_plan_json?: unknown;
    tiktok_top_examples_json?: unknown;
    reddit_archetypes_json?: unknown;
    reddit_top_examples_json?: unknown;
    html_findings_raw_json?: unknown;
    reddit_subreddit_insights_json?: unknown;
    derived_globals_json?: Record<string, unknown>;
    upload_filename?: string | null;
    notes?: string | null;
    source_inputs_import_id?: string | null;
  }
): Promise<{ id: string }> {
  const row = await qOne<{ id: string }>(db, `
    INSERT INTO caf_core.signal_packs (
      run_id, project_id, source_window, overall_candidates_json, ideas_json,
      ideas_v2_json, selected_idea_ids_json,
      source_inputs_idea_list_id,
      ig_summary_json, tiktok_summary_json, reddit_summary_json, fb_summary_json, html_summary_json,
      ig_archetypes_json, ig_7day_plan_json, ig_top_examples_json,
      tiktok_archetypes_json, tiktok_7day_plan_json, tiktok_top_examples_json,
      reddit_archetypes_json, reddit_top_examples_json,
      html_findings_raw_json, reddit_subreddit_insights_json,
      derived_globals_json, upload_filename, notes, source_inputs_import_id
    ) VALUES (
      $1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,
      $8,
      $9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,
      $14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,
      $20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24::jsonb,$25,$26,$27
    ) RETURNING id`,
    [
      data.run_id, data.project_id, data.source_window ?? null,
      JSON.stringify(data.overall_candidates_json),
      JSON.stringify(data.ideas_json ?? []),
      JSON.stringify(data.ideas_v2_json ?? []),
      JSON.stringify(data.selected_idea_ids_json ?? []),
      data.source_inputs_idea_list_id ?? null,
      j(data.ig_summary_json), j(data.tiktok_summary_json),
      j(data.reddit_summary_json), j(data.fb_summary_json), j(data.html_summary_json),
      j(data.ig_archetypes_json), j(data.ig_7day_plan_json), j(data.ig_top_examples_json),
      j(data.tiktok_archetypes_json), j(data.tiktok_7day_plan_json), j(data.tiktok_top_examples_json),
      j(data.reddit_archetypes_json), j(data.reddit_top_examples_json),
      j(data.html_findings_raw_json), j(data.reddit_subreddit_insights_json),
      JSON.stringify(data.derived_globals_json ?? {}),
      data.upload_filename ?? null,
      data.notes ?? null,
      data.source_inputs_import_id ?? null,
    ]);
  if (!row) throw new Error("Failed to insert signal_pack");
  return row;
}

export async function updateSignalPackIdeasV2(
  db: Pool,
  signalPackId: string,
  ideasV2: unknown[]
): Promise<number> {
  const row = await qOne<{ n: string }>(
    db,
    `UPDATE caf_core.signal_packs
        SET ideas_v2_json = $2::jsonb
      WHERE id = $1
      RETURNING 1::text AS n`,
    [signalPackId, JSON.stringify(ideasV2 ?? [])]
  );
  return row ? 1 : 0;
}

export async function updateSignalPackIdeasJson(
  db: Pool,
  signalPackId: string,
  ideas: unknown[]
): Promise<number> {
  const row = await qOne<{ n: string }>(
    db,
    `UPDATE caf_core.signal_packs
        SET ideas_json = $2::jsonb
      WHERE id = $1
      RETURNING 1::text AS n`,
    [signalPackId, JSON.stringify(ideas ?? [])]
  );
  return row ? 1 : 0;
}

export async function updateSignalPackSelectedIdeaIds(
  db: Pool,
  signalPackId: string,
  selectedIdeaIds: string[]
): Promise<number> {
  const row = await qOne<{ n: string }>(
    db,
    `UPDATE caf_core.signal_packs
        SET selected_idea_ids_json = $2::jsonb
      WHERE id = $1
      RETURNING 1::text AS n`,
    [signalPackId, JSON.stringify(selectedIdeaIds ?? [])]
  );
  return row ? 1 : 0;
}

export async function getSignalPackById(db: Pool, id: string): Promise<SignalPackRow | null> {
  return qOne<SignalPackRow>(db, `SELECT * FROM caf_core.signal_packs WHERE id = $1`, [id]);
}

export async function getSignalPackByRunId(db: Pool, projectId: string, runId: string): Promise<SignalPackRow | null> {
  return qOne<SignalPackRow>(db,
    `SELECT * FROM caf_core.signal_packs WHERE project_id = $1 AND run_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [projectId, runId]);
}

export async function listSignalPacks(db: Pool, projectId: string, limit = 50, offset = 0): Promise<SignalPackRow[]> {
  return q<SignalPackRow>(db,
    `SELECT * FROM caf_core.signal_packs WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [projectId, limit, offset]);
}

function j(v: unknown): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}
