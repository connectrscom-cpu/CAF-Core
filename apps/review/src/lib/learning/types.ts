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
