/**
 * Derive learning-friendly scores and bullets from Nemotron TP-parity output insights.
 */
import type { UpstreamRecommendation } from "../domain/upstream-recommendations.js";

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = asStr(obj[k]);
    if (v) return v;
  }
  return null;
}

export interface DerivedLearningSignals {
  overall_score: number;
  scores_json: Record<string, unknown>;
  strengths: string[];
  weaknesses: string[];
  improvement_bullets: string[];
  risk_flags: string[];
  summary: string | null;
  upstream_recommendations: UpstreamRecommendation[];
  insight_fields: Record<string, unknown>;
}

export function deriveLearningSignalsFromOutputInsights(
  outputInsights: Record<string, unknown>,
  rawMerged: Record<string, unknown> | null,
  opts?: { flow_family?: string }
): DerivedLearningSignals {
  const riskFlags = asStrArray(rawMerged?.risk_flags ?? outputInsights.risk_flags);
  const formatPattern = pickString(outputInsights, "format_pattern") ?? "unknown";
  const whyItWorked = pickString(outputInsights, "why_it_worked", "deck_as_whole_summary");
  const ctaClarity = pickString(outputInsights, "cta_clarity");
  const slideArc = pickString(outputInsights, "slide_arc");
  const slides = Array.isArray(outputInsights.slides) ? outputInsights.slides : [];
  const mimicEval = outputInsights.mimic_evaluation as Record<string, unknown> | undefined;
  const templateQ = asStr(mimicEval?.template_storage_quality).toLowerCase();

  const weaknesses: string[] = [];
  const improvementBullets: string[] = [];
  const strengths: string[] = [];

  if (ctaClarity && /weak|unclear|missing|low/i.test(ctaClarity)) {
    weaknesses.push(`CTA clarity issue: ${ctaClarity}`);
    improvementBullets.push("Strengthen the final-slide CTA with a specific verb-first command.");
  }
  if (slideArc && /repetitive|flat|weak|disjointed/i.test(slideArc)) {
    weaknesses.push(`Slide arc: ${slideArc}`);
    improvementBullets.push("Tighten slide-to-slide progression so each slide advances the narrative.");
  }
  for (const flag of riskFlags.slice(0, 6)) {
    weaknesses.push(flag);
    improvementBullets.push(`Address risk: ${flag}`);
  }
  if (templateQ === "reject" || templateQ === "job_only") {
    weaknesses.push(`Mimic template quality: ${templateQ}`);
    improvementBullets.push("Revise visual template or background before scaling this format.");
  }
  if (whyItWorked) {
    strengths.push(whyItWorked.slice(0, 280));
  }
  if (formatPattern && formatPattern !== "unknown") {
    strengths.push(`Format pattern reads as ${formatPattern}.`);
  }

  let overall = 0.72;
  if (templateQ === "reject") overall -= 0.2;
  else if (templateQ === "job_only") overall -= 0.1;
  overall -= Math.min(0.25, riskFlags.length * 0.04);
  if (weaknesses.length >= 4) overall -= 0.08;
  if (slides.length > 0 && weaknesses.length === 0) overall += 0.06;
  overall = Math.max(0.15, Math.min(0.92, Math.round(overall * 100) / 100));

  const upstream: UpstreamRecommendation[] = [];
  if (ctaClarity && /weak|unclear/i.test(ctaClarity)) {
    upstream.push({
      target: "learning_guidance",
      change: "Add generation guidance for stronger, specific CTAs on final carousel slides.",
      rationale: ctaClarity,
    });
  }
  if (templateQ === "reject") {
    upstream.push({
      target: "flow_definition",
      change: "Review mimic render mode or template library rules for this flow.",
      rationale: String(mimicEval?.template_storage_reason ?? "Nemotron marked template not suitable."),
    });
  }

  const summary =
    pickString(outputInsights, "deck_as_whole_summary", "on_screen_text_summary", "video_as_whole_summary") ??
    (whyItWorked ? `Generated output analysis: ${whyItWorked.slice(0, 200)}` : null);

  return {
    overall_score: overall,
    scores_json: {
      insight_fields: {
        format_pattern: formatPattern,
        why_it_worked: whyItWorked,
        slide_count: slides.length,
        flow_family: opts?.flow_family ?? null,
      },
      visual_execution_score: slides.length > 0 ? overall : null,
      copy_structure_score: slideArc ? overall : null,
      alignment_score: overall,
    },
    strengths: strengths.slice(0, 8),
    weaknesses: weaknesses.slice(0, 10),
    improvement_bullets: improvementBullets.slice(0, 10),
    risk_flags: riskFlags,
    summary,
    upstream_recommendations: upstream,
    insight_fields: {
      format_pattern: formatPattern,
      why_it_worked: whyItWorked,
      primary_emotion: pickString(outputInsights, "primary_emotion"),
      hook_type: pickString(outputInsights, "hook_type") ?? formatPattern,
      slide_count: slides.length,
    },
  };
}
