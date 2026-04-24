/**
 * Compile `signal_packs.ideas_json` from row-level inputs evidence insights (broad + top-performer tiers).
 * Merges tiers per `source_evidence_row_id` (one idea per evidence row).
 */
import type { Pool } from "pg";
import type { EvidenceInsightTier, EvidenceRowInsightEnrichedRow } from "../repositories/inputs-evidence-insights.js";
import { listEvidenceRowInsightsEnriched } from "../repositories/inputs-evidence-insights.js";

/** Provenance for `ideas_json` rows (DB insight tiers or pack-time LLM). */
export type SignalPackIdeaAnalysisTier = EvidenceInsightTier | "ideas_from_insights_llm";

export interface SignalPackIdea {
  idea_id: string;
  platform: string;
  content_idea: string;
  summary?: string;
  why_it_worked?: string | null;
  primary_emotion?: string | null;
  secondary_emotion?: string | null;
  evidence_kind?: string;
  source_evidence_row_id?: string;
  /** Insight tier merged into this idea, or LLM-generated pack ideas. */
  analysis_tier?: SignalPackIdeaAnalysisTier;
  confidence_score?: number;
}

const TIER_RANK: Record<string, number> = {
  broad_llm: 0,
  top_performer_deep: 1,
  top_performer_carousel: 2,
  top_performer_video: 3,
};

function tierRank(t: string): number {
  return TIER_RANK[t] ?? -1;
}

export function platformFromEvidenceKind(kind: string): string {
  const k = (kind || "").toLowerCase();
  if (k.includes("tiktok")) return "TikTok";
  if (k.includes("reddit")) return "Reddit";
  if (k.includes("facebook") || k.includes("fb")) return "Facebook";
  if (k.includes("instagram") || k === "instagram_post") return "Instagram";
  if (k.includes("scraped") || k.includes("html")) return "Multi";
  return "Instagram";
}

function pickContentText(r: EvidenceRowInsightEnrichedRow): string {
  const hook = r.hook_text?.trim();
  if (hook) return hook.slice(0, 1200);
  const why = r.why_it_worked?.trim();
  if (why) return why.slice(0, 1200);
  const raw = r.raw_llm_json;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    for (const k of ["content_idea", "summary", "hook", "angle"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 1200);
    }
  }
  return `Idea from ${r.evidence_kind} (${r.analysis_tier})`;
}

function mergeInsightInto(
  acc: Partial<SignalPackIdea> & { _tierRank: number; _tiers: Set<string> },
  r: EvidenceRowInsightEnrichedRow
): void {
  const tr = tierRank(r.analysis_tier);
  acc._tiers.add(r.analysis_tier);
  if (!acc.evidence_kind) acc.evidence_kind = r.evidence_kind;
  if (!acc.source_evidence_row_id) acc.source_evidence_row_id = r.source_evidence_row_id;

  const pre = parseFloat(String(r.pre_llm_score ?? ""));
  if (!Number.isNaN(pre)) acc.confidence_score = Math.max(acc.confidence_score ?? 0, pre);

  if (tr >= acc._tierRank) {
    acc._tierRank = tr;
    acc.analysis_tier = r.analysis_tier;
    acc.content_idea = pickContentText(r);
    acc.summary = r.why_it_worked?.trim() || acc.summary;
    if (r.why_it_worked?.trim()) acc.why_it_worked = r.why_it_worked.trim();
    if (r.primary_emotion?.trim()) acc.primary_emotion = r.primary_emotion.trim();
    if (r.secondary_emotion?.trim()) acc.secondary_emotion = r.secondary_emotion.trim();
  } else {
    if (!acc.why_it_worked && r.why_it_worked?.trim()) acc.why_it_worked = r.why_it_worked.trim();
    if (!acc.primary_emotion && r.primary_emotion?.trim()) acc.primary_emotion = r.primary_emotion.trim();
    if (!acc.secondary_emotion && r.secondary_emotion?.trim()) acc.secondary_emotion = r.secondary_emotion.trim();
  }
}

/**
 * Load up to `limit` insight rows (all tiers), merge by evidence row, return idea objects.
 */
export async function compileIdeasJsonFromImport(
  db: Pool,
  projectId: string,
  importId: string,
  limit = 3000
): Promise<SignalPackIdea[]> {
  const rows = await listEvidenceRowInsightsEnriched(db, projectId, importId, {
    tier: null,
    evidence_kind: null,
    limit,
    offset: 0,
  });

  const bySource = new Map<
    string,
    Partial<SignalPackIdea> & { _tierRank: number; _tiers: Set<string> }
  >();

  for (const r of rows) {
    const sid = r.source_evidence_row_id;
    if (!sid) continue;
    if (!bySource.has(sid)) {
      bySource.set(sid, {
        _tierRank: -1,
        _tiers: new Set(),
      });
    }
    mergeInsightInto(bySource.get(sid)!, r);
  }

  const ideas: SignalPackIdea[] = [];
  for (const [sid, acc] of bySource) {
    const platform = platformFromEvidenceKind(acc.evidence_kind ?? "instagram_post");
    const ideaId = `idea_${importId.replace(/-/g, "").slice(0, 8)}_${sid}`;
    ideas.push({
      idea_id: ideaId,
      platform,
      content_idea: acc.content_idea?.trim() || `Evidence-backed idea (${acc.evidence_kind ?? "row"})`,
      summary: acc.summary ?? acc.why_it_worked ?? undefined,
      why_it_worked: acc.why_it_worked ?? null,
      primary_emotion: acc.primary_emotion ?? null,
      secondary_emotion: acc.secondary_emotion ?? null,
      evidence_kind: acc.evidence_kind,
      source_evidence_row_id: sid,
      analysis_tier: acc.analysis_tier,
      confidence_score: acc.confidence_score ?? 0.75,
    });
  }

  ideas.sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0));
  return ideas;
}

/**
 * Map stored ideas to the loose row shape `buildCandidatesFromSignalPack` expects.
 */
export function mapIdeasJsonToPlannerSourceRows(ideas: SignalPackIdea[]): Record<string, unknown>[] {
  return ideas.map((idea) => ({
    ...idea,
    candidate_id: idea.idea_id,
    sign: idea.idea_id,
    topic: idea.idea_id,
    summary: idea.summary ?? idea.content_idea,
    content_idea: idea.content_idea,
    platform: idea.platform,
    target_platform: idea.platform,
    confidence: idea.confidence_score ?? 0.82,
    confidence_score: idea.confidence_score ?? 0.82,
    novelty_score: 0.55,
    platform_fit: 0.78,
    past_performance: 0.5,
    recommended_route: "HUMAN_REVIEW",
    dominant_themes: idea.why_it_worked ?? undefined,
    primary_emotion: idea.primary_emotion,
    secondary_emotion: idea.secondary_emotion,
    evidence_kind: idea.evidence_kind,
    source_evidence_row_id: idea.source_evidence_row_id,
    analysis_tier: idea.analysis_tier,
  }));
}
