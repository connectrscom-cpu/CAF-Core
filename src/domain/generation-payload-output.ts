/**
 * Typed readers for `content_jobs.generation_payload.generated_output`.
 *
 * `generated_output` is the LLM-produced JSON object. Its *shape varies per
 * `flow_type`* (carousel slides, video script, scene bundle, …), so we do not
 * try to lock it into a single Zod schema here. What we *do* centralize is the
 * repeated unsafe cast we saw in many call sites:
 *
 *   const gen = (job.generation_payload.generated_output as Record<string, unknown>) ?? {};
 *
 * That pattern silently treats arrays and primitives as empty objects, which
 * hides bugs. This module replaces it with two narrow helpers that are safe,
 * explicit, and testable without a database.
 *
 * Adoption is intentionally incremental: existing call sites continue to work;
 * new code (and any touched code) should prefer these helpers.
 */

/** Minimal typed view of `content_jobs.generation_payload`. */
export type GenerationPayloadLike =
  | {
      generated_output?: unknown;
      [k: string]: unknown;
    }
  | null
  | undefined;

/**
 * Returns `generated_output` as a plain object, or `null` if it is missing /
 * not an object. Unlike the old `(x as Record<string, unknown>) ?? {}` pattern,
 * arrays and primitives do NOT coerce to `{}` — callers get `null` and can
 * react explicitly.
 */
export function pickGeneratedOutput(
  payload: GenerationPayloadLike
): Record<string, unknown> | null {
  const out = payload?.generated_output;
  if (!out || typeof out !== "object" || Array.isArray(out)) return null;
  return out as Record<string, unknown>;
}

/**
 * Convenience: most call sites want `{}` on miss rather than `null`. Kept as a
 * separate export so the safe default is always explicit at the call site.
 */
export function pickGeneratedOutputOrEmpty(
  payload: GenerationPayloadLike
): Record<string, unknown> {
  return pickGeneratedOutput(payload) ?? {};
}

/** True when the job already has a non-empty `generated_output` object. */
export function hasGeneratedOutput(payload: GenerationPayloadLike): boolean {
  const out = pickGeneratedOutput(payload);
  return out !== null && Object.keys(out).length > 0;
}
