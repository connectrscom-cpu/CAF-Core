/**
 * Phase 2 "top performer" pass: **image-only** vision analysis (no TikTok / no video URLs / no reels).
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { ensureProject } from "../repositories/core.js";
import {
  countEvidenceRowInsightsByImportTier,
  listEvidenceRowInsightIdsByImportTier,
  upsertEvidenceRowInsight,
} from "../repositories/inputs-evidence-insights.js";
import {
  countRatedEvidenceRows,
  getInputsEvidenceImport,
  listEvidenceRowRatingFieldsByIds,
  listEvidenceRowRatingScoreMap,
  listEvidenceRowsForPreLlmScoring,
} from "../repositories/inputs-evidence.js";
import { ratingReviewSnapshotsByRowId } from "../domain/evidence-performance-review-snapshot.js";
import { getInputsProcessingProfile, upsertInputsProcessingProfile } from "../repositories/inputs-processing-profile.js";
import { processingVisionChatMultimodal } from "./processing-vision-client.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { evaluatePreLlmRow } from "./inputs-pre-llm-rank.js";
import { summarizePayloadForLlm } from "./inputs-evidence-display.js";
import {
  finalizeHttpsImageUrlForOpenAiVision,
  isVideoLikeEvidence,
  pickPrimaryImageUrlForDeepAnalysis,
} from "./inputs-image-url-for-analysis.js";
import { isCarouselDeepEligible, instagramPostPermalinkFromPayload, isLikelyStaleInstagramCdnUrl } from "./inputs-carousel-evidence-bundle.js";
import {
  buildTopPerformerRatingGateRequestOverrides,
  resolveBroadInsightsSampleGate,
} from "./inputs-top-performer-rating-gate.js";
import {
  applyTopPerformerPercentileSelection,
  resolveTopPerformerPercentileConfig,
  scoreRowForTopPerformer,
  topPerformerFormatFamilyForRow,
  type ScoredTopPerformerRow,
  type TopPerformerPercentileGroupStat,
} from "./inputs-top-performer-percentile-pool.js";
import {
  archiveTopPerformerVisionMedia,
  resolveTopPerformerArchiveMedia,
} from "./inputs-top-performer-media-archive.js";
import { getSupabaseStorageClient } from "./supabase-storage.js";
import {
  fetchFreshInstagramImageUrlFromPostEmbed,
  resolveInstagramEmbedHttpProxy,
} from "./inputs-instagram-embed-carousel-resolver.js";
import {
  assertVisionImageUrlsSafeForRemoteFetch,
  relayImageUrlsForOpenAiVision,
  shouldRelayImageUrlForOpenAi,
  VISION_CDN_PROXY_HINT,
} from "./inputs-top-performer-vision-relay.js";

const STEP = "inputs_top_performer_image_insight";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export const TOP_PERFORMER_IMAGE_SYSTEM_PROMPT = `You analyze a **single static image** from social marketing evidence (no video, no audio).
Return ONLY valid JSON:
{
  "palette": ["#RRGGBB or colour names"],
  "typography": "fonts / text style if readable",
  "layout": "composition notes",
  "on_screen_text": "verbatim short text on image if any",
  "style_summary": "overall aesthetic in 2-4 sentences",
  "hook_text": "short hook implied by creative if any",
  "caption_style": "how caption would pair visually (short)",
  "risk_flags": ["string"],
  "why_it_worked": "why this visual might perform (short)"
}
Be conservative: if unreadable, use empty strings / empty arrays.`;

export const TOP_PERFORMER_IMAGE_USER_PROMPT_TEMPLATE =
  "Evidence kind: {{EVIDENCE_KIND}}\nPre-LLM score: {{PRE_LLM_SCORE}}\nContext:\n{{TEXT_BUNDLE}}";

export interface RunDeepImageInsightsOptions {
  max_rows?: number;
  min_pre_llm_score?: number;
  rescan?: boolean;
  rating_top_fraction?: number;
  disable_rating_percentile_gate?: boolean;
}

export interface RunDeepImageInsightsResult {
  import_id: string;
  model: string;
  rows_scanned: number;
  candidates_with_image: number;
  rows_analyzed: number;
  skipped_no_image: number;
  skipped_video: number;
  /** Multi-slide carousels use `top_performer_carousel` instead of single-image deep. */
  skipped_carousel: number;
  deep_insights_total: number;
  percentile_gate_active?: boolean;
  percentile_top_fraction?: number;
  percentile_scope?: string;
  percentile_universe_count?: number;
  percentile_cap?: number;
  percentile_score_basis?: string;
  percentile_format_groups?: TopPerformerPercentileGroupStat[];
  skipped_percentile_selection?: number;
  percentile_gate_disabled?: string;
  rating_gate_active?: boolean;
  rating_top_fraction?: number;
  rated_rows_in_import?: number;
  rating_gate_cap?: number;
  skipped_rating_gate?: number;
  rating_gate_disabled?: string;
  broad_insights_gate_active?: boolean;
  broad_llm_rows_in_import?: number;
  skipped_broad_insights_gate?: number;
  broad_insights_gate_disabled?: string;
}

