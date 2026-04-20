/**
 * Upstream recommendations from the post-approval LLM reviewer.
 *
 * The reviewer (see `src/services/approved-content-llm-review.ts`) already
 * emits `improvement_bullets` that describe what is wrong with the artifact
 * ("fix slide 3 copy", "cut scene 2"). This module captures a *separate*,
 * structured list of **what to change upstream** — in prompts, schemas, flow
 * definitions, project config, learning guidance, or QC — so operators know
 * where the fix actually belongs.
 *
 * We keep parsing defensive: the LLM may omit the field entirely, or return
 * garbage. `parseUpstreamRecommendations` always returns a valid (possibly
 * empty) array without throwing.
 */
import { z } from "zod";

export const UPSTREAM_RECOMMENDATION_TARGETS = [
  "prompt_template",
  "output_schema",
  "flow_definition",
  "project_brand",
  "project_strategy",
  "learning_guidance",
  "qc_checklist",
  "risk_policy",
  "other",
] as const;

export type UpstreamRecommendationTarget =
  (typeof UPSTREAM_RECOMMENDATION_TARGETS)[number];

/** Canonical shape stored on `llm_approval_reviews.upstream_recommendations`. */
export const upstreamRecommendationSchema = z.object({
  /** Where the fix belongs. Unknown values are coerced to `"other"`. */
  target: z.enum(UPSTREAM_RECOMMENDATION_TARGETS),
  /** Imperative one-liner. */
  change: z.string().min(1).max(600),
  /** Why — usually references a weakness/improvement bullet. */
  rationale: z.string().max(1000).optional().default(""),
  /** Optional pointer to the concrete lever (prompt id, schema key, check id…). */
  field_or_check_id: z.string().max(200).optional(),
});

export type UpstreamRecommendation = z.infer<typeof upstreamRecommendationSchema>;

export const upstreamRecommendationsSchema = z.array(upstreamRecommendationSchema);

/**
 * Tolerant parser. Never throws: unknown `target` → `"other"`; missing fields
 * dropped silently; caps array length to avoid storing a novel of junk.
 */
export function parseUpstreamRecommendations(raw: unknown): UpstreamRecommendation[] {
  if (!Array.isArray(raw)) return [];
  const out: UpstreamRecommendation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const rawTarget = typeof rec.target === "string" ? rec.target.trim().toLowerCase() : "";
    const target: UpstreamRecommendationTarget =
      (UPSTREAM_RECOMMENDATION_TARGETS as readonly string[]).includes(rawTarget)
        ? (rawTarget as UpstreamRecommendationTarget)
        : "other";
    const change = typeof rec.change === "string" ? rec.change.trim() : "";
    if (!change) continue;
    const rationale = typeof rec.rationale === "string" ? rec.rationale.trim() : "";
    const fieldOrCheck =
      typeof rec.field_or_check_id === "string" && rec.field_or_check_id.trim()
        ? rec.field_or_check_id.trim().slice(0, 200)
        : undefined;
    out.push({
      target,
      change: change.slice(0, 600),
      rationale: rationale.slice(0, 1000),
      ...(fieldOrCheck ? { field_or_check_id: fieldOrCheck } : {}),
    });
    if (out.length >= 20) break;
  }
  return out;
}

/** Prompt fragment appended to the review system prompt. */
export const UPSTREAM_RECOMMENDATIONS_PROMPT_ADDENDUM = `

Additionally, produce an "upstream_recommendations" array (0–10 items). Each item says WHERE to change the system so this weakness stops recurring. Use this exact shape:
{
  "target": "prompt_template" | "output_schema" | "flow_definition" | "project_brand" | "project_strategy" | "learning_guidance" | "qc_checklist" | "risk_policy" | "other",
  "change": string,            // imperative, one line ("Tighten hook rule: forbid 'In this video…' openings")
  "rationale": string,         // tie to a specific weakness or improvement_bullet
  "field_or_check_id": string  // optional: prompt id / schema key / qc check id when known
}
Rules:
- Only include upstream items that would actually change future outputs; do NOT repeat per-artifact fixes from "improvement_bullets" unless the root cause is upstream.
- Prefer "prompt_template" for recurring copy drift, "output_schema" for missing/optional-but-needed fields, "qc_checklist" for deterministic gates, "learning_guidance" for pattern-level hints.
- When uncertain, use "other" and spell it out in "change".`;
