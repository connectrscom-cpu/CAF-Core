/**
 * Read-only job health derivation for Review / marketer UX.
 *
 * Answers: "why is this job not progressing, and what should I do?"
 * Uses typed payload readers only — never writes qc_result or render_state.
 *
 * Failure sources reused from pipeline persistence:
 * - `generation_payload.last_error` / `generation_error` (job-pipeline persistJobPipelineFailure)
 * - `generation_payload.qc_result` via pickStoredQcResult
 * - `render_state` via pickRenderState / hasActiveProviderSession / isMidProviderPhase
 */
import { hasGeneratedOutput } from "./generation-payload-output.js";
import { pickStoredQcResult } from "./generation-payload-qc.js";
import {
  hasActiveProviderSession,
  isMidProviderPhase,
  pickRenderState,
} from "./content-job-render-state.js";
import {
  isTopPerformerMimicRenderableFlow,
  TOP_PERFORMER_MIMIC_RENDER_NOT_READY_MESSAGE,
} from "./top-performer-mimic-flow-types.js";

export type JobHealthState =
  | "healthy"
  | "blocked"
  | "failed"
  | "stuck"
  | "waiting_on_provider";

export type JobHealthReasonCode =
  | "ok"
  | "qc_blocked_critical_risk"
  | "qc_blocked"
  | "generation_failed"
  | "schema_or_llm_failed"
  | "render_provider_timeout"
  | "render_failed"
  | "mimic_image_disabled"
  | "waiting_on_provider"
  | "stuck_rendering"
  | "failed_unknown";

/** Informational only — maps to existing Review actions (no new mutations). */
export type JobHealthActionHint =
  | "none"
  | "wait"
  | "rework"
  | "regenerate"
  | "decide"
  | "enable_mimic_env";

export interface JobHealth {
  state: JobHealthState;
  reason_code: JobHealthReasonCode;
  human_message: string;
  suggested_action: string;
  action_hint: JobHealthActionHint;
}