function deepModel(profile: { synth_model: string; criteria_json: Record<string, unknown> }): string {
  const raw = profile.criteria_json?.inputs_insights;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const m = String((raw as Record<string, unknown>).deep_image_model ?? "").trim();
    if (m) return m;
  }
  return profile.synth_model || "gpt-4o-mini";
}

function deepMaxRows(criteria: Record<string, unknown>, override?: number): number {
  if (override != null && Number.isFinite(override)) return clamp(override, 1, 80);
  const ins = criteria.inputs_insights;
  if (ins && typeof ins === "object" && !Array.isArray(ins)) {
    const n = parseInt(String((ins as Record<string, unknown>).deep_image_max ?? ""), 10);
    if (!Number.isNaN(n)) return clamp(n, 1, 80);
  }
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const n = parseInt(String((tp as Record<string, unknown>).max_rows ?? ""), 10);
    if (!Number.isNaN(n)) return clamp(n, 1, 80);
  }
  return 24;
}

function deepMinPreLlm(criteria: Record<string, unknown>, override?: number): number {
  if (override != null && Number.isFinite(override)) return clamp(override, 0, 1);
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const n = parseFloat(String((tp as Record<string, unknown>).pre_llm_min_score ?? ""));
    if (!Number.isNaN(n)) return clamp(n, 0, 1);
  }
  return 0.35;
}

function makeDeepInsightsId(importId: string, rowId: string): string {
  return `ins_${importId.replace(/-/g, "").slice(0, 10)}_${rowId}_deep`;
}

function parseRiskFlags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
}

