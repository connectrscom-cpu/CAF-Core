/**
 * Resolve HTTPS frame URLs for top-performer **video** vision:
 * 1) ffmpeg multi-frame sample from source video (preferred when URL exists),
 * 2) archived multi-frame rows in `evidence_media_assets`,
 * 3) payload `analysis_frame_urls` only when not a lone thumbnail fallback.
 */

import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  findArchivedSourceVideoUrlForEvidenceRow,
  listEvidenceMediaVisionFrameUrls,
  upsertEvidenceMediaAssetArchived,
} from "../repositories/inputs-evidence-media.js";
import {
  extractAudioMp3FromVideo,
  extractVideoFramesJpeg,
  videoSampleTimestamps,
  withTempVideoFile,
} from "./creative-intelligence-media.js";
import {
  parseVideoAnalysisFrameUrls,
  parseVideoAnalysisTranscript,
  parseVideoSourceUrlForArchive,
} from "./inputs-video-evidence-bundle.js";
import { openaiWhisperTranscribe } from "./openai-whisper-transcribe.js";
import type { OpenAiAuditContext } from "./openai-chat.js";
import { fetchRemoteVideoFile } from "./inputs-top-performer-media-archive.js";
import { tryCreateInstagramEmbedProxyAgent } from "./inputs-instagram-embed-carousel-resolver.js";
import { shouldRelayImageUrlForOpenAi } from "./inputs-top-performer-vision-relay.js";
import { createSignedUrlForObjectKey, getSupabaseStorageClient, uploadBuffer } from "./supabase-storage.js";

export type VideoFrameResolutionSource =
  | "payload"
  | "evidence_media_db"
  | "extracted_from_video"
  | "none";

export interface VideoFramePreparationResult {
  frame_urls: string[];
  /** Seconds aligned with `frame_urls` when ffmpeg extracted frames. */
  frame_timestamps_sec: number[];
  source: VideoFrameResolutionSource;
  evidence_media_rows_written: number;
  frames_extracted: number;
  source_video_archived: boolean;
  caption_transcript: string;
  whisper_transcript: string | null;
  extraction_error?: string;
}

function slugPathSegment(slug: string): string {
  const s = slug.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 64);
  return s || "project";
}

function truthyExtract(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function explicitExtractDisable(v: unknown): boolean {
  if (v === false) return true;
  const s = String(v).trim().toLowerCase();
  return s === "0" || s === "false" || s === "no" || s === "off";
}

/** Whether Core may download a source video and run ffmpeg when frame URLs are missing. */
export function resolveExtractVideoFramesFromSource(config: AppConfig, criteria: Record<string, unknown>): boolean {
  const mode = config.CAF_TOP_PERFORMER_EXTRACT_VIDEO_FRAMES;
  if (mode === "off") return false;
  if (mode === "on") return true;

  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const raw = (tp as Record<string, unknown>).extract_frames_from_video;
    if (explicitExtractDisable(raw)) return false;
    if (truthyExtract(raw)) return true;
  }

  return true;
}

/**
 * When true (default in **auto**), top-performer video downloads `video_url` and uploads source + frames
 * to Supabase instead of using scrape thumbnails only.
 */
export function resolvePreferSourceVideoDownload(config: AppConfig, criteria: Record<string, unknown>): boolean {
  const mode = config.CAF_TOP_PERFORMER_DOWNLOAD_SOURCE_VIDEO;
  if (mode === "off") return false;
  if (mode === "on") return true;

  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const raw = (tp as Record<string, unknown>).download_source_video;
    if (explicitExtractDisable(raw)) return false;
    if (truthyExtract(raw)) return true;
  }

  return true;
}

export function resolveTranscribeVideoAudio(config: AppConfig, criteria: Record<string, unknown>): boolean {
  const mode = config.CAF_TOP_PERFORMER_VIDEO_WHISPER;
  if (mode === "off") return false;
  if (mode === "on") return true;

  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const raw = (tp as Record<string, unknown>).transcribe_video_audio;
    if (explicitExtractDisable(raw)) return false;
    if (truthyExtract(raw)) return true;
  }

  return true;
}

