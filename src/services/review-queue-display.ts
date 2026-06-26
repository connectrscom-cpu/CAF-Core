import { resolveJobFlowDisplayLabel } from "../domain/job-flow-display-label.js";

/** Attach human `flow_label` / `flow_detail` for review queue / export consumers. */
export function enrichJobFlowDisplay<
  T extends { flow_type: string | null; generation_payload: Record<string, unknown> },
>(job: T): T & { flow_label: string; flow_detail: string | null; is_mimic_replication: boolean } {
  const info = resolveJobFlowDisplayLabel(job.flow_type, job.generation_payload);
  return {
    ...job,
    flow_label: info.flow_label,
    flow_detail: info.flow_detail,
    is_mimic_replication: info.is_mimic_replication,
  };
}
