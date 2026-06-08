/**
 * Second-stage LLM: turn row-level insights (broad + optional top-performer enrichments)
 * into a smaller set of actionable content ideas for `signal_packs.ideas_json`.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type {
  BroadInsightWithRating,
  EvidenceRowInsightEnrichedRow,
} from "../repositories/inputs-evidence-insights.js";
import {
  listBroadInsightsWithEvidenceRating,
  listTopPerformerInsightsEnriched,
} from "../repositories/inputs-evidence-insights.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { openaiChat } from "./openai-chat.js";
import { platformFromEvidenceKind } from "./signal-pack-compile-ideas.js";
import type { SignalPackIdeaV2 } from "../domain/signal-pack-ideas-v2.js";
import { signalPackIdeaSchema } from "../domain/signal-pack-ideas-v2.js";
import { z } from "zod";

export const STEP_IDEAS_FROM_INSIGHTS = "inputs_ideas_from_insights_llm";

export const IDEAS_FROM_INSIGHTS_SYSTEM_PROMPT_TEMPLATE = `You are a senior social content strategist for an automated content pipeline.
You receive an INSIGHT CONTEXT array; each item is one evidence row with:
- "broad" (mechanism fields like why_it_worked, emotions, hook_type, hook_text, cta_type, caption_style)
- optional "top_performer_styles" when the row has a top-performer insight: core insight fields (hook, emotion, why it worked) plus "nemotron_analysis" (Nemotron VL output only — no Document AI OCR, mimic evaluation, or render blueprints)
- optional "evidence_performance_review" inside top_performer_styles (rating score + rationale when the evidence row was rated)
- "grounding_insight_ids": a list of allowed insight IDs for traceability (strings). Use ONLY these IDs.

Your job: propose EXACTLY {{TARGET_IDEAS}} DISTINCT, job-ready IDEAS that we can execute downstream without guessing.

CRITICAL FORMAT SPLIT (MUST HIT):
- carousel: {{QUOTA_CAROUSEL}}
- video: {{QUOTA_VIDEO}}
- post: {{QUOTA_POST}}
- thread: {{QUOTA_THREAD}}

Do not output any other format values. Use only: "carousel" | "video" | "post" | "thread".

Return ONLY valid JSON: {"ideas":[...]} — no markdown.

Each idea object MUST match this contract exactly (all fields required unless noted):
- title: string (<=200)
- three_liner: string (<=1200)
- thesis: string (<=800)
- who_for: string (<=200)
- format: string (e.g. "carousel" | "video" | "post" | "thread")
- platform: string (e.g. Instagram, TikTok, Reddit, Facebook, Multi)
- why_now: string (<=800)
- key_points: string[] (3–10 items)
- novelty_angle: string (<=800)
- cta: string (<=200)
- grounding_insight_ids: string[] (min 1; ideally 1–3; MUST be chosen from the provided grounding_insight_ids in the context)
- expected_outcome: string (<=400)
- risk_flags: string[] (optional; default [])
- status: "proposed" (always)
- confidence_score: number 0–1 (optional but recommended)

Rules:
- Every idea MUST include grounding_insight_ids (no orphan ideas).
- Be specific (no generic "post about astrology" ideas).
- The format split above is mandatory even if the dataset is skewed.
- Keep claims safe; use risk_flags for things like "medical_claim", "financial_claim", "adult_content", "policy_risk", "brand_risk".`;

export const IDEAS_FROM_INSIGHTS_USER_PROMPT_TEMPLATE = `Project notes: {{EXTRA_INSTRUCTIONS}}

Insight context ({{CONTEXT_ROW_COUNT}} rows; {{TOP_PERFORMER_IN_CONTEXT}} include top-performer enrichment):
{{INSIGHT_CONTEXT_JSON}}`;

const TP_TIER_RANK: Record<string, number> = {
  top_performer_deep: 1,
  top_performer_carousel: 2,
  top_performer_video: 3,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function ratingNum(s: string | null | undefined): number {
  const n = parseFloat(String(s ?? ""));
  return Number.isNaN(n) ? 0 : n;
}

function normFormat(fmt: unknown): "carousel" | "video" | "post" | "thread" | "other" {
  const f = String(fmt ?? "")
    .toLowerCase()
    .trim();
  if (f === "carousel") return "carousel";
  if (f === "video") return "video";
  if (f === "post") return "post";
  if (f === "thread") return "thread";
  return "other";
}

function formatQuotas(target: number): { carousel: number; video: number; post: number; thread: number } {
  const n = clamp(target, 1, 200);
  let carousel = Math.floor(n * 0.4);
  let video = Math.floor(n * 0.3);
  let post = Math.floor(n * 0.1);
  let thread = Math.floor(n * 0.1);
  // allocate remainder deterministically: carousel → video → post → thread
  let used = carousel + video + post + thread;
  const order: Array<keyof ReturnType<typeof formatQuotas>> = ["carousel", "video", "post", "thread"];
  let idx = 0;
  while (used < n) {
    const k = order[idx % order.length]!;
    if (k === "carousel") carousel++;
    else if (k === "video") video++;
    else if (k === "post") post++;
    else thread++;
    used++;
    idx++;
  }
  // if rounding overshoots (shouldn't), trim from thread → post → video → carousel
  while (used > n) {
    if (thread > 0) thread--;
    else if (post > 0) post--;
    else if (video > 0) video--;
    else if (carousel > 1) carousel--;
    used--;
  }
  // Ensure we don't end up with zero buckets for reasonable N (avoid pathological rounding at small N).
  if (n >= 10) {
    if (post === 0) post = 1;
    if (thread === 0) thread = 1;
    used = carousel + video + post + thread;
    while (used > n && carousel > 1) {
      carousel--;
      used--;
    }
    while (used > n && video > 1) {
      video--;
      used--;
    }
  }
  return { carousel, video, post, thread };
}

function meetsQuota(ideas: Array<{ format: unknown }>, q: { carousel: number; video: number; post: number; thread: number }): boolean {
  const c = { carousel: 0, video: 0, post: 0, thread: 0, other: 0 };
  for (const i of ideas) c[normFormat(i.format)]++;
  return c.carousel >= q.carousel && c.video >= q.video && c.post >= q.post && c.thread >= q.thread;
}

function quotaCounts(ideas: Array<{ format: unknown }>): { carousel: number; video: number; post: number; thread: number; other: number } {
  const c = { carousel: 0, video: 0, post: 0, thread: 0, other: 0 };
  for (const i of ideas) c[normFormat(i.format)]++;
  return c;
}

function pickWithQuota<T extends { format: unknown; confidence_score?: number }>(
  ideas: T[],
  q: { carousel: number; video: number; post: number; thread: number }
): T[] {
  const by: Record<"carousel" | "video" | "post" | "thread" | "other", T[]> = {
    carousel: [],
    video: [],
    post: [],
    thread: [],
    other: [],
  };
  for (const it of ideas) by[normFormat(it.format)].push(it);
  const byConf = (a: T, b: T) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
  for (const k of Object.keys(by) as Array<keyof typeof by>) by[k].sort(byConf);

  const out: T[] = [];
  out.push(...by.carousel.slice(0, q.carousel));
  out.push(...by.video.slice(0, q.video));
  out.push(...by.post.slice(0, q.post));
  out.push(...by.thread.slice(0, q.thread));

  // Fill any leftover slots (if LLM over-produced in some buckets) by best remaining confidence across all.
  const need = Math.max(0, (q.carousel + q.video + q.post + q.thread) - out.length);
  if (need > 0) {
    const used = new Set(out);
    const rest = ([] as T[]).concat(by.carousel, by.video, by.post, by.thread, by.other).filter((x) => !used.has(x));
    rest.sort(byConf);
    out.push(...rest.slice(0, need));
  }
  return out;
}

function dedupeIdeas<T extends { title: string; thesis: string; key_points: string[] }>(ideas: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const it of ideas) {
    const key = `${String(it.title ?? "").trim().toLowerCase()}::${String(it.thesis ?? "")
      .trim()
      .toLowerCase()}::${(Array.isArray(it.key_points) ? it.key_points : []).join("|").toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** ~60k tokens of insight JSON leaves headroom for system prompt + model output on 128k models. */
