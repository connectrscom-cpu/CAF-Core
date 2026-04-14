/**
 * Editorial Learning Service — Learning Loop B.
 *
 * Analyzes editorial review patterns to detect:
 * - Frequent rejection reasons
 * - Recurring edits to hooks/captions
 * - Flow types with low approval
 * - Reviewer-written notes (deterministic signal + optional OpenAI synthesis)
 * - Platform-specific failure patterns
 * - Prompt versions associated with more overrides
 *
 * Produces LearningRules that influence future generation.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { triggersForInsight } from "../config/editorial-engineering-triggers.js";
import { q } from "../db/queries.js";
import { insertInsight } from "../repositories/learning-evidence.js";
import { insertLearningRule } from "../repositories/learning.js";
import { buildEngineeringRemediationPrompt } from "./editorial-engineering-prompt.js";
import { templateNameFromPayload } from "./carousel-render-pack.js";
import {
  synthesizeEditorialNotesWithLlm,
  type EditorialNotesLlmResult,
  type EditorialNotesLlmSynthesis,
} from "./editorial-notes-llm-synthesis.js";

export interface EditorialInsight {
  insight_type: string;
  scope: string;
  detail: string;
  confidence: number;
  sample_size: number;
  rule_created: boolean;
  rule_id?: string;
}

export interface EditorialAnalysisResult {
  project_slug: string;
  window_days: number;
  total_reviews: number;
  approval_rate: number;
  rejection_rate: number;
  needs_edit_rate: number;
  top_rejection_tags: Array<{ tag: string; count: number }>;
  insights: EditorialInsight[];
  rules_created: number;
  /** Markdown prompt for Claude/Cursor when editorial patterns map to code/templates (empty if no triggers matched). */
  engineering_prompt_markdown: string;
  engineering_triggers_fired: Array<{
    trigger_id: string;
    insight_type: string;
    scope: string;
    subsystem: string;
  }>;
  engineering_sample_task_ids: string[];
  /** Set when the brief was upserted into `learning_insights`. */
  engineering_insight_id: string | null;
  /** OpenAI synthesis from reviewer `notes` (skipped if no key, no notes, or error). */
  llm_notes_synthesis: EditorialNotesLlmResult | null;
}

