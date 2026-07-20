/**
 * Content-feature synthesis for the performance loop (Loop 2 intelligence).
 *
 * The deterministic analysis says *which flows* over/under-perform; this pass
 * asks OpenAI *why*: it contrasts the copy of the best and worst performing
 * published tasks (hook/title/caption extracted from generation_payload) with
 * their metrics and returns feature-level hypotheses ("questions in hooks
 * outperform", "long captions underperform on IG") plus recommended guidance.
 *
 * Output lands as a `learning_observation` (source_type
 * `performance_llm_synthesis`) and optionally mints **pending**
 * GENERATION_GUIDANCE rules (max 3) — operators still activate them.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { q } from "../db/queries.js";
import { insertObservation } from "../repositories/learning-evidence.js";
import { insertLearningRule } from "../repositories/learning.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import { openaiChat } from "./openai-chat.js";
import { openAiMaxTokens } from "./openai-coerce.js";

const MAX_TASKS_PER_SIDE = 8;
const COPY_MAX_CHARS = 500;

export interface PerformanceTaskCopy {
  task_id: string;
  flow_type: string | null;
  platform: string | null;
  metric_value: number;
  hook: string;
  title: string;
  caption: string;
}

export interface PerformanceDriverFeature {
  feature: string;
  direction: "winning" | "losing";
  evidence_task_ids: string[];
  rationale: string;
}

export interface PerformanceDriverSynthesis {
  model: string;
  summary: string;
  features: PerformanceDriverFeature[];
  recommended_guidance: string[];
  total_tokens: number;
  observation_id: string;
  minted_rule_ids: string[];
}

export interface PerformanceDriverSkipped {
  skipped: true;
  reason: string;
}

export type PerformanceDriverResult = PerformanceDriverSynthesis | PerformanceDriverSkipped;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function cap(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= COPY_MAX_CHARS ? t : `${t.slice(0, COPY_MAX_CHARS)}…`;
}

/** Pure: extract comparable copy fields from a generation payload. */
export function extractCopyForPerformance(gp: Record<string, unknown>): {
  hook: string;
  title: string;
  caption: string;
} {
  const gen = pickGeneratedOutputOrEmpty(gp);
  const car = (gen.carousel && typeof gen.carousel === "object" && !Array.isArray(gen.carousel)
    ? (gen.carousel as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  return {
    hook: cap(str(gen.hook) || str(gen.generated_hook)),
    title: cap(str(gen.title) || str(gen.generated_title)),
    caption: cap(str(gen.caption) || str(car.caption) || str(car.post_caption)),
  };
}

const PERFORMANCE_DRIVER_SYSTEM_PROMPT = `You are a content-performance analyst for CAF (Content Automation Framework).

You receive two lists of published social content from the same brand: TOP performers and BOTTOM performers by a stated engagement metric. Each item has task_id, flow_type, platform, metric value, and the copy (hook / title / caption).

Your job: identify concrete, checkable content FEATURES that separate winners from losers — hook structure (question vs statement), specificity/numbers, emotional angle, caption length, CTA style, emoji/hashtag usage, topic categories. Do NOT restate flow-level differences (those are computed deterministically) — focus on copy and content features that generation prompts can act on.

Respond with a single JSON object only (no markdown fences), keys:
- summary: string (2-3 sentences)
- features: array of { feature: string, direction: "winning"|"losing", evidence_task_ids: string[], rationale: string } (max 8)
- recommended_guidance: array of strings (max 5) — each a single imperative guidance line ready to inject into a generation prompt, e.g. "Open hooks with a specific number or timeframe rather than a generic promise."

Only claim a feature when at least 2 items support it. If the sample is too small or copy is missing, return empty arrays and say why in summary.`;

async function listRankedTaskCopy(
  db: Pool,
  projectId: string,
  windowDays: number
): Promise<{ metric: string; tasks: PerformanceTaskCopy[] }> {
  const rows = await q<{
    task_id: string;
    flow_type: string | null;
    platform: string | null;
    engagement_rate: string | null;
    saves: string | null;
    generation_payload: Record<string, unknown>;
  }>(
    db,
    `SELECT pm.task_id, j.flow_type, j.platform,
            AVG(pm.engagement_rate)::text AS engagement_rate,
            AVG(pm.saves)::text AS saves,
            (array_agg(j.generation_payload))[1] AS generation_payload
     FROM caf_core.performance_metrics pm
     JOIN caf_core.content_jobs j ON j.task_id = pm.task_id AND j.project_id = pm.project_id
     WHERE pm.project_id = $1
       AND pm.created_at >= now() - make_interval(days => $2)
       AND pm.metric_window = 'stabilized'
       AND pm.task_id IS NOT NULL
     GROUP BY pm.task_id, j.flow_type, j.platform`,
    [projectId, windowDays]
  );

  const withEng = rows.filter((r) => r.engagement_rate != null && !isNaN(parseFloat(r.engagement_rate)));
  const useEngagement = withEng.length >= Math.max(3, rows.length / 2);
  const metric = useEngagement ? "engagement_rate" : "saves";

  const tasks: PerformanceTaskCopy[] = [];
  for (const r of useEngagement ? withEng : rows) {
    const value = parseFloat((useEngagement ? r.engagement_rate : r.saves) ?? "NaN");
    if (!Number.isFinite(value)) continue;
    const copy = extractCopyForPerformance(r.generation_payload ?? {});
    if (!copy.hook && !copy.title && !copy.caption) continue;
    tasks.push({
      task_id: r.task_id,
      flow_type: r.flow_type,
      platform: r.platform,
      metric_value: value,
      ...copy,
    });
  }
  tasks.sort((a, b) => b.metric_value - a.metric_value);
  return { metric, tasks };
}

function safeParse(raw: string): {
  summary: string;
  features: PerformanceDriverFeature[];
  recommended_guidance: string[];
} | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      summary: typeof o.summary === "string" ? o.summary : "",
      features: Array.isArray(o.features) ? (o.features as PerformanceDriverFeature[]).slice(0, 8) : [],
      recommended_guidance: Array.isArray(o.recommended_guidance)
        ? (o.recommended_guidance as unknown[]).map((g) => String(g)).filter(Boolean).slice(0, 5)
        : [],
    };
  } catch {
    return null;
  }
}