export const IDEAS_LLM_MAX_CONTEXT_JSON_CHARS = 240_000;
export const IDEAS_LLM_MIN_CONTEXT_ROWS = 20;
const IDEAS_LLM_MAX_STRING_FIELD_CHARS = 800;

export type IdeasLlmInsightContextRow = {
  source_evidence_row_id: string;
  evidence_kind: string;
  evidence_rating: number | null;
  grounding_insight_ids: string[];
  broad: Record<string, unknown> | null;
  top_performer_styles: Record<string, unknown> | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function stringCap(v: unknown, maxLen: number): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
}

function trimDeepStrings(v: unknown, maxLen: number, depth = 0): unknown {
  if (depth > 10) return v;
  if (typeof v === "string") {
    return v.length <= maxLen ? v : `${v.slice(0, maxLen)}…`;
  }
  if (Array.isArray(v)) return v.map((x) => trimDeepStrings(x, maxLen, depth + 1));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      out[k] = trimDeepStrings(val, maxLen, depth + 1);
    }
    return out;
  }
  return v;
}

/** Non-Nemotron blobs merged into aesthetic JSON after the VL pass — omit from idea synthesis. */
const NEMOTRON_AESTHETIC_DROP_KEYS = new Set([
  "document_ai_deck_v1",
  "deck_visual_system",
  "deck_composition_system",
  "replication_blueprint",
  "mimic_evaluation",
  "_slide_coverage",
  "_inference_limits",
  "video_visual_system",
  "video_composition_system",
  "insight_quality",
]);

