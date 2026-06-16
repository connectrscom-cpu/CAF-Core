/**
 * Materialize `runs.candidates_json` from `signal_packs.ideas_json` (manual selection or LLM),
 * or copy legacy `overall_candidates_json` into the run.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { SignalPackRow } from "../repositories/signal-packs.js";
import { updateRunCandidatesJson } from "../repositories/runs.js";
import type { RunRow } from "../repositories/runs.js";
import { mapIdeasJsonToPlannerSourceRows, type SignalPackIdea } from "./signal-pack-compile-ideas.js";
import { normalizeOverallCandidateRows } from "./signal-pack-parser.js";
import { openaiChat } from "./openai-chat.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { parseIdeasV2 } from "../domain/signal-pack-ideas-v2.js";
import { normalizeVideoStyle } from "../decision_engine/video-flow-routing.js";
import { applyIdeaStructureToPlannerRow } from "../domain/idea-structure.js";
import { readSignalPackJobsJson } from "../domain/jobs-json-compat.js";
import { listSignalPackSelectedIdeaIds } from "../repositories/signal-pack-ideas.js";
import { getBrandConstraints, getProductProfile, getStrategyDefaults } from "../repositories/project-config.js";
import { pickBrandSliceForSnapshot, pickStrategySliceForSnapshot } from "./run-context-snapshot.js";
import {
  mimicKindToFlowType,
  type MimicPickKind,
  findVisualGuidelineEntry,
  TIER_FOR_KIND,
} from "./signal-pack-mimic-ui.js";
import { platformFromEvidenceKind } from "./signal-pack-compile-ideas.js";

export type RunCandidatesMimicPick = {
  insights_id: string;
  mimic_kind: MimicPickKind;
};

export const STEP_RUN_CANDIDATES_FROM_IDEAS_LLM = "inputs_run_candidates_from_ideas_llm";

export const RUN_CANDIDATES_FROM_IDEAS_SYSTEM_PROMPT = `You pick which content ideas from a signal pack should become planner rows for a generation run.
Return ONLY valid JSON: {"idea_ids":["..."]}
Rules:
- Each id MUST appear exactly in the input list (use the "idea_id" field from each row).
- Apply the project strategy, brand constraints, and product profile in the user message.
- Exclude ideas that violate banned words/claims, off-brand tone, or clear strategy mismatches.
- Include every idea that qualifies — up to {{MAX_PICK}} ids (the full signal pack; same ceiling as automated logical rules).
- When multiple ideas qualify, prefer a diverse mix of platforms, formats, and angles.`;

export const RUN_CANDIDATES_FROM_IDEAS_USER_PROMPT_TEMPLATE = `Project context (JSON):
{{PROJECT_CONTEXT_JSON}}

Ideas (JSON):
{{ROWS_JSON}}`;

export type RunCandidatesMaterializeMode =
  | "manual"
  | "llm"
  | "from_pack_ideas_all"
  | "from_pack_selected_ideas_v2"
  | "from_pack_overall";

export interface RunCandidatesMaterializeBody {
  mode: RunCandidatesMaterializeMode;
  /** Required when mode === manual (unless mimic_picks is non-empty). */
  idea_ids?: string[];
  /** Top-performer references to plan as mimic-only jobs (manual picker mimic tabs). */
  mimic_picks?: RunCandidatesMimicPick[];
  /** When mode === llm; defaults to all ideas in the pack (same ceiling as automated rules). */
  max_ideas?: number;
}

