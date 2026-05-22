/**
 * Top-performer **video** pass: multimodal on **sampled frame images + transcript** (no full video to OpenAI).
 * **Instagram, TikTok, and Facebook** only (`instagram_post`, `tiktok_video`, `facebook_post`); text-first kinds (e.g. Reddit) are skipped.
 * Rows without pre-ingested `analysis_frame_urls` may still qualify when a downloadable **source video URL** exists:
 * Core downloads the file, extracts JPEG frames (ffmpeg), persists `evidence_media_assets` (+ Supabase when configured),
 * then runs vision on those frames + transcript.
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
import { normalizeVideoInsightsLlmJson } from "./video-insights-llm-normalize.js";
import { runVideoFramesVisionAnalysis } from "./video-insights-vision.js";
import { evaluatePreLlmRow } from "./inputs-pre-llm-rank.js";
import { finalizeHttpsImageUrlForOpenAiVision, isVideoLikeEvidence } from "./inputs-image-url-for-analysis.js";
import { parseVideoAnalysisFrameUrls, parseVideoSourceUrlForArchive } from "./inputs-video-evidence-bundle.js";
import { ensureVideoFramesForEvidenceRow } from "./inputs-video-evidence-preparation.js";
import {
  TOP_PERFORMER_VIDEO_SYSTEM_PROMPT,
  buildVideoAestheticAnalysisJson,
  buildVideoInsightUserText,
  parseTopPerformerVideoRiskFlags,
} from "./inputs-top-performer-video-prompt.js";
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
  resolveTopPerformerArchiveSourceVideo,
} from "./inputs-top-performer-media-archive.js";
import { getSupabaseStorageClient } from "./supabase-storage.js";
import {
  capAndSortQualifierPreview,
  excerptForTopPerformerPreview,
  postUrlForTopPerformerPreview,
  type TopPerformerMediaQualifierPreviewRow,
} from "./inputs-top-performer-qualifying-preview.js";
import { resolveInstagramEmbedHttpProxy } from "./inputs-instagram-embed-carousel-resolver.js";
import { relayImageUrlsForOpenAiVision } from "./inputs-top-performer-vision-relay.js";

const STEP = "inputs_top_performer_video_insight";

/** Frame-bundle vision runs only on these evidence kinds (excludes Reddit and other text-first rows). */
const VIDEO_TOP_PERFORMER_EVIDENCE_KINDS = new Set<string>(["instagram_post", "tiktok_video", "facebook_post"]);

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export {
  TOP_PERFORMER_VIDEO_SYSTEM_PROMPT,
  TOP_PERFORMER_VIDEO_USER_PROMPT_TEMPLATE,
} from "./inputs-top-performer-video-prompt.js";

export interface RunDeepVideoInsightsOptions {
  max_rows?: number;
  min_pre_llm_score?: number;
  rescan?: boolean;
  max_frames?: number;
  rating_top_fraction?: number;
  disable_rating_percentile_gate?: boolean;
}

export interface RunDeepVideoInsightsResult {
  import_id: string;
  model: string;
  rows_scanned: number;
  video_evidence_rows: number;
  candidates_with_frames: number;
  rows_analyzed: number;
  skipped_no_frames: number;
  /** Rows with no frame URLs and no downloadable `video_url` / `source_video_url` in payload. */
  skipped_no_video_source: number;
  /** Rows that received new ffmpeg-extracted frames in this run. */
  rows_frames_extracted_from_video: number;
  evidence_media_rows_written: number;
  video_insights_total: number;
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
  /** Rows skipped because `evidence_kind` is not IG / TT / FB. */
  skipped_evidence_kind_filter?: number;
  /** Rows that qualify for video frame vision (≥1 frame URL bundle, pre-LLM + gates); sorted by pre-LLM desc, capped for UI. */
  qualifying_video_rows?: TopPerformerMediaQualifierPreviewRow[];
  top_performer_media_archive_requested?: boolean;
  top_performer_media_supabase_configured?: boolean;
  top_performer_media_archive_files_saved?: number;
  top_performer_media_archive_errors?: number;
  /** Successful Storage uploads counted from `role === "video_frame"` archive items. */
  top_performer_media_archive_frame_files_saved?: number;
  /** Successful Storage uploads counted from `role === "source_video"` archive items. */
  top_performer_media_archive_source_video_files_saved?: number;
  rows_whisper_transcribed?: number;
  /** Rows where source MP4 was uploaded to Supabase (`evidence_media/…/source.mp4`). */
  rows_source_video_archived?: number;
  deep_video_zero_work_summary?: string | null;
}

