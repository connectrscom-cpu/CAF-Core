/**
 * Standalone Document AI OCR for existing top_performer_carousel insight rows.
 * Merges OCR into raw_llm_json / aesthetic_analysis_json without re-running Nemotron.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { ensureProject } from "../repositories/core.js";
import {
  listEvidenceRowInsights,
  upsertEvidenceRowInsight,
  type EvidenceRowInsightRow,
} from "../repositories/inputs-evidence-insights.js";
import { getInputsEvidenceImport, listEvidenceRowsByIds } from "../repositories/inputs-evidence.js";
import { buildCarouselAestheticAnalysisJson } from "./carousel-insights-llm-normalize.js";
import {
  TOP_PERFORMER_CAROUSEL_MAX_SLIDES_CAP,
  TOP_PERFORMER_CAROUSEL_MAX_SLIDES_DEFAULT,
} from "./inputs-deep-carousel-insights.js";
import {
  assertDocumentAiConfigured,
  assertDocumentAiRuntimeAuth,
  documentAiAuthModeLabel,
  documentAiEnabled,
  documentAiUsesApplicationDefaultCredentials,
} from "./document-ai-auth.js";
import { processCarouselSlideUrlsWithDocumentAi } from "./document-ai-enterprise-ocr.js";
import { mergeCarouselReferenceAnalysis } from "./carousel-reference-layout-merge.js";
import { parseCarouselSlideUrls } from "./inputs-carousel-evidence-bundle.js";
import { resolveInstagramEmbedHttpProxy } from "./inputs-instagram-embed-carousel-resolver.js";
import {
  assertVisionImageUrlsSafeForRemoteFetch,
  relayImageUrlsForOpenAiVision,
} from "./inputs-top-performer-vision-relay.js";
import { getInputsProcessingProfile } from "../repositories/inputs-processing-profile.js";
import {
  appendProcessingPassProgress,
  beginProcessingPassProgress,
  finishProcessingPassProgress,
} from "./processing-pass-progress.js";
import { logPipelineEvent } from "./pipeline-logger.js";
import { signInspectionMediaForDisplay, type VisualGuidelineInspectionMedia } from "./visual-guidelines-media.js";

const STEP = "inputs_carousel_document_ai_ocr";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function visionUrlsFromStoredInspectionMedia(inspection: unknown): string[] {
  const root = asRecord(inspection);
  const items = Array.isArray(root?.items) ? root.items : [];
  const urls: string[] = [];
  for (const raw of items) {
    const it = asRecord(raw);
    if (!it) continue;
    const url = String(it.vision_fetch_url ?? it.public_url ?? "").trim();
    if (url) urls.push(url);
  }
  return urls;
}

export type CarouselDocumentAiOcrRowResult = {
  source_evidence_row_id: string;
  insights_id: string;
  slide_count: number;
  ocr_slides_ok: number;
  ocr_slides_failed: number;
  merged: boolean;
  errors: string[];
  document_ai_deck_v1: Record<string, unknown> | null;
};

export type RunCarouselDocumentAiOcrResult = {
  import_id: string;
  document_ai_enabled: true;
  document_ai_auth_mode: "application_default" | "service_account";
  insight_rows_considered: number;
  rows_processed: number;
  rows_merged: number;
  rows_skipped_no_urls: number;
  total_ocr_slides_ok: number;
  total_ocr_slides_failed: number;
  merge_into_insights: boolean;
  row_results: CarouselDocumentAiOcrRowResult[];
};

export type RunCarouselDocumentAiOcrOptions = {
  max_rows?: number;
  max_slides?: number;
  merge_into_insights?: boolean;
  progress_id?: string;
  source_evidence_row_ids?: string[];
};

function parsePreLlmScore(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function insightToUpsertInput(
  insight: EvidenceRowInsightRow,
  parsed: Record<string, unknown> | null,
  aesthetic: Record<string, unknown>
) {
  const risks = Array.isArray(insight.risk_flags_json) ? insight.risk_flags_json : [];
  return {
    project_id: insight.project_id,
    inputs_import_id: insight.inputs_import_id,
    source_evidence_row_id: insight.source_evidence_row_id,
    insights_id: insight.insights_id,
    analysis_tier: "top_performer_carousel" as const,
    pre_llm_score: parsePreLlmScore(insight.pre_llm_score),
    llm_model: insight.llm_model,
    why_it_worked: insight.why_it_worked,
    primary_emotion: insight.primary_emotion,
    secondary_emotion: insight.secondary_emotion,
    hook_type: insight.hook_type,
    custom_label_1: insight.custom_label_1,
    custom_label_2: insight.custom_label_2,
    custom_label_3: insight.custom_label_3,
    cta_type: insight.cta_type,
    hashtags: insight.hashtags,
    caption_style: insight.caption_style,
    hook_text: insight.hook_text,
    risk_flags_json: risks,
    aesthetic_analysis_json: aesthetic,
    raw_llm_json: parsed,
    evidence_performance_review_json: asRecord(insight.evidence_performance_review_json),
  };
}

export async function runCarouselDocumentAiOcrForImport(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  importId: string,
  opts: RunCarouselDocumentAiOcrOptions = {}
): Promise<RunCarouselDocumentAiOcrResult> {
  const progressId = opts.progress_id?.trim() || null;
  const mergeIntoInsights = opts.merge_into_insights !== false;
  const maxRows = clamp(opts.max_rows ?? 20, 1, 40);
  const maxSlides = clamp(
    opts.max_slides ?? TOP_PERFORMER_CAROUSEL_MAX_SLIDES_DEFAULT,
    2,
    TOP_PERFORMER_CAROUSEL_MAX_SLIDES_CAP
  );

  const logStep = (message: string, stage?: string) => {
    if (progressId) appendProcessingPassProgress(progressId, message, stage);
    logPipelineEvent("info", "other", message, { data: { import_id: importId, step: STEP, pass_stage: stage } });
  };

  if (progressId) beginProcessingPassProgress(progressId, "carousel_document_ai");
  let progressOk = false;

  try {
    assertDocumentAiConfigured(config);
    if (!documentAiEnabled(config)) {
      throw new Error("Document AI is not enabled (DOCUMENT_AI_ENABLED=1, project + processor required)");
    }
    assertDocumentAiRuntimeAuth(config);

    const project = await ensureProject(db, projectSlug);
    const imp = await getInputsEvidenceImport(db, project.id, importId);
    if (!imp) throw new Error(`Import not found: ${importId}`);

    const profile = await getInputsProcessingProfile(db, project.id);
    const criteria = (profile?.criteria_json ?? {}) as Record<string, unknown>;
    const embedHttpProxyCfg = resolveInstagramEmbedHttpProxy(config, criteria);

    logStep(`Init · Document AI OCR only · auth ${documentAiAuthModeLabel(config)}`, "init");

    let insights = await listEvidenceRowInsights(db, project.id, importId, "top_performer_carousel", 200, 0);
    const filterIds = opts.source_evidence_row_ids?.map((id) => id.trim()).filter(Boolean);
    if (filterIds?.length) {
      const idSet = new Set(filterIds);
      insights = insights.filter((i) => idSet.has(i.source_evidence_row_id));
    }
    insights = insights.slice(0, maxRows);

    if (insights.length === 0) {
      throw new Error(
        "No top_performer_carousel insight rows found for this import. Run the carousel pass first, or pass source_evidence_row_ids."
      );
    }

    const evidenceById = new Map(
      (
        await listEvidenceRowsByIds(
          db,
          project.id,
          importId,
          insights.map((i) => i.source_evidence_row_id)
        )
      ).map((r) => [r.id, r])
    );

    const rowResults: CarouselDocumentAiOcrRowResult[] = [];
    let rowsProcessed = 0;
    let rowsMerged = 0;
    let rowsSkippedNoUrls = 0;
    let totalOcrSlidesOk = 0;
    let totalOcrSlidesFailed = 0;
    const totalRows = insights.length;

    for (let i = 0; i < insights.length; i++) {
      const insight = insights[i]!;
      const rowIndex = i + 1;
      const rowLabel = insight.source_evidence_row_id.slice(0, 8);

      const signedMedia = await signInspectionMediaForDisplay(
        config,
        insight.stored_inspection_media_json as VisualGuidelineInspectionMedia | null
      );
      let visionSlideUrls = visionUrlsFromStoredInspectionMedia(signedMedia ?? insight.stored_inspection_media_json);
      if (visionSlideUrls.length === 0) {
        const ev = evidenceById.get(insight.source_evidence_row_id);
        const payload = (ev?.payload_json ?? {}) as Record<string, unknown>;
        visionSlideUrls = parseCarouselSlideUrls(payload, maxSlides);
      }
      visionSlideUrls = visionSlideUrls.slice(0, maxSlides);

      if (visionSlideUrls.length === 0) {
        rowsSkippedNoUrls++;
        rowResults.push({
          source_evidence_row_id: insight.source_evidence_row_id,
          insights_id: insight.insights_id,
          slide_count: 0,
          ocr_slides_ok: 0,
          ocr_slides_failed: 0,
          merged: false,
          errors: ["no_slide_urls"],
          document_ai_deck_v1: null,
        });
        logStep(`Row ${rowIndex}/${totalRows} · ${rowLabel} · skipped (no slide URLs)`, "row_skip");
        continue;
      }

      logStep(
        `Row ${rowIndex}/${totalRows} · ${rowLabel} · Document AI on ${visionSlideUrls.length} slide(s)…`,
        "document_ai"
      );

      const relay = await relayImageUrlsForOpenAiVision(config, visionSlideUrls, {
        http_proxy_url: embedHttpProxyCfg.url,
      });
      visionSlideUrls = relay.urls;
      assertVisionImageUrlsSafeForRemoteFetch(visionSlideUrls);

      const ocrBatch = await processCarouselSlideUrlsWithDocumentAi(config, visionSlideUrls);
      rowsProcessed++;
      totalOcrSlidesOk += ocrBatch.ocrBySlide.size;
      totalOcrSlidesFailed += ocrBatch.errors.length;

      const deckV1 =
        ocrBatch.ocrBySlide.size > 0
          ? {
              slide_count: ocrBatch.ocrBySlide.size,
              slides: [...ocrBatch.ocrBySlide.values()].map((o) => ({
                slide_index: o.slide_index,
                full_text: o.full_text,
                text_layer_count: o.text_layers.length,
                ocr_confidence_mean: o.ocr_confidence_mean,
              })),
            }
          : null;

      let merged = false;
      if (mergeIntoInsights && ocrBatch.ocrBySlide.size > 0) {
        const existingParsed = asRecord(insight.raw_llm_json) ?? {};
        const mergedParsed =
          mergeCarouselReferenceAnalysis(existingParsed, ocrBatch.ocrBySlide) ?? existingParsed;
        const aesthetic = buildCarouselAestheticAnalysisJson(mergedParsed);
        await upsertEvidenceRowInsight(db, insightToUpsertInput(insight, mergedParsed, aesthetic));
        merged = true;
        rowsMerged++;
        logStep(
          `Row ${rowIndex}/${totalRows} · merged OCR into insight (${ocrBatch.ocrBySlide.size} slide(s))`,
          "row_done"
        );
      } else if (ocrBatch.errors.length > 0) {
        const firstErr = ocrBatch.errors[0] ?? "unknown";
        logStep(
          `Row ${rowIndex}/${totalRows} · OCR failed on all slides (${ocrBatch.errors.length} error(s)) · ${firstErr.slice(0, 200)}`,
          "row_err"
        );
      } else {
        logStep(`Row ${rowIndex}/${totalRows} · OCR complete (${ocrBatch.ocrBySlide.size} slide(s))`, "row_done");
      }

      rowResults.push({
        source_evidence_row_id: insight.source_evidence_row_id,
        insights_id: insight.insights_id,
        slide_count: visionSlideUrls.length,
        ocr_slides_ok: ocrBatch.ocrBySlide.size,
        ocr_slides_failed: ocrBatch.errors.length,
        merged,
        errors: ocrBatch.errors,
        document_ai_deck_v1: deckV1,
      });
    }

    logStep(
      `Done · ${rowsProcessed} row(s) OCR'd · ${rowsMerged} merged · ${rowsSkippedNoUrls} skipped (no URLs)`,
      "done"
    );
    progressOk = true;

    return {
      import_id: importId,
      document_ai_enabled: true,
      document_ai_auth_mode: documentAiUsesApplicationDefaultCredentials(config)
        ? "application_default"
        : "service_account",
      insight_rows_considered: insights.length,
      rows_processed: rowsProcessed,
      rows_merged: rowsMerged,
      rows_skipped_no_urls: rowsSkippedNoUrls,
      total_ocr_slides_ok: totalOcrSlidesOk,
      total_ocr_slides_failed: totalOcrSlidesFailed,
      merge_into_insights: mergeIntoInsights,
      row_results: rowResults,
    };
  } finally {
    if (progressId) finishProcessingPassProgress(progressId, progressOk);
  }
}
