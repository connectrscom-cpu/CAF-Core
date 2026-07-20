export interface LearningRule {
  rule_id: string;
  trigger_type: string;
  scope_flow_type: string | null;
  scope_platform: string | null;
  action_type: string;
  action_payload: Record<string, unknown>;
  confidence: number | null;
  status: string;
  applied_at: string | null;
  created_at: string;
  scope_type?: string;
  rule_family?: string;
  storage_project_slug?: string;
  provenance?: string | null;
  source_entity_ids?: unknown;
  evidence_refs?: unknown;
}

export type LearningSectionId = "inbox" | "analyzers" | "reviews" | "observatory" | "context";

/** Per-rule scorecard from GET /v1/learning/:slug/rules/effectiveness (generation-path attribution). */
export interface RuleEffectivenessEntry {
  rule_id: string;
  attributed_tasks: number;
  decided_tasks: number;
  approved: number;
  needs_edit: number;
  rejected: number;
  approval_rate: number | null;
  approval_delta_vs_baseline: number | null;
  published: number;
  metrics_present: number;
  analyzed: number;
  avg_engagement_rate: number | null;
  engagement_delta_vs_baseline: number | null;
  sample_sufficient: boolean;
  sample_task_ids: string[];
  phases?: string[];
  holdout?: {
    control_tasks: number;
    control_decided: number;
    control_approved: number;
    control_approval_rate: number | null;
    approval_delta_vs_control: number | null;
    control_avg_engagement_rate: number | null;
    engagement_delta_vs_control: number | null;
  } | null;
}

export interface RuleEffectivenessReport {
  ok: boolean;
  window_days: number;
  min_decided: number;
  coverage_note?: string;
  baseline: {
    decided_tasks: number;
    approved_tasks: number;
    approval_rate: number | null;
    avg_engagement_rate: number | null;
  };
  rules: RuleEffectivenessEntry[];
}