function parseRiskFlags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 12);
}

function compactNemotronSlideForIdeas(slide: unknown): Record<string, unknown> | null {
  const s = asRecord(slide);
  if (!s) return null;
  const out: Record<string, unknown> = {};
  if (s.slide_index != null) out.slide_index = s.slide_index;
  const purpose = stringCap(s.slide_purpose, 40);
  if (purpose) out.slide_purpose = purpose;
  const transcript = stringCap(s.on_screen_text_transcript ?? s.on_screen_text, 280);
  if (transcript) out.on_screen_text = transcript;
  const vis = stringCap(s.visual_description, 280);
  if (vis) out.visual_description = vis;
  const layout = stringCap(s.layout_template, 120);
  if (layout) out.layout_template = layout;
  return Object.keys(out).length > 0 ? out : null;
}

function compactNemotronFrameForIdeas(frame: unknown): Record<string, unknown> | null {
  const f = asRecord(frame);
  if (!f) return null;
  const out: Record<string, unknown> = {};
  if (f.frame_index != null) out.frame_index = f.frame_index;
  const purpose = stringCap(f.frame_purpose ?? f.slide_purpose, 40);
  if (purpose) out.frame_purpose = purpose;
  const vis = stringCap(f.visual_description, 280);
  if (vis) out.visual_description = vis;
  const spoken = stringCap(f.spoken_text ?? f.on_screen_text, 280);
  if (spoken) out.spoken_text = spoken;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Nemotron VL analysis only — fields useful for content ideation.
 * Strips Document AI OCR, mimic evaluation, and render/replication blueprints.
 */
export function extractNemotronAnalysisForIdeasLlm(
  aes: Record<string, unknown>,
  analysisTier?: string
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const tier = String(analysisTier ?? "").trim();

  for (const k of [
    "format_pattern",
    "slide_arc",
    "cover_vs_body",
    "visual_consistency",
    "on_screen_text_summary",
    "cta_clarity",
    "deck_as_whole_summary",
    "video_arc",
    "opening_vs_body",
    "hook_visual",
    "message_clarity",
    "pacing_notes",
    "spoken_hook",
    "video_as_whole_summary",
    "style_summary",
    "primary_emotion",
    "secondary_emotion",
    "caption_style",
  ] as const) {
    if (NEMOTRON_AESTHETIC_DROP_KEYS.has(k)) continue;
    const s = stringCap(aes[k], tier === "top_performer_video" ? 600 : 500);
    if (s) out[k] = s;
  }

  const whisper = stringCap(aes.spoken_transcript_whisper, 800);
  if (whisper) out.spoken_transcript_whisper = whisper;

  for (const k of ["palette", "layout", "on_screen_text"] as const) {
    const v = aes[k];
    if (typeof v === "string") {
      const s = stringCap(v, 400);
      if (s) out[k] = s;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = trimDeepStrings(v, 200);
    }
  }

  const typo = asRecord(aes.typography);
  if (typo) {
    const slim: Record<string, unknown> = {};
    for (const tk of ["headline_guess", "body_guess", "hierarchy", "relative_scale"] as const) {
      const s = stringCap(typo[tk], 120);
      if (s) slim[tk] = s;
    }
    if (Object.keys(slim).length > 0) out.typography = slim;
  }

  const risks = parseRiskFlags(aes.risk_flags);
  if (risks.length > 0) out.risk_flags = risks;

  const slidesRaw = Array.isArray(aes.slides) ? aes.slides : [];
  if (slidesRaw.length > 0) {
    const slides = slidesRaw
      .slice(0, 16)
      .map(compactNemotronSlideForIdeas)
      .filter((x): x is Record<string, unknown> => x != null);
    if (slides.length > 0) out.slides = slides;
  }

  const framesRaw = Array.isArray(aes.frames) ? aes.frames : [];
  if (framesRaw.length > 0) {
    const frames = framesRaw
      .slice(0, 12)
      .map(compactNemotronFrameForIdeas)
      .filter((x): x is Record<string, unknown> => x != null);
    if (frames.length > 0) out.frames = frames;
  }

  // Belt-and-suspenders: never leak Document AI or mimic keys if nested oddly.
  for (const drop of NEMOTRON_AESTHETIC_DROP_KEYS) {
    delete out[drop];
  }
  delete out.document_ai_deck_v1;

  return out;
}

export function compactEvidencePerformanceReviewForIdeasLlm(
  perf: unknown
): Record<string, unknown> | null {
  const rec = asRecord(perf);
  if (!rec) return null;
  const scoreRaw = rec.rating_score;
  const score = typeof scoreRaw === "number" ? scoreRaw : parseFloat(String(scoreRaw ?? ""));
  if (Number.isNaN(score)) return null;
  const components = asRecord(rec.rating_components_json) ?? {};
  const slimComponents: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(components).slice(0, 12)) {
    slimComponents[k] = typeof v === "number" ? v : stringCap(v, 120);
  }
  return {
    rating_score: score,
    rating_components_json: slimComponents,
    rating_rationale: stringCap(rec.rating_rationale, 400),
  };
}

