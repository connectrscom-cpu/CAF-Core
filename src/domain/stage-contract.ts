/**
 * Stage contract helpers for `content_jobs.generation_payload` (idea → job handoff).
 * Additive, backward-compatible: keeps legacy `format` / `confidence` keys in sync.
 */

export const STAGE_CONTRACT_SCHEMA_VERSION = 1;

export type PromptBindingStatus = "bound" | "deferred";

export interface PromptBinding {
  /** Explicit prompt row at plan time vs resolved later from flow defaults. */
  status: PromptBindingStatus;
  prompt_id: string | null;
  prompt_version_id: string | null;
  prompt_version_label: string | null;
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function confidence01(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (!Number.isFinite(n)) return undefined;
  const x = n > 1 ? n / 100 : n;
  if (!Number.isFinite(x)) return undefined;
  return Math.min(1, Math.max(0, x));
}

/**
 * Canonical routing / scoring field is `confidence_score` (0–1). This keeps `confidence`
 * mirrored when either is present so older readers stay stable.
 */
export function normalizeCandidateDataContract(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };

  const ideaFmt = trimStr(out.idea_format);
  const legacyFmt = trimStr(out.format);
  if (legacyFmt && !ideaFmt) {
    out.idea_format = legacyFmt;
  }

  const primary =
    confidence01(out.confidence_score) ??
    confidence01(out.confidence);
  if (primary !== undefined) {
    out.confidence_score = primary;
    out.confidence = primary;
  }

  return out;
}

export function buildPromptBinding(opts: {
  prompt_id: string | null | undefined;
  prompt_version_id: string | null | undefined;
  prompt_version_label: string | null | undefined;
}): PromptBinding {
  const pid = trimStr(opts.prompt_id ?? "");
  const pvId = trimStr(opts.prompt_version_id ?? "");
  const pvLabel = trimStr(opts.prompt_version_label ?? "");
  return {
    status: pid ? "bound" : "deferred",
    prompt_id: pid || null,
    prompt_version_id: pvId || null,
    prompt_version_label: pvLabel || null,
  };
}

/**
 * Soft-merge contract fields for `POST /v1/jobs/ingest` payloads (additive only).
 */
export function coerceIngestedGenerationPayload(gp: Record<string, unknown>): Record<string, unknown> {
  const out = { ...gp };
  const cand = out.candidate_data;
  if (cand && typeof cand === "object" && !Array.isArray(cand)) {
    out.candidate_data = normalizeCandidateDataContract(cand as Record<string, unknown>);
  }
  if (out.schema_version === undefined) {
    out.schema_version = STAGE_CONTRACT_SCHEMA_VERSION;
  }
  if (out.prompt_binding === undefined) {
    out.prompt_binding = buildPromptBinding({
      prompt_id: out.prompt_id as string | null | undefined,
      prompt_version_id: out.prompt_version_id as string | null | undefined,
      prompt_version_label: out.prompt_version_label as string | null | undefined,
    });
  }
  return out;
}

/** Initial `generation_payload` fragment for newly planned jobs (merged by callers). */
export function buildPlannedGenerationPayloadBase(opts: {
  signal_pack_id: string;
  candidate_data: Record<string, unknown>;
  prompt_id: string | null | undefined;
  prompt_version_id: string | null | undefined;
  prompt_version_label: string | null | undefined;
  variation_index: number | null | undefined;
}): Record<string, unknown> {
  return {
    schema_version: STAGE_CONTRACT_SCHEMA_VERSION,
    signal_pack_id: opts.signal_pack_id,
    candidate_data: normalizeCandidateDataContract(opts.candidate_data),
    prompt_id: trimStr(opts.prompt_id ?? "") || null,
    prompt_version_id: trimStr(opts.prompt_version_id ?? "") || null,
    prompt_version_label: trimStr(opts.prompt_version_label ?? "") || null,
    variation_index: opts.variation_index ?? null,
    prompt_binding: buildPromptBinding({
      prompt_id: opts.prompt_id,
      prompt_version_id: opts.prompt_version_id,
      prompt_version_label: opts.prompt_version_label,
    }),
  };
}
