/**
 * Top-performer **carousel** pass: multimodal on **all slide images** (+ caption context).
 * Rows must have ≥2 HTTPS URLs from `parseCarouselSlideUrls`; excludes video/reel rows.
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
import { summarizePayloadForLlm } from "./inputs-evidence-display.js";
import {
  MIN_CAROUSEL_SLIDES_FOR_DEEP,
  parseCarouselCaptionContext,
  parseCarouselSlideUrls,
} from "./inputs-carousel-evidence-bundle.js";

const STEP = "inputs_top_performer_carousel_insight";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export const TOP_PERFORMER_CAROUSEL_SYSTEM_PROMPT = `You analyze a **multi-slide social carousel** (static images shown in order, left-to-right / slide 1 → N).
Return ONLY valid JSON:
{
  "slide_arc": "how the story progresses across slides (short)",
  "cover_vs_body": "how slide 1 hooks vs middle/ending slides",
  "visual_consistency": "palette, fonts, templates across slides",
  "on_screen_text_summary": "recurring text patterns / hooks on slides",
  "cta_clarity": "how clear the ask / next step is",
  "format_pattern": "educational | listicle | story | before_after | promo | mixed | unknown",
  "risk_flags": ["string"],
  "why_it_worked": "why this carousel may perform (short)"
}
Use every slide image; if order is ambiguous, assume given order. Be conservative when unreadable.`;

export const TOP_PERFORMER_CAROUSEL_USER_PROMPT_TEMPLATE = `Evidence kind: {{EVIDENCE_KIND}}
Pre-LLM score: {{PRE_LLM_SCORE}}
Slide count: {{SLIDE_COUNT}}
Caption / context:
{{CAPTION_CONTEXT}}

Structured row context:
{{TEXT_BUNDLE}}`;

export interface RunDeepCarouselInsightsOptions {
  max_rows?: number;
  min_pre_llm_score?: number;
  rescan?: boolean;
  max_slides?: number;
}

export interface RunDeepCarouselInsightsResult {
  import_id: string;
  model: string;
  rows_scanned: number;
  carousel_deck_rows: number;
  candidates_with_slides: number;
  rows_analyzed: number;
  skipped_no_slides: number;
  carousel_insights_total: number;
}

function carouselModel(profile: { synth_model: string; criteria_json: Record<string, unknown> }): string {
  const raw = profile.criteria_json?.inputs_insights;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const m = String((raw as Record<string, unknown>).deep_carousel_model ?? "").trim();
    if (m) return m;
  }
  return profile.synth_model || "gpt-4o-mini";
}

function carouselMaxRows(criteria: Record<string, unknown>, override?: number): number {
  if (override != null && Number.isFinite(override)) return clamp(override, 1, 40);
  const ins = criteria.inputs_insights;
  if (ins && typeof ins === "object" && !Array.isArray(ins)) {
    const n = parseInt(String((ins as Record<string, unknown>).deep_carousel_max ?? ""), 10);
    if (!Number.isNaN(n)) return clamp(n, 1, 40);
  }
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const n = parseInt(String((tp as Record<string, unknown>).max_carousel_rows ?? ""), 10);
    if (!Number.isNaN(n)) return clamp(n, 1, 40);
  }
  return 10;
}

function carouselMinPreLlm(criteria: Record<string, unknown>, override?: number): number {
  if (override != null && Number.isFinite(override)) return clamp(override, 0, 1);
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const n = parseFloat(String((tp as Record<string, unknown>).pre_llm_min_score_carousel ?? ""));
    if (!Number.isNaN(n)) return clamp(n, 0, 1);
    const n2 = parseFloat(String((tp as Record<string, unknown>).pre_llm_min_score ?? ""));
    if (!Number.isNaN(n2)) return clamp(n2, 0, 1);
  }
  return 0.35;
}

function makeCarouselInsightsId(importId: string, rowId: string): string {
  return `ins_${importId.replace(/-/g, "").slice(0, 10)}_${rowId}_cdeep`;
}

function parseRiskFlags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
}

function isCarouselEvidenceRow(kind: string, payload: Record<string, unknown>, maxSlides: number): boolean {
  if (isVideoLikeEvidence(kind, payload)) return false;
  return parseCarouselSlideUrls(payload, maxSlides).length >= MIN_CAROUSEL_SLIDES_FOR_DEEP;
}

export async function runDeepCarouselInsightsForImport(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  importId: string,
  opts: RunDeepCarouselInsightsOptions = {}
): Promise<RunDeepCarouselInsightsResult> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for carousel insights");

  const project = await ensureProject(db, projectSlug);
  const imp = await getInputsEvidenceImport(db, project.id, importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);

  let profile = await getInputsProcessingProfile(db, project.id);
  if (!profile) {
    profile = await upsertInputsProcessingProfile(db, project.id, {});
  }
  const criteria = (profile.criteria_json ?? {}) as Record<string, unknown>;
  const model = carouselModel(profile);
  const minPre = carouselMinPreLlm(criteria, opts.min_pre_llm_score);
  const maxRows = carouselMaxRows(criteria, opts.max_rows);
  const maxSlides = clamp(opts.max_slides ?? 12, MIN_CAROUSEL_SLIDES_FOR_DEEP, 12);

  const existing = opts.rescan ? new Set<string>() : await listEvidenceRowInsightIdsByImportTier(db, importId, "top_performer_carousel");

  const dbRows = await listEvidenceRowsForPreLlmScoring(db, project.id, importId, 12_000);

  type Cand = {
    id: string;
    evidence_kind: string;
    payload: Record<string, unknown>;
    pre_llm_score: number;
    slide_urls: string[];
    caption: string;
  };
  const pool: Cand[] = [];
  let skippedNoSlides = 0;
  let carouselDeckRows = 0;

  for (const r of dbRows) {
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    if (!isCarouselEvidenceRow(r.evidence_kind, payload, maxSlides)) continue;
    carouselDeckRows++;
    const ev = evaluatePreLlmRow(r.evidence_kind, payload, criteria);
    if (ev.dropped_reason != null) continue;
    if (ev.pre_llm_score < minPre) continue;
    const slideUrls = parseCarouselSlideUrls(payload, maxSlides);
    if (slideUrls.length < MIN_CAROUSEL_SLIDES_FOR_DEEP) {
      skippedNoSlides++;
      continue;
    }
    if (existing.has(r.id)) continue;
    pool.push({
      id: r.id,
      evidence_kind: r.evidence_kind,
      payload,
      pre_llm_score: ev.pre_llm_score,
      slide_urls: slideUrls,
      caption: parseCarouselCaptionContext(payload),
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
    const textBundle = summarizePayloadForLlm(c.evidence_kind, c.payload, 2200);
    const system = TOP_PERFORMER_CAROUSEL_SYSTEM_PROMPT;

    const userText = `Evidence kind: ${c.evidence_kind}
Pre-LLM score: ${c.pre_llm_score}
Slide count: ${c.slide_urls.length}
Caption / context:
${c.caption || "(none)"}

Structured row context:
${textBundle}`;

    const user_content: Array<
      { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
    > = [{ type: "text", text: userText }];
    for (let i = 0; i < c.slide_urls.length; i++) {
      user_content.push({
        type: "image_url",
        image_url: { url: c.slide_urls[i], detail: "low" },
      });
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
          slide_arc: parsed.slide_arc,
          cover_vs_body: parsed.cover_vs_body,
          visual_consistency: parsed.visual_consistency,
          on_screen_text_summary: parsed.on_screen_text_summary,
          cta_clarity: parsed.cta_clarity,
          format_pattern: parsed.format_pattern,
        }
      : {};

    const risks = parseRiskFlags(parsed?.risk_flags);

    await upsertEvidenceRowInsight(db, {
      project_id: project.id,
      inputs_import_id: importId,
      source_evidence_row_id: c.id,
      insights_id: makeCarouselInsightsId(importId, c.id),
      analysis_tier: "top_performer_carousel",
      pre_llm_score: c.pre_llm_score,
      llm_model: out.model || model,
      why_it_worked: typeof parsed?.why_it_worked === "string" ? parsed.why_it_worked : null,
      primary_emotion: null,
      secondary_emotion: null,
      hook_type: typeof parsed?.format_pattern === "string" ? parsed.format_pattern : null,
      custom_label_1: null,
      custom_label_2: null,
      custom_label_3: null,
      cta_type: typeof parsed?.cta_clarity === "string" ? parsed.cta_clarity : null,
      hashtags: null,
      caption_style: null,
      hook_text: typeof parsed?.slide_arc === "string" ? parsed.slide_arc : null,
      risk_flags_json: risks,
      aesthetic_analysis_json: aesthetic,
      raw_llm_json: parsed,
    });
    analyzed++;
  }

  const carouselTotal = await countEvidenceRowInsightsByImportTier(db, importId, "top_performer_carousel");

  return {
    import_id: importId,
    model,
    rows_scanned: dbRows.length,
    carousel_deck_rows: carouselDeckRows,
    candidates_with_slides: pool.length,
    rows_analyzed: analyzed,
    skipped_no_slides: skippedNoSlides,
    carousel_insights_total: carouselTotal,
  };
}