export function compactTopPerformerStylesForIdeasLlm(
  tops: EvidenceRowInsightEnrichedRow[]
): Record<string, unknown> | null {
  if (!tops.length) return null;
  let best = tops[0]!;
  for (const t of tops) {
    const tr = TP_TIER_RANK[t.analysis_tier] ?? 0;
    const br = TP_TIER_RANK[best.analysis_tier] ?? 0;
    if (tr >= br) best = t;
  }
  let perf = best.evidence_performance_review_json;
  if (perf == null) {
    for (const t of tops) {
      if (t.evidence_performance_review_json != null) {
        perf = t.evidence_performance_review_json;
        break;
      }
    }
  }
  const aes = asRecord(best.aesthetic_analysis_json);
  const nemotronAnalysis = aes ? extractNemotronAnalysisForIdeasLlm(aes, best.analysis_tier) : null;
  const rowRisks = parseRiskFlags(best.risk_flags_json);
  return {
    insights_id: best.insights_id,
    analysis_tier: best.analysis_tier,
    why_it_worked: stringCap(best.why_it_worked, 600),
    hook_type: stringCap(best.hook_type, 80),
    hook_text: stringCap(best.hook_text, 400),
    primary_emotion: stringCap(best.primary_emotion, 80),
    secondary_emotion: stringCap(best.secondary_emotion, 80),
    cta_type: stringCap(best.cta_type, 80),
    caption_style: stringCap(best.caption_style, 200),
    hashtags: stringCap(best.hashtags, 300),
    custom_label_1: stringCap(best.custom_label_1, 120),
    custom_label_2: stringCap(best.custom_label_2, 120),
    custom_label_3: stringCap(best.custom_label_3, 120),
    ...(rowRisks.length > 0 ? { risk_flags: rowRisks } : {}),
    ...(nemotronAnalysis && Object.keys(nemotronAnalysis).length > 0
      ? { nemotron_analysis: nemotronAnalysis }
      : {}),
    evidence_performance_review: compactEvidencePerformanceReviewForIdeasLlm(perf),
  };
}

/**
 * Shrink insight context to fit model limits: trim long strings, then drop lowest-priority rows
 * (context is already ordered: top-performer first, then highest-rated broad rows).
 */