/** 0 = always run Whisper when a video URL is available (transcribe all). Set to 80+ to restore caption-length skip. */
export function resolveWhisperSkipWhenCaptionChars(
  config: AppConfig,
  criteria: Record<string, unknown>
): number {
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const raw = (tp as Record<string, unknown>).whisper_skip_when_caption_chars;
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
    if (raw != null && String(raw).trim() !== "") {
      const n = parseInt(String(raw), 10);
      if (!Number.isNaN(n) && n >= 0) return n;
    }
  }
  return config.CAF_TOP_PERFORMER_WHISPER_SKIP_CAPTION_CHARS;
}

export function shouldRunWhisper(
  captionTranscript: string,
  config: AppConfig,
  criteria: Record<string, unknown>
): boolean {
  if (!resolveTranscribeVideoAudio(config, criteria)) return false;
  const skipAt = resolveWhisperSkipWhenCaptionChars(config, criteria);
  if (skipAt > 0 && captionTranscript.trim().length >= skipAt) return false;
  return true;
}

async function tryWhisperFromVideoUrl(
  config: AppConfig,
  args: EnsureVideoFramesArgs,
  videoUrl: string,
  captionTranscript: string
): Promise<string | null> {
  if (!videoUrl.trim() || !args.openAiApiKey?.trim()) return null;
  if (!shouldRunWhisper(captionTranscript, config, args.criteria)) return null;
  try {
    const proxyAgent = tryCreateInstagramEmbedProxyAgent(args.httpProxyUrl);
    try {
      const dl = await fetchRemoteVideoFile(
        videoUrl,
        config.CAF_TOP_PERFORMER_ARCHIVE_SOURCE_VIDEO_TIMEOUT_MS,
        config.CAF_TOP_PERFORMER_ARCHIVE_MAX_BYTES_SOURCE_VIDEO,
        proxyAgent ?? undefined
      );
      return await whisperFromVideoBuffer(config, args.openAiApiKey.trim(), dl.buf, dl.ext, args.audit);
    } finally {
      await proxyAgent?.close().catch(() => {});
    }
  } catch {
    return null;
  }
}

async function whisperFromVideoBuffer(
  config: AppConfig,
  apiKey: string,
  videoBuf: Buffer,
  videoExt: string,
  audit: OpenAiAuditContext | null | undefined
): Promise<string | null> {
  let text: string | null = null;
  await withTempVideoFile(videoBuf, videoExt, async (fp) => {
    const audio = await extractAudioMp3FromVideo(config, fp, 120);
    if (!audio || audio.length < 500) return;
    const out = await openaiWhisperTranscribe(
      apiKey,
      {
        model: config.OPENAI_WHISPER_MODEL,
        audio,
        filename: `evidence${videoExt.replace(/^\./, "") || "mp4"}.mp3`,
      },
      audit ? { ...audit, step: "inputs_top_performer_video_whisper" } : null
    );
    text = out.text.trim() || null;
  });
  return text;
}

async function visionUrlForStoredObject(
  config: AppConfig,
  bucket: string,
  objectPath: string,
  publicUrl: string | null
): Promise<string> {
  const signed = await createSignedUrlForObjectKey(config, bucket, objectPath, 604800);
  if ("signedUrl" in signed) return signed.signedUrl;
  if (publicUrl?.trim()) return publicUrl.trim();
  return "";
}

function frameSourceUrlDedupeKey(videoUrl: string, timestampSec: number): string {
  return `${videoUrl}#caf_frame_t=${timestampSec}`;
}

export interface EnsureVideoFramesArgs {
  projectId: string;
  projectSlug: string;
  importId: string;
  evidenceRowId: string;
  sourcePlatform: string;
  payload: Record<string, unknown>;
  maxFrames: number;
  criteria: Record<string, unknown>;
  postUrl?: string | null;
  postId?: string | null;
  ownerUsername?: string | null;
  httpProxyUrl?: string | null;
  /** When false, reuse archived extracted frames in DB without re-downloading video. */
  forceReextract?: boolean;
  openAiApiKey?: string | null;
  audit?: OpenAiAuditContext | null;
}

