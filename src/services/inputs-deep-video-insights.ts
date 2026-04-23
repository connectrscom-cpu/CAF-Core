/**
 * Top-performer **video** pass: multimodal on **sampled frame images + transcript** only.
 * Skips rows without `analysis_frame_urls` (or aliases) — no raw MP4 upload to OpenAI from Core.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { ensureProject } from "../repositories/core.js";
import {
  countEvidenceRowInsightsByImportTier,
  listEvidenceRowInsightIdsByImportTier,
  upsertEvidenceRowInsight,
} from "../repositories/inputs-evidence-insights.js";
import { getInputsEvidenceImport, listEvidenceRowsForPreLlmScoring } from "../repositories/inputs-evidence.js";
import { getInputsProcessingProfile, upsertInputsProcessingProfile } from "../repositories/inputs-processing-profile.js";
import { openaiChatMultimodal } from "./openai-chat-multimodal.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { evaluatePreLlmRow } from "./inputs-pre-llm-rank.js";
import { isVideoLikeEvidence } from "./inputs-image-url-for-analysis.js";
import { parseVideoAnalysisFrameUrls, parseVideoAnalysisTranscript } from "./inputs-video-evidence-bundle.js";

const STEP = "inputs_top_performer_video_insight";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export interface RunDeepVideoInsightsOptions {
  max_rows?: number;
  min_pre_llm_score?: number;
  rescan?: boolean;
  max_frames?: number;
}

export interface RunDeepVideoInsightsResult {
  import_id: string;
  model: string;
  rows_scanned: number;
  video_evidence_rows: number;
  candidates_with_frames: number;
  rows_analyzed: number;
  skipped_no_frames: number;
  video_insights_total: number;
}

function videoModel(profile: { synth_model: string; criteria_json: Record<string, unknown> }): string {
  const raw = profile.criteria_json?.inputs_insights;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const m = String((raw as Record<string, unknown>).deep_video_model ?? "").trim();
    if (m) return m;
  }
  return profile.synth_model || "gpt-4o-mini";
}

function videoMaxRows(criteria: Record<string, unknown>, override?: number): number {
  if (override != null && Number.isFinite(override)) return clamp(override, 1, 60);
  const ins = criteria.inputs_insights;
  if (ins && typeof ins === "object" && !Array.isArray(ins)) {
    const n = parseInt(String((ins as Record<string, unknown>).deep_video_max ?? ""), 10);
    if (!Number.isNaN(n)) return clamp(n, 1, 60);
  }
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const n = parseInt(String((tp as Record<string, unknown>).max_video_rows ?? ""), 10);
    if (!Number.isNaN(n)) return clamp(n, 1, 60);
  }
  return 12;
}

function videoMinPreLlm(criteria: Record<string, unknown>, override?: number): number {
  if (override != null && Number.isFinite(override)) return clamp(override, 0, 1);
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const n = parseFloat(String((tp as Record<string, unknown>).pre_llm_min_score_video ?? ""));
    if (!Number.isNaN(n)) return clamp(n, 0, 1);
    const n2 = parseFloat(String((tp as Record<string, unknown>).pre_llm_min_score ?? ""));
    if (!Number.isNaN(n2)) return clamp(n2, 0, 1);
  }
  return 0.4;
}

function makeVideoInsightsId(importId: string, rowId: string): string {
  return `ins_${importId.replace(/-/g, "").slice(0, 10)}_${rowId}_vdeep`;
}

function parseRiskFlags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
}

function isVideoEvidenceRow(kind: string, payload: Record<string, unknown>): boolean {
  if (kind === "tiktok_video") return true;
  return isVideoLikeEvidence(kind, payload);
}

export async function runDeepVideoInsightsForImport(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  importId: string,
  opts: RunDeepVideoInsightsOptions = {}
): Promise<RunDeepVideoInsightsResult> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for video frame insights");

  const project = await ensureProject(db, projectSlug);
  const imp = await getInputsEvidenceImport(db, project.id, importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);

  let profile = await getInputsProcessingProfile(db, project.id);
  if (!profile) {
    profile = await upsertInputsProcessingProfile(db, project.id, {});
  }
  const criteria = (profile.criteria_json ?? {}) as Record<string, unknown>;
  const model = videoModel(profile);
  const minPre = videoMinPreLlm(criteria, opts.min_pre_llm_score);
  const maxRows = videoMaxRows(criteria, opts.max_rows);
  const maxFrames = clamp(opts.max_frames ?? 10, 1, 12);

  const existing = opts.rescan ? new Set<string>() : await listEvidenceRowInsightIdsByImportTier(db, importId, "top_performer_video");

  const dbRows = await listEvidenceRowsForPreLlmScoring(db, project.id, importId, 12_000);

  type Cand = {
    id: string;
    evidence_kind: string;
    payload: Record<string, unknown>;
    pre_llm_score: number;
    frame_urls: string[];
    transcript: string;
  };
  const pool: Cand[] = [];
  let skippedNoFrames = 0;
  let videoEvidenceRows = 0;

  for (const r of dbRows) {
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    if (!isVideoEvidenceRow(r.evidence_kind, payload)) continue;
    videoEvidenceRows++;
    const ev = evaluatePreLlmRow(r.evidence_kind, payload, criteria);
    if (ev.dropped_reason != null) continue;
    if (ev.pre_llm_score < minPre) continue;
    const frameUrls = parseVideoAnalysisFrameUrls(payload, maxFrames);
    if (frameUrls.length === 0) {
      skippedNoFrames++;
      continue;
    }
    if (existing.has(r.id)) continue;
    pool.push({
      id: r.id,
      evidence_kind: r.evidence_kind,
      payload,
      pre_llm_score: ev.pre_llm_score,
      frame_urls: frameUrls,
      transcript: parseVideoAnalysisTranscript(payload),
    });
  }

  pool.sort((a, b) => b.pre_llm_score - a.pre_llm_score);
  const top = pool.slice(0, maxRows);

  const auditBase = {
    db,
    projectId: project.id,
    runId: null,
    taskId: null,
    signalPackId: null,
  };

  let analyzed = 0;
  for (const c of top) {
    const system = `You analyze **sampled static frames** from a short-form video (no audio, no full video playback).
Return ONLY valid JSON:
{
  "hook_visual": "what the opening frames signal",
  "message_clarity": "core message from visuals + transcript",
  "pacing_notes": "inferred from frame sequence only (short)",
  "palette": ["colours"],
  "on_screen_text": "text visible across frames",
  "style_summary": "2-4 sentences on aesthetic / format",
  "format_pattern": "talking head | b-roll | text-on-screen | mixed | unknown",
  "risk_flags": ["string"],
  "why_it_worked": "why this may perform (short)"
}
If transcript is empty, rely on frames only. Be conservative when uncertain.`;

    const userText = `Evidence kind: ${c.evidence_kind}
Pre-LLM score: ${c.pre_llm_score}
Frame count: ${c.frame_urls.length}
Transcript (may be empty):
${c.transcript || "(none)"}`;

    const user_content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
    > = [{ type: "text", text: userText }];
    for (const url of c.frame_urls) {
      user_content.push({ type: "image_url", image_url: { url, detail: "low" } });
    }

    const out = await openaiChatMultimodal(
      apiKey,
      {
        model,
        system_prompt: system,
        user_content,
        max_tokens: 4096,
        response_format: "json_object",
      },
      { ...auditBase, step: STEP }
    );

    const parsed = parseJsonObjectFromLlmText(out.content) as Record<string, unknown> | null;
    const aesthetic: Record<string, unknown> = parsed
      ? {
          hook_visual: parsed.hook_visual,
          message_clarity: parsed.message_clarity,
          pacing_notes: parsed.pacing_notes,
          palette: parsed.palette,
          on_screen_text: parsed.on_screen_text,
          style_summary: parsed.style_summary,
          format_pattern: parsed.format_pattern,
        }
      : {};

    const risks = parseRiskFlags(parsed?.risk_flags);

    await upsertEvidenceRowInsight(db, {
      project_id: project.id,
      inputs_import_id: importId,
      source_evidence_row_id: c.id,
      insights_id: makeVideoInsightsId(importId, c.id),
      analysis_tier: "top_performer_video",
      pre_llm_score: c.pre_llm_score,
      llm_model: out.model || model,
      why_it_worked: typeof parsed?.why_it_worked === "string" ? parsed.why_it_worked : null,
      primary_emotion: null,
      secondary_emotion: null,
      hook_type: typeof parsed?.format_pattern === "string" ? parsed.format_pattern : null,
      custom_label_1: null,
      custom_label_2: null,
      custom_label_3: null,
      cta_type: null,
      hashtags: null,
      caption_style: null,
      hook_text: typeof parsed?.hook_visual === "string" ? parsed.hook_visual : null,
      risk_flags_json: risks,
      aesthetic_analysis_json: aesthetic,
      raw_llm_json: parsed,
    });
    analyzed++;
  }

  const videoTotal = await countEvidenceRowInsightsByImportTier(db, importId, "top_performer_video");

  return {
    import_id: importId,
    model,
    rows_scanned: dbRows.length,
    video_evidence_rows: videoEvidenceRows,
    candidates_with_frames: pool.length,
    rows_analyzed: analyzed,
    skipped_no_frames: skippedNoFrames,
    video_insights_total: videoTotal,
  };
}