function formatLlmNotesForPrompt(s: EditorialNotesLlmSynthesis): string {
  const themeLines =
    s.recurring_themes?.length > 0
      ? s.recurring_themes
          .map((t) => {
            const q = (t.example_quotes ?? []).slice(0, 2).map((x) => `"${x}"`).join("; ");
            const c = t.approx_count != null ? ` (~${t.approx_count})` : "";
            return `- **${t.theme}**${c}${q ? ` — e.g. ${q}` : ""}`;
          })
          .join("\n")
      : "_No themes extracted._";

  const actionLines =
    s.recommended_actions?.length > 0
      ? s.recommended_actions
          .map(
            (a) =>
              `#### ${a.title} (${a.priority} · ${a.category})\n` +
              (a.carousel_template_name
                ? `**Template:** \`${Array.isArray(a.carousel_template_name) ? a.carousel_template_name.join(", ") : String(a.carousel_template_name)}\`\n`
                : "") +
              (a.where_to_change
                ? `**Where to change:** ${
                    Array.isArray(a.where_to_change)
                      ? a.where_to_change.map((p) => `\`${p}\``).join(", ")
                      : `\`${String(a.where_to_change)}\``
                  }\n`
                : "") +
              `\n${a.rationale}\n\n_Next:_ ${a.suggested_next_steps}\n` +
              (a.example_task_ids?.length ? `\n\`task_id\` examples: ${a.example_task_ids.map((id) => `\`${id}\``).join(", ")}\n` : "")
          )
          .join("\n")
      : "_No structured actions._";

  const code = (s.coding_agent_markdown ?? "").trim();
  return [
    "## Reviewer notes — OpenAI synthesis",
    "",
    s.summary.trim(),
    "",
    "### Recurring themes",
    themeLines,
    "",
    "### Recommended actions",
    actionLines,
    "",
    "### Coding agent brief",
    code || "_No separate coding brief; use themes and actions above._",
    "",
  ].join("\n");
}

function mergeEngineeringMarkdown(heuristicMd: string, llmBlock: string): string {
  const h = heuristicMd.trim();
  const l = llmBlock.trim();
  if (h && l) return `${h}\n\n---\n\n${l}`;
  return h || l;
}

/**
 * Analyze editorial review history for a project and generate learning rules.
 *
 * @param llmNotesSynthesis When true (default if `OPENAI_API_KEY` is set), runs an OpenAI pass on non-empty reviewer notes.
 */
export async function analyzeEditorialPatterns(
  db: Pool,
  config: AppConfig,
  projectId: string,
  projectSlug: string,
  windowDays: number = 30,
  autoCreateRules: boolean = true,
  persistEngineeringInsight: boolean = true,
  llmNotesSynthesis?: boolean
): Promise<EditorialAnalysisResult> {
  const runLlmOnNotes =
    llmNotesSynthesis !== undefined ? llmNotesSynthesis : Boolean(config.OPENAI_API_KEY?.trim());

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const analysisRunDay = new Date().toISOString().slice(0, 10);

  const reviews = await q<{
    task_id: string;
    decision: string | null;
    rejection_tags: unknown[];
    notes: string | null;
    overrides_json: Record<string, unknown>;
    created_at: string;
    flow_type: string | null;
    platform: string | null;
    generation_payload: Record<string, unknown>;
  }>(
    db,
    `
    SELECT er.task_id, er.decision, er.rejection_tags, er.notes, er.overrides_json, er.created_at,
           j.flow_type, j.platform,
           COALESCE(j.generation_payload, '{}'::jsonb) AS generation_payload
    FROM caf_core.editorial_reviews er
    LEFT JOIN caf_core.content_jobs j
      ON j.task_id = er.task_id AND j.project_id = er.project_id
    WHERE er.project_id = $1 AND er.created_at >= $2
    ORDER BY er.created_at DESC
  `,
    [projectId, cutoff.toISOString()]
  );

  if (reviews.length === 0) {
    return {
      project_slug: projectSlug,
      window_days: windowDays,
      total_reviews: 0,
      approval_rate: 0,
      rejection_rate: 0,
      needs_edit_rate: 0,
      top_rejection_tags: [],
      insights: [],
      rules_created: 0,
      engineering_prompt_markdown: "",
      engineering_triggers_fired: [],
      engineering_sample_task_ids: [],
      engineering_insight_id: null,
      llm_notes_synthesis: null,
    };
  }

  const total = reviews.length;
  const approved = reviews.filter((r) => r.decision === "APPROVED").length;
  const rejected = reviews.filter((r) => r.decision === "REJECTED").length;
  const needsEdit = reviews.filter((r) => r.decision === "NEEDS_EDIT").length;

  // Aggregate rejection tags
  const tagCounts = new Map<string, number>();
  for (const review of reviews) {
    const tags = review.rejection_tags;
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        const t = String(tag);
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
  }

  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  // Aggregate override patterns
  const overrideFields = new Map<string, number>();
  for (const review of reviews) {
    const overrides = review.overrides_json;
    if (overrides && typeof overrides === "object") {
      for (const key of Object.keys(overrides)) {
        if (overrides[key] != null && overrides[key] !== "") {
          overrideFields.set(key, (overrideFields.get(key) ?? 0) + 1);
        }
      }
    }
  }

  // Per-flow-type approval rates
  const flowReviews = await q<{ flow_type: string; decision: string; cnt: string }>(db, `
    SELECT j.flow_type, er.decision, COUNT(*)::text AS cnt
    FROM caf_core.editorial_reviews er
    JOIN caf_core.content_jobs j ON j.task_id = er.task_id AND j.project_id = er.project_id
    WHERE er.project_id = $1 AND er.created_at >= $2 AND er.decision IS NOT NULL
    GROUP BY j.flow_type, er.decision
  `, [projectId, cutoff.toISOString()]);

  const flowStats = new Map<string, { approved: number; rejected: number; needs_edit: number; total: number }>();
  for (const row of flowReviews) {
    const stats = flowStats.get(row.flow_type) ?? { approved: 0, rejected: 0, needs_edit: 0, total: 0 };
    const count = parseInt(row.cnt, 10);
    stats.total += count;
    if (row.decision === "APPROVED") stats.approved += count;
    else if (row.decision === "REJECTED") stats.rejected += count;
    else if (row.decision === "NEEDS_EDIT") stats.needs_edit += count;
    flowStats.set(row.flow_type, stats);
  }

  const insights: EditorialInsight[] = [];
  let rulesCreated = 0;

  // Insight: high rejection tags
  for (const { tag, count } of topTags) {
    if (count >= 3 && count / total >= 0.15) {
      const insight: EditorialInsight = {
        insight_type: "frequent_rejection_tag",
        scope: tag,
        detail: `Tag "${tag}" appears in ${count}/${total} reviews (${(count / total * 100).toFixed(0)}%)`,
        confidence: Math.min(0.95, count / total + 0.3),
        sample_size: count,
        rule_created: false,
      };

      if (autoCreateRules) {
        const ruleId = `editorial_tag_${tag.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}_${Date.now()}`;
        const tagTaskIds = reviews
          .filter((r) => Array.isArray(r.rejection_tags) && r.rejection_tags.includes(tag))
          .map((r) => r.task_id);
        await insertLearningRule(db, {
          rule_id: ruleId,
          project_id: projectId,
          trigger_type: "editorial_rejection_pattern",
          action_type: "SCORE_PENALTY",
          action_payload: {
            rejection_tag: tag,
            penalty: -0.15,
            window_days: windowDays,
            observation: insight.detail,
          },
          confidence: insight.confidence,
          source_entity_ids: tagTaskIds,
          evidence_refs: tagTaskIds,
          rule_family: "ranking",
          provenance: "editorial_analysis",
        });
        insight.rule_created = true;
        insight.rule_id = ruleId;
        rulesCreated++;
      }

      insights.push(insight);
    }
  }

  // Insight: flow types with low approval
  for (const [flowType, stats] of flowStats) {
    if (stats.total >= 5) {
      const approvalRate = stats.approved / stats.total;
      if (approvalRate < 0.5) {
        const insight: EditorialInsight = {
          insight_type: "low_approval_flow",
          scope: flowType,
          detail: `Flow "${flowType}" has ${(approvalRate * 100).toFixed(0)}% approval (${stats.approved}/${stats.total})`,
          confidence: Math.min(0.9, 0.4 + stats.total * 0.05),
          sample_size: stats.total,
          rule_created: false,
        };

        if (autoCreateRules && approvalRate < 0.3) {
          const ruleId = `editorial_low_approval_${flowType}_${Date.now()}`;
          await insertLearningRule(db, {
            rule_id: ruleId,
            project_id: projectId,
            trigger_type: "editorial_low_approval",
            scope_flow_type: flowType,
            action_type: "REDUCE_VOLUME",
            action_payload: {
              flow_type: flowType,
              approval_rate: approvalRate,
              recommendation: "reduce volume or switch prompt version",
              observation: insight.detail,
            },
            confidence: insight.confidence,
            source_entity_ids: [],
            evidence_refs: [`flow_stats:${flowType}:${windowDays}d`],
            rule_family: "suppression",
            provenance: "editorial_analysis",
          });
          insight.rule_created = true;
          insight.rule_id = ruleId;
          rulesCreated++;
        }

        insights.push(insight);
      }
    }
  }

  // Insight: frequently overridden fields
  for (const [field, count] of overrideFields) {
    if (count >= 3 && count / total >= 0.2) {
      insights.push({
        insight_type: "frequent_override_field",
        scope: field,
        detail: `Field "${field}" is overridden in ${count}/${total} reviews (${(count / total * 100).toFixed(0)}%)`,
        confidence: Math.min(0.85, count / total + 0.2),
        sample_size: count,
        rule_created: false,
      });
    }
  }

  const reviewsWithNotes = reviews.filter((r) => (r.notes ?? "").trim().length > 0);
  const notesCount = reviewsWithNotes.length;
  if (notesCount >= 3 && notesCount / total >= 0.08) {
    insights.push({
      insight_type: "frequent_reviewer_notes",
      scope: "notes",
      detail: `${notesCount}/${total} reviews include non-empty reviewer notes (${((notesCount / total) * 100).toFixed(0)}%)`,
      confidence: Math.min(0.88, notesCount / total + 0.15),
      sample_size: notesCount,
      rule_created: false,
    });
  }

  // Sample task_ids for low-approval flows (for engineering brief)
  const lowApprovalFlowTaskIds: Record<string, string[]> = {};
  const lowFlowScopes = new Set<string>();
  for (const ins of insights) {
    if (ins.insight_type !== "low_approval_flow") continue;
    if (triggersForInsight(ins.insight_type, ins.scope).length === 0) continue;
    lowFlowScopes.add(ins.scope);
  }
  for (const flowType of lowFlowScopes) {
    const rows = await q<{ task_id: string }>(
      db,
      `SELECT er.task_id
       FROM caf_core.editorial_reviews er
       JOIN caf_core.content_jobs j ON j.task_id = er.task_id AND j.project_id = er.project_id
       WHERE er.project_id = $1 AND er.created_at >= $2 AND j.flow_type = $3
         AND er.decision IN ('REJECTED', 'NEEDS_EDIT')
       ORDER BY er.created_at DESC
       LIMIT 8`,
      [projectId, cutoff.toISOString(), flowType]
    );
    lowApprovalFlowTaskIds[flowType] = rows.map((r) => r.task_id);
  }

  const engBrief = buildEngineeringRemediationPrompt({
    projectSlug,
    windowDays,
    totalReviews: total,
    approvalRate: approved / total,
    insights,
    reviews: reviews.map((r) => ({
      task_id: r.task_id,
      rejection_tags: r.rejection_tags,
      overrides_json: r.overrides_json ?? {},
    })),
    lowApprovalFlowTaskIds,
  });

  let llmNotesResult: EditorialNotesLlmResult | null = null;
  if (runLlmOnNotes) {
    const aggregate = {
      total_reviews: total,
      approval_rate: approved / total,
      rejection_rate: rejected / total,
      needs_edit_rate: needsEdit / total,
      top_rejection_tags: topTags,
      top_override_fields: Array.from(overrideFields.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([field, count]) => ({ field, count })),
      deterministic_insights: insights.map((i) => ({
        type: i.insight_type,
        scope: i.scope,
        detail: i.detail,
      })),
      reviews_with_notes_count: notesCount,
    };

    llmNotesResult = await synthesizeEditorialNotesWithLlm(db, config, projectId, {
      projectSlug,
      windowDays,
      aggregate,
      noteRows: reviews.map((r) => ({
        task_id: r.task_id,
        decision: r.decision,
        flow_type: r.flow_type,
        platform: r.platform,
        rejection_tags: r.rejection_tags,
        carousel_template_name: templateNameFromPayload(r.generation_payload ?? {}).replace(/\.hbs$/i, "").trim() || null,
        carousel_template_path_hint: (() => {
          const base = templateNameFromPayload(r.generation_payload ?? {}).replace(/\.hbs$/i, "").trim();
          return base ? `services/renderer/templates/${base}.hbs` : null;
        })(),
        note: (r.notes ?? "").trim(),
        created_at: r.created_at,
      })),
    });
  }

  const llmMdBlock =
    llmNotesResult && !("skipped" in llmNotesResult) ? formatLlmNotesForPrompt(llmNotesResult) : "";
  const combinedEngineeringMd = mergeEngineeringMarkdown(engBrief.markdown, llmMdBlock);

  let engineeringInsightId: string | null = null;
  if (combinedEngineeringMd && persistEngineeringInsight) {
    engineeringInsightId = `eng_editorial_${projectSlug}_${windowDays}d_${analysisRunDay}`;
    const triggerCount = engBrief.triggers_fired.length;
    const llmOk = llmNotesResult && !("skipped" in llmNotesResult);
    await insertInsight(db, {
      insight_id: engineeringInsightId,
      scope_type: "engineering",
      project_id: projectId,
      title: `Engineering brief: editorial (${windowDays}d, ${triggerCount} trigger(s)${llmOk ? ", LLM notes" : ""})`,
      body: combinedEngineeringMd,
      derived_from_observation_ids: [],
      confidence:
        triggerCount > 0 || llmOk
          ? Math.min(0.9, 0.55 + triggerCount * 0.05 + (llmOk ? 0.1 : 0))
          : null,
      status: "draft",
    });
  }

  const extraSampleIds =
    llmNotesResult && !("skipped" in llmNotesResult)
      ? (llmNotesResult.recommended_actions ?? []).flatMap((a) => a.example_task_ids ?? [])
      : [];
  const mergedSampleIds = [...new Set([...engBrief.sample_task_ids, ...extraSampleIds])].slice(0, 20);

  return {
    project_slug: projectSlug,
    window_days: windowDays,
    total_reviews: total,
    approval_rate: approved / total,
    rejection_rate: rejected / total,
    needs_edit_rate: needsEdit / total,
    top_rejection_tags: topTags,
    insights,
    rules_created: rulesCreated,
    engineering_prompt_markdown: combinedEngineeringMd,
    engineering_triggers_fired: engBrief.triggers_fired,
    engineering_sample_task_ids: mergedSampleIds,
    engineering_insight_id: engineeringInsightId,
    llm_notes_synthesis: llmNotesResult,
  };
}
