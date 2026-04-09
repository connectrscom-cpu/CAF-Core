import type { PlannedJob } from "../decision_engine/types.js";

export interface RunPromptVersionsSnapshot {
  trace_id: string;
  engine_version: string;
  captured_at: string;
  jobs: Array<{
    candidate_id: string;
    flow_type: string;
    variation_name: string;
    prompt_version_id: string | null;
    prompt_id: string | null;
    prompt_version_label: string | null;
  }>;
}

export function buildSnapshotFromPlannedJobs(
  selected: PlannedJob[],
  traceId: string,
  engineVersion: string
): RunPromptVersionsSnapshot {
  return {
    trace_id: traceId,
    engine_version: engineVersion,
    captured_at: new Date().toISOString(),
    jobs: selected.map((j) => ({
      candidate_id: j.candidate_id,
      flow_type: j.flow_type,
      variation_name: j.variation_name,
      prompt_version_id: j.prompt_version_id,
      prompt_id: j.prompt_id,
      prompt_version_label: j.prompt_version_label,
    })),
  };
}
