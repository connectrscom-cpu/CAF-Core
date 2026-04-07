/**
 * Assemble signal-pack rows + decision-trace planner I/O for admin / review transparency.
 */
import type { CandidateInput, GenerationPlanResult, PlannedJob } from "../decision_engine/types.js";

export interface CandidatePlanRow extends CandidateInput {
  outcome: "planned" | "dropped" | "unknown";
  outcome_detail?: string;
  planned_variations?: number;
  pre_gen_score?: number;
  recommended_route?: string;
}

export interface TransparencyTraceView {
  trace_id: string;
  created_at: string;
  engine_version: string;
  candidates: CandidatePlanRow[];
  plan_output: {
    suppressed: boolean;
    suppression_reasons: GenerationPlanResult["suppression_reasons"];
    selected: PlannedJob[];
    dropped_candidates: GenerationPlanResult["dropped_candidates"];
    meta: GenerationPlanResult["meta"];
  };
}

function isGenerationPlanResult(v: unknown): v is GenerationPlanResult {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.trace_id === "string" && Array.isArray(o.selected) && Array.isArray(o.dropped_candidates);
}

function isPlanRequest(v: unknown): v is { candidates?: CandidateInput[] } {
  return v != null && typeof v === "object" && "candidates" in (v as object);
}

export function buildTransparencyTraceView(
  inputSnapshot: unknown,
  outputSnapshot: unknown,
  traceMeta: { trace_id: string; created_at: string; engine_version: string }
): TransparencyTraceView | null {
  if (!isPlanRequest(inputSnapshot) || !isGenerationPlanResult(outputSnapshot)) return null;
  const candidates = Array.isArray(inputSnapshot.candidates) ? inputSnapshot.candidates : [];
  const output = outputSnapshot;

  const selectedByCandidate = new Map<string, PlannedJob[]>();
  for (const j of output.selected) {
    const list = selectedByCandidate.get(j.candidate_id) ?? [];
    list.push(j);
    selectedByCandidate.set(j.candidate_id, list);
  }

  const droppedByCandidate = new Map<string, (typeof output.dropped_candidates)[0]>();
  for (const d of output.dropped_candidates) {
    droppedByCandidate.set(d.candidate_id, d);
  }

  const rows: CandidatePlanRow[] = candidates.map((c) => {
    const sel = selectedByCandidate.get(c.candidate_id);
    if (sel?.length) {
      const first = sel[0];
      return {
        ...c,
        outcome: "planned",
        planned_variations: sel.length,
        pre_gen_score: first.pre_gen_score,
        recommended_route: first.recommended_route,
      };
    }
    const dr = droppedByCandidate.get(c.candidate_id);
    if (dr) {
      return {
        ...c,
        outcome: "dropped",
        outcome_detail: dr.reason,
        pre_gen_score: dr.pre_gen_score,
      };
    }
    return {
      ...c,
      outcome: "unknown",
      outcome_detail:
        "Not listed in plan output (e.g. deduped before scoring or cut by max_candidates without a drop record)",
    };
  });

  return {
    trace_id: traceMeta.trace_id,
    created_at: traceMeta.created_at,
    engine_version: traceMeta.engine_version,
    candidates: rows,
    plan_output: {
      suppressed: output.suppressed,
      suppression_reasons: output.suppression_reasons,
      selected: output.selected,
      dropped_candidates: output.dropped_candidates,
      meta: output.meta,
    },
  };
}
