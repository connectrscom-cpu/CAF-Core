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

function mergeTopTiers(tops: EvidenceRowInsightEnrichedRow[]): Record<string, unknown> | null {
  if (!tops.length) return null;
  let best = tops[0];
  for (const t of tops) {
    const tr = TP_TIER_RANK[t.analysis_tier] ?? 0;
    const br = TP_TIER_RANK[best.analysis_tier] ?? 0;
    if (tr >= br) best = t;
  }
  return {
    analysis_tier: best.analysis_tier,
    hook_type: best.hook_type,
    hook_text: best.hook_text,
    why_it_worked: best.why_it_worked,
    aesthetic_analysis_json: best.aesthetic_analysis_json,
    cta_type: best.cta_type,
    caption_style: best.caption_style,
    primary_emotion: best.primary_emotion,
    secondary_emotion: best.secondary_emotion,
  };
}

function compactBroad(b: BroadInsightWithRating): Record<string, unknown> {
  return {
    why_it_worked: b.why_it_worked,
    hook_text: b.hook_text,
    hook_type: b.hook_type,
    primary_emotion: b.primary_emotion,
    secondary_emotion: b.secondary_emotion,
    cta_type: b.cta_type,
    caption_style: b.caption_style,
    custom_label_1: b.custom_label_1,
    custom_label_2: b.custom_label_2,
    custom_label_3: b.custom_label_3,
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
      top_performer_styles: mergeTopTiers(tops),
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

  const context = selectInsightContextForIdeasLlm(
    broad,
    topRows,
    opts.contextInsightCap,
    opts.minTopPerformerInContext
  );

  const topInCtx = context.filter((c) => c.top_performer_styles != null).length;

  const target = clamp(opts.targetIdeaCount, 1, 200);
  const quotas = formatQuotas(target);
  const system = `You are a senior social content strategist for an automated content pipeline.
You receive an INSIGHT CONTEXT array; each item is one evidence row with:
- "broad" (mechanism fields like why_it_worked, emotions, hook_type, hook_text, cta_type, caption_style)
- optional "top_performer_styles" (richer analysis for standout posts)
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
  if (!ideasArr.success || ideasArr.data.length === 0) {
    throw new Error("Ideas-from-insights LLM returned invalid ideas contract (expected canonical signal pack idea schema)");
  }
  if (!meetsQuota(ideasArr.data, quotas)) {
    // Hard enforce: if we can't satisfy the split, fail loudly so the operator can adjust prompts/data.
    throw new Error(
      `Ideas-from-insights did not meet required format split (carousel=${quotas.carousel}, video=${quotas.video}, post=${quotas.post}, thread=${quotas.thread}).`
    );
  }
  const slug = opts.packRunId.replace(/[^a-zA-Z0-9_]/g, "").slice(-12) || "pack";

  const quotaPicked = pickWithQuota(ideasArr.data, quotas).slice(0, target);
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