export interface JobHealthLastTransition {
  to_state?: string | null;
  created_at?: string | Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface DeriveJobHealthInput {
  status: string | null | undefined;
  flow_type?: string | null;
  generation_payload?: Record<string, unknown> | null;
  render_state?: unknown;
  updated_at?: string | Date | null;
  last_transition?: JobHealthLastTransition | null;
  /** Optional current env; historical detection prefers persisted error text. */
  mimic_image_enabled?: boolean;
  now?: Date;
}

const STUCK_RENDERING_MS = 30 * 60 * 1000;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function trimErr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function toMs(v: string | Date | null | undefined): number | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/** Same priority as run-content-outcomes.resolveJobErrorMessage (without DB trail). */
export function pickJobPersistedError(
  generationPayload: Record<string, unknown> | null | undefined,
  renderState: unknown,
  lastTransition?: JobHealthLastTransition | null
): string | null {
  const rs = pickRenderState(renderState);
  const rsErr = trimErr(rs.raw.error) || trimErr(rs.raw.reason) || trimErr(rs.raw.message);
  if (rsErr) return rsErr.slice(0, 500);

  const gp = asRecord(generationPayload);
  const genErr = trimErr(gp.generation_error) || trimErr(gp.last_error);
  if (genErr) return genErr.slice(0, 500);

  const meta = lastTransition?.metadata;
  if (meta && typeof meta === "object") {
    const mErr = trimErr(meta.error) || trimErr(meta.message);
    if (mErr) return mErr.slice(0, 500);
  }
  return null;
}

function isMimicEnvGateError(err: string): boolean {
  const e = err.toLowerCase();
  return (
    e.includes("mimic_image_enabled") ||
    e.includes(TOP_PERFORMER_MIMIC_RENDER_NOT_READY_MESSAGE.toLowerCase().slice(0, 40))
  );
}

function isLlmOrSchemaError(err: string): boolean {
  const e = err.toLowerCase();
  return (
    e.includes("llm generation failed") ||
    e.includes("schema validation") ||
    e.includes("output schema") ||
    e.includes("json schema") ||
    e.includes("failed to parse") ||
    e.includes("openai") ||
    e.includes("generation failed")
  );
}

function isProviderTimeoutError(err: string): boolean {
  const e = err.toLowerCase();
  return (
    e.includes("timed out") ||
    e.includes("timeout") ||
    e.includes("etimedout") ||
    e.includes("provider timeout") ||
    e.includes("polling timed")
  );
}

function criticalRiskFindingText(qc: NonNullable<ReturnType<typeof pickStoredQcResult>>): string | null {
  const critical = (qc.blocking_risk_policies ?? []).filter(
    (p) => String(p.severity ?? "").toUpperCase() === "CRITICAL"
  );
  if (critical.length === 0) return null;
  const first = critical[0]!;
  const terms = first.matched_terms?.length ? ` (matched: ${first.matched_terms.join(", ")})` : "";
  return `${first.policy_name} — CRITICAL${terms}`;
}

function healthy(): JobHealth {
  return {
    state: "healthy",
    reason_code: "ok",
    human_message: "Job is progressing normally.",
    suggested_action: "No action needed.",
    action_hint: "none",
  };
}

/**
 * Derive operator-facing health from persisted job fields.
 * Pure / DB-free. Callers pass optional last transition and env flags.
 */
export function deriveJobHealth(input: DeriveJobHealthInput): JobHealth {
  const status = String(input.status ?? "")
    .trim()
    .toUpperCase();
  const flowType = String(input.flow_type ?? "").trim();
  const gp = input.generation_payload ?? null;
  const err = pickJobPersistedError(gp, input.render_state, input.last_transition);
  const rs = pickRenderState(input.render_state);
  const now = input.now ?? new Date();
  const updatedMs = toMs(input.updated_at) ?? toMs(input.last_transition?.created_at);

  // ── Provider in flight (retry intentionally guarded) ─────────────────────
  if (status === "RENDERING" && hasActiveProviderSession(input.render_state)) {
    const phase = rs.phase || "in progress";
    return {
      state: "waiting_on_provider",
      reason_code: "waiting_on_provider",
      human_message: `Waiting on the video/render provider (phase: ${phase}). A session is already active.`,
      suggested_action:
        "Wait for the provider to finish. Do not re-submit — retry is intentionally guarded while video_id/session_id exist.",
      action_hint: "wait",
    };
  }

  // ── Stuck rendering (mid-phase or stale without session) ─────────────────
  if (status === "RENDERING") {
    const midOrEmpty = isMidProviderPhase(rs.phase) || rs.phase === "" || rs.phase === "starting";
    const stale = updatedMs != null && now.getTime() - updatedMs > STUCK_RENDERING_MS;
    if ((midOrEmpty && !hasActiveProviderSession(input.render_state) && stale) || (stale && !hasActiveProviderSession(input.render_state))) {
      return {
        state: "stuck",
        reason_code: "stuck_rendering",
        human_message: err
          ? `Render appears stuck: ${err.slice(0, 280)}`
          : "Render appears stuck — no active provider session and no recent progress.",
        suggested_action:
          "Reprocess the run or resume render from the pipeline. If a provider id appears later, retries stay guarded.",
        action_hint: "regenerate",
      };
    }
  }

  // ── QC blocked ──────────────────────────────────────────────────────────
  if (status === "BLOCKED") {
    const qc = pickStoredQcResult(gp);
    const criticalText = qc ? criticalRiskFindingText(qc) : null;
    if (criticalText) {
      return {
        state: "blocked",
        reason_code: "qc_blocked_critical_risk",
        human_message: `QC blocked this job due to CRITICAL risk: ${criticalText}`,
        suggested_action:
          "Edit copy to remove the risk language, then use Rework / Regenerate from the decision panel — or Reject.",
        action_hint: "rework",
      };
    }
    const short =
      (qc?.reason_short && qc.reason_short.trim()) ||
      (qc?.reasons?.[0] && String(qc.reasons[0]).trim()) ||
      err ||
      "QC blocked this job.";
    return {
      state: "blocked",
      reason_code: "qc_blocked",
      human_message: short.slice(0, 400),
      suggested_action:
        "Review QC findings on this job. Use Decide (Needs edit / Reject) or Rework after fixing issues.",
      action_hint: "decide",
    };
  }

  // ── Failed ──────────────────────────────────────────────────────────────
  if (status === "FAILED") {
    const mimicLane = flowType !== "" && isTopPerformerMimicRenderableFlow(flowType);
    const mimicGateFromError = Boolean(err && isMimicEnvGateError(err));
    const mimicGateFromEnv =
      mimicLane && input.mimic_image_enabled === false && (!err || mimicGateFromError);
    if (mimicGateFromError || mimicGateFromEnv) {
      return {
        state: "failed",
        reason_code: "mimic_image_disabled",
        human_message: mimicGateFromError
          ? err!.slice(0, 400)
          : "Mimic image render is disabled (MIMIC_IMAGE_ENABLED is off).",
        suggested_action:
          "Ask an engineer to enable MIMIC_IMAGE_ENABLED=1 and configure a mimic image provider, then re-run this job.",
        action_hint: "enable_mimic_env",
      };
    }

    if (err && isProviderTimeoutError(err)) {
      return {
        state: "failed",
        reason_code: "render_provider_timeout",
        human_message: `Render provider timed out: ${err.slice(0, 280)}`,
        suggested_action:
          "Retry from the run pipeline. If a provider session id is already stored, wait or resume — do not double-submit.",
        action_hint: "regenerate",
      };
    }

    if (err && isLlmOrSchemaError(err)) {
      return {
        state: "failed",
        reason_code: "schema_or_llm_failed",
        human_message: err.slice(0, 400),
        suggested_action: "Use Regenerate / Rework from the decision panel to retry LLM generation.",
        action_hint: "regenerate",
      };
    }

    if (!hasGeneratedOutput(gp) && err) {
      return {
        state: "failed",
        reason_code: "generation_failed",
        human_message: err.slice(0, 400),
        suggested_action: "Use Regenerate / Rework from the decision panel to retry generation.",
        action_hint: "regenerate",
      };
    }

    if (err) {
      const looksRender =
        /render|heygen|flux|provider|carousel|video|assembly|ffmpeg|sora/i.test(err) ||
        status === "FAILED";
      if (looksRender && hasGeneratedOutput(gp)) {
        return {
          state: "failed",
          reason_code: "render_failed",
          human_message: err.slice(0, 400),
          suggested_action:
            "Retry render from the run pipeline, or Regenerate slides/media from the job if available.",
          action_hint: "regenerate",
        };
      }
      return {
        state: "failed",
        reason_code: "failed_unknown",
        human_message: err.slice(0, 400),
        suggested_action: "Open this job for details. Use Rework / Regenerate or Reject as appropriate.",
        action_hint: "decide",
      };
    }

    return {
      state: "failed",
      reason_code: "failed_unknown",
      human_message: "Job failed — no structured error was stored. Check run logs if needed.",
      suggested_action: "Reprocess the run, or open the job and use Rework / Regenerate.",
      action_hint: "regenerate",
    };
  }

  // Terminal / in-progress statuses without failure signals
  return healthy();
}
