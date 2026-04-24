/**
 * Phase 2 broad pass: text-only LLM analysis per evidence row (no images/video).
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { ensureProject } from "../repositories/core.js";
import {
  countEvidenceRowInsightsByImportTier,
  listEvidenceRowInsightIdsByImportTier,
  upsertEvidenceRowInsight,
} from "../repositories/inputs-evidence-insights.js";
import { getInputsProcessingProfile, upsertInputsProcessingProfile } from "../repositories/inputs-processing-profile.js";
import { listEvidenceRowsForPreLlmScoring } from "../repositories/inputs-evidence.js";
import { getInputsEvidenceImport } from "../repositories/inputs-evidence.js";
import { openaiChat } from "./openai-chat.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { evaluatePreLlmRow } from "./inputs-pre-llm-rank.js";
import { summarizePayloadForLlm } from "./inputs-evidence-display.js";

const STEP = "inputs_broad_llm_insights_batch";

export interface RunBroadInsightsOptions {
  evidence_kind?: string | null;
  max_rows?: number;
  rescan?: boolean;
  /** If set, only include rows with pre_llm_score >= this value (in addition to passing profile min + text gate). */
  min_pre_llm_score?: number;
  /** If true, include a debug object in the result for easier troubleshooting. */
  debug?: boolean;
  custom_label_1?: string | null;
  custom_label_2?: string | null;
  custom_label_3?: string | null;
  /**
   * Optional overrides for the OpenAI prompts.
   * - `{{CUSTOM_LABEL_1}}`, `{{CUSTOM_LABEL_2}}`, `{{CUSTOM_LABEL_3}}` are substituted.
   * - `{{ROWS_JSON}}` is substituted with the current batch payload JSON; if omitted, rows JSON is appended.
   */
  system_prompt?: string | null;
  user_prompt?: string | null;
}

export interface RunBroadInsightsResult {
  import_id: string;
  model: string;
  rows_scanned: number;
  rows_eligible_new: number;
  already_had_broad: number;
  rows_sent: number;
  batches: number;
  upserted: number;
  broad_insights_total: number;
  debug?: {
    kind_filter: string | null;
    max_rows: number;
    min_pre_llm_score: number | null;
    rescan: boolean;
    batch_size: number;
    candidates_sample_row_ids: string[];
    batches: Array<{
      batch_index: number;
      chunk_size: number;
      parsed_insights: number;
      matched_row_ids: number;
      upserted: number;
      missing_from_output_sample: string[];
      extra_output_sample: string[];
    }>;
  };
}

export interface BroadInsightsEligibilityEstimate {
  import_id: string;
  model: string;
  rows_scanned: number;
  rows_eligible_new: number;
  already_had_broad: number;
  rows_would_send: number;
}

export interface BroadInsightsPromptPreview {
  model: string;
  batch_size: number;
  kind_filter: string | null;
  labels: { l1: string; l2: string; l3: string };
  system_prompt: string;
  user_prompt: string;
  rows_payload: unknown[];
}

function insightLabels(criteria: Record<string, unknown>): { l1: string; l2: string; l3: string } {
  const raw = criteria.insight_column_labels;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { l1: "", l2: "", l3: "" };
  }
  const o = raw as Record<string, unknown>;
  return {
    l1: String(o.custom_label_1 ?? "").trim(),
    l2: String(o.custom_label_2 ?? "").trim(),
    l3: String(o.custom_label_3 ?? "").trim(),
  };
}

function broadBatchSize(criteria: Record<string, unknown>): number {
  const raw = criteria.inputs_insights;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const n = parseInt(String((raw as Record<string, unknown>).broad_batch_size ?? ""), 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 20) return n;
  }
  return 6;
}

function broadModel(profile: { synth_model: string; criteria_json: Record<string, unknown> }): string {
  const raw = profile.criteria_json?.inputs_insights;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const m = String((raw as Record<string, unknown>).broad_model ?? "").trim();
    if (m) return m;
  }
  return profile.synth_model || "gpt-4o-mini";
}

function makeInsightsId(importId: string, rowId: string): string {
  return `ins_${importId.replace(/-/g, "").slice(0, 10)}_${rowId}_broad`;
}

function parseRiskFlags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
}