export const MIN_FRAMES_FOR_FULL_VIDEO_SAMPLE = 3;

/**
 * Returns HTTPS (or data-URI) image URLs suitable for OpenAI vision, persisting media to
 * `evidence_media_assets` (+ Supabase when configured) when extraction runs.
 */
export async function ensureVideoFramesForEvidenceRow(
  db: Pool,
  config: AppConfig,
  args: EnsureVideoFramesArgs
): Promise<VideoFramePreparationResult> {
  const maxFrames = Math.max(1, Math.min(args.maxFrames, 16));
  const captionTranscript = parseVideoAnalysisTranscript(args.payload);
  const emptyResult = (partial: Partial<VideoFramePreparationResult>): VideoFramePreparationResult => ({
    frame_urls: [],
    frame_timestamps_sec: [],
    source: "none",
    evidence_media_rows_written: 0,
    frames_extracted: 0,
    source_video_archived: false,
    caption_transcript: captionTranscript,
    whisper_transcript: null,
    ...partial,
  });

  const videoUrl = parseVideoSourceUrlForArchive(args.payload);
  const canExtract = resolveExtractVideoFramesFromSource(config, args.criteria);
  const fromPayload = parseVideoAnalysisFrameUrls(args.payload, maxFrames);
  const payloadUsesBlockedCdn = fromPayload.some((u) => shouldRelayImageUrlForOpenAi(u));
  const sparsePayloadFrames = fromPayload.length > 0 && fromPayload.length < MIN_FRAMES_FOR_FULL_VIDEO_SAMPLE;

  let ffmpegFailed: VideoFramePreparationResult | null = null;

  if (!args.forceReextract) {
    const fromDb = await listEvidenceMediaVisionFrameUrls(db, args.projectId, args.evidenceRowId, maxFrames);
    if (fromDb.length >= MIN_FRAMES_FOR_FULL_VIDEO_SAMPLE) {
      const whisper = videoUrl
        ? await tryWhisperFromVideoUrl(config, args, videoUrl, captionTranscript)
        : null;
      return {
        frame_urls: fromDb,
        frame_timestamps_sec: videoSampleTimestamps(null, fromDb.length),
        source: "evidence_media_db",
        evidence_media_rows_written: 0,
        frames_extracted: 0,
        source_video_archived: false,
        caption_transcript: captionTranscript,
        whisper_transcript: whisper,
      };
    }
  }

  if (videoUrl && canExtract) {
    const extracted = await downloadExtractAndArchiveSourceVideo(
      db,
      config,
      args,
      videoUrl,
      maxFrames,
      captionTranscript
    );
    if (extracted.frame_urls.length > 0) {
      return extracted;
    }
    ffmpegFailed = extracted;
    if (args.forceReextract) {
      return extracted;
    }
  }

  if (fromPayload.length > 0 && !payloadUsesBlockedCdn) {
    if (videoUrl && canExtract && sparsePayloadFrames && ffmpegFailed) {
      return {
        ...ffmpegFailed,
        frame_urls: [],
        source: "none",
        extraction_error:
          ffmpegFailed.extraction_error ??
          "refused_single_thumbnail_after_ffmpeg_failed",
      };
    }
    if (!(videoUrl && canExtract && sparsePayloadFrames)) {
      const whisper = videoUrl ? await tryWhisperFromVideoUrl(config, args, videoUrl, captionTranscript) : null;
      return {
        frame_urls: fromPayload,
        frame_timestamps_sec: videoSampleTimestamps(null, fromPayload.length),
        source: "payload",
        evidence_media_rows_written: 0,
        frames_extracted: 0,
        source_video_archived: false,
        caption_transcript: captionTranscript,
        whisper_transcript: whisper,
      };
    }
  }

  if (fromPayload.length > 0 && payloadUsesBlockedCdn) {
    return emptyResult({
      extraction_error: videoUrl
        ? "source_video_download_or_frame_extract_failed; payload_thumbnails_are_expired_instagram_cdn"
        : "payload_thumbnails_are_expired_instagram_cdn_no_video_url",
    });
  }

  if (!args.forceReextract) {
    const fromDb = await listEvidenceMediaVisionFrameUrls(db, args.projectId, args.evidenceRowId, maxFrames);
    if (fromDb.length > 0) {
      const whisper = videoUrl
        ? await tryWhisperFromVideoUrl(config, args, videoUrl, captionTranscript)
        : null;
      return {
        frame_urls: fromDb,
        frame_timestamps_sec: videoSampleTimestamps(null, fromDb.length),
        source: "evidence_media_db",
        evidence_media_rows_written: 0,
        frames_extracted: 0,
        source_video_archived: false,
        caption_transcript: captionTranscript,
        whisper_transcript: whisper,
      };
    }
  }

  if (!canExtract) {
    return emptyResult({ extraction_error: "extract_frames_from_video_disabled" });
  }

  if (!videoUrl) {
    return emptyResult({ extraction_error: "no_downloadable_video_url" });
  }

  return downloadExtractAndArchiveSourceVideo(db, config, args, videoUrl, maxFrames, captionTranscript);
}

