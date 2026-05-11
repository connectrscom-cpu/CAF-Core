import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  insertCreativeSourceAsset,
  insertCreativeVisualAnalysis,
  updateCreativeVisualAnalysis,
  insertCreativeInsight,
} from "../repositories/creative-intelligence.js";
import {
  downloadUrlBytes,
  isImageMime,
  isVideoMime,
  extractVideoFramesJpeg,
  withTempVideoFile,
  uploadCreativeIntelBuffer,
  videoSampleTimestamps,
} from "./creative-intelligence-media.js";
import { runCreativeVisualAnalysis } from "./creative-intelligence-vision.js";

function insightRefFromGroup(sourceGroupId: string): string {
  return `ci_${sourceGroupId.replace(/-/g, "").slice(0, 16)}`;
}

export interface IngestTopPerformerItem {
  source_url?: string;
  external_source_id?: string;
  media_type: string;
  media_urls?: string[];
  thumbnail_url?: string;
  video_url?: string;
  caption?: string;
  metrics?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface IngestTopPerformersBody {
  platform: string;
  items: IngestTopPerformerItem[];
  selection_reason?: string;
}

export interface IngestItemResult {
  source_group_id: string;
  insight_ref: string;
  asset_ids: string[];
  analysis_id: string | null;
  analysis_status: string;
}

export async function ingestTopPerformers(
  db: Pool,
  config: AppConfig,
  projectId: string,
  projectSlug: string,
  body: IngestTopPerformersBody
): Promise<{ ingest_batch_id: string; results: IngestItemResult[] }> {
  const batch = randomUUID();
  const results: IngestItemResult[] = [];
  const timeout = config.STORAGE_HTTP_FETCH_TIMEOUT_MS || 120_000;
  const maxB = config.CREATIVE_INTEL_MAX_DOWNLOAD_BYTES;

  for (const item of body.items) {
    const sourceGroupId = randomUUID();
    const insightRef = insightRefFromGroup(sourceGroupId);
    const assetIds: string[] = [];
    const platform = body.platform?.trim() || "Multi";
    const mt = String(item.media_type || "unknown").toLowerCase();
    const meta = {
      caption: item.caption ?? null,
      selection_reason: body.selection_reason ?? null,
      ...(item.metadata ?? {}),
    };

    const pushImageAsset = async (
      url: string,
      role: string,
      pos: number
    ): Promise<void> => {
      const dl = await downloadUrlBytes(url, maxB, timeout);
      if (!dl || !isImageMime(dl.mime)) {
        const row = await insertCreativeSourceAsset(db, {
          project_id: projectId,
          source_type: "social_reference",
          external_source_id: item.external_source_id ?? null,
          source_url: item.source_url ?? null,
          platform,
          media_type: mt === "carousel" ? "carousel" : "image",
          asset_role: role,
          asset_url: url,
          mime_type: dl?.mime ?? null,
          position_index: pos,
          performance_metrics_json: (item.metrics ?? {}) as Record<string, unknown>,
          source_metadata_json: meta as Record<string, unknown>,
          source_group_id: sourceGroupId,
          ingest_batch_id: batch,
        });
        assetIds.push(row.id);
        return;
      }
      try {
        const ext = dl.mime.includes("png") ? "png" : dl.mime.includes("webp") ? "webp" : "jpg";
        const fn = `${role}-${pos}.${ext}`;
        const up = await uploadCreativeIntelBuffer(config, projectSlug, sourceGroupId, fn, dl.buffer, dl.mime);
        const row = await insertCreativeSourceAsset(db, {
          project_id: projectId,
          source_type: "social_reference",
          external_source_id: item.external_source_id ?? null,
          source_url: item.source_url ?? null,
          platform,
          media_type: mt === "carousel" ? "carousel" : "image",
          asset_role: role,
          asset_url: url,
          storage_bucket: up.bucket,
          storage_key: up.object_path,
          mime_type: dl.mime,
          position_index: pos,
          performance_metrics_json: (item.metrics ?? {}) as Record<string, unknown>,
          source_metadata_json: meta as Record<string, unknown>,
          source_group_id: sourceGroupId,
          ingest_batch_id: batch,
          provenance_json: { public_url: up.public_url },
        });
        assetIds.push(row.id);
      } catch {
        const row = await insertCreativeSourceAsset(db, {
          project_id: projectId,
          source_type: "social_reference",
          external_source_id: item.external_source_id ?? null,
          source_url: item.source_url ?? null,
          platform,
          media_type: mt === "carousel" ? "carousel" : "image",
          asset_role: role,
          asset_url: url,
          mime_type: dl.mime,
          position_index: pos,
          performance_metrics_json: (item.metrics ?? {}) as Record<string, unknown>,
          source_metadata_json: { ...meta, upload_failed: true } as Record<string, unknown>,
          source_group_id: sourceGroupId,
          ingest_batch_id: batch,
        });
        assetIds.push(row.id);
      }
    };

    if (mt === "carousel" && Array.isArray(item.media_urls)) {
      let pos = 0;
      for (const u of item.media_urls) {
        await pushImageAsset(String(u).trim(), "slide", pos++);
      }
    } else if (mt === "video" || mt === "reel") {
      if (item.thumbnail_url?.trim()) {
        await pushImageAsset(item.thumbnail_url.trim(), "thumbnail", 0);
      }
      const vidUrl = item.video_url?.trim() || item.source_url?.trim() || "";
      if (vidUrl.startsWith("https://")) {
        const dl = await downloadUrlBytes(vidUrl, maxB, timeout);
        if (dl && (isVideoMime(dl.mime) || dl.mime === "application/octet-stream")) {
          const row = await insertCreativeSourceAsset(db, {
            project_id: projectId,
            source_type: "social_reference",
            external_source_id: item.external_source_id ?? null,
            source_url: item.source_url ?? vidUrl,
            platform,
            media_type: "video",
            asset_role: "original",
            asset_url: vidUrl,
            mime_type: dl.mime,
            position_index: 0,
            performance_metrics_json: (item.metrics ?? {}) as Record<string, unknown>,
            source_metadata_json: meta as Record<string, unknown>,
            source_group_id: sourceGroupId,
            ingest_batch_id: batch,
          });
          assetIds.push(row.id);
          const ts = videoSampleTimestamps(null, config.CREATIVE_INTEL_VIDEO_MAX_FRAMES);
          try {
            await withTempVideoFile(dl.buffer, ".mp4", async (fp) => {
              const frames = await extractVideoFramesJpeg(config, fp, ts);
              for (let idx = 0; idx < frames.length; idx++) {
                const fr = frames[idx]!;
                const fn = `frame-${idx}.jpg`;
                const up = await uploadCreativeIntelBuffer(
                  config,
                  projectSlug,
                  sourceGroupId,
                  fn,
                  fr,
                  "image/jpeg"
                );
                const frRow = await insertCreativeSourceAsset(db, {
                  project_id: projectId,
                  source_type: "social_reference",
                  external_source_id: item.external_source_id ?? null,
                  source_url: vidUrl,
                  platform,
                  media_type: "video",
                  asset_role: "extracted_frame",
                  asset_url: null,
                  storage_bucket: up.bucket,
                  storage_key: up.object_path,
                  mime_type: "image/jpeg",
                  position_index: idx + 1,
                  performance_metrics_json: {},
                  source_metadata_json: { extracted_at_sec: ts[idx] ?? idx } as Record<string, unknown>,
                  source_group_id: sourceGroupId,
                  ingest_batch_id: batch,
                  provenance_json: { public_url: up.public_url },
                });
                assetIds.push(frRow.id);
              }
            });
          } catch {
            /* ffmpeg missing or failed */
          }
        } else {
          const vrow = await insertCreativeSourceAsset(db, {
            project_id: projectId,
            source_type: "social_reference",
            external_source_id: item.external_source_id ?? null,
            source_url: item.source_url ?? vidUrl,
            platform,
            media_type: "video",
            asset_role: "original",
            asset_url: vidUrl,
            mime_type: dl?.mime ?? null,
            position_index: 0,
            performance_metrics_json: (item.metrics ?? {}) as Record<string, unknown>,
            source_metadata_json: { ...meta, video_download_skipped: true } as Record<string, unknown>,
            source_group_id: sourceGroupId,
            ingest_batch_id: batch,
          });
          assetIds.push(vrow.id);
        }
      }
    } else if (Array.isArray(item.media_urls) && item.media_urls[0]) {
      await pushImageAsset(String(item.media_urls[0]).trim(), "original", 0);
    } else if (item.source_url?.trim()) {
      await pushImageAsset(item.source_url.trim(), "original", 0);
    }

    let analysisId: string | null = null;
    let analysisStatus = "skipped";
    if (config.CREATIVE_INTEL_ANALYZE_INLINE && config.OPENAI_API_KEY?.trim()) {
      const assets = await db.query(
        `SELECT id, asset_url, storage_bucket, storage_key, mime_type, asset_role, provenance_json
         FROM caf_core.creative_source_assets
         WHERE project_id = $1 AND source_group_id = $2::uuid
         ORDER BY position_index ASC, created_at ASC`,
        [projectId, sourceGroupId]
      );
      const imageUrls: string[] = [];
      for (const a of assets.rows as Array<Record<string, unknown>>) {
        const prov = a.provenance_json as Record<string, unknown> | null;
        const pub = prov && typeof prov.public_url === "string" ? prov.public_url.trim() : "";
        const au = typeof a.asset_url === "string" ? a.asset_url.trim() : "";
        const mime = String(a.mime_type ?? "");
        if (mime.startsWith("image/") && (pub || (au.startsWith("https://") && au))) {
          imageUrls.push(pub || au);
        }
      }
      if (imageUrls.length > 0) {
        const ins = await insertCreativeVisualAnalysis(db, {
          project_id: projectId,
          source_group_id: sourceGroupId,
          analysis_model: config.OPENAI_CREATIVE_INTEL_VISION_MODEL,
          media_type: mt,
          analysis_status: "pending",
        });
        analysisId = ins.id;
        try {
          const ctx = `Platform: ${platform}\nMedia type: ${mt}\nCaption: ${item.caption ?? ""}\nMetrics: ${JSON.stringify(item.metrics ?? {}).slice(0, 1500)}`;
          const { parsed, raw, model } = await runCreativeVisualAnalysis({
            db,
            config,
            projectId,
            imageUrls,
            userContext: ctx,
          });
          await updateCreativeVisualAnalysis(db, analysisId, {
            analysis_status: "completed",
            visual_summary: parsed.visual_summary ?? null,
            style_tags_json: parsed.style_tags ?? [],
            layout_json: (parsed.layout ?? null) as Record<string, unknown> | null,
            color_palette_json: (parsed.color_palette ?? null) as Record<string, unknown> | null,
            typography_json: (parsed.typography ?? null) as Record<string, unknown> | null,
            composition_json: (parsed.composition ?? null) as Record<string, unknown> | null,
            motion_json: (parsed.motion ?? null) as Record<string, unknown> | null,
            editing_json: null,
            hook_visual_pattern: null,
            text_overlay_json: (parsed.text_overlay ?? null) as Record<string, unknown> | null,
            design_pattern: parsed.layout?.type ?? null,
            mimicry_notes: parsed.mimicry_notes ?? null,
            generation_guidance: parsed.generation_guidance ?? null,
            confidence: 0.72,
            raw_model_output_json: raw,
          });
          await insertCreativeInsight(db, {
            project_id: projectId,
            insight_ref: insightRef,
            scope_platform: platform,
            scope_media_type: mt,
            scope_content_format: mt,
            insight_type: "visual_style",
            title: `${platform} ${mt} reference`.slice(0, 200),
            summary: parsed.visual_summary ?? null,
            guidance: parsed.generation_guidance ?? parsed.mimicry_notes ?? null,
            evidence_asset_ids_json: assetIds,
            evidence_analysis_ids_json: [analysisId],
            evidence_source_urls_json: [item.source_url, ...(item.media_urls ?? [])].filter(Boolean) as string[],
            support_count: 1,
            confidence: 0.7,
            status: "active",
          });
          analysisStatus = "completed";
        } catch (e) {
          await updateCreativeVisualAnalysis(db, analysisId, {
            analysis_status: "failed",
            error_message: e instanceof Error ? e.message.slice(0, 2000) : "analysis_failed",
          });
          analysisStatus = "failed";
        }
      }
    }

    results.push({
      source_group_id: sourceGroupId,
      insight_ref: insightRef,
      asset_ids: assetIds,
      analysis_id: analysisId,
      analysis_status: analysisStatus,
    });
  }

  return { ingest_batch_id: batch, results };
}
