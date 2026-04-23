/**
 * Phase 2 "top performer" pass: **image-only** vision analysis (no TikTok / no video URLs / no reels).
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { ensureProject } from "../repositories/core.js";
import {
  countEvidenceRowInsightsByImportTier,
  listEvidenceRowInsightIdsByImportTier,
  upsertEvidenceRowInsight,
} from "../repositories/inputs-evidence-insights.js";
import { getInputsEvidenceImport } from "../repositories/inputs-evidence.js";
import { listEvidenceRowsForPreLlmScoring } from "../repositories/inputs-evidence.js";
import { getInputsProcessingProfile, upsertInputsProcessingProfile } from "../repositories/inputs-processing-profile.js";
import { openaiChatMultimodal } from "./openai-chat-multimodal.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { evaluatePreLlmRow } from "./inputs-pre-llm-rank.js";
import { summarizePayloadForLlm } from "./inputs-evidence-display.js";
import { isVideoLikeEvidence, pickPrimaryImageUrlForDeepAnalysis } from "./inputs-image-url-for-analysis.js";
import { isCarouselDeepEligible } from "./inputs-carousel-evidence-bundle.js";

const STEP = "inputs_top_performer_image_insight";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export interface RunDeepImageInsightsOptions {
  max_rows?: number;
  min_pre_llm_score?: number;
  rescan?: boolean;
}

export interface RunDeepImageInsightsResult {
  import_id: string;
  model: string;
  rows_scanned: number;
  candidates_with_image: number;
  rows_analyzed: number;
  skipped_no_image: number;
  skipped_video: number;
  /** Multi-slide carousels use `top_performer_carousel` instead of single-image deep. */
  skipped_carousel: number;
  deep_insights_total: number;
}

function deepModel(profile: { synth_model: string; criteria_json: Record<string, unknown> }): string {
  const raw = profile.criteria_json?.inputs_insights;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const m = String((raw as Record<string, unknown>).deep_image_model ?? "").trim();
    if (m) return m;
  }
  return profile.synth_model || "gpt-4o-mini";
}

function deepMaxRows(criteria: Record<string, unknown>, override?: number): number {
  if (override != null && Number.isFinite(override)) return clamp(override, 1, 80);
  const ins = criteria.inputs_insights;
  if (ins && typeof ins === "object" && !Array.isArray(ins)) {
    const n = parseInt(String((ins as Record<string, unknown>).deep_image_max ?? ""), 10);
    if (!Number.isNaN(n)) return clamp(n, 1, 80);
  }
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const n = parseInt(String((tp as Record<string, unknown>).max_rows ?? ""), 10);
    if (!Number.isNaN(n)) return clamp(n, 1, 80);
  }
  return 24;
}

function deepMinPreLlm(criteria: Record<string, unknown>, override?: number): number {
  if (override != null && Number.isFinite(override)) return clamp(override, 0, 1);
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const n = parseFloat(String((tp as Record<string, unknown>).pre_llm_min_score ?? ""));
    if (!Number.isNaN(n)) return clamp(n, 0, 1);
  }
  return 0.35;
}

function makeDeepInsightsId(importId: string, rowId: string): string {
  return `ins_${importId.replace(/-/g, "").slice(0, 10)}_${rowId}_deep`;
}

function parseRiskFlags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
}

