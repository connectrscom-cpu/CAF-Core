/**
 * Run-level generation-context snapshot.
 *
 * Captured at end-of-planning, this is the frozen answer to *"what generation
 * context did we use for this run?"* — so when someone reviews a run weeks
 * later, or replans against a refreshed prompt/config/learning world, there
 * is an unambiguous record of the inputs that shaped the outputs.
 *
 * Stored on `caf_core.runs.context_snapshot_json` (see migration 025).
 *
 * Intentionally narrow:
 *   - prompt_versions: reuse the existing `run_prompt_versions_snapshot` row
 *     (candidate_id + prompt_id + version label per planned job).
 *   - project_config: a small slice of strategy / brand / allowed flows —
 *     only the keys we rely on to compare runs, not the whole JSON.
 *   - learning: fingerprint + applied rule ids per (flow_type, platform)
 *     that were actually routed through the facade during planning time.
 *
 * This module is DB-free and pure — it takes already-fetched data and
 * assembles the snapshot. Callers fetch via existing repositories. Keeping
 * it pure means we can golden-test it without a Postgres instance.
 */
import { createHash } from "node:crypto";
import type { RunPromptVersionsSnapshot } from "./run-prompt-versions-snapshot.js";
import type { CompiledLearning } from "./learning-rule-selection.js";

export const RUN_CONTEXT_SNAPSHOT_VERSION = 1 as const;

export interface ProjectConfigSliceInput {
  /** Allowed flow_types that were enabled for the run. */
  enabled_flow_types: string[];
  /** Small, stable subset of strategy (tone / goals etc.). `null` when not set. */
  strategy_slice?: Record<string, unknown> | null;
  /** Small, stable subset of brand constraints (banned words, voice…). */
  brand_slice?: Record<string, unknown> | null;
}

export interface LearningSliceInput {
  flow_type: string | null;
  platform: string | null;
  compiled: Pick<CompiledLearning, "applied_rule_ids" | "merged_guidance">;
}

export interface BuildRunContextSnapshotInput {
  run_id: string;
  project_slug: string;
  engine_version: string;
  trace_id: string;
  prompt_versions: RunPromptVersionsSnapshot;
  project_config: ProjectConfigSliceInput;
  /** One entry per (flow_type, platform) that was compiled during planning. */
  learning: LearningSliceInput[];
}

export interface RunContextSnapshot {
  snapshot_version: number;
  captured_at: string;
  run_id: string;
  project_slug: string;
  engine_version: string;
  trace_id: string;
  prompt_versions: RunPromptVersionsSnapshot;
  project_config: {
    enabled_flow_types: string[];
    strategy_slice: Record<string, unknown> | null;
    brand_slice: Record<string, unknown> | null;
  };
  learning: Array<{
    flow_type: string | null;
    platform: string | null;
    applied_rule_ids: string[];
    /**
     * Stable fingerprint of the merged guidance text — lets two runs compare
     * "same learning vs different learning" without storing the full text.
     */
    guidance_fingerprint: string;
    guidance_chars: number;
  }>;
}

/**
 * SHA-256 fingerprint truncated to 16 hex chars — collision-resistant enough
 * for "same guidance or not?" comparisons while staying human-readable in
 * logs. Empty strings get the stable value `"empty"` so operators can tell
 * "no guidance" apart from "unknown".
 */
export function fingerprintGuidance(text: string): string {
  const t = (text ?? "").trim();
  if (!t) return "empty";
  return createHash("sha256").update(t).digest("hex").slice(0, 16);
}

/** Pure assembler — takes fetched inputs and returns the frozen snapshot. */
export function buildRunContextSnapshot(
  input: BuildRunContextSnapshotInput
): RunContextSnapshot {
  return {
    snapshot_version: RUN_CONTEXT_SNAPSHOT_VERSION,
    captured_at: new Date().toISOString(),
    run_id: input.run_id,
    project_slug: input.project_slug,
    engine_version: input.engine_version,
    trace_id: input.trace_id,
    prompt_versions: input.prompt_versions,
    project_config: {
      enabled_flow_types: [...input.project_config.enabled_flow_types].sort(),
      strategy_slice: input.project_config.strategy_slice ?? null,
      brand_slice: input.project_config.brand_slice ?? null,
    },
    learning: input.learning.map((l) => ({
      flow_type: l.flow_type,
      platform: l.platform,
      applied_rule_ids: [...l.compiled.applied_rule_ids].sort(),
      guidance_fingerprint: fingerprintGuidance(l.compiled.merged_guidance),
      guidance_chars: (l.compiled.merged_guidance ?? "").length,
    })),
  };
}

/**
 * Convenience: extract the subset of brand constraints we consider worth
 * snapshotting. Everything else goes to learning / future expansion. Pure.
 */
export function pickBrandSliceForSnapshot(
  brand: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!brand) return null;
  // Narrow set that actually shapes copy output — banned words, tone, voice
  // cues, CTA rules. Skips audit columns (id, project_id, updated_at).
  const keys = [
    "tone",
    "voice_style",
    "audience_level",
    "emoji_policy",
    "banned_claims",
    "banned_words",
    "mandatory_disclaimers",
    "cta_style_rules",
    "storytelling_style",
    "risk_level_default",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (brand[k] !== undefined && brand[k] !== null && brand[k] !== "") out[k] = brand[k];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Same idea for strategy (kept narrow for diffability). */
export function pickStrategySliceForSnapshot(
  strategy: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!strategy) return null;
  const keys = [
    "project_type",
    "core_offer",
    "target_audience",
    "transformation_promise",
    "primary_business_goal",
    "primary_content_goal",
    "brand_archetype",
    "strategic_content_pillars",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (strategy[k] !== undefined && strategy[k] !== null && strategy[k] !== "") out[k] = strategy[k];
  }
  return Object.keys(out).length > 0 ? out : null;
}