async function downloadExtractAndArchiveSourceVideo(
  db: Pool,
  config: AppConfig,
  args: EnsureVideoFramesArgs,
  videoUrl: string,
  maxFrames: number,
  captionTranscript: string
): Promise<VideoFramePreparationResult> {
  const emptyResult = (partial: Partial<VideoFramePreparationResult>): VideoFramePreparationResult => ({
    frame_urls: [],
    frame_timestamps_sec: [],
    source: "none",
    evidence_media_rows_written: 0,
    frames_extracted: 0,
    source_video_archived: false,
    caption_transcript: captionTranscript,
    whisper_transcript: null,
    ...partial,
  });

  const proxyAgent = tryCreateInstagramEmbedProxyAgent(args.httpProxyUrl);
  let rowsWritten = 0;
  let sourceVideoArchived = false;

  try {
    let videoBuf: Buffer;
    let videoExt: string;
    let videoContentType: string;
    try {
      try {
        const dl = await fetchRemoteVideoFile(
          videoUrl,
          config.CAF_TOP_PERFORMER_ARCHIVE_SOURCE_VIDEO_TIMEOUT_MS,
          config.CAF_TOP_PERFORMER_ARCHIVE_MAX_BYTES_SOURCE_VIDEO,
          proxyAgent ?? undefined
        );
        videoBuf = dl.buf;
        videoExt = dl.ext;
        videoContentType = dl.contentType;
      } catch (cdnErr) {
        const archivedUrl = await findArchivedSourceVideoUrlForEvidenceRow(
          db,
          args.projectId,
          args.evidenceRowId
        );
        if (!archivedUrl) throw cdnErr;
        const dl = await fetchRemoteVideoFile(
          archivedUrl,
          config.CAF_TOP_PERFORMER_ARCHIVE_SOURCE_VIDEO_TIMEOUT_MS,
          config.CAF_TOP_PERFORMER_ARCHIVE_MAX_BYTES_SOURCE_VIDEO,
          proxyAgent ?? undefined
        );
        videoBuf = dl.buf;
        videoExt = dl.ext;
        videoContentType = dl.contentType;
      }
    } catch (e) {
      await upsertEvidenceMediaAssetArchived(db, {
        projectId: args.projectId,
        evidenceRowId: args.evidenceRowId,
        sourcePlatform: args.sourcePlatform,
        sourcePostUrl: args.postUrl,
        sourcePostId: args.postId,
        sourceOwnerUsername: args.ownerUsername,
        sourceUrl: videoUrl,
        sourceField: "source_video_url",
        assetRole: "source_video",
        mediaType: "video",
        slideIndex: null,
        archiveStatus: "failed",
        errorMessage: e instanceof Error ? e.message : String(e),
      });
      rowsWritten++;
      return emptyResult({
        evidence_media_rows_written: rowsWritten,
        extraction_error: e instanceof Error ? e.message : String(e),
      });
    }

    const slug = slugPathSegment(args.projectSlug);
    const rowSeg = String(args.evidenceRowId).replace(/\D/g, "") || "0";
    const impSeg = args.importId.replace(/-/g, "");
    const storagePrefix = `evidence_media/${slug}/${impSeg}/row_${rowSeg}`;
    const supabase = getSupabaseStorageClient(config);
    const bucket = config.SUPABASE_ASSETS_BUCKET || "assets";

    let sourcePublicUrl: string | null = null;
    let sourceObjectPath: string | null = null;
    if (supabase) {
      try {
        const objectPathRel = `${storagePrefix}/source${videoExt}`;
        const up = await uploadBuffer(config, objectPathRel, videoBuf, videoContentType);
        sourcePublicUrl = up.public_url;
        sourceObjectPath = up.object_path;
        sourceVideoArchived = true;
      } catch (e) {
        await upsertEvidenceMediaAssetArchived(db, {
          projectId: args.projectId,
          evidenceRowId: args.evidenceRowId,
          sourcePlatform: args.sourcePlatform,
          sourcePostUrl: args.postUrl,
          sourcePostId: args.postId,
          sourceOwnerUsername: args.ownerUsername,
          sourceUrl: videoUrl,
          sourceField: "source_video_url",
          assetRole: "source_video",
          mediaType: "video",
          slideIndex: null,
          archiveStatus: "failed",
          errorMessage: e instanceof Error ? e.message : String(e),
        });
        rowsWritten++;
      }
    }

    if (sourceVideoArchived && sourceObjectPath) {
      await upsertEvidenceMediaAssetArchived(db, {
        projectId: args.projectId,
        evidenceRowId: args.evidenceRowId,
        sourcePlatform: args.sourcePlatform,
        sourcePostUrl: args.postUrl,
        sourcePostId: args.postId,
        sourceOwnerUsername: args.ownerUsername,
        sourceUrl: videoUrl,
        sourceField: "source_video_url",
        assetRole: "source_video",
        mediaType: "video",
        slideIndex: null,
        archiveStatus: "archived",
        storageBucket: bucket,
        storagePath: sourceObjectPath,
        publicUrl: sourcePublicUrl,
        metadata: { bytes: videoBuf.length },
      });
      rowsWritten++;
    } else if (!supabase) {
      await upsertEvidenceMediaAssetArchived(db, {
        projectId: args.projectId,
        evidenceRowId: args.evidenceRowId,
        sourcePlatform: args.sourcePlatform,
        sourcePostUrl: args.postUrl,
        sourcePostId: args.postId,
        sourceOwnerUsername: args.ownerUsername,
        sourceUrl: videoUrl,
        sourceField: "source_video_url",
        assetRole: "source_video",
        mediaType: "video",
        slideIndex: null,
        archiveStatus: "pending",
        metadata: { bytes: videoBuf.length, note: "supabase_not_configured" },
      });
      rowsWritten++;
    }

    const timestamps = videoSampleTimestamps(null, maxFrames);
    const frameBuffers: Buffer[] = [];
    await withTempVideoFile(videoBuf, videoExt, async (fp) => {
      const frames = await extractVideoFramesJpeg(config, fp, timestamps);
      frameBuffers.push(...frames);
    });

    let whisperTranscript: string | null = null;
    if (args.openAiApiKey?.trim() && shouldRunWhisper(captionTranscript, config, args.criteria)) {
      try {
        whisperTranscript = await whisperFromVideoBuffer(
          config,
          args.openAiApiKey.trim(),
          videoBuf,
          videoExt,
          args.audit
        );
      } catch {
        /* optional */
      }
    }

    if (frameBuffers.length === 0) {
      return emptyResult({
        evidence_media_rows_written: rowsWritten,
        source_video_archived: sourceVideoArchived,
        extraction_error: "ffmpeg_extracted_zero_frames",
      });
    }

    const visionUrls: string[] = [];
    for (let i = 0; i < frameBuffers.length; i++) {
      const buf = frameBuffers[i]!;
      const ts = timestamps[i] ?? i;
      const dedupeUrl = frameSourceUrlDedupeKey(videoUrl, ts);
      let visionUrl = "";
      let publicUrl: string | null = null;
      let objectPath: string | null = null;

      if (supabase) {
        try {
          const objectPathRel = `${storagePrefix}/frame_${String(i + 1).padStart(2, "0")}.jpg`;
          const up = await uploadBuffer(config, objectPathRel, buf, "image/jpeg");
          objectPath = up.object_path;
          publicUrl = up.public_url;
          visionUrl = await visionUrlForStoredObject(config, up.bucket, up.object_path, up.public_url);
        } catch (e) {
          await upsertEvidenceMediaAssetArchived(db, {
            projectId: args.projectId,
            evidenceRowId: args.evidenceRowId,
            sourcePlatform: args.sourcePlatform,
            sourcePostUrl: args.postUrl,
            sourcePostId: args.postId,
            sourceOwnerUsername: args.ownerUsername,
            sourceUrl: dedupeUrl,
            sourceField: "ffmpeg_extract",
            assetRole: "extracted_frame",
            mediaType: "image",
            slideIndex: i,
            archiveStatus: "failed",
            errorMessage: e instanceof Error ? e.message : String(e),
            metadata: { timestamp_sec: ts },
          });
          rowsWritten++;
          visionUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
        }
      } else {
        visionUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
      }

      if (objectPath) {
        await upsertEvidenceMediaAssetArchived(db, {
          projectId: args.projectId,
          evidenceRowId: args.evidenceRowId,
          sourcePlatform: args.sourcePlatform,
          sourcePostUrl: args.postUrl,
          sourcePostId: args.postId,
          sourceOwnerUsername: args.ownerUsername,
          sourceUrl: dedupeUrl,
          sourceField: "ffmpeg_extract",
          assetRole: "extracted_frame",
          mediaType: "image",
          slideIndex: i,
          archiveStatus: "archived",
          storageBucket: bucket,
          storagePath: objectPath,
          publicUrl,
          metadata: { timestamp_sec: ts, bytes: buf.length },
        });
        rowsWritten++;
      } else if (!supabase) {
        await upsertEvidenceMediaAssetArchived(db, {
          projectId: args.projectId,
          evidenceRowId: args.evidenceRowId,
          sourcePlatform: args.sourcePlatform,
          sourcePostUrl: args.postUrl,
          sourcePostId: args.postId,
          sourceOwnerUsername: args.ownerUsername,
          sourceUrl: dedupeUrl,
          sourceField: "ffmpeg_extract",
          assetRole: "extracted_frame",
          mediaType: "image",
          slideIndex: i,
          archiveStatus: "archived",
          publicUrl: null,
          metadata: { timestamp_sec: ts, bytes: buf.length, vision_data_uri: true },
        });
        rowsWritten++;
      }

      if (visionUrl) visionUrls.push(visionUrl);
    }

    const usedTimestamps = timestamps.slice(0, visionUrls.length);

    if (whisperTranscript && sourceVideoArchived) {
      await upsertEvidenceMediaAssetArchived(db, {
        projectId: args.projectId,
        evidenceRowId: args.evidenceRowId,
        sourcePlatform: args.sourcePlatform,
        sourcePostUrl: args.postUrl,
        sourcePostId: args.postId,
        sourceOwnerUsername: args.ownerUsername,
        sourceUrl: `${videoUrl}#caf_whisper_v1`,
        sourceField: "whisper_transcript",
        assetRole: "transcript",
        mediaType: "text",
        slideIndex: null,
        archiveStatus: "archived",
        metadata: { whisper_transcript: whisperTranscript, model: config.OPENAI_WHISPER_MODEL },
      });
      rowsWritten++;
    }

    return {
      frame_urls: visionUrls.slice(0, maxFrames),
      frame_timestamps_sec: usedTimestamps,
      source: "extracted_from_video",
      evidence_media_rows_written: rowsWritten,
      frames_extracted: frameBuffers.length,
      source_video_archived: sourceVideoArchived,
      caption_transcript: captionTranscript,
      whisper_transcript: whisperTranscript,
    };
  } finally {
    try {
      await proxyAgent?.close();
    } catch {
      /* ignore */
    }
  }
}
