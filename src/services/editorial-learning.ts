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
import { randomUUID } from "node:crypto";
import { triggersForInsight } from "../config/editorial-engineering-triggers.js";
import { q } from "../db/queries.js";
import { insertInsight, insertObservation } from "../repositories/learning-evidence.js";
import { insertLearningRule } from "../repositories/learning.js";
import { listRunOutputReviewsForEditorialWindow, type RunOutputReviewRow } from "../repositories/run-output-reviews.js";
import { buildEngineeringRemediationPrompt } from "./editorial-engineering-prompt.js";
import { templateNameFromPayload } from "./carousel-render-pack.js";
import {
  synthesizeEditorialNotesWithLlm,
  type EditorialNotesLlmResult,
  type EditorialNotesLlmSynthesis,
} from "./editorial-notes-llm-synthesis.js";
import {
  compactValidationOutputForEditorialSynthesis,
  validationCompactHasStructuredSignal,
} from "../domain/editorial-validation-for-synthesis.js";

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
  /** Rows marked `editorial_analysis_consumed_at` after this run (0 when nothing processed or marking disabled). */
  editorial_reviews_marked_consumed: number;
}

export interface AnalyzeEditorialPatternsOpts {
  /** When true (default), sets `editorial_analysis_consumed_at` on included review rows so the next run only picks up new reviews. */
  markReviewsConsumed?: boolean;
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

function formatRunOutputReviewsMarkdown(rows: RunOutputReviewRow[]): string {
  if (rows.length === 0) return "";
  const blocks = rows.map((r) => {
    const who = (r.validator ?? "").trim() || "operator";
    return `### Run \`${r.run_id}\` (${who} · ${r.updated_at})\n\n${r.body.trim()}`;
  });
  return ["## Holistic run output reviews (operator)", "", ...blocks].join("\n\n");
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
  llmNotesSynthesis?: boolean,
  analysisOpts?: AnalyzeEditorialPatternsOpts
): Promise<EditorialAnalysisResult> {
  const markReviewsConsumed = analysisOpts?.markReviewsConsumed !== false;
  const runLlmOnNotes =
    llmNotesSynthesis !== undefined ? llmNotesSynthesis : Boolean(config.OPENAI_API_KEY?.trim());

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const analysisRunDay = new Date().toISOString().slice(0, 10);

  const reviews = await q<{
    id: string;
    task_id: string;
    decision: string | null;
    rejection_tags: unknown[];
    notes: string | null;
    overrides_json: Record<string, unknown>;
    created_at: string;
    flow_type: string | null;
    platform: string | null;
    generation_payload: Record<string, unknown>;
    validation_output_json: Record<string, unknown>;
  }>(
    db,
    `
    SELECT er.id, er.task_id, er.decision, er.rejection_tags, er.notes, er.overrides_json, er.created_at,
           j.flow_type, j.platform,
           COALESCE(j.generation_payload, '{}'::jsonb) AS generation_payload,
           COALESCE(er.validation_output_json, '{}'::jsonb) AS validation_output_json
    FROM caf_core.editorial_reviews er
    LEFT JOIN caf_core.content_jobs j
      ON j.task_id = er.task_id AND j.project_id = er.project_id
    WHERE er.project_id = $1
      AND er.created_at >= $2
      AND er.submit = true
      AND er.decision IS NOT NULL
      AND er.editorial_analysis_consumed_at IS NULL
    ORDER BY er.created_at DESC
  `,
    [projectId, cutoff.toISOString()]
  );

  const runOutputReviews = await listRunOutputReviewsForEditorialWindow(db, projectId, cutoff.toISOString());

  if (reviews.length === 0 && runOutputReviews.length === 0) {
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
      editorial_reviews_marked_consumed: 0,
    };
  }

