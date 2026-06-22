import { resolveJobFlowDisplayLabel } from "../domain/job-flow-display-label.js";

/** Attach human `flow_label` for review queue / export consumers. */
export function enrichJobFlowDisplay<
  T extends { flow_type: string | null; generation_payload: Record<string, unknown> },
>(job: T): T & { flow_label: string; is_mimic_replication: boolean } {
  const info = resolveJobFlowDisplayLabel(job.flow_type, job.generation_payload);
  return {
    ...job,
    flow_label: info.flow_label,
    is_mimic_replication: info.is_mimic_replication,
  };
}