function videoModel(profile: { synth_model: string; criteria_json: Record<string, unknown> }): string {
  const raw = profile.criteria_json?.inputs_insights;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const m = String((raw as Record<string, unknown>).deep_video_model ?? "").trim();
    if (m) return m;
  }
  return profile.synth_model || "gpt-4o-mini";
}

function videoMaxRows(criteria: Record<string, unknown>, override?: number): number {
  if (override != null && Number.isFinite(override)) return clamp(override, 1, 60);
  const ins = criteria.inputs_insights;
  if (ins && typeof ins === "object" && !Array.isArray(ins)) {
    const n = parseInt(String((ins as Record<string, unknown>).deep_video_max ?? ""), 10);
    if (!Number.isNaN(n)) return clamp(n, 1, 60);
  }
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const n = parseInt(String((tp as Record<string, unknown>).max_video_rows ?? ""), 10);
    if (!Number.isNaN(n)) return clamp(n, 1, 60);
  }
  return 12;
}

function videoMinPreLlm(criteria: Record<string, unknown>, override?: number): number {
  if (override != null && Number.isFinite(override)) return clamp(override, 0, 1);
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const n = parseFloat(String((tp as Record<string, unknown>).pre_llm_min_score_video ?? ""));
    if (!Number.isNaN(n)) return clamp(n, 0, 1);
    const n2 = parseFloat(String((tp as Record<string, unknown>).pre_llm_min_score ?? ""));
    if (!Number.isNaN(n2)) return clamp(n2, 0, 1);
  }
  return 0.4;
}

function makeVideoInsightsId(importId: string, rowId: string): string {
  return `ins_${importId.replace(/-/g, "").slice(0, 10)}_${rowId}_vdeep`;
}

function isVideoEvidenceRow(kind: string, payload: Record<string, unknown>): boolean {
  if (kind === "tiktok_video") return true;
  return isVideoLikeEvidence(kind, payload);
}

