import type { EditorialEngineeringTrigger } from "../config/editorial-engineering-triggers.js";
import { triggersForInsight } from "../config/editorial-engineering-triggers.js";

/** Minimal shape — avoids importing editorial-learning (cycles). */
export interface EditorialInsightBrief {
  insight_type: string;
  scope: string;
  detail: string;
  sample_size: number;
}

export interface EngineeringPromptReviewRow {
  task_id: string;
  rejection_tags: unknown[];
  overrides_json: Record<string, unknown>;
}

export interface EngineeringRemediationBrief {
  markdown: string;
  triggers_fired: Array<{
    trigger_id: string;
    insight_type: string;
    scope: string;
    subsystem: string;
  }>;
  sample_task_ids: string[];
}

function uniqueStrings(xs: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const t = x.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

function sampleTaskIdsForTag(reviews: EngineeringPromptReviewRow[], tag: string, limit: number): string[] {
  const ids: string[] = [];
  for (const r of reviews) {
    const tags = r.rejection_tags;
    if (!Array.isArray(tags)) continue;
    if (tags.some((t) => String(t) === tag)) ids.push(r.task_id);
  }
  return uniqueStrings(ids, limit);
}

function sampleTaskIdsForOverrideField(reviews: EngineeringPromptReviewRow[], field: string, limit: number): string[] {
  const ids: string[] = [];
  for (const r of reviews) {
    const o = r.overrides_json;
    if (!o || typeof o !== "object") continue;
    if (!(field in o)) continue;
    const v = o[field];
    if (v != null && v !== "") ids.push(r.task_id);
  }
  return uniqueStrings(ids, limit);
}

function sampleTaskIdsForLowApprovalFlow(taskIdsFromDb: string[], limit: number): string[] {
  return uniqueStrings(taskIdsFromDb, limit);
}

function sectionForTrigger(
  trigger: EditorialEngineeringTrigger,
  insight: EditorialInsightBrief,
  sampleIds: string[]
): string {
  const lines: string[] = [];
  lines.push(`### ${trigger.subsystem}`);
  lines.push(`- **Trigger:** \`${trigger.id}\` (${insight.insight_type} → \`${insight.scope}\`)`);
  lines.push(`- **Evidence:** ${insight.detail}`);
  lines.push(`- **Where to look:** ${trigger.search_paths.map((p) => `\`${p}\``).join(", ")}`);
  lines.push(`- **Remediation hint:** ${trigger.remediation_hint}`);
  if (sampleIds.length > 0) {
    lines.push(`- **Sample \`task_id\` values:** ${sampleIds.map((id) => `\`${id}\``).join(", ")}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Builds a markdown prompt suitable for pasting into Claude / Cursor when editorial
 * patterns match configured engineering triggers (templates, renderer, generation, etc.).
 */
export function buildEngineeringRemediationPrompt(input: {
  projectSlug: string;
  windowDays: number;
  totalReviews: number;
  approvalRate: number;
  insights: EditorialInsightBrief[];
  reviews: EngineeringPromptReviewRow[];
  /** task_ids for jobs in a low-approval flow (optional; from SQL) */
  lowApprovalFlowTaskIds?: Record<string, string[]>;
}): EngineeringRemediationBrief {
  const fired: EngineeringRemediationBrief["triggers_fired"] = [];
  const allSampleIds: string[] = [];
  const sections: string[] = [];

  for (const insight of input.insights) {
    const matched = triggersForInsight(insight.insight_type, insight.scope);
    for (const trigger of matched) {
      let samples: string[] = [];
      if (insight.insight_type === "frequent_rejection_tag") {
        samples = sampleTaskIdsForTag(input.reviews, insight.scope, 5);
      } else if (insight.insight_type === "frequent_override_field") {
        samples = sampleTaskIdsForOverrideField(input.reviews, insight.scope, 5);
      } else if (insight.insight_type === "low_approval_flow") {
        const fromDb = input.lowApprovalFlowTaskIds?.[insight.scope] ?? [];
        samples = sampleTaskIdsForLowApprovalFlow(fromDb, 5);
      }
      allSampleIds.push(...samples);
      fired.push({
        trigger_id: trigger.id,
        insight_type: insight.insight_type,
        scope: insight.scope,
        subsystem: trigger.subsystem,
      });
      sections.push(sectionForTrigger(trigger, insight, samples));
    }
  }

  if (sections.length === 0) {
    return { markdown: "", triggers_fired: [], sample_task_ids: [] };
  }

  const header = [
    "# CAF — engineering remediation (from editorial analysis)",
    "",
    `**Project:** \`${input.projectSlug}\`  `,
    `**Evidence window:** last ${input.windowDays} days  `,
    `**Reviews analyzed:** ${input.totalReviews}  `,
    `**Approval rate (window):** ${(input.approvalRate * 100).toFixed(1)}%  `,
    "",
    "## Constraints",
    "",
    "- Preserve the existing \`task_id\` / text-ID hierarchy; do not rename ID schemes in a partial change.",
    "- \`learning_rules\` already adjust ranking and volume; this brief is for **code, templates, or pipeline** when prompts alone are insufficient.",
    "- Prefer the smallest change that addresses the pattern; add a test or rendered snapshot if the issue is visual.",
    "",
    "## Patterns matched to engineering surfaces",
    "",
    ...sections,
    "## Suggested agent workflow",
    "",
    "1. Use the sample \`task_id\` values to load the latest draft, assets, and \`editorial_reviews\` rows in Core or the review app.",
    "2. Reproduce the failure mode (render output, payload shape, or review UX).",
    "3. Implement the fix in the paths listed above; avoid unrelated refactors.",
    "4. Summarize what changed and which triggers (\`trigger id\`) you believe are addressed.",
    "",
  ].join("\n");

  return {
    markdown: header,
    triggers_fired: fired,
    sample_task_ids: uniqueStrings(allSampleIds, 12),
  };
}