export async function runDeepImageInsightsForImport(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  importId: string,
  opts: RunDeepImageInsightsOptions = {}
): Promise<RunDeepImageInsightsResult> {
  if (config.PROCESSING_VISION_PROVIDER === "openai" && !config.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required for image insights");
  }
  if (config.PROCESSING_VISION_PROVIDER === "nvidia" && !config.NVIDIA_NIM_API_KEY?.trim()) {
    throw new Error("NVIDIA_NIM_API_KEY is required when PROCESSING_VISION_PROVIDER=nvidia");
  }

  const project = await ensureProject(db, projectSlug);
  const imp = await getInputsEvidenceImport(db, project.id, importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);

  let profile = await getInputsProcessingProfile(db, project.id);
  if (!profile) {
    profile = await upsertInputsProcessingProfile(db, project.id, {});
  }
  const criteria = (profile.criteria_json ?? {}) as Record<string, unknown>;
  const model = deepModel(profile);
  const maxRows = deepMaxRows(criteria, opts.max_rows);
  const percentileConfig = resolveTopPerformerPercentileConfig(
    criteria,
    buildTopPerformerRatingGateRequestOverrides(opts),
    opts.min_pre_llm_score
  );
  const broadGate = await resolveBroadInsightsSampleGate(db, importId, criteria);
  const ratingScores = await listEvidenceRowRatingScoreMap(db, project.id, importId);
  const ratedRowsInImport = await countRatedEvidenceRows(db, project.id, importId);

  const mediaArchiveRequested = resolveTopPerformerArchiveMedia(config, criteria);
  const mediaSupabaseConfigured = !!getSupabaseStorageClient(config);
  const embedHttpProxyCfg = resolveInstagramEmbedHttpProxy(config, criteria);

  const existingDeep = opts.rescan ? new Set<string>() : await listEvidenceRowInsightIdsByImportTier(db, importId, "top_performer_deep");

  const dbRows = await listEvidenceRowsForPreLlmScoring(db, project.id, importId, 12_000);

  type Cand = ScoredTopPerformerRow & {
    pre_llm_score: number;
    evidence_kind: string;
    payload: Record<string, unknown>;
    image_url: string;
  };
  const eligible: Cand[] = [];
  let skippedVideo = 0;
  let skippedNoImage = 0;
  let skippedCarousel = 0;
  let skippedBroadInsightsGate = 0;

  for (const r of dbRows) {
    if (r.evidence_kind === "tiktok_video") {
      skippedVideo++;
      continue;
    }
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    if (isVideoLikeEvidence(r.evidence_kind, payload)) {
      skippedVideo++;
      continue;
    }
    if (isCarouselDeepEligible(payload, 12)) {
      skippedCarousel++;
      continue;
    }
    const ev = evaluatePreLlmRow(r.evidence_kind, payload, criteria);
    if (ev.dropped_reason != null) continue;
    const imageUrl = pickPrimaryImageUrlForDeepAnalysis(r.evidence_kind, payload);
    if (!imageUrl) {
      skippedNoImage++;
      continue;
    }
    const scored = scoreRowForTopPerformer(r.id, ev.pre_llm_score, ratingScores);
    eligible.push({
      ...scored,
      pre_llm_score: ev.pre_llm_score,
      evidence_kind: r.evidence_kind,
      payload,
      image_url: imageUrl,
    });
  }

  skippedBroadInsightsGate = broadGate.active ? eligible.filter((e) => !broadGate.idSet.has(e.id)).length : 0;

  const { selected: percentileSelected, stats: percentileStats } = applyTopPerformerPercentileSelection(
    eligible,
    percentileConfig,
    {
      broadIdSet: broadGate.active ? broadGate.idSet : null,
      maxRows,
      ratedRowsInImport,
      groupByFormatFamily: (r) => topPerformerFormatFamilyForRow(r.evidence_kind, r.payload),
    }
  );

  const skippedPercentileSelection = Math.max(
    0,
    percentileStats.universe_count - percentileStats.selected_by_percentile
  );

  const top = percentileSelected.filter((c) => !existingDeep.has(c.id));
  const ratingRows = await listEvidenceRowRatingFieldsByIds(db, project.id, importId, top.map((c) => c.id));
  const ratingSnapByRow = ratingReviewSnapshotsByRowId(
    ratingRows.map((row) => ({
      id: row.id,
      rating_score: row.rating_score,
      rating_components_json: row.rating_components_json,
      rating_rationale: row.rating_rationale,
      rated_at: row.rated_at,
    }))
  );

  const auditBase = {
    db,
    projectId: project.id,
    runId: null,
    taskId: null,
    signalPackId: null,
  };

  let analyzed = 0;
  for (const c of top) {
    const textBundle = summarizePayloadForLlm(c.evidence_kind, c.payload, 2500);
    const system = TOP_PERFORMER_IMAGE_SYSTEM_PROMPT;

    let visionUrl = c.image_url;
    let storedInspection: Record<string, unknown> | undefined;

    const postUrlForRefresh = instagramPostPermalinkFromPayload(c.payload);
    const needsFreshImage =
      shouldRelayImageUrlForOpenAi(visionUrl) || isLikelyStaleInstagramCdnUrl(visionUrl);
    if (c.evidence_kind === "instagram_post" && postUrlForRefresh && needsFreshImage) {
      const fresh = await fetchFreshInstagramImageUrlFromPostEmbed(
        postUrlForRefresh,
        config,
        embedHttpProxyCfg.url
      );
      if (fresh) visionUrl = fresh;
    }

    if (mediaArchiveRequested && mediaSupabaseConfigured) {
      const arch = await archiveTopPerformerVisionMedia(config, {
        projectSlug,
        inputsImportId: importId,
        sourceEvidenceRowId: c.id,
        tier: "top_performer_deep",
        role: "carousel_slide",
        urls: [visionUrl],
        ...(embedHttpProxyCfg.url ? { http_proxy_url: embedHttpProxyCfg.url } : {}),
      });
      storedInspection = JSON.parse(JSON.stringify(arch)) as Record<string, unknown>;
      const it0 = arch.items[0];
      const signed = it0?.ok ? it0.vision_fetch_url || it0.public_url : null;
      if (signed) {
        visionUrl = signed;
      } else if (it0?.error) {
        storedInspection = {
          ...storedInspection,
          archive_download_error: it0.error,
          archive_source_url: visionUrl,
        };
      }
    }

    try {
      const imgRelay = await relayImageUrlsForOpenAiVision(config, [visionUrl], {
        http_proxy_url: embedHttpProxyCfg.url,
      });
      visionUrl = imgRelay.urls[0] ?? visionUrl;
    } catch (relayErr) {
      const relayMsg = relayErr instanceof Error ? relayErr.message : String(relayErr);
      const postHint = postUrlForRefresh ? ` Post: ${postUrlForRefresh}.` : "";
      throw new Error(
        `Could not download top-performer image for vision (${relayMsg}).${postHint} ${VISION_CDN_PROXY_HINT}`
      );
    }
    assertVisionImageUrlsSafeForRemoteFetch([visionUrl]);

    const userText = `Evidence kind: ${c.evidence_kind}\nPre-LLM score: ${c.pre_llm_score}\nContext:\n${textBundle}`;

    const out = await processingVisionChatMultimodal(
      config,
      model,
      {
        system_prompt: system,
        user_content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: finalizeHttpsImageUrlForOpenAiVision(visionUrl), detail: "low" } },
        ],
        max_tokens: 4096,
        response_format: "json_object",
      },
      { ...auditBase, step: STEP }
    );

    const parsed = parseJsonObjectFromLlmText(out.content) as Record<string, unknown> | null;
    const aesthetic: Record<string, unknown> = parsed
      ? {
          palette: parsed.palette,
          typography: parsed.typography,
          layout: parsed.layout,
          on_screen_text: parsed.on_screen_text,
          style_summary: parsed.style_summary,
        }
      : {};

    const risks = parseRiskFlags(parsed?.risk_flags);

    if (mediaArchiveRequested && !mediaSupabaseConfigured) {
      storedInspection = {
        archived_at: new Date().toISOString(),
        tier: "top_performer_deep",
        project_slug: projectSlug,
        inputs_import_id: importId,
        source_evidence_row_id: c.id,
        skipped_reason: "supabase_not_configured",
        items: [],
      };
    }

    await upsertEvidenceRowInsight(db, {
      project_id: project.id,
      inputs_import_id: importId,
      source_evidence_row_id: c.id,
      insights_id: makeDeepInsightsId(importId, c.id),
      analysis_tier: "top_performer_deep",
      pre_llm_score: c.pre_llm_score,
      llm_model: out.model || model,
      why_it_worked: typeof parsed?.why_it_worked === "string" ? parsed.why_it_worked : null,
      primary_emotion: null,
      secondary_emotion: null,
      hook_type: null,
      custom_label_1: null,
      custom_label_2: null,
      custom_label_3: null,
      cta_type: null,
      hashtags: null,
      caption_style: typeof parsed?.caption_style === "string" ? parsed.caption_style : null,
      hook_text: typeof parsed?.hook_text === "string" ? parsed.hook_text : null,
      risk_flags_json: risks,
      aesthetic_analysis_json: aesthetic,
      raw_llm_json: parsed,
      evidence_performance_review_json: ratingSnapByRow.get(c.id) ?? null,
      ...(storedInspection !== undefined ? { stored_inspection_media_json: storedInspection } : {}),
    });
    analyzed++;
  }

  const deepTotal = await countEvidenceRowInsightsByImportTier(db, importId, "top_performer_deep");

  return {
    import_id: importId,
    model,
    rows_scanned: dbRows.length,
    candidates_with_image: top.length,
    rows_analyzed: analyzed,
    skipped_no_image: skippedNoImage,
    skipped_video: skippedVideo,
    skipped_carousel: skippedCarousel,
    deep_insights_total: deepTotal,
    percentile_gate_active: percentileConfig.active,
    percentile_top_fraction: percentileConfig.fraction,
    percentile_scope: "top_performer_deep",
    percentile_universe_count: percentileStats.universe_count,
    percentile_cap: percentileStats.percentile_cap,
    percentile_score_basis: percentileStats.score_basis,
    percentile_format_groups: percentileStats.format_groups,
    skipped_percentile_selection: skippedPercentileSelection,
    percentile_gate_disabled: percentileConfig.disabled,
    rating_gate_active: percentileConfig.active,
    rating_top_fraction: percentileConfig.fraction,
    rated_rows_in_import: ratedRowsInImport,
    rating_gate_cap: percentileStats.percentile_cap,
    skipped_rating_gate: skippedPercentileSelection,
    rating_gate_disabled: percentileConfig.disabled,
    broad_insights_gate_active: broadGate.active,
    broad_llm_rows_in_import: broadGate.broad_llm_row_count,
    skipped_broad_insights_gate: skippedBroadInsightsGate,
    broad_insights_gate_disabled: broadGate.disabled,
  };
}
