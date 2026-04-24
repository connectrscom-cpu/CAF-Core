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
import type { SignalPackIdea } from "./signal-pack-compile-ideas.js";
import { platformFromEvidenceKind } from "./signal-pack-compile-ideas.js";

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
  ideas: SignalPackIdea[];
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
    broad: Record<string, unknown> | null;
    top_performer_styles: Record<string, unknown> | null;
  }> = [];

  for (const id of chosen) {
    const br = broadByEvidence.get(id) ?? null;
    const tops = tpByEvidence.get(id) ?? [];
    const kind = br?.evidence_kind ?? tops[0]?.evidence_kind ?? "instagram_post";
    const ratingRaw = br?.evidence_rating_score ?? null;
    const rating = ratingRaw == null || ratingRaw === "" ? null : ratingNum(ratingRaw);
    out.push({
      source_evidence_row_id: id,
      evidence_kind: kind,
      evidence_rating: rating,
      broad: br ? compactBroad(br) : null,
      top_performer_styles: mergeTopTiers(tops),
    });
  }

  return out;
}

function parseLlmIdeas(raw: unknown, targetMax: number): Array<{
  content_idea: string;
  summary?: string;
  platform?: string;
  confidence_score?: number;
  supporting_evidence_row_ids?: string[];
  primary_emotion?: string | null;
  why_it_worked?: string | null;
}> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const arr = (raw as { ideas?: unknown }).ideas;
  if (!Array.isArray(arr)) return [];
  const out: Array<{
    content_idea: string;
    summary?: string;
    platform?: string;
    confidence_score?: number;
    supporting_evidence_row_ids?: string[];
    primary_emotion?: string | null;
    why_it_worked?: string | null;
  }> = [];
  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const ci = typeof o.content_idea === "string" ? o.content_idea.trim() : "";
    if (!ci) continue;
    const sup = o.supporting_evidence_row_ids;
    const ids = Array.isArray(sup) ? sup.map((x) => String(x).trim()).filter(Boolean) : [];
    out.push({
      content_idea: ci.slice(0, 2000),
      summary: typeof o.summary === "string" ? o.summary.trim().slice(0, 2000) : undefined,
      platform: typeof o.platform === "string" ? o.platform.trim() : undefined,
      confidence_score: typeof o.confidence_score === "number" ? clamp(o.confidence_score, 0, 1) : undefined,
      supporting_evidence_row_ids: ids.length ? ids : undefined,
      primary_emotion: typeof o.primary_emotion === "string" ? o.primary_emotion : null,
      why_it_worked: typeof o.why_it_worked === "string" ? o.why_it_worked : null,
    });
    if (out.length >= targetMax) break;
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
  const system = `You are a senior social content strategist. You receive INSIGHTS from a research pipeline:
each item is one evidence row with optional "broad" LLM fields and optional "top_performer_styles" (richer visual/format analysis for standout posts).

Your job: propose ${target} DISTINCT content ideas the brand should actually create (new posts / carousels / short video concepts — not summaries of the dataset).

Rules:
- Each idea must be actionable and specific enough to brief a creator.
- Ground ideas in the insight patterns; you may combine multiple evidence rows into one idea.
- Prefer angles supported by top_performer_styles when present.
- Vary platforms and formats where evidence supports it.
- Return ONLY valid JSON: {"ideas":[...]} — no markdown.
- Each idea object MUST include:
  - "content_idea": string (the hook / creative concept)
  - "summary": string (1–2 sentences)
  - "platform": string (e.g. Instagram, TikTok, Multi)
  - "confidence_score": number 0–1
  - "supporting_evidence_row_ids": string[] (subset of source_evidence_row_id values you used; can be one or many)
  Optional: "primary_emotion", "why_it_worked" (short).
- Maximum ${target} ideas. Fewer only if evidence is too thin to justify more.`;

  const user = `Project notes: ${opts.extraInstructions || "(none)"}

Insight context (${context.length} rows; ${topInCtx} include top-performer enrichment):
${JSON.stringify(context, null, 0)}`;

  const out = await openaiChat(
    apiKey,
    {
      model: opts.model,
      system_prompt: system,
      user_prompt: user,
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

  const parsed = parseJsonObjectFromLlmText(out.content);
  const rawIdeas = parseLlmIdeas(parsed, target);
  const slug = opts.packRunId.replace(/[^a-zA-Z0-9_]/g, "").slice(-12) || "pack";

  const ideas: SignalPackIdea[] = rawIdeas.map((r, i) => {
    const primaryId = r.supporting_evidence_row_ids?.[0];
    const kind = context.find((c) => c.source_evidence_row_id === primaryId)?.evidence_kind ?? "instagram_post";
    const plat = r.platform?.trim() || platformFromEvidenceKind(kind);
    const ideaId = `idea_${slug}_${i + 1}`;
    return {
      idea_id: ideaId,
      platform: plat,
      content_idea: r.content_idea,
      summary: r.summary ?? r.content_idea,
      why_it_worked: r.why_it_worked ?? null,
      primary_emotion: r.primary_emotion ?? null,
      secondary_emotion: null,
      evidence_kind: kind,
      source_evidence_row_id: primaryId,
      analysis_tier: "ideas_from_insights_llm",
      confidence_score: r.confidence_score ?? 0.75,
    } satisfies SignalPackIdea;
  });

  return {
    ideas,
    context_insights_used: context.length,
    top_performer_rows_in_context: topInCtx,
  };
}