export function budgetInsightContextForIdeasLlm(
  context: IdeasLlmInsightContextRow[],
  opts?: { maxJsonChars?: number; minRows?: number; maxStringFieldChars?: number }
): IdeasLlmInsightContextRow[] {
  const maxJsonChars = opts?.maxJsonChars ?? IDEAS_LLM_MAX_CONTEXT_JSON_CHARS;
  const minRows = Math.max(1, opts?.minRows ?? IDEAS_LLM_MIN_CONTEXT_ROWS);
  const maxStringFieldChars = opts?.maxStringFieldChars ?? IDEAS_LLM_MAX_STRING_FIELD_CHARS;

  let rows = trimDeepStrings(context, maxStringFieldChars) as IdeasLlmInsightContextRow[];
  let json = JSON.stringify(rows);
  while (json.length > maxJsonChars && rows.length > minRows) {
    rows = rows.slice(0, rows.length - 1);
    json = JSON.stringify(rows);
  }
  return rows;
}

function compactBroad(b: BroadInsightWithRating): Record<string, unknown> {
  return {
    why_it_worked: stringCap(b.why_it_worked, 600),
    hook_text: stringCap(b.hook_text, 400),
    hook_type: stringCap(b.hook_type, 80),
    primary_emotion: stringCap(b.primary_emotion, 80),
    secondary_emotion: stringCap(b.secondary_emotion, 80),
    cta_type: stringCap(b.cta_type, 80),
    caption_style: stringCap(b.caption_style, 200),
    custom_label_1: stringCap(b.custom_label_1, 120),
    custom_label_2: stringCap(b.custom_label_2, 120),
    custom_label_3: stringCap(b.custom_label_3, 120),
    pre_llm_score: b.pre_llm_score,
  };
}

export interface IdeasFromInsightsLlmOpts {
  importId: string;
  packRunId: string;
  /** Target number of ideas (project `max_ideas_in_signal_pack`). */
  targetIdeaCount: number;
  /** Max insight rows in LLM context (`max_insights_for_ideas_llm`). */
  contextInsightCap: number;
  /** Prefer at least this many rows that have top-performer enrichment (`min_top_performer_insights_for_ideas_llm`). */
  minTopPerformerInContext: number;
  model: string;
  extraInstructions: string;
}

export interface IdeasFromInsightsLlmResult {
  ideas: SignalPackIdeaV2[];
  context_insights_used: number;
  top_performer_rows_in_context: number;
}

/**
 * Pick broad rows + attach merged top-performer fields; prioritize rated top-performer evidence
 * then fill with highest-rated broad-only rows.
 */
export function selectInsightContextForIdeasLlm(
  broad: BroadInsightWithRating[],
  topRows: EvidenceRowInsightEnrichedRow[],
  contextCap: number,
  minTopInContext: number
): Array<{
  source_evidence_row_id: string;
  evidence_kind: string;
  evidence_rating: number | null;
  grounding_insight_ids: string[];
  broad: Record<string, unknown> | null;
  top_performer_styles: Record<string, unknown> | null;
}> {
  const cap = clamp(contextCap, 20, 2000);
  const wantTop = clamp(minTopInContext, 0, cap);

  const tpByEvidence = new Map<string, EvidenceRowInsightEnrichedRow[]>();
  for (const r of topRows) {
    const id = r.source_evidence_row_id;
    if (!id) continue;
    const arr = tpByEvidence.get(id) ?? [];
    arr.push(r);
    tpByEvidence.set(id, arr);
  }

  const broadByEvidence = new Map<string, BroadInsightWithRating>();
  for (const b of broad) {
    const id = b.source_evidence_row_id;
    if (!id) continue;
    if (!broadByEvidence.has(id)) broadByEvidence.set(id, b);
  }

  const tpIdsSorted = [...tpByEvidence.keys()].sort((a, b) => {
    const ba = broadByEvidence.get(a);
    const bb = broadByEvidence.get(b);
    return ratingNum(bb?.evidence_rating_score) - ratingNum(ba?.evidence_rating_score);
  });

  const chosen: string[] = [];
  const used = new Set<string>();

  const takeTop = Math.min(wantTop, tpIdsSorted.length);
  for (let i = 0; i < takeTop; i++) {
    const id = tpIdsSorted[i]!;
    chosen.push(id);
    used.add(id);
  }

  const broadSorted = [...broad].sort(
    (a, b) => ratingNum(b.evidence_rating_score) - ratingNum(a.evidence_rating_score)
  );

  for (const b of broadSorted) {
    if (chosen.length >= cap) break;
    const id = b.source_evidence_row_id;
    if (!id || used.has(id)) continue;
    chosen.push(id);
    used.add(id);
  }

  const out: Array<{
    source_evidence_row_id: string;
    evidence_kind: string;
    evidence_rating: number | null;
    grounding_insight_ids: string[];
    broad: Record<string, unknown> | null;
    top_performer_styles: Record<string, unknown> | null;
  }> = [];

  for (const id of chosen) {
    const br = broadByEvidence.get(id) ?? null;
    const tops = tpByEvidence.get(id) ?? [];
    const kind = br?.evidence_kind ?? tops[0]?.evidence_kind ?? "instagram_post";
    const ratingRaw = br?.evidence_rating_score ?? null;
    const rating = ratingRaw == null || ratingRaw === "" ? null : ratingNum(ratingRaw);
    const grounding_insight_ids = [
      ...(br?.insights_id ? [String(br.insights_id).trim()] : []),
      ...tops.map((t) => String(t.insights_id ?? "").trim()).filter(Boolean),
    ];
    out.push({
      source_evidence_row_id: id,
      evidence_kind: kind,
      evidence_rating: rating,
      grounding_insight_ids,
      broad: br ? compactBroad(br) : null,
      top_performer_styles: compactTopPerformerStylesForIdeasLlm(tops),
    });
  }

  return out;
}