function substitutePromptVars(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

function defaultBroadSystemPrompt(): string {
  return `You analyze social/scraper evidence for a marketing content pipeline.
Return ONLY valid JSON with shape:
{"insights":[
  {
    "row_db_id":"string (must match input)",
    "why_it_worked":"string",
    "primary_emotion":"string",
    "secondary_emotion":"string",
    "hook_type":"string",
    "custom_label_1":"string (short; use label meaning if provided)",
    "custom_label_2":"string",
    "custom_label_3":"string",
    "cta_type":"string",
    "hashtags":"string (normalized list or sentence)",
    "caption_style":"string",
    "hook_text":"string (short hook if visible)",
    "risk_flags":["string"]
  }
]}
One object per input row in this batch only. Do not invent row_db_id values.`;
}

function defaultBroadUserPrompt(labels: { l1: string; l2: string; l3: string }, rowsPayload: unknown[]): string {
  return `Custom column label hints (may be empty — still output strings, can be ""):
- custom_label_1: ${labels.l1 || "(none)"}
- custom_label_2: ${labels.l2 || "(none)"}
- custom_label_3: ${labels.l3 || "(none)"}

Rows (JSON):
${JSON.stringify(rowsPayload, null, 0)}`;
}

function resolveLabels(
  criteria: Record<string, unknown>,
  overrides?: { l1?: string | null; l2?: string | null; l3?: string | null }
): { l1: string; l2: string; l3: string } {
  const base = insightLabels(criteria);
  const l1 = (overrides?.l1 ?? "").trim();
  const l2 = (overrides?.l2 ?? "").trim();
  const l3 = (overrides?.l3 ?? "").trim();
  return {
    l1: l1 !== "" ? l1 : base.l1,
    l2: l2 !== "" ? l2 : base.l2,
    l3: l3 !== "" ? l3 : base.l3,
  };
}

function buildBroadPrompts(params: {
  criteria: Record<string, unknown>;
  rowsPayload: unknown[];
  systemOverride?: string | null;
  userOverride?: string | null;
  labelOverrides?: { l1?: string | null; l2?: string | null; l3?: string | null };
}): { labels: { l1: string; l2: string; l3: string }; system: string; user: string } {
  const labels = resolveLabels(params.criteria, params.labelOverrides);
  const rowsJson = JSON.stringify(params.rowsPayload, null, 0);
  const vars = {
    CUSTOM_LABEL_1: labels.l1 || "(none)",
    CUSTOM_LABEL_2: labels.l2 || "(none)",
    CUSTOM_LABEL_3: labels.l3 || "(none)",
    ROWS_JSON: rowsJson,
  };

  const systemRaw = (params.systemOverride ?? "").trim() || defaultBroadSystemPrompt();
  const system = substitutePromptVars(systemRaw, vars);

  const userRaw = (params.userOverride ?? "").trim() || defaultBroadUserPrompt(labels, params.rowsPayload);
  const userSub = substitutePromptVars(userRaw, vars);
  const user = userSub.includes("{{ROWS_JSON}}")
    ? userSub
    : userSub.includes("Rows (JSON):")
      ? userSub
      : `${userSub}\n\nRows (JSON):\n${rowsJson}`;

  return { labels, system, user };
}

export async function previewBroadInsightsPrompt(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  importId: string,
  opts: RunBroadInsightsOptions = {}
): Promise<BroadInsightsPromptPreview> {
  const project = await ensureProject(db, projectSlug);
  const imp = await getInputsEvidenceImport(db, project.id, importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);

  let profile = await getInputsProcessingProfile(db, project.id);
  if (!profile) {
    profile = await upsertInputsProcessingProfile(db, project.id, {});
  }
  const criteria = (profile.criteria_json ?? {}) as Record<string, unknown>;
  const model = broadModel(profile);
  const batchSize = broadBatchSize(criteria);
  const kindFilter = opts.evidence_kind?.trim() || null;

  const dbRows = await listEvidenceRowsForPreLlmScoring(db, project.id, importId, 12_000);
  type Cand = { id: string; evidence_kind: string; payload: Record<string, unknown>; pre_llm_score: number };
  const candidates: Cand[] = [];
  for (const r of dbRows) {
    if (kindFilter && r.evidence_kind !== kindFilter) continue;
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    const ev = evaluatePreLlmRow(r.evidence_kind, payload, criteria);
    if (ev.dropped_reason != null) continue;
    candidates.push({ id: r.id, evidence_kind: r.evidence_kind, payload, pre_llm_score: ev.pre_llm_score });
    if (candidates.length >= batchSize) break;
  }

  const rowsPayload = candidates.map((c) => ({
    row_db_id: c.id,
    evidence_kind: c.evidence_kind,
    pre_llm_score: c.pre_llm_score,
    bundle: summarizePayloadForLlm(c.evidence_kind, c.payload, 4000),
  }));

  const prompts = buildBroadPrompts({
    criteria,
    rowsPayload,
    systemOverride: opts.system_prompt,
    userOverride: opts.user_prompt,
    labelOverrides: {
      l1: opts.custom_label_1,
      l2: opts.custom_label_2,
      l3: opts.custom_label_3,
    },
  });

  return {
    model,
    batch_size: batchSize,
    kind_filter: kindFilter,
    labels: prompts.labels,
    system_prompt: prompts.system,
    user_prompt: prompts.user,
    rows_payload: rowsPayload,
  };
}

export async function runBroadInsightsForImport(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  importId: string,
  opts: RunBroadInsightsOptions = {}
): Promise<RunBroadInsightsResult> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for broad insights");

  const project = await ensureProject(db, projectSlug);
  const imp = await getInputsEvidenceImport(db, project.id, importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);

  let profile = await getInputsProcessingProfile(db, project.id);
  if (!profile) {
    profile = await upsertInputsProcessingProfile(db, project.id, {});
  }
  const criteria = (profile.criteria_json ?? {}) as Record<string, unknown>;
  const model = broadModel(profile);
  const batchSize = broadBatchSize(criteria);
  const maxRows = Math.min(Math.max(opts.max_rows ?? 800, 1), 5000);
  const minPre = typeof opts.min_pre_llm_score === "number" && Number.isFinite(opts.min_pre_llm_score)
    ? Math.max(0, Math.min(1, opts.min_pre_llm_score))
    : null;
  const kindFilter = opts.evidence_kind?.trim() || null;
  const wantDebug = !!opts.debug;

  const existingIds = await listEvidenceRowInsightIdsByImportTier(db, importId, "broad_llm");
  const alreadyHad = existingIds.size;
  const existing = opts.rescan ? new Set<string>() : existingIds;

  const dbRows = await listEvidenceRowsForPreLlmScoring(db, project.id, importId, 12_000);

  type Cand = { id: string; evidence_kind: string; payload: Record<string, unknown>; pre_llm_score: number };
  const candidates: Cand[] = [];
  for (const r of dbRows) {
    if (kindFilter && r.evidence_kind !== kindFilter) continue;
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    const ev = evaluatePreLlmRow(r.evidence_kind, payload, criteria);
    if (ev.dropped_reason != null) continue;
    if (minPre != null && ev.pre_llm_score < minPre) continue;
    if (existing.has(r.id)) continue;
    candidates.push({ id: r.id, evidence_kind: r.evidence_kind, payload, pre_llm_score: ev.pre_llm_score });
    if (candidates.length >= maxRows) break;
  }

  const labelOverrides = {
    l1: opts.custom_label_1,
    l2: opts.custom_label_2,
    l3: opts.custom_label_3,
  };
  let upserted = 0;
  let batches = 0;
  const debugBatches: RunBroadInsightsResult["debug"] extends { batches: infer T } ? T : never = [];

  const auditBase = {
    db,
    projectId: project.id,
    runId: null,
    taskId: null,
    signalPackId: null,
  };

  for (let off = 0; off < candidates.length; off += batchSize) {
    const chunk = candidates.slice(off, off + batchSize);
    if (chunk.length === 0) break;
    batches++;
    const batchIndex = batches;
    const beforeUpsert = upserted;

    const rowsPayload = chunk.map((c) => ({
      row_db_id: c.id,
      evidence_kind: c.evidence_kind,
      pre_llm_score: c.pre_llm_score,
      bundle: summarizePayloadForLlm(c.evidence_kind, c.payload, 4000),
    }));

    const prompts = buildBroadPrompts({
      criteria,
      rowsPayload,
      systemOverride: opts.system_prompt,
      userOverride: opts.user_prompt,
      labelOverrides,
    });

    const out = await openaiChat(
      apiKey,
      {
        model,
        system_prompt: prompts.system,
        user_prompt: prompts.user,
        max_tokens: 8192,
        response_format: "json_object",
      },
      { ...auditBase, step: STEP }
    );

    const parsed = parseJsonObjectFromLlmText(out.content);
    const arr =
      parsed && Array.isArray((parsed as { insights?: unknown }).insights)
        ? ((parsed as { insights: unknown[] }).insights as Record<string, unknown>[])
        : [];

    const byId = new Map(chunk.map((c) => [c.id, c]));
    const expectedIds = new Set(chunk.map((c) => c.id));
    const matchedIds = new Set<string>();
    const extraIds: string[] = [];
    for (const item of arr) {
      const rid = String(item.row_db_id ?? "").trim();
      if (!rid) continue;
      if (!byId.has(rid)) {
        extraIds.push(rid);
        continue;
      }
      const c = byId.get(rid)!;
      matchedIds.add(rid);
      const risks = parseRiskFlags(item.risk_flags);
      await upsertEvidenceRowInsight(db, {
        project_id: project.id,
        inputs_import_id: importId,
        source_evidence_row_id: rid,
        insights_id: makeInsightsId(importId, rid),
        analysis_tier: "broad_llm",
        pre_llm_score: c.pre_llm_score,
        llm_model: model,
        why_it_worked: typeof item.why_it_worked === "string" ? item.why_it_worked : null,
        primary_emotion: typeof item.primary_emotion === "string" ? item.primary_emotion : null,
        secondary_emotion: typeof item.secondary_emotion === "string" ? item.secondary_emotion : null,
        hook_type: typeof item.hook_type === "string" ? item.hook_type : null,
        custom_label_1: typeof item.custom_label_1 === "string" ? item.custom_label_1 : null,
        custom_label_2: typeof item.custom_label_2 === "string" ? item.custom_label_2 : null,
        custom_label_3: typeof item.custom_label_3 === "string" ? item.custom_label_3 : null,
        cta_type: typeof item.cta_type === "string" ? item.cta_type : null,
        hashtags: typeof item.hashtags === "string" ? item.hashtags : null,
        caption_style: typeof item.caption_style === "string" ? item.caption_style : null,
        hook_text: typeof item.hook_text === "string" ? item.hook_text : null,
        risk_flags_json: risks,
        aesthetic_analysis_json: null,
        raw_llm_json: item as Record<string, unknown>,
      });
      upserted++;
    }

    if (wantDebug) {
      const missing: string[] = [];
      for (const id of expectedIds) {
        if (!matchedIds.has(id)) missing.push(id);
      }
      debugBatches.push({
        batch_index: batchIndex,
        chunk_size: chunk.length,
        parsed_insights: arr.length,
        matched_row_ids: matchedIds.size,
        upserted: upserted - beforeUpsert,
        missing_from_output_sample: missing.slice(0, 12),
        extra_output_sample: extraIds.slice(0, 12),
      });
    }
  }

  const broadTotal = await countEvidenceRowInsightsByImportTier(db, importId, "broad_llm");

  return {
    import_id: importId,
    model,
    rows_scanned: dbRows.length,
    rows_eligible_new: candidates.length,
    already_had_broad: alreadyHad,
    rows_sent: candidates.length,
    batches,
    upserted,
    broad_insights_total: broadTotal,
    debug: wantDebug
      ? {
          kind_filter: kindFilter,
          max_rows: maxRows,
          min_pre_llm_score: minPre,
          rescan: !!opts.rescan,
          batch_size: batchSize,
          candidates_sample_row_ids: candidates.slice(0, 24).map((c) => c.id),
          batches: debugBatches,
        }
      : undefined,
  };
}

