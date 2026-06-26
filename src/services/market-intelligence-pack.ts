import type { Pool } from "pg";
import { deriveEvidencePostFormat } from "../services/inputs-evidence-post-format.js";
import { listEvidenceRowInsightsEnriched } from "../repositories/inputs-evidence-insights.js";
import {
  buildMarketIntelligenceV1,
  MARKET_INTELLIGENCE_V1_KEY,
  type MarketIntelligenceV1,
  type SynthesisInsightRowInput,
} from "../domain/market-intelligence-synthesis.js";
import { mergeSignalPackDerivedGlobalsJson } from "../repositories/signal-packs.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function toSynthesisInput(
  projectSlug: string,
  importId: string,
  signalPackId: string | null,
  runId: string | null,
  r: Awaited<ReturnType<typeof listEvidenceRowInsightsEnriched>>[number] & {
    evidence_payload_json?: unknown;
  }
): SynthesisInsightRowInput {
  const payload =
    r.evidence_payload_json != null && typeof r.evidence_payload_json === "object" && !Array.isArray(r.evidence_payload_json)
      ? (r.evidence_payload_json as Record<string, unknown>)
      : {};
  return {
    project_slug: projectSlug,
    inputs_import_id: importId,
    signal_pack_id: signalPackId,
    run_id: runId,
    evidence_post_format: deriveEvidencePostFormat(r.evidence_kind, payload),
    id: r.id,
    insights_id: r.insights_id,
    analysis_tier: r.analysis_tier,
    source_evidence_row_id: r.source_evidence_row_id,
    evidence_kind: r.evidence_kind,
    pre_llm_score: r.pre_llm_score,
    why_it_worked: r.why_it_worked,
    primary_emotion: r.primary_emotion,
    secondary_emotion: r.secondary_emotion,
    hook_type: r.hook_type,
    hook_text: r.hook_text,
    hashtags: r.hashtags,
    caption_style: r.caption_style,
    cta_type: r.cta_type,
    custom_label_1: r.custom_label_1,
    custom_label_2: r.custom_label_2,
    custom_label_3: r.custom_label_3,
    aesthetic_analysis_json: r.aesthetic_analysis_json,
    risk_flags_json: r.risk_flags_json,
    created_at: r.created_at,
  };
}

export function readStoredMarketIntelligenceV1(
  derivedGlobals: Record<string, unknown> | null | undefined
): MarketIntelligenceV1 | null {
  const raw = asRecord(derivedGlobals?.[MARKET_INTELLIGENCE_V1_KEY]);
  if (!raw || raw.schema_version !== 1) return null;
  return raw as unknown as MarketIntelligenceV1;
}

export async function buildMarketIntelligenceForImport(
  db: Pool,
  projectId: string,
  projectSlug: string,
  importId: string,
  opts?: {
    signal_pack_id?: string | null;
    run_id?: string | null;
    derived_globals?: Record<string, unknown> | null;
    limit?: number;
  }
): Promise<MarketIntelligenceV1> {
  const limit = opts?.limit ?? 500;
  const raw = await listEvidenceRowInsightsEnriched(db, projectId, importId, {
    tier: null,
    evidence_kind: null,
    limit,
    offset: 0,
  });
  const rows = raw.map((r) =>
    toSynthesisInput(projectSlug, importId, opts?.signal_pack_id ?? null, opts?.run_id ?? null, r)
  );
  return buildMarketIntelligenceV1({
    insightRows: rows,
    derivedGlobals: opts?.derived_globals ?? null,
  });
}

export async function ensureMarketIntelligenceOnPack(
  db: Pool,
  projectId: string,
  projectSlug: string,
  importId: string,
  signalPackId: string,
  derivedGlobals: Record<string, unknown>,
  opts?: { persist?: boolean; force?: boolean }
): Promise<MarketIntelligenceV1> {
  const stored = readStoredMarketIntelligenceV1(derivedGlobals);
  if (stored && !opts?.force) return stored;

  const v1 = await buildMarketIntelligenceForImport(db, projectId, projectSlug, importId, {
    signal_pack_id: signalPackId,
    derived_globals: derivedGlobals,
  });

  if (opts?.persist !== false) {
    await mergeSignalPackDerivedGlobalsJson(db, signalPackId, {
      [MARKET_INTELLIGENCE_V1_KEY]: v1,
    });
  }

  return v1;
}