export async function synthesizePerformanceDriversWithLlm(
  db: Pool,
  config: AppConfig,
  projectId: string,
  projectSlug: string,
  opts: {
    windowDays: number;
    /** Mint pending GENERATION_GUIDANCE rules from recommended_guidance (max 3). Default false. */
    mint_pending_rules?: boolean;
  }
): Promise<PerformanceDriverResult> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) return { skipped: true, reason: "OPENAI_API_KEY not configured" };

  const { metric, tasks } = await listRankedTaskCopy(db, projectId, opts.windowDays);
  if (tasks.length < 6) {
    return { skipped: true, reason: `insufficient_published_tasks_with_copy (${tasks.length} < 6)` };
  }

  const top = tasks.slice(0, MAX_TASKS_PER_SIDE);
  const bottom = tasks.slice(-MAX_TASKS_PER_SIDE).reverse();

  const payload = {
    project_slug: projectSlug,
    window_days: opts.windowDays,
    metric,
    top_performers: top,
    bottom_performers: bottom,
  };

  try {
    const out = await openaiChat(
      apiKey,
      {
        model: config.OPENAI_MODEL,
        system_prompt: PERFORMANCE_DRIVER_SYSTEM_PROMPT,
        user_prompt: `Analyze the following performance contrast and produce the JSON object described in your instructions.\n\n${JSON.stringify(payload)}`,
        max_tokens: openAiMaxTokens(3072),
        response_format: "json_object",
      },
      { db, projectId, step: "performance_driver_synthesis" }
    );

    const parsed = safeParse(out.content);
    if (!parsed) return { skipped: true, reason: "llm_invalid_json" };

    const observationId = `perf_drivers_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
    await insertObservation(db, {
      observation_id: observationId,
      scope_type: "project",
      project_id: projectId,
      source_type: "performance_llm_synthesis",
      flow_type: null,
      platform: null,
      observation_type: "performance_driver_synthesis",
      entity_ref: null,
      payload_json: {
        metric,
        window_days: opts.windowDays,
        summary: parsed.summary,
        features: parsed.features,
        recommended_guidance: parsed.recommended_guidance,
        top_task_ids: top.map((t) => t.task_id),
        bottom_task_ids: bottom.map((t) => t.task_id),
        model: out.model,
      },
      confidence: null,
      observed_at: new Date().toISOString(),
    });

    const mintedRuleIds: string[] = [];
    if (opts.mint_pending_rules) {
      for (const guidance of parsed.recommended_guidance.slice(0, 3)) {
        const ruleId = `perf_guidance_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
        await insertLearningRule(db, {
          rule_id: ruleId,
          project_id: projectId,
          trigger_type: "performance_driver_synthesis",
          scope_flow_type: null,
          scope_platform: null,
          action_type: "GENERATION_GUIDANCE",
          action_payload: {
            guidance_kind: "performance_driver",
            guidance,
            instruction: guidance,
            metric,
            source_observation_id: observationId,
          },
          confidence: 0.5,
          source_entity_ids: top.slice(0, 5).map((t) => t.task_id),
          evidence_refs: [observationId],
          rule_family: "generation",
          provenance: "performance_driver_synthesis",
          created_by: "performance_llm_synthesis",
        });
        mintedRuleIds.push(ruleId);
      }
    }

    return {
      model: out.model,
      summary: parsed.summary,
      features: parsed.features,
      recommended_guidance: parsed.recommended_guidance,
      total_tokens: out.total_tokens,
      observation_id: observationId,
      minted_rule_ids: mintedRuleIds,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { skipped: true, reason: `openai_error:${msg.slice(0, 500)}` };
  }
}
