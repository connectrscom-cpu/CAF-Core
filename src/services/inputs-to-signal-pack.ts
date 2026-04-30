/**
 * Rate scraped / social evidence rows (OpenAI) and synthesize caf_core.signal_packs.overall_candidates_json
 * compatible with run-orchestrator + normalizeOverallCandidateRows.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { ensureProject } from "../repositories/core.js";
import { insertInsightsPack } from "../repositories/insights-packs.js";
import { insertSignalPack } from "../repositories/signal-packs.js";
import {
  getImportEvidenceStats,
  getInputsEvidenceImport,
  listEvidenceRowsByIds,
  listEvidenceRowsForRating,
  listTopRatedRowsForSynth,
  updateEvidenceRowRatingById,
  type EvidenceRowWithRating,
} from "../repositories/inputs-evidence.js";
import { getInputsProcessingProfile, upsertInputsProcessingProfile } from "../repositories/inputs-processing-profile.js";
import { computeInputHealth, flagSparseEvidenceRows, persistImportHealth } from "./input-health.js";
import { buildSelectionSnapshotForImport, persistSelectionSnapshot } from "./inputs-selection.js";
import { mergePreLlmConfig, rankImportRowsForLlm } from "./inputs-pre-llm-rank.js";
import { openaiChat } from "./openai-chat.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { normalizeOverallCandidateRows } from "./signal-pack-parser.js";
import { synthesizeIdeasJsonFromInsightsLlm } from "./ideas-from-insights-llm.js";
import { parseIdeasV2 } from "../domain/signal-pack-ideas-v2.js";
import { upsertIdea, replaceIdeaGroundingInsights } from "../repositories/ideas.js";
import { replaceSignalPackIdeas } from "../repositories/signal-pack-ideas.js";
import { getInsightRowUuidsByInsightsIds } from "../repositories/inputs-evidence-insights.js";
import { computeHashtagLeaderboardForEvidenceImport } from "./hashtag-leaderboard.js";

const STEP_RATING = "inputs_rating_batch";
const STEP_SYNTH = "inputs_signal_pack_synthesize";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function weightMap(criteria: Record<string, unknown>): Record<string, number> {
  const w = criteria.weights;
  if (w && typeof w === "object" && !Array.isArray(w)) {
    const o: Record<string, number> = {};
    for (const [k, v] of Object.entries(w as Record<string, unknown>)) {
      const n = parseFloat(String(v));
      if (!Number.isNaN(n)) o[k] = n;
    }
    if (Object.keys(o).length) return o;
  }
  return {
    engagement_potential: 0.25,
    topic_clarity: 0.25,
    brand_voice_fit: 0.25,
    originality: 0.25,
  };
}

function weightedScore(components: Record<string, unknown>, weights: Record<string, number>): number {
  let sum = 0;
  let wsum = 0;
  for (const [k, wt] of Object.entries(weights)) {
    const raw = components[k];
    const n = parseFloat(String(raw ?? ""));
    if (Number.isNaN(n)) continue;
    sum += clamp(n, 0, 1) * wt;
    wsum += wt;
  }
  if (wsum <= 0) return 0;
  return clamp(sum / wsum, 0, 1);
}

function compactRowPayload(row: EvidenceRowWithRating): string {
  const p = row.payload_json ?? {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = p[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  };
  const text = [
    pick("title", "Title"),
    pick("caption", "body_text", "main_text", "Caption"),
    pick("permalink", "url", "post_url", "Link"),
  ]
    .filter(Boolean)
    .join(" \n ")
    .slice(0, 1200);
  return text || JSON.stringify(p).slice(0, 800);
}

export interface BuildSignalPackFromImportResult {
  signal_pack_id: string;
  pack_run_id: string;
  insights_pack_id: string;
  overall_candidates_count: number;
  ideas_count: number;
  ideas_llm_context_insights: number;
  ideas_llm_top_performer_rows_in_context: number;
  rows_rated: number;
  rows_considered_for_rating: number;
  synth_used_rows: number;
}

/**
 * Rate up to profile.max_rows_for_rating rows, then synthesize overall_candidates_json
 * and insert a new signal_packs row (same JSON shape as XLSX ingest).
 */
