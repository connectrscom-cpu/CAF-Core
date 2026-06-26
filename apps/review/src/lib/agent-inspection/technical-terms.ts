import { OPERATOR_LABELS } from "@/lib/marketer/language";
import { buildCopyInventory } from "./copy-inventory";

/** Backend/internal CAF terms that should not appear in marketer-facing UI. */
export const TECHNICAL_TERM_PATTERNS: { term: string; pattern: RegExp; recommendation: string }[] = [
  { term: "project_slug", pattern: /\bproject_slug\b/i, recommendation: "Use brand slug in operator-only contexts." },
  { term: "project", pattern: /\bproject\b/i, recommendation: "Use Brand instead in marketer-facing UI." },
  { term: "run_id", pattern: /\brun_id\b/i, recommendation: "Use content cycle or run label in operator tools only." },
  { term: "run", pattern: /\brun\b/i, recommendation: "Prefer content cycle in marketer-facing UI." },
  { term: "signal pack", pattern: /\bsignal\s*pack\b/i, recommendation: "Use research brief in marketer-facing UI." },
  { term: "candidate", pattern: /\bcandidate\b/i, recommendation: "Use idea in marketer-facing UI." },
  { term: "planner row", pattern: /\bplanner\s*row\b/i, recommendation: "Hide internal planning identifiers." },
  { term: "content job", pattern: /\bcontent\s*job\b/i, recommendation: "Use content piece in marketer-facing UI." },
  { term: "task_id", pattern: /\btask_id\b/i, recommendation: "Hide internal task identifiers from marketers." },
  { term: "flow_type", pattern: /\bflow_type\b/i, recommendation: "Use content format label instead." },
  { term: "generation_payload", pattern: /\bgeneration_payload\b/i, recommendation: "Internal only — never show in UI." },
  { term: "qc_result", pattern: /\bqc_result\b/i, recommendation: "Use quality check in marketer-facing UI." },
  { term: "render_state", pattern: /\brender_state\b/i, recommendation: "Internal only — never show in UI." },
  { term: "mimic mode", pattern: /\bmimic\s*mode\b/i, recommendation: "Use visual mimic or winning format in UI." },
  { term: "provider session", pattern: /\bprovider\s*session\b/i, recommendation: "Internal only — never show in UI." },
  { term: "publication placement", pattern: /\bpublication\s*placement\b/i, recommendation: "Use scheduled post in marketer-facing UI." },
  { term: "learning rule", pattern: /\blearning\s*rule\b/i, recommendation: "Use insight or recommendation in marketer-facing UI." },
];

export interface TechnicalTermHit {
  term: string;
  where: string;
  recommendation: string;
}

/** Scan known visible label inventories for technical term leakage. */
export function scanTechnicalTermsInCopy(): TechnicalTermHit[] {
  const inventory = buildCopyInventory();
  const hits: TechnicalTermHit[] = [];
  const seen = new Set<string>();

  const buckets: [string, string[]][] = [
    ["Sidebar labels", inventory.sidebar_labels],
    ["Dashboard labels", inventory.dashboard_labels],
    ["Status labels", inventory.status_labels],
    ["Workspace labels", inventory.workspace_labels],
    ["Operator nav labels", Object.values(OPERATOR_LABELS)],
  ];

  for (const [where, labels] of buckets) {
    for (const label of labels) {
      for (const { term, pattern, recommendation } of TECHNICAL_TERM_PATTERNS) {
        const key = `${term}::${where}`;
        if (seen.has(key)) continue;
        if (pattern.test(label)) {
          seen.add(key);
          hits.push({ term, where, recommendation });
        }
      }
    }
  }

  return hits;
}