  const total = reviews.length;
  const approved = reviews.filter((r) => r.decision === "APPROVED").length;
  const rejected = reviews.filter((r) => r.decision === "REJECTED").length;
  const needsEdit = reviews.filter((r) => r.decision === "NEEDS_EDIT").length;
  const approvalRateWindow = total > 0 ? approved / total : 0;

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
    WHERE er.project_id = $1
      AND er.created_at >= $2
      AND er.decision IS NOT NULL
      AND er.submit = true
      AND er.editorial_analysis_consumed_at IS NULL
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
    if (total > 0 && count >= 3 && count / total >= 0.15) {
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
    if (total > 0 && count >= 3 && count / total >= 0.2) {
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
  const reviewsWithValidationSignal = reviews.filter((r) => {
    const c = compactValidationOutputForEditorialSynthesis(r.validation_output_json);
    return Boolean(c && validationCompactHasStructuredSignal(c));
  });
  const validationSignalCount = reviewsWithValidationSignal.length;
  if (total > 0 && notesCount >= 3 && notesCount / total >= 0.08) {
    insights.push({
      insight_type: "frequent_reviewer_notes",
      scope: "notes",
      detail: `${notesCount}/${total} reviews include non-empty reviewer notes (${((notesCount / total) * 100).toFixed(0)}%)`,
      confidence: Math.min(0.88, notesCount / total + 0.15),
      sample_size: notesCount,
      rule_created: false,
    });
  }
  if (total > 0 && validationSignalCount >= 3 && validationSignalCount / total >= 0.08) {
    insights.push({
      insight_type: "frequent_validation_findings",
      scope: "validation_output",
      detail: `${validationSignalCount}/${total} reviews carry structured validation signal (tags/findings/rework hints) (${((validationSignalCount / total) * 100).toFixed(0)}%)`,
      confidence: Math.min(0.88, validationSignalCount / total + 0.15),
      sample_size: validationSignalCount,
      rule_created: false,
    });
  }

  if (runOutputReviews.length > 0) {
    insights.push({
      insight_type: "run_output_operator_review",
      scope: `${runOutputReviews.length} run(s)`,
      detail: `Holistic run output reviews in window: ${runOutputReviews.map((r) => r.run_id).join(", ")}`,
      confidence: 0.72,
      sample_size: runOutputReviews.length,
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
       WHERE er.project_id = $1
         AND er.created_at >= $2
         AND j.flow_type = $3
         AND er.decision IN ('REJECTED', 'NEEDS_EDIT')
         AND er.submit = true
         AND er.editorial_analysis_consumed_at IS NULL
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
    approvalRate: approvalRateWindow,
    insights,
    reviews: reviews.map((r) => ({
      task_id: r.task_id,
      rejection_tags: r.rejection_tags,
      overrides_json: r.overrides_json ?? {},
    })),
    lowApprovalFlowTaskIds,
  });

  const runReviewMd = formatRunOutputReviewsMarkdown(runOutputReviews);
  const engineeringMarkdownBase =
    engBrief.markdown.trim() && runReviewMd
      ? `${engBrief.markdown.trim()}\n\n---\n\n${runReviewMd}`
      : engBrief.markdown.trim() || runReviewMd;

  let llmNotesResult: EditorialNotesLlmResult | null = null;
  if (runLlmOnNotes) {
    const aggregate = {
      total_reviews: total,
      approval_rate: approvalRateWindow,
      rejection_rate: total > 0 ? rejected / total : 0,
      needs_edit_rate: total > 0 ? needsEdit / total : 0,
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
      reviews_with_validation_signal_count: validationSignalCount,
      run_output_reviews: runOutputReviews.map((r) => ({
        run_id: r.run_id,
        body: r.body.length > 4000 ? `${r.body.slice(0, 4000)}…` : r.body,
        validator: r.validator,
        updated_at: r.updated_at,
      })),
    };

    llmNotesResult = await synthesizeEditorialNotesWithLlm(db, config, projectId, {
      projectSlug,
      windowDays,
      aggregate,
      runOutputReviews,
      noteRows: reviews.map((r) => {
        const compact = compactValidationOutputForEditorialSynthesis(r.validation_output_json);
        return {
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
          validation_compact: compact,
        };
      }),
    });

    // Ensure actions are template-aware even if the model omits fields:
    // resolve templates from example task_ids and attach template + repo path hints.
    if (llmNotesResult && !("skipped" in llmNotesResult) && Array.isArray(llmNotesResult.recommended_actions)) {
      const taskIds = [
        ...new Set(
          llmNotesResult.recommended_actions
            .flatMap((a) => (Array.isArray(a.example_task_ids) ? a.example_task_ids : []))
            .map((x) => String(x).trim())
            .filter(Boolean)
        ),
      ].slice(0, 120);

      if (taskIds.length > 0) {
        const rows = await q<{ task_id: string; generation_payload: Record<string, unknown> }>(
          db,
          `SELECT task_id, COALESCE(generation_payload, '{}'::jsonb) AS generation_payload
           FROM caf_core.content_jobs
           WHERE project_id = $1 AND task_id = ANY($2::text[])`,
          [projectId, taskIds]
        );
        const byTask = new Map<string, string>();
        for (const r of rows) {
          const base = templateNameFromPayload(r.generation_payload ?? {}).replace(/\.hbs$/i, "").trim();
          if (base) byTask.set(r.task_id, base);
        }

        llmNotesResult.recommended_actions = llmNotesResult.recommended_actions.map((a) => {
          const ex = Array.isArray(a.example_task_ids) ? a.example_task_ids : [];
          const templates = [
            ...new Set(
              ex
                .map((tid) => byTask.get(String(tid).trim()) ?? "")
                .map((t) => t.trim())
                .filter(Boolean)
            ),
          ];

          const existingT = a.carousel_template_name;
          const shouldAttachTemplate =
            (existingT == null || (Array.isArray(existingT) ? existingT.length === 0 : String(existingT).trim() === "")) &&
            templates.length > 0;

          const existingWhere = a.where_to_change;
          const hasWhere =
            existingWhere != null &&
            (Array.isArray(existingWhere) ? existingWhere.length > 0 : String(existingWhere).trim().length > 0);

          const templatePaths = templates.map((t) => `services/renderer/templates/${t}.hbs`);
          const whereToChange =
            hasWhere
              ? existingWhere
              : templates.length > 0
                ? templatePaths
                : a.category === "pipeline"
                  ? ["src/services/carousel-render-pack.ts"]
                  : a.category === "generation_prompt"
                    ? ["src/services/llm-generator.ts", "src/services/carousel-copy-prompt-policy.ts"]
                    : null;

          return {
            ...a,
            ...(shouldAttachTemplate ? { carousel_template_name: templates.length === 1 ? templates[0] : templates } : {}),
            ...(hasWhere ? {} : whereToChange ? { where_to_change: whereToChange } : {}),
          };
        });
      }
    }

    // Mint pending GENERATION_GUIDANCE rules from LLM-classified actions.
    //
    // Three action categories translate to LLM-injectable guidance (they change what the generator is told,
    // not the renderer code or the Core pipeline):
    //   - learning_rule           → generic ranking/suppression/guidance rule
    //   - generation_prompt       → edit to the text-copy / carousel generator prompt
    //   - video_generation_prompt → edit to the video script / video prompt / scene-assembly prompt
    //
    // These remain pending (operator-approved) but are injected automatically into the next editorial rework.
    // Categories like `renderer_template`, `heygen_template`, or `pipeline` intentionally *do not* mint a
    // guidance rule — they need code changes, not LLM guidance. They still appear in the engineering brief.
    if (llmNotesResult && !("skipped" in llmNotesResult)) {
      const noteMeta = new Map(
        reviews.map((r) => [r.task_id, { flow_type: r.flow_type ?? null, platform: r.platform ?? null }]) as Array<
          [string, { flow_type: string | null; platform: string | null }]
        >
      );
      const GUIDANCE_MINT_CATEGORIES = new Set([
        "learning_rule",
        "generation_prompt",
        "video_generation_prompt",
      ]);
      const VIDEO_GUIDANCE_CATEGORIES = new Set(["video_generation_prompt"]);

      const actions = (llmNotesResult.recommended_actions ?? []).filter((a) =>
        GUIDANCE_MINT_CATEGORIES.has(String(a.category ?? "").toLowerCase())
      );

      for (const a of actions.slice(0, 10)) {
        const category = String(a.category ?? "").toLowerCase();
        const ex = Array.isArray(a.example_task_ids)
          ? a.example_task_ids.map((x) => String(x).trim()).filter(Boolean)
          : [];

        const flowCounts = new Map<string, number>();
        const platformCounts = new Map<string, number>();
        for (const tid of ex) {
          const meta = noteMeta.get(tid);
          if (meta?.flow_type) flowCounts.set(meta.flow_type, (flowCounts.get(meta.flow_type) ?? 0) + 1);
          if (meta?.platform) platformCounts.set(meta.platform, (platformCounts.get(meta.platform) ?? 0) + 1);
        }
        const videoDefault = VIDEO_GUIDANCE_CATEGORIES.has(category);
        const scopeFlowType =
          [...flowCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ??
          (videoDefault ? "Video_Script_HeyGen" : "Flow_Carousel_Copy");
        const scopePlatform = [...platformCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "Instagram";

        const title = String(a.title ?? "").trim() || "Editorial guideline";
        const next = String(a.suggested_next_steps ?? "").trim();
        const rationale = String(a.rationale ?? "").trim();
        const guidance = [title, next, rationale].filter(Boolean).join("\n");
        if (!guidance.trim()) continue;

        const ruleId = `editorial_guidance_${randomUUID().replace(/-/g, "").slice(0, 16)}_${Date.now()}`;
        await insertLearningRule(db, {
          rule_id: ruleId,
          project_id: projectId,
          trigger_type: "editorial_notes_llm",
          scope_flow_type: scopeFlowType,
          scope_platform: scopePlatform,
          action_type: "GENERATION_GUIDANCE",
          action_payload: {
            guidance,
            title,
            category,
            bullets: next ? next.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 10) : [],
            example_task_ids: ex.slice(0, 10),
            carousel_template_name: (a.carousel_template_name as unknown) ?? null,
            where_to_change: (a.where_to_change as unknown) ?? null,
          },
          confidence:
            String(a.priority ?? "").toLowerCase() === "high"
              ? 0.75
              : String(a.priority ?? "").toLowerCase() === "medium"
                ? 0.6
                : 0.5,
          source_entity_ids: ex.slice(0, 10),
          rule_family: "generation",
          provenance: "editorial_notes_llm",
          created_by: "editorial_learning",
        });
        rulesCreated++;
      }
    }
  }

  const llmMdBlock =
    llmNotesResult && !("skipped" in llmNotesResult) ? formatLlmNotesForPrompt(llmNotesResult) : "";
  const combinedEngineeringMd = mergeEngineeringMarkdown(engineeringMarkdownBase, llmMdBlock);

  let engineeringInsightId: string | null = null;
  if (combinedEngineeringMd && persistEngineeringInsight) {
    engineeringInsightId = `eng_editorial_${projectSlug}_${windowDays}d_${analysisRunDay}`;
    const triggerCount = engBrief.triggers_fired.length;
    const llmOk = llmNotesResult && !("skipped" in llmNotesResult);
    const hasRunReviews = runOutputReviews.length > 0;
    await insertInsight(db, {
      insight_id: engineeringInsightId,
      scope_type: "engineering",
      project_id: projectId,
      title: `Engineering brief: editorial (${windowDays}d, ${triggerCount} trigger(s)${llmOk ? ", LLM notes" : ""}${hasRunReviews ? ", run reviews" : ""})`,
      body: combinedEngineeringMd,
      derived_from_observation_ids: [],
      confidence:
        triggerCount > 0 || llmOk || hasRunReviews
          ? Math.min(0.9, 0.55 + triggerCount * 0.05 + (llmOk ? 0.1 : 0) + (hasRunReviews ? 0.05 : 0))
          : null,
      status: "draft",
    });
  }

  // Persist the full analysis outcome (structured) for traceability/debugging.
  // This complements the engineering markdown insight by storing the raw JSON that produced it,
  // including validation_contract-derived signals and any LLM synthesis output.
  const analysisObservationId = `ed_analysis_${projectSlug}_${windowDays}d_${analysisRunDay}`;
  await insertObservation(db, {
    observation_id: analysisObservationId.length > 120 ? analysisObservationId.slice(0, 120) : analysisObservationId,
    scope_type: "project",
    project_id: projectId,
    source_type: "editorial_analysis",
    flow_type: null,
    platform: null,
    observation_type: "editorial_analysis_run",
    entity_ref: analysisRunDay,
    payload_json: {
      project_slug: projectSlug,
      window_days: windowDays,
      cutoff_iso: cutoff.toISOString(),
      total_reviews: total,
      approved,
      rejected,
      needs_edit: needsEdit,
      approval_rate: approvalRateWindow,
      top_rejection_tags: topTags,
      deterministic_insights: insights,
      rules_created: rulesCreated,
      engineering: {
        triggers_fired: engBrief.triggers_fired,
        sample_task_ids: mergedSampleIds,
        engineering_insight_id: engineeringInsightId,
      },
      llm_notes_synthesis: llmNotesResult,
      evidence_counts: {
        reviews_with_notes_count: notesCount,
        reviews_with_validation_signal_count: validationSignalCount,
        run_output_reviews_count: runOutputReviews.length,
      },
      run_output_reviews: runOutputReviews.map((r) => ({
        run_id: r.run_id,
        validator: r.validator,
        updated_at: r.updated_at,
        body: r.body.length > 6000 ? `${r.body.slice(0, 6000)}…` : r.body,
      })),
    },
    confidence:
      engBrief.triggers_fired.length > 0 || (llmNotesResult && !("skipped" in llmNotesResult)) || runOutputReviews.length > 0
        ? Math.min(
            0.92,
            0.55 +
              engBrief.triggers_fired.length * 0.05 +
              (llmNotesResult && !("skipped" in llmNotesResult) ? 0.12 : 0) +
              (runOutputReviews.length > 0 ? 0.06 : 0)
          )
        : null,
    observed_at: new Date().toISOString(),
  }).catch(() => {});

  const extraSampleIds =
    llmNotesResult && !("skipped" in llmNotesResult)
      ? (llmNotesResult.recommended_actions ?? []).flatMap((a) => a.example_task_ids ?? [])
      : [];
  const mergedSampleIds = [...new Set([...engBrief.sample_task_ids, ...extraSampleIds])].slice(0, 20);

  let editorial_reviews_marked_consumed = 0;
  if (markReviewsConsumed && reviews.length > 0) {
    const ids = reviews.map((r) => r.id);
    const upd = await db.query(
      `UPDATE caf_core.editorial_reviews
       SET editorial_analysis_consumed_at = now()
       WHERE project_id = $1 AND id = ANY($2::uuid[])`,
      [projectId, ids]
    );
    editorial_reviews_marked_consumed = upd.rowCount ?? ids.length;
  }

  return {
    project_slug: projectSlug,
    window_days: windowDays,
    total_reviews: total,
    approval_rate: approvalRateWindow,
    rejection_rate: total > 0 ? rejected / total : 0,
    needs_edit_rate: total > 0 ? needsEdit / total : 0,
    top_rejection_tags: topTags,
    insights,
    rules_created: rulesCreated,
    engineering_prompt_markdown: combinedEngineeringMd,
    engineering_triggers_fired: engBrief.triggers_fired,
    engineering_sample_task_ids: mergedSampleIds,
    engineering_insight_id: engineeringInsightId,
    llm_notes_synthesis: llmNotesResult,
    editorial_reviews_marked_consumed,
  };
}
