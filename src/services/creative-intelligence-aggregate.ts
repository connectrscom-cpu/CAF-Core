import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { openaiChat } from "./openai-chat.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { z } from "zod";
import {
  listCreativeVisualAnalyses,
  insertCreativeInsight,
  getCreativeVisualAnalysis,
} from "../repositories/creative-intelligence.js";

const aggOut = z.object({
  insights: z
    .array(
      z.object({
        insight_type: z.string(),
        title: z.string(),
        summary: z.string(),
        guidance: z.string(),
        evidence_analysis_ids: z.array(z.string()).optional(),
      })
    )
    .max(20),
});

export async function generateAggregatedCreativeInsights(
  db: Pool,
  config: AppConfig,
  projectId: string,
  opts?: { limit_analyses?: number; platform?: string | null }
): Promise<{ created: number; insight_refs: string[] }> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY required for aggregate creative insights");
  const lim = Math.min(Math.max(opts?.limit_analyses ?? 20, 1), 60);
  const rows = await listCreativeVisualAnalyses(db, projectId, { limit: lim, status: "completed" });
  if (rows.length === 0) return { created: 0, insight_refs: [] };

  const bundle = rows.map((r) => ({
    id: r.id,
    summary: (r.visual_summary ?? "").slice(0, 600),
    style_tags: r.style_tags_json,
    layout: r.layout_json,
    motion: r.motion_json,
    guidance: (r.generation_guidance ?? "").slice(0, 500),
  }));

  const sys = `You merge multiple visual analyses of top-performing social content into 3–8 reusable CREATIVE insights.
Return ONLY JSON: {"insights":[{"insight_type":"visual_style|layout|color|typography|motion|hook_pattern|format_pattern","title":"...","summary":"...","guidance":"...","evidence_analysis_ids":["uuid",...]}]}.
Each insight must cite evidence_analysis_ids from the input. Be project-agnostic. Guidance must be safe pattern-level (no "copy exactly").`;

  const user = `Analyses JSON:\n${JSON.stringify(bundle).slice(0, 100_000)}`;

  const out = await openaiChat(
    apiKey,
    {
      model: config.OPENAI_CREATIVE_INTEL_VISION_MODEL || "gpt-4o-mini",
      system_prompt: sys,
      user_prompt: user,
      max_tokens: 3000,
      response_format: "json_object",
    },
    { db, projectId, runId: null, taskId: null, signalPackId: null, step: "creative_intel_aggregate" }
  );

  const raw = parseJsonObjectFromLlmText(out.content);
  const parsed = aggOut.safeParse(raw);
  if (!parsed.success) return { created: 0, insight_refs: [] };

  const refs: string[] = [];
  for (const ins of parsed.data.insights) {
    const ref = `ci_agg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const evIds = (ins.evidence_analysis_ids ?? [])
      .map((x) => String(x).trim())
      .filter((id) => rows.some((r) => r.id === id));
    const assetIds: string[] = [];
    for (const aid of evIds.slice(0, 12)) {
      const a = await getCreativeVisualAnalysis(db, projectId, aid);
      if (a?.source_asset_id) assetIds.push(a.source_asset_id);
    }
    await insertCreativeInsight(db, {
      project_id: projectId,
      insight_ref: ref,
      scope_platform: opts?.platform ?? null,
      scope_media_type: null,
      scope_content_format: null,
      insight_type: ins.insight_type.slice(0, 80),
      title: ins.title.slice(0, 200),
      summary: ins.summary.slice(0, 2000),
      guidance: ins.guidance.slice(0, 4000),
      evidence_asset_ids_json: assetIds,
      evidence_analysis_ids_json: evIds,
      evidence_source_urls_json: [],
      support_count: evIds.length || 1,
      confidence: 0.65,
      status: "active",
    });
    refs.push(ref);
  }
  return { created: parsed.data.insights.length, insight_refs: refs };
}