function ideasForLlmPick(pack: SignalPackRow): { id: string; row: Record<string, unknown> }[] {
  const rich = ideasJsonAsRich(pack);
  if (rich.length > 0) {
    return rich
      .map((i) => {
        const id = String(i.id ?? i.idea_id ?? "").trim();
        const contentIdea = String(i.content_idea ?? i.three_liner ?? i.thesis ?? i.title ?? "").trim();
        const summary = String(i.summary ?? i.three_liner ?? "").trim();
        return {
          id,
          row: {
            idea_id: id,
            title: i.title,
            platform: i.platform,
            format: i.format,
            content_idea: contentIdea.slice(0, 400),
            summary: summary.slice(0, 300),
            confidence_score: i.confidence_score ?? i.idea_score,
            risk_flags: i.risk_flags,
          },
        };
      })
      .filter((x) => x.id);
  }
  return ideasArray(pack)
    .map((i) => {
      const id = String(i.idea_id ?? "").trim();
      return {
        id,
        row: {
          idea_id: i.idea_id,
          platform: i.platform,
          content_idea: (i.content_idea ?? "").slice(0, 400),
          summary: (i.summary ?? "").slice(0, 300),
        },
      };
    })
    .filter((x) => x.id);
}

function productProfileSliceForLlmPick(
  product: Awaited<ReturnType<typeof getProductProfile>>
): Record<string, unknown> | null {
  if (!product) return null;
  const out: Record<string, unknown> = {};
  const keys = [
    "product_name",
    "product_category",
    "one_liner",
    "value_proposition",
    "primary_audience",
    "key_benefits",
    "differentiators",
  ] as const;
  for (const k of keys) {
    const v = (product as unknown as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function ideasArray(pack: SignalPackRow): SignalPackIdea[] {
  const raw = readSignalPackJobsJson(pack as unknown as Record<string, unknown>);
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw as SignalPackIdea[];
}

function ideasJsonAsRich(pack: SignalPackRow): Record<string, unknown>[] {
  const raw = readSignalPackJobsJson(pack as unknown as Record<string, unknown>);
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return parseIdeasV2(raw) as unknown as Record<string, unknown>[];
}

function ideasV2Array(pack: SignalPackRow): Record<string, unknown>[] {
  const raw = pack.ideas_v2_json;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw as Record<string, unknown>[];
}

function selectedIdeaIds(pack: SignalPackRow): string[] {
  const raw = pack.selected_idea_ids_json;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

function mapIdeasV2ToPlannerSourceRows(
  ideas: Record<string, unknown>[],
  config?: AppConfig
): Record<string, unknown>[] {
  return ideas.map((i) => {
    const id = String(i.id ?? "").trim() || String(i.idea_id ?? "").trim();
    const title = String(i.title ?? "").trim();
    const three = String(i.three_liner ?? i["3_liner"] ?? "").trim();
    const thesis = String(i.thesis ?? "").trim();
    const platform = String(i.platform ?? "Multi").trim() || "Multi";
    const format = String(i.format ?? "post").trim();
    const videoStyle = normalizeVideoStyle(i.video_style ?? i.video_pipeline);
    const cta = String(i.cta ?? "").trim();
    const whyNow = String(i.why_now ?? "").trim();
    const novelty = String(i.novelty_angle ?? "").trim();
    const keyPoints = Array.isArray(i.key_points) ? i.key_points.map((x) => String(x).trim()).filter(Boolean) : [];
    const confidence = typeof i.confidence_score === "number" ? i.confidence_score : undefined;
    const ideaScore = typeof i.idea_score === "number" ? i.idea_score : undefined;
    const riskFlags = Array.isArray(i.risk_flags) ? i.risk_flags.map((x) => String(x).trim()).filter(Boolean) : [];
    const grounding = Array.isArray(i.grounding_insight_ids)
      ? i.grounding_insight_ids.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const hasCreativeIntelGrounding = grounding.some((g) => String(g).startsWith("ci_"));
    const pastPerformance =
      hasCreativeIntelGrounding && config
        ? Math.min(0.99, config.CREATIVE_INTEL_PLANNER_PAST_PERFORMANCE_BOOST)
        : 0.5;

    // Planner expects a loose "overall_candidates_json-like" row shape.
    const contentIdea = title || thesis || three || id || "Selected idea";
    const summary = three || [whyNow, novelty].filter(Boolean).join(" — ") || contentIdea;

    return applyIdeaStructureToPlannerRow({
      idea_id: id,
      candidate_id: id,
      platform,
      target_platform: platform,
      format,
      content_lens: i.content_lens,
      execution_profile: i.execution_profile,
      carousel_style: i.carousel_style,
      video_style: videoStyle ?? i.video_style,
      product_angle: i.product_angle,
      content_idea: contentIdea,
      summary,
      confidence_score: confidence ?? ideaScore ?? 0.8,
      confidence: confidence ?? ideaScore ?? 0.8,
      novelty_score: 0.6,
      platform_fit: 0.75,
      past_performance: pastPerformance,
      recommended_route: "HUMAN_REVIEW",
      cta,
      why_now: whyNow || undefined,
      novelty_angle: novelty || undefined,
      key_points: keyPoints.length ? keyPoints : undefined,
      risk_flags: riskFlags.length ? riskFlags : undefined,
      grounding_insight_ids: grounding.length ? grounding : undefined,
      provenance: "signal_pack.ideas_json",
    });
  });
}

function normalizePlannerRows(rows: Record<string, unknown>[], runIdHint: string): Record<string, unknown>[] {
  return normalizeOverallCandidateRows(rows as unknown[], runIdHint);
}

export function plannerRowsFromIdeaSubset(
  pack: SignalPackRow,
  ideaIds: string[],
  runIdHint: string,
  config?: AppConfig
): Record<string, unknown>[] {
  const want = new Set(ideaIds.map((x) => String(x).trim()).filter(Boolean));
  // Prefer canonical rich ideas stored in ideas_json (id field), fall back to legacy idea_id shape.
  const rich = ideasJsonAsRich(pack).filter((i) => want.has(String(i.id ?? i.idea_id ?? "").trim()));
  if (rich.length > 0) {
    const mapped = mapIdeasV2ToPlannerSourceRows(rich, config);
    return normalizePlannerRows(mapped, runIdHint);
  }
  const legacy = ideasArray(pack).filter((i) => want.has(String(i.idea_id ?? "").trim()));
  if (legacy.length === 0) return [];
  const mappedLegacy = mapIdeasJsonToPlannerSourceRows(legacy);
  return normalizePlannerRows(mappedLegacy as unknown as Record<string, unknown>[], runIdHint);
}

function stringField(v: unknown, max = 800): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Planner rows for manually picked top-performer mimic references (one row → one mimic flow). */
export function plannerRowsFromMimicPicks(
  pack: SignalPackRow,
  picks: RunCandidatesMimicPick[],
  runIdHint: string
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const pick of picks) {
    const insightsId = String(pick.insights_id ?? "").trim();
    if (!insightsId) continue;
    const dedupeKey = `${pick.mimic_kind}:${insightsId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const entry = findVisualGuidelineEntry(pack, insightsId);
    if (!entry) {
      throw new Error(`No visual guideline entry for insights_id ${insightsId} — rebuild the signal pack.`);
    }
    const tier = stringField(entry.analysis_tier, 80);
    const expectedTier = TIER_FOR_KIND[pick.mimic_kind];
    if (tier && expectedTier && tier !== expectedTier) {
      throw new Error(
        `insights_id ${insightsId} is tier ${tier}, not ${expectedTier} — pick it under the matching mimic tab.`
      );
    }

    const flowType = mimicKindToFlowType(pick.mimic_kind);
    const rowId = stringField(entry.source_evidence_row_id, 40);
    const hook = stringField(entry.hook_text_preview, 400);
    const why = stringField(entry.why_it_worked, 600);
    const formatPattern = stringField(entry.format_pattern, 120);
    const platform = platformFromEvidenceKind(stringField(entry.evidence_kind, 80) || "instagram_post");
    const ideaId = `mimic_${insightsId}`;
    const contentIdea = hook || why.slice(0, 400) || `Mimic ${pick.mimic_kind} · ${insightsId}`;
    const format =
      pick.mimic_kind === "carousel" ? "carousel" : pick.mimic_kind === "video" ? "video" : "post";

    rows.push({
      idea_id: ideaId,
      candidate_id: ideaId,
      sign: ideaId,
      topic: ideaId,
      platform,
      target_platform: platform,
      format,
      content_idea: contentIdea,
      summary: why || contentIdea,
      confidence: 0.88,
      confidence_score: 0.88,
      novelty_score: 0.55,
      platform_fit: 0.82,
      past_performance: 0.85,
      recommended_route: "HUMAN_REVIEW",
      source_evidence_row_id: rowId || undefined,
      analysis_tier: tier || expectedTier,
      grounding_insight_ids: [insightsId],
      target_flow_type: flowType,
      manual_mimic_pick: true,
      mimic_kind: pick.mimic_kind,
      provenance: "signal_pack.visual_guidelines_pack_v1",
    });
  }

  return normalizePlannerRows(rows, runIdHint);
}

export async function materializeRunCandidates(
  db: Pool,
  config: AppConfig,
  projectId: string,
  run: Pick<RunRow, "id" | "run_id" | "signal_pack_id">,
  pack: SignalPackRow,
  body: RunCandidatesMaterializeBody
): Promise<{ planner_rows: number; candidates_provenance: Record<string, unknown> }> {
  if (!run.signal_pack_id || run.signal_pack_id !== pack.id) {
    throw new Error("Run signal_pack_id must match the provided pack");
  }

  let rows: Record<string, unknown>[] = [];
  let provenance: Record<string, unknown> = { mode: body.mode };

  if (body.mode === "from_pack_overall") {
    const oc = pack.overall_candidates_json;
    const list = Array.isArray(oc) ? (oc as unknown[]) : [];
    rows = normalizeOverallCandidateRows(list, run.run_id) as Record<string, unknown>[];
    provenance = { ...provenance, source: "signal_pack.overall_candidates_json", row_count: rows.length };
  } else if (body.mode === "from_pack_ideas_all") {
    // Canonical: rich ideas are stored in ideas_json.
    const rich = ideasJsonAsRich(pack);
    if (rich.length > 0) {
      const mapped = mapIdeasV2ToPlannerSourceRows(rich, config);
      rows = normalizePlannerRows(mapped, run.run_id);
      provenance = { ...provenance, source: "signal_pack.ideas_json", idea_count: rich.length, row_count: rows.length };
    } else {
      const ideas = ideasArray(pack);
      if (ideas.length === 0) {
        throw new Error("signal_pack.ideas_json is empty — build a pack in Processing or use from_pack_overall");
      }
      const mapped = mapIdeasJsonToPlannerSourceRows(ideas);
      rows = normalizePlannerRows(mapped as unknown as Record<string, unknown>[], run.run_id);
      provenance = { ...provenance, source: "signal_pack.ideas_json(legacy)", idea_count: ideas.length, row_count: rows.length };
    }
  } else if (body.mode === "from_pack_selected_ideas_v2") {
    // Prefer the new join table selection; fall back to legacy JSON column.
    let ids: string[] = [];
    try {
      ids = await listSignalPackSelectedIdeaIds(db, { project_id: projectId, signal_pack_id: pack.id });
    } catch {
      ids = [];
    }
    if (ids.length === 0) ids = selectedIdeaIds(pack);
    if (ids.length === 0) throw new Error("signal_pack.selected_idea_ids_json is empty");

    // Prefer canonical storage in ideas_json; keep fallback to deprecated ideas_v2_json.
    const want = new Set(ids);
    const richIdeas = ideasJsonAsRich(pack);
    let chosen = richIdeas.filter((i) => want.has(String(i.id ?? i.idea_id ?? "").trim()));
    let source = "signal_pack.selected_idea_ids_json + ideas_json";
    if (chosen.length === 0) {
      const deprecated = ideasV2Array(pack);
      chosen = deprecated.filter((i) => want.has(String(i.id ?? i.idea_id ?? "").trim()));
      source = "signal_pack.selected_idea_ids_json + ideas_v2_json(deprecated)";
    }
    if (chosen.length === 0) throw new Error("No matching ideas_v2_json rows for selected_idea_ids_json");
    const mapped = mapIdeasV2ToPlannerSourceRows(chosen, config);
    rows = normalizePlannerRows(mapped, run.run_id);
    provenance = {
      ...provenance,
      source,
      idea_count: chosen.length,
      row_count: rows.length,
    };
  } else if (body.mode === "manual") {
    const ids = body.idea_ids ?? [];
    const mimicPicks = body.mimic_picks ?? [];
    if (ids.length === 0 && mimicPicks.length === 0) {
      throw new Error("idea_ids or mimic_picks required when mode=manual");
    }
    const merged: Record<string, unknown>[] = [];
    if (ids.length > 0) {
      const ideaRows = plannerRowsFromIdeaSubset(pack, ids, run.run_id, config);
      if (ideaRows.length === 0) throw new Error("No matching ideas for the given idea_ids");
      merged.push(...ideaRows);
    }
    if (mimicPicks.length > 0) {
      merged.push(...plannerRowsFromMimicPicks(pack, mimicPicks, run.run_id));
    }
    rows = merged;
    provenance = {
      ...provenance,
      ...(ids.length ? { idea_ids: ids } : {}),
      ...(mimicPicks.length ? { mimic_picks: mimicPicks } : {}),
      row_count: rows.length,
    };
  } else if (body.mode === "llm") {
    const entries = ideasForLlmPick(pack);
    if (entries.length === 0) {
      throw new Error("signal_pack.ideas_json is empty — nothing for the LLM to select from");
    }
    const maxPick = Math.min(
      200,
      Math.max(1, body.max_ideas ?? entries.length)
    );
    const apiKey = config.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for mode=llm");

    const [brand, strategy, product] = await Promise.all([
      getBrandConstraints(db, projectId),
      getStrategyDefaults(db, projectId),
      getProductProfile(db, projectId),
    ]);
    const projectContext = {
      strategy: pickStrategySliceForSnapshot(
        (strategy as unknown as Record<string, unknown> | null) ?? null
      ),
      brand_constraints: pickBrandSliceForSnapshot(
        (brand as unknown as Record<string, unknown> | null) ?? null
      ),
      product_profile: productProfileSliceForLlmPick(product),
    };

    const compact = entries.map((e) => e.row);

    const system = RUN_CANDIDATES_FROM_IDEAS_SYSTEM_PROMPT.replace(/\{\{MAX_PICK\}\}/g, String(maxPick));

    const user = RUN_CANDIDATES_FROM_IDEAS_USER_PROMPT_TEMPLATE.replace(
      "{{PROJECT_CONTEXT_JSON}}",
      JSON.stringify(projectContext, null, 0)
    ).replace("{{ROWS_JSON}}", JSON.stringify(compact, null, 0));

    const out = await openaiChat(
      apiKey,
      {
        model: "gpt-4o-mini",
        system_prompt: system,
        user_prompt: user,
        max_tokens: 2048,
        response_format: "json_object",
      },
      {
        db,
        projectId,
        runId: run.run_id,
        taskId: null,
        signalPackId: run.signal_pack_id,
        step: STEP_RUN_CANDIDATES_FROM_IDEAS_LLM,
      }
    );

    const parsed = parseJsonObjectFromLlmText(out.content) as { idea_ids?: unknown } | null;
    const rawIds = parsed && Array.isArray(parsed.idea_ids) ? parsed.idea_ids : [];
    const picked = rawIds.map((x) => String(x).trim()).filter(Boolean);
    if (picked.length === 0) throw new Error("LLM returned no idea_ids");
    rows = plannerRowsFromIdeaSubset(pack, picked.slice(0, maxPick), run.run_id, config);
    if (rows.length === 0) throw new Error("LLM idea_ids did not match any pack ideas");
    provenance = {
      ...provenance,
      source: "llm",
      llm_idea_ids: picked.slice(0, maxPick),
      row_count: rows.length,
      model: out.model,
      project_context: projectContext,
      pack_idea_count: entries.length,
      max_pick: maxPick,
    };
  } else {
    throw new Error(`Unknown mode: ${(body as RunCandidatesMaterializeBody).mode}`);
  }

  await updateRunCandidatesJson(db, run.id, rows, provenance);
  return { planner_rows: rows.length, candidates_provenance: provenance };
}
