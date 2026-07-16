import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  insightRowMatchesResearchPlatform,
  ideaJsonMatchesResearchPlatform,
  candidateRowMatchesResearchPlatform,
  researchPlatformIdFromEvidenceKind,
  researchPlatformLabel,
  serializeMarketerResearchBriefNotes,
  type ResearchBriefPlatformId,
} from "../domain/research-brief-platform.js";
import { MARKET_INTELLIGENCE_V1_KEY } from "../domain/market-intelligence-synthesis.js";
import { listEvidenceRowInsightsEnriched } from "../repositories/inputs-evidence-insights.js";
import { insertSignalPack } from "../repositories/signal-packs.js";
import { buildMarketIntelligenceForImport } from "./market-intelligence-pack.js";

const MIN_INSIGHT_ROWS_FOR_PLATFORM_BRIEF = 5;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function readPostMaxAgeDays(meta: Record<string, unknown> | null): number | null {
  if (!meta) return null;
  const n = meta.postMaxAgeDays ?? meta.post_max_age_days;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export async function spawnPlatformScopedResearchBriefPacks(
  db: Pool,
  config: AppConfig,
  ctx: {
    projectId: string;
    projectSlug: string;
    brandDisplayName?: string | null;
    importId: string;
    parentPackId: string;
    packRunId: string;
    parentDerivedGlobals: Record<string, unknown>;
    ideasJson: unknown[];
    overallCandidates: unknown[];
    marketerResearchMeta?: Record<string, unknown> | null;
  }
): Promise<{ platform_pack_ids: string[]; platforms_spawned: ResearchBriefPlatformId[] }> {
  const rows = await listEvidenceRowInsightsEnriched(db, ctx.projectId, ctx.importId, {
    tier: null,
    evidence_kind: null,
    limit: 500,
    offset: 0,
  });

  const counts = new Map<ResearchBriefPlatformId, number>();
  for (const r of rows) {
    const id = researchPlatformIdFromEvidenceKind(r.evidence_kind);
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const eligible = [...counts.entries()]
    .filter(([, n]) => n >= MIN_INSIGHT_ROWS_FOR_PLATFORM_BRIEF)
    .map(([id]) => id);

  // Fan out platform briefs when 2+ networks qualify, OR when LinkedIn alone qualifies
  // (LinkedIn intelligence is person-first and should not stay Meta-shaped on the parent pack only).
  const linkedinOnly =
    eligible.length === 1 && eligible[0] === "linkedin";
  if (eligible.length < 2 && !linkedinOnly) {
    return { platform_pack_ids: [], platforms_spawned: [] };
  }

  const meta = ctx.marketerResearchMeta ?? null;
  const postMaxAgeDays = readPostMaxAgeDays(meta);
  const created: string[] = [];
  const spawned: ResearchBriefPlatformId[] = [];

  for (const platformId of eligible) {
    const platformIdeas = ctx.ideasJson.filter((raw) => {
      const rec = asRecord(raw);
      return rec ? ideaJsonMatchesResearchPlatform(rec, platformId) : false;
    });
    const platformCandidates = ctx.overallCandidates.filter((raw) => {
      const rec = asRecord(raw);
      return rec ? candidateRowMatchesResearchPlatform(rec, platformId) : false;
    });

    const scopedGlobals: Record<string, unknown> = {
      ...ctx.parentDerivedGlobals,
      research_brief_scope: "platform",
      research_brief_platform: platformId,
      parent_signal_pack_id: ctx.parentPackId,
      platforms_found: [researchPlatformLabel(platformId)],
      total_candidates: platformCandidates.length,
      ideas_count: platformIdeas.length,
    };

    const marketIntelligenceV1 = await buildMarketIntelligenceForImport(
      db,
      config,
      ctx.projectId,
      ctx.projectSlug,
      ctx.importId,
      {
        derived_globals: scopedGlobals,
        brand_display_name: ctx.brandDisplayName,
        platform_scope: platformId,
        signal_pack_id: null,
      }
    );

    const title =
      marketIntelligenceV1.research_brief_title?.trim() ||
      `${researchPlatformLabel(platformId)} research brief`;

    const packNotes = serializeMarketerResearchBriefNotes({
      marketerTitle: title,
      briefScope: "platform",
      platforms: [platformId],
      parentSignalPackId: ctx.parentPackId,
      postMaxAgeDays,
    });

    const derived_globals_json = {
      ...scopedGlobals,
      [MARKET_INTELLIGENCE_V1_KEY]: marketIntelligenceV1,
    };

    const pack = await insertSignalPack(db, {
      run_id: `${ctx.packRunId}__${platformId}`,
      project_id: ctx.projectId,
      source_window: null,
      overall_candidates_json: platformCandidates,
      ideas_json: platformIdeas,
      ig_summary_json: null,
      tiktok_summary_json: null,
      reddit_summary_json: null,
      fb_summary_json: null,
      html_summary_json: null,
      derived_globals_json,
      upload_filename: `from_inputs_import:${ctx.importId}#${platformId}`,
      notes: packNotes,
      source_inputs_import_id: ctx.importId,
    });

    created.push(pack.id);
    spawned.push(platformId);
  }

  return { platform_pack_ids: created, platforms_spawned: spawned };
}

/** Count insight rows per platform (for tests / diagnostics). */
export function countInsightRowsByResearchPlatform(
  rows: Array<{ evidence_kind: string }>
): Map<ResearchBriefPlatformId, number> {
  const counts = new Map<ResearchBriefPlatformId, number>();
  for (const r of rows) {
    const id = researchPlatformIdFromEvidenceKind(r.evidence_kind);
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export { insightRowMatchesResearchPlatform, MIN_INSIGHT_ROWS_FOR_PLATFORM_BRIEF };