export async function estimateBroadInsightsForImport(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  importId: string,
  opts: RunBroadInsightsOptions = {}
): Promise<BroadInsightsEligibilityEstimate> {
  const project = await ensureProject(db, projectSlug);
  const imp = await getInputsEvidenceImport(db, project.id, importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);

  let profile = await getInputsProcessingProfile(db, project.id);
  if (!profile) {
    profile = await upsertInputsProcessingProfile(db, project.id, {});
  }
  const criteria = (profile.criteria_json ?? {}) as Record<string, unknown>;
  const model = broadModel(profile);
  const maxRows = Math.min(Math.max(opts.max_rows ?? 800, 1), 5000);
  const minPre =
    typeof opts.min_pre_llm_score === "number" && Number.isFinite(opts.min_pre_llm_score)
      ? Math.max(0, Math.min(1, opts.min_pre_llm_score))
      : null;
  const kindFilter = opts.evidence_kind?.trim() || null;

  const existingIds = await listEvidenceRowInsightIdsByImportTier(db, importId, "broad_llm");
  const alreadyHad = existingIds.size;
  const existing = opts.rescan ? new Set<string>() : existingIds;

  const dbRows = await listEvidenceRowsForPreLlmScoring(db, project.id, importId, 12_000);

  let eligibleNew = 0;
  for (const r of dbRows) {
    if (kindFilter && r.evidence_kind !== kindFilter) continue;
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    const ev = evaluatePreLlmRow(r.evidence_kind, payload, criteria);
    if (ev.dropped_reason != null) continue;
    if (minPre != null && ev.pre_llm_score < minPre) continue;
    if (existing.has(r.id)) continue;
    eligibleNew++;
    if (eligibleNew >= maxRows) break;
  }

  return {
    import_id: importId,
    model,
    rows_scanned: dbRows.length,
    rows_eligible_new: eligibleNew,
    already_had_broad: alreadyHad,
    rows_would_send: eligibleNew,
  };
}