export async function runDeepImageInsightsForImport(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  importId: string,
  opts: RunDeepImageInsightsOptions = {}
): Promise<RunDeepImageInsightsResult> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for image insights");

  const project = await ensureProject(db, projectSlug);
  const imp = await getInputsEvidenceImport(db, project.id, importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);

  let profile = await getInputsProcessingProfile(db, project.id);
  if (!profile) {
    profile = await upsertInputsProcessingProfile(db, project.id, {});
  }
  const criteria = (profile.criteria_json ?? {}) as Record<string, unknown>;
  const model = deepModel(profile);
  const minPre = deepMinPreLlm(criteria, opts.min_pre_llm_score);
  const maxRows = deepMaxRows(criteria, opts.max_rows);

  const existingDeep = opts.rescan ? new Set<string>() : await listEvidenceRowInsightIdsByImportTier(db, importId, "top_performer_deep");

  const dbRows = await listEvidenceRowsForPreLlmScoring(db, project.id, importId, 12_000);

  type Cand = {
    id: string;
    evidence_kind: string;
    payload: Record<string, unknown>;
    pre_llm_score: number;
    image_url: string;
  };
  const pool: Cand[] = [];
  let skippedVideo = 0;
  let skippedNoImage = 0;
  let skippedCarousel = 0;

  for (const r of dbRows) {
    if (r.evidence_kind === "tiktok_video") {
      skippedVideo++;
      continue;
    }
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    if (isVideoLikeEvidence(r.evidence_kind, payload)) {
      skippedVideo++;
      continue;
    }
    if (isCarouselDeepEligible(payload, 12)) {
      skippedCarousel++;
      continue;
    }
    const ev = evaluatePreLlmRow(r.evidence_kind, payload, criteria);
    if (ev.dropped_reason != null) continue;
    if (ev.pre_llm_score < minPre) continue;
    const imageUrl = pickPrimaryImageUrlForDeepAnalysis(r.evidence_kind, payload);
    if (!imageUrl) {
      skippedNoImage++;
      continue;
    }
    if (existingDeep.has(r.id)) continue;
    pool.push({ id: r.id, evidence_kind: r.evidence_kind, payload, pre_llm_score: ev.pre_llm_score, image_url: imageUrl });
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
    const textBundle = summarizePayloadForLlm(c.evidence_kind, c.payload, 2500);
    const system = `You analyze a **single static image** from social marketing evidence (no video, no audio).
Return ONLY valid JSON:
{
  "palette": ["#RRGGBB or colour names"],
  "typography": "fonts / text style if readable",
  "layout": "composition notes",
  "on_screen_text": "verbatim short text on image if any",
  "style_summary": "overall aesthetic in 2-4 sentences",
  "hook_text": "short hook implied by creative if any",
  "caption_style": "how caption would pair visually (short)",
  "risk_flags": ["string"],
  "why_it_worked": "why this visual might perform (short)"
}
Be conservative: if unreadable, use empty strings / empty arrays.`;

    const userText = `Evidence kind: ${c.evidence_kind}\nPre-LLM score: ${c.pre_llm_score}\nContext:\n${textBundle}`;

    const out = await openaiChatMultimodal(
      apiKey,
      {
        model,
        system_prompt: system,
        user_content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: c.image_url, detail: "low" } },
        ],
        max_tokens: 4096,
        response_format: "json_object",
      },
      { ...auditBase, step: STEP }
    );

    const parsed = parseJsonObjectFromLlmText(out.content) as Record<string, unknown> | null;
    const aesthetic: Record<string, unknown> = parsed
      ? {
          palette: parsed.palette,
          typography: parsed.typography,
          layout: parsed.layout,
          on_screen_text: parsed.on_screen_text,
          style_summary: parsed.style_summary,
        }
      : {};

    const risks = parseRiskFlags(parsed?.risk_flags);

    await upsertEvidenceRowInsight(db, {
      project_id: project.id,
      inputs_import_id: importId,
      source_evidence_row_id: c.id,
      insights_id: makeDeepInsightsId(importId, c.id),
      analysis_tier: "top_performer_deep",
      pre_llm_score: c.pre_llm_score,
      llm_model: out.model || model,
      why_it_worked: typeof parsed?.why_it_worked === "string" ? parsed.why_it_worked : null,
      primary_emotion: null,
      secondary_emotion: null,
      hook_type: null,
      custom_label_1: null,
      custom_label_2: null,
      custom_label_3: null,
      cta_type: null,
      hashtags: null,
      caption_style: typeof parsed?.caption_style === "string" ? parsed.caption_style : null,
      hook_text: typeof parsed?.hook_text === "string" ? parsed.hook_text : null,
      risk_flags_json: risks,
      aesthetic_analysis_json: aesthetic,
      raw_llm_json: parsed,
    });
    analyzed++;
  }

  const deepTotal = await countEvidenceRowInsightsByImportTier(db, importId, "top_performer_deep");

  return {
    import_id: importId,
    model,
    rows_scanned: dbRows.length,
    candidates_with_image: pool.length,
    rows_analyzed: analyzed,
    skipped_no_image: skippedNoImage,
    skipped_video: skippedVideo,
    skipped_carousel: skippedCarousel,
    deep_insights_total: deepTotal,
  };
}
