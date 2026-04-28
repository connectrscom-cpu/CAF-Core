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
import { listSignalPackSelectedIdeaIds } from "../repositories/signal-pack-ideas.js";

export const STEP_RUN_CANDIDATES_FROM_IDEAS_LLM = "inputs_run_candidates_from_ideas_llm";

export type RunCandidatesMaterializeMode =
  | "manual"
  | "llm"
  | "from_pack_ideas_all"
  | "from_pack_selected_ideas_v2"
  | "from_pack_overall";

export interface RunCandidatesMaterializeBody {
  mode: RunCandidatesMaterializeMode;
  /** Required when mode === manual */
  idea_ids?: string[];
  /** When mode === llm; default 40 */
  max_ideas?: number;
}

function ideasArray(pack: SignalPackRow): SignalPackIdea[] {
  const raw = pack.ideas_json;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw as SignalPackIdea[];
}

function ideasJsonAsRich(pack: SignalPackRow): Record<string, unknown>[] {
  const raw = pack.ideas_json;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  // parseIdeasV2 is now the canonical rich-idea parser (stored in ideas_json).
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

function mapIdeasV2ToPlannerSourceRows(ideas: Record<string, unknown>[]): Record<string, unknown>[] {
  return ideas.map((i) => {
    const id = String(i.id ?? "").trim() || String(i.idea_id ?? "").trim();
    const title = String(i.title ?? "").trim();
    const three = String(i.three_liner ?? i["3_liner"] ?? "").trim();
    const thesis = String(i.thesis ?? "").trim();
    const platform = String(i.platform ?? "Multi").trim() || "Multi";
    const format = String(i.format ?? "post").trim();
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

    // Planner expects a loose "overall_candidates_json-like" row shape.
    const contentIdea = title || thesis || three || id || "Selected idea";
    const summary = three || [whyNow, novelty].filter(Boolean).join(" — ") || contentIdea;

    return {
      idea_id: id,
      candidate_id: id,
      platform,
      target_platform: platform,
      format,
      content_idea: contentIdea,
      summary,
      confidence_score: confidence ?? ideaScore ?? 0.8,
      confidence: confidence ?? ideaScore ?? 0.8,
      novelty_score: 0.6,
      platform_fit: 0.75,
      past_performance: 0.5,
      recommended_route: "HUMAN_REVIEW",
      cta,
      why_now: whyNow || undefined,
      novelty_angle: novelty || undefined,
      key_points: keyPoints.length ? keyPoints : undefined,
      risk_flags: riskFlags.length ? riskFlags : undefined,
      grounding_insight_ids: grounding.length ? grounding : undefined,
      provenance: "signal_pack.ideas_v2_json",
    } satisfies Record<string, unknown>;
  });
}

function normalizePlannerRows(rows: Record<string, unknown>[], runIdHint: string): Record<string, unknown>[] {
  return normalizeOverallCandidateRows(rows as unknown[], runIdHint);
}

export function plannerRowsFromIdeaSubset(
  pack: SignalPackRow,
  ideaIds: string[],
  runIdHint: string
): Record<string, unknown>[] {
  const want = new Set(ideaIds.map((x) => String(x).trim()).filter(Boolean));
  // Prefer canonical rich ideas stored in ideas_json (id field), fall back to legacy idea_id shape.
  const rich = ideasJsonAsRich(pack).filter((i) => want.has(String(i.id ?? i.idea_id ?? "").trim()));
  if (rich.length > 0) {
    const mapped = mapIdeasV2ToPlannerSourceRows(rich);
    return normalizePlannerRows(mapped, runIdHint);
  }
  const legacy = ideasArray(pack).filter((i) => want.has(String(i.idea_id ?? "").trim()));
  if (legacy.length === 0) return [];
  const mappedLegacy = mapIdeasJsonToPlannerSourceRows(legacy);
  return normalizePlannerRows(mappedLegacy as unknown as Record<string, unknown>[], runIdHint);
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
      const mapped = mapIdeasV2ToPlannerSourceRows(rich);
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
    const mapped = mapIdeasV2ToPlannerSourceRows(chosen);
    rows = normalizePlannerRows(mapped, run.run_id);
    provenance = {
      ...provenance,
      source,
      idea_count: chosen.length,
      row_count: rows.length,
    };
  } else if (body.mode === "manual") {
    const ids = body.idea_ids ?? [];
    if (ids.length === 0) throw new Error("idea_ids required when mode=manual");
    rows = plannerRowsFromIdeaSubset(pack, ids, run.run_id);
    if (rows.length === 0) throw new Error("No matching ideas for the given idea_ids");
    provenance = { ...provenance, idea_ids: ids, row_count: rows.length };
  } else if (body.mode === "llm") {
    const ideas = ideasArray(pack);
    if (ideas.length === 0) throw new Error("signal_pack.ideas_json is empty — nothing for the LLM to select from");
    const maxPick = Math.min(100, Math.max(1, body.max_ideas ?? 40));
    const apiKey = config.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for mode=llm");

    const compact = ideas.map((i) => ({
      idea_id: i.idea_id,
      platform: i.platform,
      content_idea: (i.content_idea ?? "").slice(0, 400),
      summary: (i.summary ?? "").slice(0, 300),
    }));

    const system = `You pick which content ideas should become planner rows for a generation run.
Return ONLY valid JSON: {"idea_ids":["..."]}
Rules:
- Each id MUST appear exactly in the input list (field idea_id).
- Pick at most ${maxPick} ids.
- Prefer a diverse, high-impact subset (platforms, angles).`;

    const user = `Ideas (JSON):\n${JSON.stringify(compact, null, 0)}`;

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
    rows = plannerRowsFromIdeaSubset(pack, picked.slice(0, maxPick), run.run_id);
    if (rows.length === 0) throw new Error("LLM idea_ids did not match any pack ideas");
    provenance = {
      ...provenance,
      source: "llm",
      llm_idea_ids: picked.slice(0, maxPick),
      row_count: rows.length,
      model: out.model,
    };
  } else {
    throw new Error(`Unknown mode: ${(body as RunCandidatesMaterializeBody).mode}`);
  }

  await updateRunCandidatesJson(db, run.id, rows, provenance);
  return { planner_rows: rows.length, candidates_provenance: provenance };
}
