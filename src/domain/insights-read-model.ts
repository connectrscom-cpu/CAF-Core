/**
 * Operator-facing read model for `caf_core.inputs_evidence_row_insights` (structured, not raw LLM dump).
 */
import type { EvidenceInsightTier } from "../repositories/inputs-evidence-insights.js";
import { platformSlugFromEvidenceKind } from "./evidence-read-model.js";

export type InsightReadType =
  | "top_performer"
  | "hook_pattern"
  | "emotional_pattern"
  | "visual_pattern"
  | "pacing_pattern"
  | "format_pattern"
  | "audience_signal"
  | "hashtag_cluster"
  | "strategic_opportunity"
  | "risk_or_warning"
  | "market_row_analysis";

export interface InsightExampleReadModel {
  evidence_id: string;
  hook: string | null;
}

export interface InsightReadModelItem {
  id: string;
  insights_id: string;
  project_slug: string;
  inputs_import_id: string;
  signal_pack_id: string | null;
  run_id: string | null;
  type: InsightReadType;
  title: string;
  summary: string;
  confidence: number | null;
  platforms: string[];
  formats: string[];
  supporting_evidence_ids: string[];
  creative_implication: string | null;
  examples: InsightExampleReadModel[];
  created_at: string;
  source: string;
  analysis_tier: EvidenceInsightTier;
  /** Stable link to evidence row (same import). */
  source_evidence_row_id: string;
}

function nonEmpty(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t : null;
}

function confidenceFromPreLlm(score: string | null): number | null {
  if (score == null || score === "") return null;
  const n = parseFloat(score);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

/**
 * Map stored analysis tier + populated columns into a primary insight type for operators.
 */
export function deriveInsightReadType(row: {
  analysis_tier: EvidenceInsightTier;
  hook_type: string | null;
  hook_text: string | null;
  primary_emotion: string | null;
  aesthetic_analysis_json: unknown;
  risk_flags_json: unknown;
  hashtags: string | null;
  cta_type: string | null;
}): InsightReadType {
  const risks = Array.isArray(row.risk_flags_json) ? row.risk_flags_json : [];
  if (risks.length > 0) return "risk_or_warning";
  const tier = row.analysis_tier;
  if (tier === "top_performer_deep" || tier === "top_performer_video" || tier === "top_performer_carousel") {
    return "top_performer";
  }
  if (tier === "broad_llm") {
    if (nonEmpty(row.hook_type) || nonEmpty(row.hook_text)) return "hook_pattern";
    if (nonEmpty(row.primary_emotion)) return "emotional_pattern";
    if (row.aesthetic_analysis_json && typeof row.aesthetic_analysis_json === "object") return "visual_pattern";
    if (nonEmpty(row.hashtags)) return "hashtag_cluster";
    if (nonEmpty(row.cta_type)) return "audience_signal";
    return "market_row_analysis";
  }
  return "strategic_opportunity";
}

function titleFromRow(
  type: InsightReadType,
  row: {
    hook_type: string | null;
    primary_emotion: string | null;
    hook_text: string | null;
    analysis_tier: EvidenceInsightTier;
  }
): string {
  if (type === "top_performer") return "Top performer — visual / structural decode";
  if (type === "hook_pattern") return nonEmpty(row.hook_type) ? `Hook pattern: ${row.hook_type}` : "Hook pattern";
  if (type === "emotional_pattern") {
    const e = nonEmpty(row.primary_emotion);
    return e ? `Emotional signal: ${e}` : "Emotional pattern";
  }
  if (type === "visual_pattern") return "Visual / aesthetic signals";
  if (type === "pacing_pattern") return "Pacing / structure (video)";
  if (type === "format_pattern") return "Format-level read";
  if (type === "hashtag_cluster") return "Hashtag / topic cluster";
  if (type === "audience_signal") return "Audience / CTA signal";
  if (type === "risk_or_warning") return "Risk or weak pattern";
  if (type === "market_row_analysis") return "Market row analysis (broad)";
  return "Strategic read";
}

export function buildInsightReadModelItem(input: {
  project_slug: string;
  inputs_import_id: string;
  signal_pack_id: string | null;
  run_id: string | null;
  evidence_post_format?: string | null;
  id: string;
  insights_id: string;
  analysis_tier: EvidenceInsightTier;
  source_evidence_row_id: string;
  evidence_kind: string;
  pre_llm_score: string | null;
  why_it_worked: string | null;
  primary_emotion: string | null;
  secondary_emotion: string | null;
  hook_type: string | null;
  hook_text: string | null;
  hashtags: string | null;
  caption_style: string | null;
  cta_type: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  aesthetic_analysis_json: unknown;
  risk_flags_json: unknown;
  created_at: string;
}): InsightReadModelItem {
  const type = deriveInsightReadType(input);
  const summaryParts = [
    nonEmpty(input.why_it_worked),
    nonEmpty(input.caption_style) ? `Caption style: ${input.caption_style}` : null,
    nonEmpty(input.secondary_emotion) ? `Secondary emotion: ${input.secondary_emotion}` : null,
  ].filter(Boolean);
  const summary = summaryParts.join(" ") || "See structured fields and supporting evidence.";

  const creative =
    nonEmpty(input.custom_label_1) ||
    nonEmpty(input.custom_label_2) ||
    nonEmpty(input.custom_label_3) ||
    nonEmpty(input.why_it_worked);

  const examples: InsightExampleReadModel[] = [
    {
      evidence_id: input.source_evidence_row_id,
      hook: nonEmpty(input.hook_text) ?? null,
    },
  ];

  const plat = platformSlugFromEvidenceKind(input.evidence_kind);
  const fmt = String(input.evidence_post_format ?? "").trim();

  return {
    id: input.id,
    insights_id: input.insights_id,
    project_slug: input.project_slug,
    inputs_import_id: input.inputs_import_id,
    signal_pack_id: input.signal_pack_id,
    run_id: input.run_id,
    type,
    title: titleFromRow(type, input),
    summary,
    confidence: confidenceFromPreLlm(input.pre_llm_score),
    platforms: [plat],
    formats: fmt ? [fmt] : [],
    supporting_evidence_ids: [input.source_evidence_row_id],
    creative_implication: creative,
    examples,
    created_at: input.created_at,
    source: "inputs_evidence_row_insights",
    analysis_tier: input.analysis_tier,
    source_evidence_row_id: input.source_evidence_row_id,
  };
}