export async function buildSignalPackFromEvidenceImport(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  importId: string
): Promise<BuildSignalPackFromImportResult> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to rate evidence and synthesize a signal pack");
  }

  const project = await ensureProject(db, projectSlug);
  let profile = await getInputsProcessingProfile(db, project.id);
  if (!profile) {
    profile = await upsertInputsProcessingProfile(db, project.id, {});
  }

  const criteria = (profile.criteria_json ?? {}) as Record<string, unknown>;
  const weights = weightMap(criteria);
  const maxRate = clamp(profile.max_rows_for_rating, 1, 5000);
  const batchSize = clamp(profile.max_rows_per_llm_batch, 1, 80);
  const maxIdeas = clamp(profile.max_ideas_in_signal_pack, 1, 200);
  const contextInsightCap = clamp(Number(profile.max_insights_for_ideas_llm) || 200, 20, 2000);
  const minTopPerformerInContext = clamp(
    Number(profile.min_top_performer_insights_for_ideas_llm) || 20,
    0,
    contextInsightCap
  );
  const minScore = clamp(parseFloat(String(profile.min_llm_score_for_pack ?? 0.35)), 0, 1);
  const extra = profile.extra_instructions?.trim() || "";
  const ratingModel = profile.rating_model || "gpt-4o-mini";
  const synthModel = profile.synth_model || "gpt-4o-mini";

  const impRow = await getInputsEvidenceImport(db, project.id, importId);
  if (!impRow) throw new Error(`Inputs import not found: ${importId}`);

  const health = await computeInputHealth(
    db,
    project.id,
    importId,
    (impRow.sheet_stats_json ?? {}) as Record<string, unknown>
  );
  await persistImportHealth(db, project.id, importId, health);
  await flagSparseEvidenceRows(db, project.id, importId);

  const preLlmCfg = mergePreLlmConfig(criteria);
  let selectedIds: string[] = [];
  /** Snapshot persisted on the import (cap-based v1 or pre_llm_v1). */
  let selectionSnapshot: Record<string, unknown> | null = null;

  if (preLlmCfg.enabled) {
    const ranked = await rankImportRowsForLlm(db, project.id, importId, criteria, maxRate);
    await persistSelectionSnapshot(db, project.id, importId, ranked.snapshot);
    selectionSnapshot = ranked.snapshot as unknown as Record<string, unknown>;
    selectedIds = ranked.selected_row_ids.map((x) => String(x)).slice(0, maxRate);
  } else {
    let snap: Record<string, unknown> | null =
      impRow.selection_snapshot_json && typeof impRow.selection_snapshot_json === "object"
        ? (impRow.selection_snapshot_json as Record<string, unknown>)
        : null;
    const snapIds = snap?.selected_row_ids;
    if (!snap || !Array.isArray(snapIds) || snapIds.length === 0) {
      const built = await buildSelectionSnapshotForImport(db, project.id, importId);
      await persistSelectionSnapshot(db, project.id, importId, built);
      snap = built as unknown as Record<string, unknown>;
    }
    selectionSnapshot = snap;
    selectedIds = (Array.isArray(snap!.selected_row_ids) ? snap!.selected_row_ids : [])
      .map((x) => String(x))
      .slice(0, maxRate);
  }

  let rows =
    selectedIds.length > 0
      ? await listEvidenceRowsByIds(db, project.id, importId, selectedIds)
      : [];
  if (rows.length === 0) {
    rows = await listEvidenceRowsForRating(db, project.id, importId, maxRate);
  }
  const auditBase = {
    db,
    projectId: project.id,
    runId: null,
    taskId: null,
    signalPackId: null,
  };

  let rated = 0;
  for (let off = 0; off < rows.length; off += batchSize) {
    const chunk = rows.slice(off, off + batchSize);
    const payload = chunk.map((r) => ({
      row_db_id: r.id,
      evidence_kind: r.evidence_kind,
      sheet_name: r.sheet_name,
      text: compactRowPayload(r),
    }));

    const system = `You score social-media and scraped content rows for a marketing content pipeline.
Return ONLY valid JSON with shape:
{"ratings":[{"row_db_id":"string","components":{"engagement_potential":0-1,"topic_clarity":0-1,"brand_voice_fit":0-1,"originality":0-1},"rationale":"short","include_in_pack":boolean}]}
One entry per input row, same order as provided. Be strict about numeric 0-1.`;

    const user = `Weights for overall score (informational; you still output all components 0-1): ${JSON.stringify(weights)}
Project criteria / notes: ${extra || "(none)"}

Rows:
${JSON.stringify(payload, null, 0)}`;

    const out = await openaiChat(
      apiKey,
      {
        model: ratingModel,
        system_prompt: system,
        user_prompt: user,
        max_tokens: 4096,
        response_format: "json_object",
      },
      { ...auditBase, step: STEP_RATING }
    );

    const parsed = parseJsonObjectFromLlmText(out.content);
    const ratings = parsed && Array.isArray((parsed as { ratings?: unknown }).ratings)
      ? ((parsed as { ratings: unknown[] }).ratings as Record<string, unknown>[])
      : [];

    const byId = new Map<string, Record<string, unknown>>();
    for (const r of ratings) {
      const id = String(r.row_db_id ?? "").trim();
      if (id) byId.set(id, r);
    }

    for (const r of chunk) {
      const hit = byId.get(r.id);
      const components = (hit?.components as Record<string, unknown>) ?? {};
      const score = weightedScore(components, weights);
      const rationale = typeof hit?.rationale === "string" ? hit.rationale : null;
      const n = await updateEvidenceRowRatingById(db, r.id, project.id, {
        rating_score: score,
        rating_components_json: components,
        rating_rationale: rationale,
      });
      if (n > 0) rated++;
    }
  }

  let pool = await listTopRatedRowsForSynth(db, project.id, importId, minScore, maxIdeas * 2);
  if (pool.length === 0) {
    pool = await listTopRatedRowsForSynth(db, project.id, importId, 0, Math.min(maxIdeas * 2, 40));
  }

  const synthSlice = pool.slice(0, maxIdeas * 2);
  const synthInput = synthSlice.map((r) => ({
    row_db_id: r.id,
    evidence_kind: r.evidence_kind,
    sheet: r.sheet_name,
    llm_score: parseFloat(String(r.rating_score ?? "0")) || 0,
    components: r.rating_components_json ?? {},
    payload_excerpt: compactRowPayload(r),
  }));

  const synthSystem = `You build overall_candidates_json for CAF Core — the list of content "ideas" that will be multiplied by enabled flow types when a run starts.

Each idea MUST be one object with at least:
- "content_idea": string (hook / idea the creator would post)
- "summary": string (1-2 sentences; can mirror content_idea)
- "platform": string (e.g. Instagram, TikTok, Multi — match the source when obvious)
- "confidence_score": number 0-1 (use the provided llm_score as baseline)
- "novelty_score", "platform_fit", "past_performance": numbers 0-1 (sensible defaults from components if needed)
- "sign": string optional (zodiac / segment if inferable from text, else "")
- "dominant_themes": optional short string
- "evidence_row_ids": array of string ids referencing input rows used (from row_db_id)

Do NOT include markdown. Return ONLY JSON: {"overall_candidates":[...] }
Max ${maxIdeas} objects.`;

  const synthUser = `Synthesize up to ${maxIdeas} strong, non-redundant ideas from these rated evidence rows (higher llm_score first). Merge duplicates.

Rows:
${JSON.stringify(synthInput, null, 0)}`;

  const synthOut = await openaiChat(
    apiKey,
    {
      model: synthModel,
      system_prompt: synthSystem,
      user_prompt: synthUser,
      max_tokens: 8192,
      response_format: "json_object",
    },
    { ...auditBase, step: STEP_SYNTH }
  );

  const synthParsed = parseJsonObjectFromLlmText(synthOut.content);
  const rawList =
    synthParsed && Array.isArray((synthParsed as { overall_candidates?: unknown }).overall_candidates)
      ? ((synthParsed as { overall_candidates: unknown[] }).overall_candidates as unknown[])
      : [];

  const packRunId = `SIG_INPUTS_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${Date.now().toString(36).toUpperCase()}`;
  const normalized = normalizeOverallCandidateRows(rawList, packRunId);

  const ideasLlm = await synthesizeIdeasJsonFromInsightsLlm(db, config, project.id, {
    importId,
    packRunId,
    targetIdeaCount: maxIdeas,
    contextInsightCap,
    minTopPerformerInContext,
    model: synthModel,
    extraInstructions: extra,
  });
  /**
   * `ideas-from-insights-llm` returns a lightweight idea shape used historically for `signal_packs.ideas_json`.
   * We now require the canonical rich idea contract (same as UI POST /signal-packs/:id/ideas).
   */
  const ideasJson = parseIdeasV2(ideasLlm.ideas);
  if (ideasLlm.ideas.length > 0 && ideasJson.length === 0) {
    throw new Error("Ideas-from-insights returned invalid idea contract (expected canonical signal pack ideas)");
  }

  const stats = await getImportEvidenceStats(db, project.id, importId);
  const hashtagStats = await computeHashtagLeaderboardForEvidenceImport(db, project.id, importId, {
    max_rows: 5000,
    limit: 120,
  });
  const derived_globals_json: Record<string, unknown> = {
    from_inputs_evidence_import_id: importId,
    inputs_stats: stats,
    total_candidates: normalized.length,
    ideas_count: ideasJson.length,
    hashtag_leaderboard_v1: hashtagStats.leaderboard,
    hashtag_leaderboard_rows_scanned: hashtagStats.rows_scanned,
    ideas_from_insights_llm: {
      context_insights_used: ideasLlm.context_insights_used,
      top_performer_rows_in_context: ideasLlm.top_performer_rows_in_context,
      target_idea_count: maxIdeas,
      context_cap: contextInsightCap,
      min_top_performer_requested: minTopPerformerInContext,
      model: synthModel,
    },
    platforms_found: [...new Set(normalized.map((c) => c.platform).filter(Boolean))],
    signs_found: [...new Set(normalized.map((c) => c.sign).filter(Boolean))],
    synthesized_at: new Date().toISOString(),
  };

  const pack = await insertSignalPack(db, {
    run_id: packRunId,
    project_id: project.id,
    source_window: null,
    overall_candidates_json: normalized,
    ideas_json: ideasJson,
    ig_summary_json: null,
    tiktok_summary_json: null,
    reddit_summary_json: null,
    fb_summary_json: null,
    html_summary_json: null,
    derived_globals_json,
    upload_filename: `from_inputs_import:${importId}`,
    notes: `Synthesized from inputs evidence import ${importId} (${rated} rows rated).`,
    source_inputs_import_id: importId,
  });

  // Dual-write: persist canonical Ideas + ordered pack links as tables (best-effort; never break pack creation).
  try {
    const insightIds = [
      ...new Set(
        ideasJson
          .flatMap((i) => (Array.isArray(i.grounding_insight_ids) ? i.grounding_insight_ids : []))
          .map((x) => String(x).trim())
          .filter(Boolean)
      ),
    ];
    const insightUuidById = await getInsightRowUuidsByInsightsIds(db, project.id, insightIds);

    const ideaRowIdsOrdered: string[] = [];
    for (let pos = 0; pos < ideasJson.length; pos++) {
      const idea = ideasJson[pos]!;
      const row = await upsertIdea(db, {
        project_id: project.id,
        idea_id: idea.id,
        inputs_import_id: importId,
        run_id: packRunId,
        title: idea.title,
        three_liner: idea.three_liner,
        thesis: idea.thesis,
        who_for: idea.who_for,
        format: String(idea.format ?? "post"),
        platform: String(idea.platform ?? "Multi"),
        why_now: idea.why_now,
        key_points: Array.isArray(idea.key_points) ? idea.key_points : [],
        novelty_angle: idea.novelty_angle,
        cta: idea.cta,
        expected_outcome: idea.expected_outcome,
        risk_flags: Array.isArray(idea.risk_flags) ? idea.risk_flags : [],
        status: idea.status,
        idea_json: idea as unknown as Record<string, unknown>,
      });
      ideaRowIdsOrdered.push(row.id);

      const grounding = Array.isArray(idea.grounding_insight_ids) ? idea.grounding_insight_ids : [];
      const resolved = grounding
        .map((gid) => insightUuidById.get(String(gid).trim()) ?? "")
        .filter(Boolean);
      await replaceIdeaGroundingInsights(db, {
        project_id: project.id,
        idea_row_id: row.id,
        insight_row_ids: resolved,
      });
    }

    await replaceSignalPackIdeas(db, {
      project_id: project.id,
      signal_pack_id: pack.id,
      idea_row_ids_ordered: ideaRowIdsOrdered,
    });
  } catch {
    // non-fatal
  }

  const insights = await insertInsightsPack(db, {
    project_id: project.id,
    inputs_import_id: importId,
    signal_pack_id: pack.id,
    title: `Insights for import ${importId.slice(0, 8)}`,
    body_json: {
      pipeline: "inputs_to_signal_pack_v1",
      input_health: health,
      selection: selectionSnapshot ?? {},
      stats,
      overall_candidates_count: normalized.length,
      ideas_count: ideasJson.length,
      ideas_from_insights_llm: derived_globals_json.ideas_from_insights_llm,
    },
    evidence_refs_json: [
      {
        inputs_import_id: importId,
        selection_row_ids: selectedIds.slice(0, 500),
        synth_pool_row_ids: synthSlice.map((r) => r.id),
      },
    ],
  });

  return {
    signal_pack_id: pack.id,
    pack_run_id: packRunId,
    insights_pack_id: insights.id,
    overall_candidates_count: normalized.length,
    ideas_count: ideasJson.length,
    ideas_llm_context_insights: ideasLlm.context_insights_used,
    ideas_llm_top_performer_rows_in_context: ideasLlm.top_performer_rows_in_context,
    rows_rated: rated,
    rows_considered_for_rating: rows.length,
    synth_used_rows: synthSlice.length,
  };
}
