/**
 * Scene-assembly candidate router: at run start, an LLM proposes additional overall_candidates
 * rows suited for multi-scene video (Video_Scene_Generator, legacy FLOW_SCENE_ASSEMBLY, etc.) before the decision engine runs.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { listPromptTemplates } from "../repositories/flow-engine.js";
import { buildCreationPack, interpolateTemplate } from "./llm-generator-helpers.js";
import { openaiChat } from "./openai-chat.js";
import { openAiMaxTokens } from "./openai-coerce.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";

export function isSceneAssemblyFlowType(flowType: string): boolean {
  const t = flowType.trim();
  if (!t) return false;
  const compact = t.toUpperCase().replace(/_/g, "");
  if (compact.includes("SCENEASSEMBLY") || compact.includes("VIDEOSCENEASSEMBLY")) return true;
  // Flow Engine workbook: Video_Scene_Generator
  if (/video_scene_generator/i.test(t)) return true;
  return /scene_assembly/i.test(t);
}

export function findEnabledSceneAssemblyFlowType(
  enabledFlows: Array<{ flow_type: string }>
): string | null {
  for (const f of enabledFlows) {
    if (isSceneAssemblyFlowType(f.flow_type)) return f.flow_type;
  }
  return null;
}

export async function expandOverallCandidatesWithSceneAssemblyRouter(
  db: Pool,
  config: AppConfig,
  params: {
    projectId: string;
    runId: string;
    signalPackId: string | null;
    overallCandidates: Record<string, unknown>[];
    enabledFlows: Array<{ flow_type: string }>;
  }
): Promise<Record<string, unknown>[]> {
  const sceneFlow = findEnabledSceneAssemblyFlowType(params.enabledFlows);
  const maxSeeds = config.SCENE_ASSEMBLY_ROUTER_MAX_SEEDS ?? 0;
  if (!sceneFlow || maxSeeds <= 0 || !config.OPENAI_API_KEY?.trim()) {
    return params.overallCandidates;
  }

  try {
    const creationContext = await buildCreationPack(db, params.projectId, params.signalPackId, {}, null);
    const compact = params.overallCandidates.slice(0, 120).map((row) => ({
      candidate_id: row.candidate_id ?? row.sign ?? row.topic,
      summary: String(row.summary ?? row.content_idea ?? row.dominant_themes ?? "").slice(0, 500),
      platform: row.platform ?? row.target_platform ?? "Instagram",
    }));

    const templates = await listPromptTemplates(db, sceneFlow);
    const tpl =
      templates.find((t) => (t.prompt_role ?? "").toLowerCase() === "scene_candidate_router") ?? null;

    const defaultSystem =
      "You are the scene-assembly candidate router. Given existing signal-pack ideas, propose additional ideas that work well as multi-scene videos (clear beats, visual variety, short narrative arc). Reply with the requested JSON shape (object in markdown fence is fine).";
    const defaultUser = `Run ID: ${params.runId}
Scene assembly flow_type: ${sceneFlow}
Max new seeds: ${maxSeeds}

Existing candidates (JSON):
${JSON.stringify(compact)}

Creation context (use for brand/strategy alignment):
{{creation_pack_json}}

Return JSON exactly in this shape:
{"scene_assembly_seeds":[{"content_idea":"string (1-4 sentences)","platform":"Instagram or TikTok","confidence_score":0.0-1.0,"notes":"optional"}]}
Use at most ${maxSeeds} seeds. Each seed must be distinct and suitable for multi-scene assembly.`;

    const systemPrompt = tpl?.system_prompt?.trim() ? tpl.system_prompt : defaultSystem;
    const userPrompt = tpl?.user_prompt_template
      ? interpolateTemplate(tpl.user_prompt_template, creationContext)
      : interpolateTemplate(defaultUser, creationContext);

    const llm = await openaiChat(
      config.OPENAI_API_KEY,
      {
        model: config.OPENAI_MODEL,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        max_tokens: openAiMaxTokens(tpl?.max_tokens_default ?? 2000),
      },
      {
        db,
        projectId: params.projectId,
        runId: params.runId,
        taskId: null,
        signalPackId: params.signalPackId,
        step: "llm_scene_assembly_candidate_router",
      }
    );

    const parsed = parseJsonObjectFromLlmText(llm.content);
    if (!parsed) return params.overallCandidates;
    const seeds = Array.isArray(parsed.scene_assembly_seeds) ? parsed.scene_assembly_seeds : [];

    const out = [...params.overallCandidates];
    let added = 0;
    for (const raw of seeds) {
      if (added >= maxSeeds) break;
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      const idea = String(s.content_idea ?? s.summary ?? "").trim();
      if (idea.length < 20) continue;
      const platform = String(s.platform ?? "Instagram").trim() || "Instagram";
      const conf = typeof s.confidence_score === "number" && Number.isFinite(s.confidence_score) ? s.confidence_score : 0.75;
      const slug = params.runId.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80);
      const cid = `sa_${slug}_${added}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
      out.push({
        candidate_id: cid,
        summary: idea,
        content_idea: idea,
        platform,
        target_platform: platform,
        confidence: conf,
        confidence_score: conf,
        platform_fit: typeof s.platform_fit === "number" ? s.platform_fit : 0.72,
        novelty_score: typeof s.novelty_score === "number" ? s.novelty_score : 0.55,
        past_performance: typeof s.past_performance === "number" ? s.past_performance : 0.5,
        recommended_route: String(s.recommended_route ?? "HUMAN_REVIEW"),
        source: "scene_assembly_candidate_router",
        router_notes: s.notes ?? null,
      });
      added++;
    }
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[scene-assembly-candidate-router] skipped:", msg);
    return params.overallCandidates;
  }
}