export async function runDeepVideoInsightsForImport(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  importId: string,
  opts: RunDeepVideoInsightsOptions = {}
): Promise<RunDeepVideoInsightsResult> {
  if (config.PROCESSING_VISION_PROVIDER === "openai" && !config.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required for video frame insights");
  }
  if (config.PROCESSING_VISION_PROVIDER === "nvidia" && !config.NVIDIA_NIM_API_KEY?.trim()) {
    throw new Error("NVIDIA_NIM_API_KEY is required when PROCESSING_VISION_PROVIDER=nvidia");
  }

  const openAiApiKey = config.OPENAI_API_KEY?.trim() ?? "";

  const project = await ensureProject(db, projectSlug);
  const imp = await getInputsEvidenceImport(db, project.id, importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);

  let profile = await getInputsProcessingProfile(db, project.id);
  if (!profile) {
    profile = await upsertInputsProcessingProfile(db, project.id, {});
  }
  const criteria = (profile.criteria_json ?? {}) as Record<string, unknown>;
  const model = videoModel(profile);
  const maxRows = videoMaxRows(criteria, opts.max_rows);
  const percentileConfig = resolveTopPerformerPercentileConfig(
    criteria,
    buildTopPerformerRatingGateRequestOverrides(opts),
    opts.min_pre_llm_score
  );
  const maxFrames = clamp(opts.max_frames ?? 12, 1, 16);

  const mediaArchiveRequested = resolveTopPerformerArchiveMedia(config, criteria);
  const sourceVideoArchiveRequested = mediaArchiveRequested && resolveTopPerformerArchiveSourceVideo(config, criteria);
  const mediaSupabaseConfigured = !!getSupabaseStorageClient(config);
  const mediaArchiveHttpProxyCfg = resolveInstagramEmbedHttpProxy(config, criteria);
  let mediaArchiveFilesSaved = 0;
  let mediaArchiveErrors = 0;
  let mediaArchiveFrameFilesSaved = 0;
  let mediaArchiveSourceVideoFilesSaved = 0;

  const broadGate = await resolveBroadInsightsSampleGate(db, importId, criteria);
  const ratingScores = await listEvidenceRowRatingScoreMap(db, project.id, importId);
  const ratedRowsInImport = await countRatedEvidenceRows(db, project.id, importId);

  const existing = opts.rescan ? new Set<string>() : await listEvidenceRowInsightIdsByImportTier(db, importId, "top_performer_video");

  const dbRows = await listEvidenceRowsForPreLlmScoring(db, project.id, importId, 12_000);

  type Cand = ScoredTopPerformerRow & {
    pre_llm_score: number;
    evidence_kind: string;
    payload: Record<string, unknown>;
    frame_urls: string[];
    transcript: string;
    caption_transcript: string;
  };
  const eligible: Cand[] = [];
  let skippedNoFrames = 0;
  let skippedNoVideoSource = 0;
  let skippedBroadInsightsGate = 0;
  let skippedEvidenceKindFilter = 0;
  let videoEvidenceRows = 0;
  const qualifyingVideoScratch: TopPerformerMediaQualifierPreviewRow[] = [];

  for (const r of dbRows) {
    if (!VIDEO_TOP_PERFORMER_EVIDENCE_KINDS.has(r.evidence_kind)) {
      skippedEvidenceKindFilter++;
      continue;
    }
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    if (!isVideoEvidenceRow(r.evidence_kind, payload)) continue;
    videoEvidenceRows++;
    const ev = evaluatePreLlmRow(r.evidence_kind, payload, criteria);
    if (ev.dropped_reason != null) continue;
    const frameUrls = parseVideoAnalysisFrameUrls(payload, maxFrames);
    const videoSourceUrl = parseVideoSourceUrlForArchive(payload);
    if (frameUrls.length === 0 && !videoSourceUrl) {
      skippedNoFrames++;
      skippedNoVideoSource++;
      continue;
    }
    const scored = scoreRowForTopPerformer(r.id, ev.pre_llm_score, ratingScores);
    eligible.push({
      ...scored,
      pre_llm_score: ev.pre_llm_score,
      evidence_kind: r.evidence_kind,
      payload,
      frame_urls: frameUrls.length > 0 ? frameUrls : [],
      transcript: "",
      caption_transcript: "",
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
  const selectedIdSet = new Set(percentileSelected.map((c) => c.id));
  for (const e of eligible) {
    if (broadGate.active && !broadGate.idSet.has(e.id)) continue;
    if (!selectedIdSet.has(e.id)) continue;
    qualifyingVideoScratch.push({
      row_id: e.id,
      evidence_kind: e.evidence_kind,
      pre_llm_score: e.score,
      media_count: e.frame_urls.length > 0 ? e.frame_urls.length : parseVideoSourceUrlForArchive(e.payload) ? 1 : 0,
      caption_excerpt: excerptForTopPerformerPreview(e.payload),
      post_url: postUrlForTopPerformerPreview(e.evidence_kind, e.payload),
      already_has_tier_insight: existing.has(e.id),
    });
  }

  const top = percentileSelected.filter((c) => !existing.has(c.id));
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
  let rowsFramesExtracted = 0;
  let rowsSourceVideoArchived = 0;
  let rowsWhisperTranscribed = 0;
  let evidenceMediaRowsWritten = 0;

  const platformForRow = (kind: string): string => {
    if (kind === "tiktok_video") return "tiktok";
    if (kind === "facebook_post") return "facebook";
    return "instagram";
  };

  for (const c of top) {
    const system = TOP_PERFORMER_VIDEO_SYSTEM_PROMPT;

    const prep = await ensureVideoFramesForEvidenceRow(db, config, {
      projectId: project.id,
      projectSlug,
      importId,
      evidenceRowId: c.id,
      sourcePlatform: platformForRow(c.evidence_kind),
      payload: c.payload,
      maxFrames,
      criteria,
      postUrl: postUrlForTopPerformerPreview(c.evidence_kind, c.payload),
      postId: String(c.payload.id ?? c.payload.post_id ?? "").trim() || null,
      ownerUsername: String(c.payload.username ?? c.payload.owner ?? "").trim() || null,
      httpProxyUrl: mediaArchiveHttpProxyCfg.url,
      forceReextract: !!opts.rescan,
      openAiApiKey,
      audit: { ...auditBase, step: "inputs_top_performer_video_whisper" },
    });
    evidenceMediaRowsWritten += prep.evidence_media_rows_written;
    if (prep.frames_extracted > 0) rowsFramesExtracted++;
    if (prep.source_video_archived) rowsSourceVideoArchived++;
    if (prep.whisper_transcript?.trim()) rowsWhisperTranscribed++;

    const frameUrls = prep.frame_urls.length > 0 ? prep.frame_urls : c.frame_urls;
    if (frameUrls.length === 0) {
      continue;
    }

    const frameTimestamps =
      prep.frame_timestamps_sec.length === frameUrls.length
        ? prep.frame_timestamps_sec
        : prep.frame_timestamps_sec.length > 0
          ? prep.frame_timestamps_sec
          : Array.from({ length: frameUrls.length }, (_, i) => i);

    const userText = buildVideoInsightUserText({
      evidenceKind: c.evidence_kind,
      preLlmScore: c.pre_llm_score,
      frameCount: frameUrls.length,
      frameTimestampsSec: frameTimestamps,
      captionTranscript: prep.caption_transcript,
      spokenTranscript: prep.whisper_transcript ?? "",
      frameSource: prep.source,
    });

    let storedInspection: Record<string, unknown> | undefined;
    let visionFrameUrls = [...frameUrls];

    const skipRemoteFrameArchive =
      prep.source === "extracted_from_video" ||
      prep.source === "evidence_media_db" ||
      frameUrls.some((u) => u.startsWith("data:image/"));

    const remoteHttpsFrames = frameUrls.filter((u) => u.startsWith("https://"));

    if (mediaArchiveRequested && mediaSupabaseConfigured && !skipRemoteFrameArchive && remoteHttpsFrames.length > 0) {
      const arch = await archiveTopPerformerVisionMedia(config, {
        projectSlug,
        inputsImportId: importId,
        sourceEvidenceRowId: c.id,
        tier: "top_performer_video",
        role: "video_frame",
        urls: remoteHttpsFrames,
        archive_source_video: false,
        ...(mediaArchiveHttpProxyCfg.url ? { http_proxy_url: mediaArchiveHttpProxyCfg.url } : {}),
      });
      for (const it of arch.items) {
        if (it.ok) {
          mediaArchiveFilesSaved++;
          if (it.role !== "source_video") mediaArchiveFrameFilesSaved++;
        } else if (it.error) {
          mediaArchiveErrors++;
        }
      }
      storedInspection = JSON.parse(JSON.stringify(arch)) as Record<string, unknown>;
      visionFrameUrls = remoteHttpsFrames.map((src, i) => {
        const it = arch.items[i];
        const relay = it?.ok ? it.vision_fetch_url || it.public_url : null;
        return relay || src;
      });
      const dataUriFrames = frameUrls.filter((u) => u.startsWith("data:image/"));
      visionFrameUrls = [...visionFrameUrls, ...dataUriFrames];
    } else if (prep.source === "extracted_from_video" || prep.source === "evidence_media_db") {
      storedInspection = {
        archived_at: new Date().toISOString(),
        tier: "top_performer_video",
        project_slug: projectSlug,
        inputs_import_id: importId,
        source_evidence_row_id: c.id,
        frame_resolution_source: prep.source,
        frames_extracted: prep.frames_extracted,
        source_video_archived: prep.source_video_archived,
        items: [],
      };
    }

    const frameRelay = await relayImageUrlsForOpenAiVision(config, visionFrameUrls, {
      http_proxy_url: mediaArchiveHttpProxyCfg.url,
    });
    visionFrameUrls = frameRelay.urls;

    const visionOut = await runVideoFramesVisionAnalysis({
      config,
      profileModel: model,
      systemPrompt: system,
      userText,
      visionFrameUrls,
      frameCount: frameUrls.length,
      finalizeImageUrl: finalizeHttpsImageUrlForOpenAiVision,
      audit: auditBase,
      auditStep: STEP,
    });

    const parsed = normalizeVideoInsightsLlmJson(visionOut.parsed);
    const aesthetic = buildVideoAestheticAnalysisJson(parsed);
    if (prep.whisper_transcript) {
      aesthetic.spoken_transcript_whisper = prep.whisper_transcript;
    }

    const risks = parseTopPerformerVideoRiskFlags(parsed?.risk_flags);

    if (
      mediaArchiveRequested &&
      mediaSupabaseConfigured &&
      sourceVideoArchiveRequested &&
      prep.source !== "extracted_from_video"
    ) {
      const sourceVideoUrl = parseVideoSourceUrlForArchive(c.payload);
      if (sourceVideoUrl) {
        const arch2 = await archiveTopPerformerVisionMedia(config, {
          projectSlug,
          inputsImportId: importId,
          sourceEvidenceRowId: c.id,
          tier: "top_performer_video",
          role: "video_frame",
          urls: [],
          archive_source_video: true,
          source_video_url: sourceVideoUrl,
          ...(mediaArchiveHttpProxyCfg.url ? { http_proxy_url: mediaArchiveHttpProxyCfg.url } : {}),
        });
        for (const it of arch2.items) {
          if (it.ok) {
            mediaArchiveFilesSaved++;
            if (it.role === "source_video") mediaArchiveSourceVideoFilesSaved++;
          } else if (it.error) {
            mediaArchiveErrors++;
          }
        }
        const base = (storedInspection ?? { archived_at: new Date().toISOString(), tier: "top_performer_video" }) as Record<
          string,
          unknown
        > & { items?: unknown[] };
        const items1 = Array.isArray(base.items) ? base.items : [];
        const items2 = arch2.items ?? [];
        storedInspection = { ...base, items: [...items1, ...items2] };
      }
    }

    if (mediaArchiveRequested && !mediaSupabaseConfigured) {
      storedInspection = {
        archived_at: new Date().toISOString(),
        tier: "top_performer_video",
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
      insights_id: makeVideoInsightsId(importId, c.id),
      analysis_tier: "top_performer_video",
      pre_llm_score: c.pre_llm_score,
      llm_model: visionOut.model || model,
      why_it_worked: typeof parsed?.why_it_worked === "string" ? parsed.why_it_worked : null,
      primary_emotion: null,
      secondary_emotion: null,
      hook_type: typeof parsed?.format_pattern === "string" ? parsed.format_pattern : null,
      custom_label_1: null,
      custom_label_2: null,
      custom_label_3: null,
      cta_type: typeof parsed?.cta_clarity === "string" ? parsed.cta_clarity : null,
      hashtags: null,
      caption_style: null,
      hook_text: (() => {
        const whisper = prep.whisper_transcript?.trim();
        if (whisper) return whisper.length > 4000 ? `${whisper.slice(0, 4000)}…` : whisper;
        if (typeof parsed?.spoken_hook === "string" && parsed.spoken_hook.trim()) return parsed.spoken_hook;
        if (typeof parsed?.hook_visual === "string" && parsed.hook_visual.trim()) return parsed.hook_visual;
        return null;
      })(),
      risk_flags_json: risks,
      aesthetic_analysis_json: aesthetic,
      raw_llm_json: parsed,
      evidence_performance_review_json: ratingSnapByRow.get(c.id) ?? null,
      ...(storedInspection !== undefined ? { stored_inspection_media_json: storedInspection } : {}),
    });
    analyzed++;
  }

  const videoTotal = await countEvidenceRowInsightsByImportTier(db, importId, "top_performer_video");
  const qualifying_video_rows = capAndSortQualifierPreview(qualifyingVideoScratch);

  let deepVideoZeroWorkSummary: string | null = null;
  if (analyzed === 0 && top.length === 0) {
    if (percentileConfig.active && skippedPercentileSelection > 0 && percentileStats.universe_count > 0) {
      const pct = Math.round(percentileConfig.fraction * 10000) / 100;
      deepVideoZeroWorkSummary =
        `${videoEvidenceRows} video row(s) were media-eligible; top ${pct}% kept none for vision ` +
        `(${skippedPercentileSelection} below top fraction in universe ${percentileStats.universe_count}). Raise Top % or relax broad-insights gate.`;
    } else if (skippedNoFrames > 0) {
      deepVideoZeroWorkSummary =
        `${skippedNoFrames} video row(s) passed pre-LLM/gates but lack analysis_frame_urls and a direct HTTPS video_url (Apify video_url / video_urls_json / Instagram normalizer). ` +
        `Re-scrape with MP4 CDN URLs or run after enriching payload.`;
    }
  }

  return {
    import_id: importId,
    model,
    rows_scanned: dbRows.length,
    video_evidence_rows: videoEvidenceRows,
    candidates_with_frames: top.length,
    rows_analyzed: analyzed,
    skipped_no_frames: skippedNoFrames,
    skipped_no_video_source: skippedNoVideoSource,
    rows_frames_extracted_from_video: rowsFramesExtracted,
    rows_source_video_archived: rowsSourceVideoArchived,
    evidence_media_rows_written: evidenceMediaRowsWritten,
    video_insights_total: videoTotal,
    percentile_gate_active: percentileConfig.active,
    percentile_top_fraction: percentileConfig.fraction,
    percentile_scope: "top_performer_video",
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
    skipped_evidence_kind_filter: skippedEvidenceKindFilter,
    qualifying_video_rows,
    top_performer_media_archive_requested: mediaArchiveRequested,
    top_performer_media_supabase_configured: mediaSupabaseConfigured,
    top_performer_media_archive_files_saved: mediaArchiveFilesSaved,
    top_performer_media_archive_errors: mediaArchiveErrors,
    top_performer_media_archive_frame_files_saved: mediaArchiveFrameFilesSaved,
    top_performer_media_archive_source_video_files_saved: mediaArchiveSourceVideoFilesSaved,
    rows_whisper_transcribed: rowsWhisperTranscribed,
    deep_video_zero_work_summary: deepVideoZeroWorkSummary,
  };
}