export async function synthesizeIdeasJsonFromInsightsLlm(
  db: Pool,
  config: AppConfig,
  projectId: string,
  opts: IdeasFromInsightsLlmOpts
): Promise<IdeasFromInsightsLlmResult> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for ideas-from-insights LLM");
  }

  const fetchCap = clamp(opts.contextInsightCap * 3, 100, 3000);
  const broad = await listBroadInsightsWithEvidenceRating(db, projectId, opts.importId, fetchCap);
  const topRows = await listTopPerformerInsightsEnriched(db, projectId, opts.importId, fetchCap);

  if (broad.length === 0 && topRows.length === 0) {
    return { ideas: [], context_insights_used: 0, top_performer_rows_in_context: 0 };
  }

  const rawContext = selectInsightContextForIdeasLlm(
    broad,
    topRows,
    opts.contextInsightCap,
    opts.minTopPerformerInContext
  );
  const context = budgetInsightContextForIdeasLlm(rawContext);

  const topInCtx = context.filter((c) => c.top_performer_styles != null).length;

  const target = clamp(opts.targetIdeaCount, 1, 200);
  const quotas = formatQuotas(target);
  const system = `You are a senior social content strategist for an automated content pipeline.
You receive an INSIGHT CONTEXT array; each item is one evidence row with:
- "broad" (mechanism fields like why_it_worked, emotions, hook_type, hook_text, cta_type, caption_style)
- optional "top_performer_styles" when the row has a top-performer insight: core insight fields (hook, emotion, why it worked) plus "nemotron_analysis" (Nemotron VL output only — no Document AI OCR, mimic evaluation, or render blueprints)
- optional "evidence_performance_review" inside top_performer_styles (rating score + rationale when the evidence row was rated)
- "grounding_insight_ids": a list of allowed insight IDs for traceability (strings). Use ONLY these IDs.

Your job: propose EXACTLY ${target} DISTINCT, job-ready IDEAS that we can execute downstream without guessing.

CRITICAL FORMAT SPLIT (MUST HIT):
- carousel: ${quotas.carousel}
- video: ${quotas.video}
- post: ${quotas.post}
- thread: ${quotas.thread}

Do not output any other format values. Use only: "carousel" | "video" | "post" | "thread".

Return ONLY valid JSON: {"ideas":[...]} — no markdown.

Each idea object MUST match this contract exactly (all fields required unless noted):
- title: string (<=200)
- three_liner: string (<=1200)
- thesis: string (<=800)
- who_for: string (<=200)
- format: string (e.g. "carousel" | "video" | "post" | "thread")
- platform: string (e.g. Instagram, TikTok, Reddit, Facebook, Multi)
- why_now: string (<=800)
- key_points: string[] (3–10 items)
- novelty_angle: string (<=800)
- cta: string (<=200)
- grounding_insight_ids: string[] (min 1; ideally 1–3; MUST be chosen from the provided grounding_insight_ids in the context)
- expected_outcome: string (<=400)
- risk_flags: string[] (optional; default [])
- status: "proposed" (always)
- confidence_score: number 0–1 (optional but recommended)

Rules:
- Every idea MUST include grounding_insight_ids (no orphan ideas).
- Be specific (no generic "post about astrology" ideas).
- The format split above is mandatory even if the dataset is skewed.
- Keep claims safe; use risk_flags for things like "medical_claim", "financial_claim", "adult_content", "policy_risk", "brand_risk".`;

  const user = `Project notes: ${opts.extraInstructions || "(none)"}

Insight context (${context.length} rows; ${topInCtx} include top-performer enrichment):
${JSON.stringify(context, null, 0)}`;

  let parsed: unknown = null;
  let rawIdeas: unknown = null;
  let lastText = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await openaiChat(
      apiKey,
      {
        model: opts.model,
        system_prompt:
          attempt === 1
            ? system
            : `${system}\n\nYou failed to match the required format split previously. Try again and hit the exact counts.`,
        user_prompt:
          attempt === 1
            ? user
            : `${user}\n\nIMPORTANT: Output exactly ${target} ideas and exactly this split: carousel=${quotas.carousel}, video=${quotas.video}, post=${quotas.post}, thread=${quotas.thread}.`,
        max_tokens: 8192,
        response_format: "json_object",
      },
      {
        db,
        projectId,
        runId: null,
        taskId: null,
        signalPackId: null,
        step: STEP_IDEAS_FROM_INSIGHTS,
      }
    );
    lastText = out.content;
    parsed = parseJsonObjectFromLlmText(out.content);
    rawIdeas = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as { ideas?: unknown }).ideas : [];
    if (Array.isArray(rawIdeas)) break;
  }
  const llmIdeaSchema = signalPackIdeaSchema
    .omit({
      id: true,
      created_at: true,
      run_id: true,
      status: true,
    })
    .extend({
      risk_flags: z.array(z.string().min(1).max(60)).optional(),
      confidence_score: z.number().min(0).max(1).optional(),
    });
  const ideasArr = z.array(llmIdeaSchema).safeParse(Array.isArray(rawIdeas) ? rawIdeas : []);
  let baseIdeas = ideasArr.success ? ideasArr.data : [];

  async function generateFormatBatch(format: "carousel" | "video" | "post" | "thread", count: number) {
    const n = Math.max(0, Math.min(200, count));
    if (n === 0) return [] as z.infer<typeof llmIdeaSchema>[];
    const fmtSystem = `You are generating IDEAS for a content pipeline.\n\nReturn ONLY valid JSON: {"ideas":[...]} — no markdown.\n\nGenerate EXACTLY ${n} ideas.\n\nEvery idea MUST follow the canonical idea contract (all fields required unless noted):\n- title (<=200)\n- three_liner (<=1200)\n- thesis (<=800)\n- who_for (<=200)\n- format MUST be exactly \"${format}\" (no other values)\n- platform (Instagram|TikTok|Reddit|Facebook|Multi)\n- why_now (<=800)\n- key_points (3-10)\n- novelty_angle (<=800)\n- cta (<=200)\n- grounding_insight_ids (min 1; choose ONLY from the provided context grounding_insight_ids)\n- expected_outcome (<=400)\n- risk_flags (optional; default [])\n- status: \"proposed\" (always)\n- confidence_score 0-1 (optional)\n\nCRITICAL: output ${n} ideas with format=\"${format}\".\n`;
    const fmtUser = `Project notes: ${opts.extraInstructions || "(none)"}\n\nInsight context (${context.length} rows; ${topInCtx} include top-performer enrichment):\n${JSON.stringify(context, null, 0)}\n`;
    let arr: z.SafeParseReturnType<unknown, z.infer<typeof llmIdeaSchema>[]> | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = await openaiChat(
        apiKey ?? "",
        {
          model: opts.model,
          system_prompt:
            attempt === 1
              ? fmtSystem
              : `${fmtSystem}\nYou must return EXACTLY ${n} objects. No commentary. No missing fields.`,
          user_prompt: fmtUser,
          max_tokens: 8192,
          response_format: "json_object",
        },
        {
          db,
          projectId,
          runId: null,
          taskId: null,
          signalPackId: null,
          step: STEP_IDEAS_FROM_INSIGHTS,
        }
      );
      const p = parseJsonObjectFromLlmText(out.content);
      const ri = p && typeof p === "object" && !Array.isArray(p) ? (p as { ideas?: unknown }).ideas : [];
      arr = z.array(llmIdeaSchema).safeParse(Array.isArray(ri) ? ri : []);
      if (arr.success && arr.data.length >= Math.min(n, 1)) break;
    }
    if (!arr || !arr.success || arr.data.length === 0) {
      throw new Error(`Ideas-from-insights: failed generating ${format} batch (invalid JSON contract)`);
    }
    // force format (belt + suspenders)
    return arr.data.map((x) => ({ ...x, format })) as z.infer<typeof llmIdeaSchema>[];
  }

  // If the single-call model misses quota, fall back to per-format batches to guarantee the split.
  if (baseIdeas.length === 0 || !meetsQuota(baseIdeas, quotas)) {
    const seedPicked = pickWithQuota(baseIdeas, quotas);
    const buckets: Record<"carousel" | "video" | "post" | "thread", z.infer<typeof llmIdeaSchema>[]> = {
      carousel: [],
      video: [],
      post: [],
      thread: [],
    };
    for (const it of seedPicked) {
      const k = normFormat(it.format);
      if (k === "carousel" || k === "video" || k === "post" || k === "thread") buckets[k].push(it);
    }

    // Self-heal each bucket until we have enough rows, allowing minor dedupe shrink.
    const maxRounds = 3;
    for (const k of ["carousel", "video", "post", "thread"] as const) {
      for (let round = 1; round <= maxRounds; round++) {
        const want = quotas[k];
        buckets[k] = dedupeIdeas(buckets[k]);
        const have = buckets[k].length;
        if (have >= want) break;
        const missing = want - have;
        // Over-generate slightly to absorb dedupe collisions.
        const batch = await generateFormatBatch(k, missing + 2);
        buckets[k] = dedupeIdeas([...buckets[k], ...batch]);
      }
    }

    baseIdeas = ([] as z.infer<typeof llmIdeaSchema>[]).concat(
      buckets.carousel,
      buckets.video,
      buckets.post,
      buckets.thread
    );
  }

  if (baseIdeas.length === 0) {
    throw new Error("Ideas-from-insights LLM returned invalid ideas contract (expected canonical signal pack idea schema)");
  }
  if (!meetsQuota(baseIdeas, quotas)) {
    const c = quotaCounts(baseIdeas);
    throw new Error(
      `Ideas-from-insights did not meet required format split (required carousel=${quotas.carousel}, video=${quotas.video}, post=${quotas.post}, thread=${quotas.thread}; got carousel=${c.carousel}, video=${c.video}, post=${c.post}, thread=${c.thread}, other=${c.other}).`
    );
  }
  const slug = opts.packRunId.replace(/[^a-zA-Z0-9_]/g, "").slice(-12) || "pack";

  const quotaPicked = pickWithQuota(baseIdeas, quotas).slice(0, target);
  const ideas: SignalPackIdeaV2[] = quotaPicked.map((r, i) => {
    // Enforce deterministic IDs and minimal metadata while keeping the canonical contract.
    const ideaId = `idea_${slug}_${i + 1}`;
    const grounding = Array.isArray(r.grounding_insight_ids) ? r.grounding_insight_ids.map((x) => String(x).trim()).filter(Boolean) : [];
    const safeGrounding = grounding.length
      ? grounding
      : (() => {
          // Hard fallback to first available grounding id from context (breaking change: we still require grounding).
          const first = context.find((c) => (c.grounding_insight_ids ?? []).length > 0)?.grounding_insight_ids?.[0];
          return first ? [String(first).trim()] : [];
        })();
    if (safeGrounding.length === 0) {
      throw new Error("Ideas-from-insights: could not resolve grounding_insight_ids (no insight ids in context)");
    }

    // If platform is missing/blank, infer from evidence kinds present in context.
    const inferredPlatform =
      typeof r.platform === "string" && r.platform.trim()
        ? r.platform.trim()
        : platformFromEvidenceKind(context[0]?.evidence_kind ?? "instagram_post");

    return {
      ...r,
      id: ideaId,
      run_id: opts.packRunId,
      created_at: new Date().toISOString(),
      platform: inferredPlatform,
      status: "proposed",
      grounding_insight_ids: safeGrounding,
      risk_flags: Array.isArray(r.risk_flags) ? r.risk_flags : [],
    };
  });

  return {
    ideas,
    context_insights_used: context.length,
    top_performer_rows_in_context: topInCtx,
  };
}
