"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { TaskViewer } from "@/components/TaskViewer";
import { DecisionPanel } from "@/components/DecisionPanel";
import { MimicCarouselEdits } from "@/components/MimicCarouselEdits";
import { CarouselEdits, CarouselEditsExport } from "@/components/CarouselEdits";
import { CarouselBrandStylingPanel } from "@/components/CarouselBrandStylingPanel";
import {
  buildCarouselRenderTypographyPatch,
  buildSlidesJson,
  createSyntheticSlides,
  mergeCarouselThemeIntoPayload,
  mergeCarouselTypographyIntoPayload,
  mimicSlideFieldsFromTextBlocks,
  parseSlidesFromJson,
  resolveMimicTextBlocksForSlide,
  enrichMimicSlidesFromVisualGuideline,
  fullBleedSlotTextsFromSlide,
  slideRecordForCopySlots,
  readCarouselTypographyFromFullJob,
  type CarouselSlidesPayload,
} from "@/lib/carousel-slides";
import type { NormalizedSlide } from "@/lib/carousel-slides";
import type { ReviewQueueRow } from "@/lib/types";
import { taskAssetsToPreviewRows, type TaskAssetPreview } from "@/lib/media-url";
import { decodeTaskIdParam } from "@/lib/task-id";
import { useReviewProject } from "@/components/ReviewProjectContext";
import { taskApiQuery } from "@/lib/task-links";
import { parseMimicLayoutQcFromPayload, type MimicLayoutSlideBadge } from "@/lib/mimic-layout-qc";
import { HeyGenReviewEdits } from "@/components/HeyGenReviewEdits";
import { VideoReviewEdits } from "@/components/VideoReviewEdits";
import { VideoBrandStampControls } from "@/components/VideoBrandStampControls";
import { ImageReviewEdits } from "@/components/ImageReviewEdits";
import { isHeyGenReviewFlow } from "@/lib/heygen-review-flow";
import { isCarouselFlow, isImageFlow, isVideoFlow } from "@/lib/flow-kind";
import { InspectValidationJson } from "@/components/InspectValidationJson";
import { MimicCarouselInspectPanel } from "@/components/MimicCarouselInspectPanel";
import { JobInfoBar } from "@/components/JobInfoBar";
import { JobJourneyPanel } from "@/components/JobJourneyPanel";
import { MimicCarouselLayerEditorPanel } from "@/components/MimicCarouselLayerEditorPanel";
import { CopyTaskDebugBundleButton } from "@/components/CopyTaskDebugBundleButton";
import { isMimicCarouselFlow, isTpGroundedCarouselReviewFlow } from "@/lib/flow-kind";
import { displayFlowLabel, displayFlowDetail } from "@/lib/display-flow-label";
import {
  jobRenderFailureBanner,
  resolveTextOverlayReprintUiState,
  textOverlayReprintBannerMessage,
  textOverlayReprintFailureDetails,
} from "@/lib/text-overlay-reprint-status";
import { carouselRegenerateUiState } from "@/lib/carousel-regenerate-status";
import { resolveSlideRenderStatuses } from "@/lib/slide-render-status";
import { RenderFailureBanner } from "@/components/RenderFailureBanner";
import {
  registerReviewBackgroundJob,
  REVIEW_JOB_COMPLETED_EVENT,
} from "@/lib/review-background-jobs";
import { pickRenderableThumb } from "@/lib/marketer/inspection-media";
import { mimicReferenceUrlForSlide } from "@/lib/mimic-reference-slides";
import { sourceSlideIndexForMimicOutput } from "@caf-core-carousel/mimic-output-slide-index";
import {
  applyMimicTemplateBgFieldEdit,
  isMimicTemplateBgMode,
  normalizeMimicTemplateBgSlides,
  resolveMimicTemplateBgEditorFields,
  resolveMimicTemplateBgEditorFieldsForSlide,
} from "@/lib/mimic-template-bg";
import { buildMimicReprintSlideCopyOverrides } from "@/lib/mimic-reprint-slide-copy";
import { resolveBrandLogoDisplayUrl, resolveBrandLogoReprintUrl, resolveBrandSlideFrames, type BrandSlideFrameOption } from "@/lib/brand-asset-url";

function hashtagsInitialFromRow(data: ReviewQueueRow): string {
  const override = (data.final_hashtags_override ?? "").trim();
  if (override) return override;
  const plain = (data.generated_hashtags ?? "").trim();
  if (plain) return plain;
  const json = (data.generated_hashtags_json ?? "").trim();
  if (!json) return "";
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) return parsed.map((x) => String(x)).join(" ");
    if (typeof parsed === "string") return parsed;
  } catch { /* use raw */ }
  return json;
}

interface TaskDetailResponse {
  rowIndex: number;
  data: ReviewQueueRow;
}

interface AssetsResponse {
  assets: { position: number; public_url: string | null; asset_type: string | null }[];
}

export interface TaskReviewClientProps {
  taskIdParam: string;
  projectFromUrl: string;
}

export function TaskReviewClient({ taskIdParam, projectFromUrl }: TaskReviewClientProps) {
  const { navHref } = useReviewProject();
  const router = useRouter();
  const searchParams = useSearchParams();
  const embeddedInAdmin = searchParams.get("embed") === "admin";
  const marketerMode = searchParams.get("marketer") === "1";
  const task_id = useMemo(() => decodeTaskIdParam(taskIdParam), [taskIdParam]);

  const [data, setData] = useState<ReviewQueueRow | null>(null);
  const [taskAssets, setTaskAssets] = useState<TaskAssetPreview[]>([]);
  /** Bumped after asset refetch so carousel/compare images remount and bust browser cache. */
  const [assetRefreshKey, setAssetRefreshKey] = useState(0);
  const [mimicLayoutPreviewRevision, setMimicLayoutPreviewRevision] = useState(0);
  /** Qwen background plates by asset position (for live preview compositing). */
  const [mimicBackgroundByPosition, setMimicBackgroundByPosition] = useState<Record<number, string>>({});
  const [mimicPlateByPosition, setMimicPlateByPosition] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittedHeygenPrompt, setSubmittedHeygenPrompt] = useState<{
    prompt: string | null;
    script_text: string | null;
    post_path: string | null;
    avatar_id: string | null;
    voice_id: string | null;
    video_id: string | null;
    created_at: string;
    ok: boolean;
    error_message: string | null;
  } | null>(null);
  const [upstreamLineage, setUpstreamLineage] = useState<Record<string, unknown> | null>(null);
  const [fullJob, setFullJob] = useState<Record<string, unknown> | null>(null);
  const [projectStrategyHandle, setProjectStrategyHandle] = useState("");

  const execTaskId = (data?.task_id ?? "").trim() || task_id;

  const { slides: initialSlides, raw: rawPayload } = useMemo(
    () =>
      parseSlidesFromJson(
        (data?.final_slides_json_override ?? data?.generated_slides_json)?.trim() || undefined
      ),
    [data?.generated_slides_json, data?.final_slides_json_override]
  );

  const [editedSlides, setEditedSlides] = useState<NormalizedSlide[]>([]);
  const [viewerSlideIndex, setViewerSlideIndex] = useState(1);
  const [activeTextBlockIndex, setActiveTextBlockIndex] = useState<number | null>(null);
  const viewerSlideIndexRef = useRef(1);
  viewerSlideIndexRef.current = viewerSlideIndex;
  const mimicTextBlockUpdaterRef = useRef<((blockIndex: number, text: string) => void) | null>(null);
  const [regenerateSlideBusy, setRegenerateSlideBusy] = useState(false);
  const [mimicRegenNote, setMimicRegenNote] = useState("");
  const [editedCaption, setEditedCaption] = useState("");
  const [editedTitle, setEditedTitle] = useState("");
  const [editedHook, setEditedHook] = useState("");
  const [editedHashtags, setEditedHashtags] = useState("");
  const [editedScript, setEditedScript] = useState("");
  const [heygenAvatarId, setHeygenAvatarId] = useState("");
  const [heygenVoiceId, setHeygenVoiceId] = useState("");
  const [heygenForceRerender, setHeygenForceRerender] = useState(false);
  const [videoPromptAnalysis, setVideoPromptAnalysis] = useState("");
  const [skipVideoRegeneration, setSkipVideoRegeneration] = useState(false);
  const [imagePromptAnalysis, setImagePromptAnalysis] = useState("");
  const [skipImageRegeneration, setSkipImageRegeneration] = useState(false);
  const [fontScale, setFontScale] = useState("1");
  const [carouselHeadlineFontPx, setCarouselHeadlineFontPx] = useState("");
  const [carouselBodyFontPx, setCarouselBodyFontPx] = useState("");
  const [carouselKickerFontPx, setCarouselKickerFontPx] = useState("");
  const [carouselCtaFontPx, setCarouselCtaFontPx] = useState("");
  const [carouselHandleFontPx, setCarouselHandleFontPx] = useState("");
  const [carouselPaperHex, setCarouselPaperHex] = useState("");
  const [carouselInkHex, setCarouselInkHex] = useState("");
  const [carouselLogoEnabled, setCarouselLogoEnabled] = useState(false);
  const [carouselFrameEnabled, setCarouselFrameEnabled] = useState(false);
  const [carouselFrameAssetId, setCarouselFrameAssetId] = useState("");
  const [videoLogoEnabled, setVideoLogoEnabled] = useState(false);
  const [videoFrameEnabled, setVideoFrameEnabled] = useState(false);
  const [videoFrameAssetId, setVideoFrameAssetId] = useState("");
  const [carouselTypoBaseline, setCarouselTypoBaseline] = useState({
    carousel_headline_font_px: "",
    carousel_body_font_px: "",
    carousel_kicker_font_px: "",
    carousel_cta_font_px: "",
    carousel_handle_font_px: "",
  });
  const carouselTypoSeededForTask = useRef<string | null>(null);
  const mimicOcrEnrichedForTask = useRef<string | null>(null);
  const taskLoadedOnceRef = useRef(false);

  useEffect(() => {
    setEditedSlides([]);
    setTaskAssets([]);
    setMimicBackgroundByPosition({});
    setMimicPlateByPosition({});
    setEditedScript("");
    setHeygenAvatarId("");
    setHeygenVoiceId("");
    setHeygenForceRerender(false);
    setVideoPromptAnalysis("");
    setSkipVideoRegeneration(false);
    setImagePromptAnalysis("");
    setSkipImageRegeneration(false);
    setCarouselPaperHex("");
    setCarouselInkHex("");
    setCarouselLogoEnabled(false);
    setCarouselFrameEnabled(false);
    setCarouselFrameAssetId("");
    setVideoLogoEnabled(false);
    setVideoFrameEnabled(false);
    setVideoFrameAssetId("");
    setSubmittedHeygenPrompt(null);
    setUpstreamLineage(null);
    setFullJob(null);
    setProjectStrategyHandle("");
    mimicOcrEnrichedForTask.current = null;
    taskLoadedOnceRef.current = false;
  }, [task_id]);

  useEffect(() => {
    if (initialSlides.length > 0) {
      setEditedSlides((prev) => {
        if (prev.length > 0) return prev;
        if (taskAssets.length > initialSlides.length) {
          const nExtra = taskAssets.length - initialSlides.length;
          const extra: NormalizedSlide[] = Array.from({ length: nExtra }, (_, i) => ({
            index: initialSlides.length + i,
            type: "body",
            headline: "",
            body: "",
            handle: "",
          }));
          return [...initialSlides, ...extra];
        }
        return initialSlides;
      });
      return;
    }
    if (taskAssets.length > 0) {
      setEditedSlides((prev) =>
        prev.length === 0 ? createSyntheticSlides(taskAssets.length) : prev
      );
    }
  }, [initialSlides, taskAssets]);

  useEffect(() => {
    if (!data) return;
    setEditedCaption((data.final_caption_override ?? data.generated_caption ?? "").trim());
    setEditedTitle((data.final_title_override ?? data.generated_title ?? "").trim());
    setEditedHook((data.final_hook_override ?? data.generated_hook ?? "").trim());
    setEditedHashtags(hashtagsInitialFromRow(data));
    setEditedScript((data.final_spoken_script_override ?? data.generated_spoken_script ?? "").trim());
    setHeygenAvatarId((data.heygen_avatar_id ?? "").trim());
    setHeygenVoiceId((data.heygen_voice_id ?? "").trim());
    setHeygenForceRerender(false);
  }, [data]);

  useEffect(() => {
    const raw = rawPayload && typeof rawPayload === "object" ? (rawPayload as Record<string, unknown>).font_scale : undefined;
    const n = Number(raw);
    setFontScale(Number.isFinite(n) && n > 0 ? String(n) : "1");
    const paper =
      rawPayload && typeof rawPayload === "object" && typeof (rawPayload as Record<string, unknown>).carousel_paper === "string"
        ? String((rawPayload as Record<string, unknown>).carousel_paper).trim()
        : "";
    const ink =
      rawPayload && typeof rawPayload === "object" && typeof (rawPayload as Record<string, unknown>).carousel_ink === "string"
        ? String((rawPayload as Record<string, unknown>).carousel_ink).trim()
        : "";
    setCarouselPaperHex(paper);
    setCarouselInkHex(ink);
  }, [rawPayload]);

  useEffect(() => {
    carouselTypoSeededForTask.current = null;
    setCarouselHeadlineFontPx("");
    setCarouselBodyFontPx("");
    setCarouselKickerFontPx("");
    setCarouselCtaFontPx("");
    setCarouselHandleFontPx("");
    setCarouselTypoBaseline({
      carousel_headline_font_px: "",
      carousel_body_font_px: "",
      carousel_kicker_font_px: "",
      carousel_cta_font_px: "",
      carousel_handle_font_px: "",
    });
  }, [task_id]);

  useEffect(() => {
    const jobTask = typeof fullJob?.task_id === "string" ? fullJob.task_id.trim() : "";
    if (!fullJob || jobTask !== task_id || carouselTypoSeededForTask.current === task_id) return;
    const t = readCarouselTypographyFromFullJob(fullJob);
    setCarouselTypoBaseline(t);
    setCarouselHeadlineFontPx(t.carousel_headline_font_px);
    setCarouselBodyFontPx(t.carousel_body_font_px);
    setCarouselKickerFontPx(t.carousel_kicker_font_px);
    setCarouselCtaFontPx(t.carousel_cta_font_px);
    setCarouselHandleFontPx(t.carousel_handle_font_px);
    carouselTypoSeededForTask.current = task_id;
  }, [fullJob, task_id]);

  const fetchTask = useCallback(async (opts?: { quiet?: boolean; bustAssets?: boolean }) => {
    if (!task_id) return;
    const quiet = opts?.quiet === true;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const qs = taskApiQuery(task_id, projectFromUrl);
      const [taskRes, assetsRes] = await Promise.all([
        fetch(`/api/task?${qs}`),
        fetch(`/api/task/assets?${qs}`),
      ]);
      if (taskRes.status === 404) {
        setError("Job not found");
        setData(null);
        setTaskAssets([]);
        return;
      }
      if (!taskRes.ok) throw new Error(await taskRes.text());
      const taskJson: TaskDetailResponse = await taskRes.json();
      setData(taskJson.data);
      // Fetch full Core job detail for JSON inspection (includes reviews + validation_output_json).
      fetch(`/api/task/${encodeURIComponent(task_id)}?${qs}&include_job=1`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          const job = j && typeof j === "object" ? (j as any).job : null;
          setFullJob(job && typeof job === "object" ? (job as Record<string, unknown>) : null);
        })
        .catch(() => setFullJob(null));
      if (assetsRes.ok) {
        const assetsJson: AssetsResponse = await assetsRes.json();
        const rows = [...(assetsJson.assets ?? [])].sort((a, b) => a.position - b.position);
        const flowHint = (taskJson.data?.flow_type ?? "").trim();
        const mimicBg: Record<number, string> = {};
        const mimicPlates: Record<number, string> = {};
        for (const a of rows) {
          const assetType = (a.asset_type ?? "").toLowerCase();
          const u = (a.public_url ?? "").trim();
          if (!u) continue;
          if (assetType === "mimic_background") mimicBg[a.position] = u;
          if (assetType === "mimic_visual_plate") mimicPlates[a.position] = u;
        }
        setMimicBackgroundByPosition(mimicBg);
        setMimicPlateByPosition(mimicPlates);
        setTaskAssets(
          taskAssetsToPreviewRows(rows, {
            flowTypeHint: flowHint,
            ...(opts?.bustAssets ? { cacheBust: Date.now() } : {}),
          })
        );
      } else {
        setMimicBackgroundByPosition({});
        setMimicPlateByPosition({});
        setTaskAssets([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load task");
      setData(null);
      setTaskAssets([]);
    } finally {
      if (!quiet) setLoading(false);
      taskLoadedOnceRef.current = true;
    }
  }, [task_id, projectFromUrl]);

  const refreshTaskAssets = useCallback(async () => {
    await fetchTask({ quiet: true, bustAssets: true });
    setAssetRefreshKey((k) => k + 1);
  }, [fetchTask]);

  useEffect(() => { fetchTask(); }, [fetchTask]);

  const textOverlayReprint = useMemo(
    () => resolveTextOverlayReprintUiState(fullJob?.render_state, data),
    [fullJob, data]
  );

  const textOverlayReprintBanner = useMemo(
    () => textOverlayReprintBannerMessage(textOverlayReprint),
    [textOverlayReprint]
  );

  const textOverlayReprintFailure = useMemo(
    () => textOverlayReprintFailureDetails(textOverlayReprint),
    [textOverlayReprint]
  );

  const carouselRegenerate = useMemo(
    () => carouselRegenerateUiState(fullJob?.render_state),
    [fullJob?.render_state]
  );

  const jobFailureBanner = useMemo(() => {
    if (textOverlayReprintFailure || textOverlayReprintBanner) return null;
    return jobRenderFailureBanner(
      data?.review_status,
      fullJob?.render_state ?? null
    );
  }, [textOverlayReprintFailure, textOverlayReprintBanner, data?.review_status, fullJob?.render_state]);

  const prevTextReprintActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = prevTextReprintActiveRef.current;
    prevTextReprintActiveRef.current = textOverlayReprint.active;
    if (wasActive && !textOverlayReprint.active) {
      void refreshTaskAssets();
    }
  }, [textOverlayReprint.active, refreshTaskAssets]);

  useEffect(() => {
    if (!textOverlayReprint.active) return;
    const id = window.setInterval(() => {
      void fetchTask({ quiet: true, bustAssets: true });
    }, 15_000);
    return () => window.clearInterval(id);
  }, [textOverlayReprint.active, fetchTask]);

  const prevCarouselRegenActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = prevCarouselRegenActiveRef.current;
    prevCarouselRegenActiveRef.current = carouselRegenerate.active;
    if (wasActive && !carouselRegenerate.active && !carouselRegenerate.failed) {
      void refreshTaskAssets();
    }
  }, [carouselRegenerate.active, carouselRegenerate.failed, refreshTaskAssets]);

  useEffect(() => {
    if (!carouselRegenerate.active) return;
    const id = window.setInterval(() => {
      void fetchTask({ quiet: true, bustAssets: true });
    }, 15_000);
    return () => window.clearInterval(id);
  }, [carouselRegenerate.active, fetchTask]);

  useEffect(() => {
    const onJobCompleted = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId?: string; project?: string }>).detail;
      const project = (data?.project ?? projectFromUrl).trim();
      if (!detail?.taskId || detail.taskId !== execTaskId.trim()) return;
      if (detail.project && project && detail.project !== project) return;
      void refreshTaskAssets();
    };
    window.addEventListener(REVIEW_JOB_COMPLETED_EVENT, onJobCompleted);
    return () => window.removeEventListener(REVIEW_JOB_COMPLETED_EVENT, onJobCompleted);
  }, [data?.project, projectFromUrl, execTaskId, refreshTaskAssets]);

  /**
   * Fetch the exact prompt/script_text HeyGen received for this task (from api_call_audit).
   * We only fetch after `data` loads so we know the flow is actually video (avoids pointless
   * calls for carousels). Silent on error — the panel falls back to the LLM-side prompt.
   */
  useEffect(() => {
    if (!data) return;
    const flowType = (data.flow_type ?? "").trim();
    if (!flowType) return;
    if (!isVideoFlow(flowType) && !isHeyGenReviewFlow(flowType)) return;
    let cancelled = false;
    const run = async () => {
      try {
        const qs = taskApiQuery(task_id, projectFromUrl);
        const res = await fetch(`/api/task/heygen-prompt?${qs}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { submit?: typeof submittedHeygenPrompt };
        if (cancelled) return;
        setSubmittedHeygenPrompt(json.submit ?? null);
      } catch {
        /* non-fatal: panel falls back to LLM-side videoPrompt */
      }
    };
    run();
    return () => { cancelled = true; };
  }, [data, task_id, projectFromUrl]);

  /**
   * Fetch upstream lineage (run → signal pack → idea → grounding insights/evidence).
   * Silent on error — the panel stays empty if the task was ingested without idea links.
   */
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    const run = async () => {
      try {
        const qs = taskApiQuery(task_id, projectFromUrl);
        const res = await fetch(`/api/task/lineage?${qs}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { lineage?: Record<string, unknown> };
        if (cancelled) return;
        setUpstreamLineage(json.lineage ?? null);
      } catch {
        /* non-fatal */
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [data, task_id, projectFromUrl]);

  useEffect(() => {
    const slug = (data?.project ?? projectFromUrl ?? "").trim();
    if (!slug) {
      setProjectStrategyHandle("");
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`/api/project-config/strategy?project=${encodeURIComponent(slug)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { strategy?: Record<string, unknown> | null };
        const h = json.strategy?.instagram_handle;
        if (cancelled) return;
        setProjectStrategyHandle(typeof h === "string" ? h.trim() : "");
      } catch {
        if (!cancelled) setProjectStrategyHandle("");
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [data?.project, projectFromUrl]);

  // Brand palette swatches + logo for the mimic text editor (1.5).
  const [brandPalette, setBrandPalette] = useState<string[]>([]);
  const [brandLogoUrl, setBrandLogoUrl] = useState<string>("");
  const [brandLogoReprintUrl, setBrandLogoReprintUrl] = useState<string>("");
  const [brandFrames, setBrandFrames] = useState<BrandSlideFrameOption[]>([]);
  useEffect(() => {
    const slug = (data?.project ?? projectFromUrl ?? "").trim();
    if (!slug) {
      setBrandPalette([]);
      setBrandLogoUrl("");
      setBrandLogoReprintUrl("");
      setBrandFrames([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/project-config/brand-assets?project=${encodeURIComponent(slug)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          brand_assets?: Array<{ kind?: string; public_url?: string | null; metadata_json?: Record<string, unknown> }>;
        };
        if (cancelled) return;
        const assets = Array.isArray(json.brand_assets) ? json.brand_assets : [];
        const colors: string[] = [];
        for (const a of assets) {
          if (a.kind !== "palette") continue;
          const raw = a.metadata_json?.colors;
          if (Array.isArray(raw)) {
            for (const c of raw) {
              const hex = typeof c === "string" ? c.trim() : "";
              if (/^#[0-9a-fA-F]{3,8}$/.test(hex) && !colors.includes(hex)) colors.push(hex);
            }
          }
        }
        setBrandPalette(colors.slice(0, 12));
        setBrandLogoUrl(resolveBrandLogoDisplayUrl(slug, assets));
        setBrandLogoReprintUrl(resolveBrandLogoReprintUrl(slug, assets));

        const bibleRes = await fetch(`/api/brand/${encodeURIComponent(slug)}/brand-bible`, { cache: "no-store" });
        if (!bibleRes.ok) {
          setBrandFrames([]);
          return;
        }
        const bibleJson = (await bibleRes.json()) as {
          snapshot?: { resolved_assets?: Array<{ asset_id?: string; role?: string; label?: string | null; public_url?: string | null }> };
        };
        if (cancelled) return;
        const resolved = Array.isArray(bibleJson.snapshot?.resolved_assets) ? bibleJson.snapshot!.resolved_assets! : [];
        setBrandFrames(resolveBrandSlideFrames(slug, resolved));
      } catch {
        if (!cancelled) {
          setBrandPalette([]);
          setBrandLogoUrl("");
          setBrandLogoReprintUrl("");
          setBrandFrames([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.project, projectFromUrl]);

  useEffect(() => {
    if (!execTaskId || typeof window === "undefined") return;
    const key = `caf-carousel-logo-stamp:${execTaskId}`;
    const stored = sessionStorage.getItem(key);
    if (stored === "0") setCarouselLogoEnabled(false);
    else if (stored === "1") setCarouselLogoEnabled(true);
    else setCarouselLogoEnabled(Boolean(brandLogoReprintUrl.trim()));
  }, [execTaskId, brandLogoReprintUrl]);

  useEffect(() => {
    if (!execTaskId || typeof window === "undefined") return;
    sessionStorage.setItem(`caf-carousel-logo-stamp:${execTaskId}`, carouselLogoEnabled ? "1" : "0");
  }, [carouselLogoEnabled, execTaskId]);

  useEffect(() => {
    if (brandFrames.length === 0) {
      setCarouselFrameAssetId("");
      return;
    }
    setCarouselFrameAssetId((prev) => {
      if (prev && brandFrames.some((f) => f.assetId === prev)) return prev;
      return brandFrames[0]!.assetId;
    });
  }, [brandFrames]);

  useEffect(() => {
    if (!execTaskId || typeof window === "undefined") return;
    const key = `caf-video-logo-stamp:${execTaskId}`;
    const stored = sessionStorage.getItem(key);
    if (stored === "0") setVideoLogoEnabled(false);
    else if (stored === "1") setVideoLogoEnabled(true);
    else setVideoLogoEnabled(Boolean(brandLogoReprintUrl.trim()));
  }, [execTaskId, brandLogoReprintUrl]);

  useEffect(() => {
    if (!execTaskId || typeof window === "undefined") return;
    sessionStorage.setItem(`caf-video-logo-stamp:${execTaskId}`, videoLogoEnabled ? "1" : "0");
  }, [videoLogoEnabled, execTaskId]);

  useEffect(() => {
    if (brandFrames.length === 0) {
      setVideoFrameAssetId("");
      return;
    }
    setVideoFrameAssetId((prev) => {
      if (prev && brandFrames.some((f) => f.assetId === prev)) return prev;
      return brandFrames[0]!.assetId;
    });
  }, [brandFrames]);

  const decision = useMemo(() => (data?.decision ?? "").trim(), [data?.decision]);
  const notes = useMemo(() => (data?.notes ?? "").trim(), [data?.notes]);
  const runId = (data?.run_id ?? "").trim();

  const heygenWorkbench = useMemo(() => isHeyGenReviewFlow(data?.flow_type), [data?.flow_type]);
  const flowTypeStr = (data?.flow_type ?? "").trim();
  const imageFlow = useMemo(() => (flowTypeStr ? isImageFlow(flowTypeStr) : false), [flowTypeStr]);
  // Image flows are classified first so a FLOW_IMG_* never accidentally falls into the video branch.
  const videoFlow = useMemo(
    () => (flowTypeStr && !imageFlow ? isVideoFlow(flowTypeStr) : false),
    [flowTypeStr, imageFlow]
  );
  const mimicCarouselFlow = useMemo(
    () => (flowTypeStr ? isMimicCarouselFlow(flowTypeStr) : false),
    [flowTypeStr]
  );
  const tpGroundedCarouselReview = useMemo(() => {
    if (!flowTypeStr) return false;
    const gp = fullJob?.generation_payload as Record<string, unknown> | undefined;
    return isTpGroundedCarouselReviewFlow(flowTypeStr, gp);
  }, [flowTypeStr, fullJob?.generation_payload]);

  const slideRenderStatuses = useMemo(() => {
    if (!tpGroundedCarouselReview && !isCarouselFlow(flowTypeStr)) return [];
    const slideCount = Math.max(editedSlides.length, taskAssets.length, 1);
    const rs = fullJob?.render_state as Record<string, unknown> | null | undefined;
    const renderError = typeof rs?.error === "string" ? rs.error : null;
    return resolveSlideRenderStatuses({
      slideCount,
      taskAssets,
      textOverlayReprint,
      carouselRegenerate,
      renderError,
    });
  }, [
    tpGroundedCarouselReview,
    flowTypeStr,
    editedSlides.length,
    taskAssets,
    textOverlayReprint,
    carouselRegenerate,
    fullJob?.render_state,
  ]);

  const mimicTemplateBg = useMemo(() => {
    const gp = fullJob?.generation_payload as Record<string, unknown> | undefined;
    const mimicV1 =
      gp?.mimic_v1 && typeof gp.mimic_v1 === "object" && !Array.isArray(gp.mimic_v1)
        ? (gp.mimic_v1 as Record<string, unknown>)
        : null;
    return isMimicTemplateBgMode(mimicV1);
  }, [fullJob]);

  const layoutSlideBadges = useMemo((): Record<number, MimicLayoutSlideBadge[]> => {
    const gp = fullJob?.generation_payload;
    const qc = parseMimicLayoutQcFromPayload(gp);
    if (!qc) return {};
    const out: Record<number, MimicLayoutSlideBadge[]> = {};
    for (const slide of qc.slides) {
      out[slide.slide_index - 1] = slide.badges;
    }
    return out;
  }, [fullJob]);

  const layoutQcAttentionBanner = useMemo(() => {
    const qc = parseMimicLayoutQcFromPayload(fullJob?.generation_payload);
    if (!qc?.review_attention) return null;
    const flagged = qc.slides.filter((s) => !s.badges.includes("pass"));
    if (flagged.length === 0) return null;
    return `Layout check flagged ${flagged.length} slide${flagged.length === 1 ? "" : "s"} — see thumb badges and open the layout editor before approving.`;
  }, [fullJob]);

  const fullBleedSlotTexts = useMemo(() => {
    if (mimicTemplateBg || editedSlides.length < 1) return [];
    const slide = editedSlides[Math.max(0, viewerSlideIndex - 1)];
    if (!slide) return [];
    const gp = fullJob?.generation_payload as Record<string, unknown> | undefined;
    const mimicV1 =
      gp?.mimic_v1 && typeof gp.mimic_v1 === "object" && !Array.isArray(gp.mimic_v1)
        ? (gp.mimic_v1 as Record<string, unknown>)
        : null;
    const vg =
      mimicV1?.visual_guideline && typeof mimicV1.visual_guideline === "object"
        ? (mimicV1.visual_guideline as Record<string, unknown>)
        : null;
    const grounding =
      gp?.mimic_job_grounding && typeof gp.mimic_job_grounding === "object"
        ? (gp.mimic_job_grounding as Record<string, unknown>)
        : null;
    const slideCopyLayout = Array.isArray(grounding?.slide_copy_layout)
      ? (grounding.slide_copy_layout as Record<string, unknown>[])
      : null;
    const rec = slideRecordForCopySlots(vg, slideCopyLayout, viewerSlideIndex);
    const fromSlots = fullBleedSlotTextsFromSlide(slide, rec);
    if (fromSlots.some((t) => t.trim())) return fromSlots;
    return resolveMimicTextBlocksForSlide(slide)
      .filter((b) => b.role !== "handle" && !/^@[\w.]{2,}$/i.test(b.text.trim()))
      .map((b) => b.text.trim());
  }, [mimicTemplateBg, editedSlides, viewerSlideIndex, fullJob]);

  useEffect(() => {
    if (!tpGroundedCarouselReview || !fullJob || editedSlides.length === 0) return;
    if (mimicTemplateBg) {
      if (mimicOcrEnrichedForTask.current === execTaskId) return;
      mimicOcrEnrichedForTask.current = execTaskId;
      setEditedSlides((prev) => normalizeMimicTemplateBgSlides(prev));
      return;
    }
    if (mimicOcrEnrichedForTask.current === execTaskId) return;
    const gp = fullJob.generation_payload as Record<string, unknown> | undefined;
    const mimicV1 =
      gp?.mimic_v1 && typeof gp.mimic_v1 === "object" && !Array.isArray(gp.mimic_v1)
        ? (gp.mimic_v1 as Record<string, unknown>)
        : null;
    const vg =
      mimicV1?.visual_guideline && typeof mimicV1.visual_guideline === "object"
        ? (mimicV1.visual_guideline as Record<string, unknown>)
        : null;
    const grounding =
      gp?.mimic_job_grounding && typeof gp.mimic_job_grounding === "object" && !Array.isArray(gp.mimic_job_grounding)
        ? (gp.mimic_job_grounding as Record<string, unknown>)
        : null;
    const slideCopyLayout = Array.isArray(grounding?.slide_copy_layout)
      ? (grounding.slide_copy_layout as Record<string, unknown>[])
      : null;
    if (!vg && !slideCopyLayout?.length) return;
    mimicOcrEnrichedForTask.current = execTaskId;
    setEditedSlides((prev) => {
      if (prev.length === 0) return prev;
      return enrichMimicSlidesFromVisualGuideline(prev, vg, slideCopyLayout);
    });
  }, [tpGroundedCarouselReview, mimicTemplateBg, fullJob, editedSlides.length, execTaskId]);

  const carouselFlow = useMemo(
    () => (flowTypeStr ? isCarouselFlow(flowTypeStr) : false),
    [flowTypeStr]
  );

  const carouselSlideCount = useMemo(() => {
    const fromCopy = Math.max(editedSlides.length, initialSlides.length);
    const fromAssets = taskAssets.length;
    const gp = fullJob?.generation_payload;
    const manifest =
      gp && typeof gp === "object" && !Array.isArray(gp)
        ? (gp as Record<string, unknown>).render_manifest
        : null;
    const manifestCount =
      manifest && typeof manifest === "object" && !Array.isArray(manifest)
        ? Number((manifest as Record<string, unknown>).slide_count)
        : 0;
    const fromManifestSlides = Array.isArray((manifest as Record<string, unknown> | null)?.slides)
      ? ((manifest as Record<string, unknown>).slides as unknown[]).length
      : 0;
    return Math.max(fromCopy, fromAssets, manifestCount, fromManifestSlides, 0);
  }, [editedSlides.length, initialSlides.length, taskAssets.length, fullJob]);

  const existingSlideReworkIndices = useMemo(() => {
    const raw = (data?.slide_rework_indices ?? "").trim();
    if (!raw) return undefined;
    const parsed = raw
      .split(/[,\s]+/)
      .map((s) => Math.floor(Number(s)))
      .filter((n) => Number.isFinite(n) && n >= 1);
    return parsed.length > 0 ? parsed : undefined;
  }, [data?.slide_rework_indices]);
  const mediaPrompt = (data?.generated_video_prompt ?? "").trim();
  const videoPromptLabel = heygenWorkbench ? "HeyGen" : "Video";
  const imagePromptLabel = "Image";

  const { hasEdits, editsSummary } = useMemo(() => {
    const summary: string[] = [];
    if (!data) return { hasEdits: false, editsSummary: [] };
    const initialTitle = (data.final_title_override ?? data.generated_title ?? "").trim();
    const initialHook = (data.final_hook_override ?? data.generated_hook ?? "").trim();
    const initialCaption = (data.final_caption_override ?? data.generated_caption ?? "").trim();
    const initialHashtags = hashtagsInitialFromRow(data);
    if (editedTitle !== initialTitle) summary.push("Title");
    if (editedHook !== initialHook) summary.push("Hook");
    if (editedCaption !== initialCaption) summary.push("Caption");
    if (editedHashtags !== initialHashtags) summary.push("Hashtags");
    const hadParsedSlides = initialSlides.length > 0;
    if (hadParsedSlides && !videoFlow && !imageFlow) {
      if (editedSlides.length !== initialSlides.length) {
        summary.push("Slides (count)");
      } else {
        for (let i = 0; i < editedSlides.length; i++) {
          const a = editedSlides[i];
          const b = initialSlides[i];
          if (!b || a.headline !== b.headline || a.body !== b.body) summary.push(`Slide ${i + 1}`);
        }
      }
    }
    if (heygenWorkbench) {
      const initialScript = (data.final_spoken_script_override ?? data.generated_spoken_script ?? "").trim();
      if (editedScript.trim() !== initialScript) summary.push("Spoken script");
      const initialAv = (data.heygen_avatar_id ?? "").trim();
      const initialVo = (data.heygen_voice_id ?? "").trim();
      if (heygenAvatarId.trim() !== initialAv) summary.push("HeyGen avatar id");
      if (heygenVoiceId.trim() !== initialVo) summary.push("HeyGen voice id");
      if (heygenForceRerender) summary.push("Force HeyGen re-render");
    }
    if (videoFlow && skipVideoRegeneration) summary.push("Keep existing video (captions-only rework)");
    if (imageFlow && skipImageRegeneration) summary.push("Keep existing image (captions-only rework)");
    if (
      !videoFlow &&
      !imageFlow &&
      (carouselHeadlineFontPx.trim() !== carouselTypoBaseline.carousel_headline_font_px.trim() ||
        carouselBodyFontPx.trim() !== carouselTypoBaseline.carousel_body_font_px.trim() ||
        carouselKickerFontPx.trim() !== carouselTypoBaseline.carousel_kicker_font_px.trim() ||
        carouselCtaFontPx.trim() !== carouselTypoBaseline.carousel_cta_font_px.trim() ||
        carouselHandleFontPx.trim() !== carouselTypoBaseline.carousel_handle_font_px.trim())
    ) {
      summary.push("Carousel typography");
    }
    return { hasEdits: summary.length > 0, editsSummary: summary };
  }, [
    data,
    editedTitle,
    editedHook,
    editedCaption,
    editedHashtags,
    editedSlides,
    initialSlides,
    heygenWorkbench,
    editedScript,
    heygenAvatarId,
    heygenVoiceId,
    heygenForceRerender,
    videoFlow,
    imageFlow,
    skipVideoRegeneration,
    skipImageRegeneration,
    carouselHeadlineFontPx,
    carouselBodyFontPx,
    carouselKickerFontPx,
    carouselCtaFontPx,
    carouselHandleFontPx,
    carouselTypoBaseline,
  ]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        if (!hasEdits) {
          const btn = document.querySelector('[data-decision="APPROVED"]') as HTMLButtonElement;
          btn?.click();
        }
      }
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        (document.querySelector('[data-decision="NEEDS_EDIT"]') as HTMLButtonElement)?.click();
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        (document.querySelector('[data-decision="REJECTED"]') as HTMLButtonElement)?.click();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [hasEdits]);

  const carouselTemplate = useMemo(() => {
    const gp = fullJob?.generation_payload as Record<string, unknown> | undefined;
    if (!gp) return "";
    const gen = (gp.generated_output as Record<string, unknown>) ?? {};
    const render = (gen.render as Record<string, unknown>) ?? {};
    return String(render.html_template_name ?? render.template_key ?? gp.template ?? "")
      .replace(/\.hbs$/i, "")
      .trim();
  }, [fullJob]);

  const instagramHandleForPreview = useMemo(() => {
    const gp = fullJob?.generation_payload as Record<string, unknown> | undefined;
    if (gp) {
      const direct = gp.instagram_handle;
      if (typeof direct === "string" && direct.trim()) return direct.trim();
      const strat = gp.strategy;
      if (strat && typeof strat === "object" && !Array.isArray(strat)) {
        const nested = (strat as Record<string, unknown>).instagram_handle;
        if (typeof nested === "string" && nested.trim()) return nested.trim();
      }
    }
    return projectStrategyHandle;
  }, [fullJob, projectStrategyHandle]);

  const templateBgFieldRoles = useMemo(() => {
    if (!mimicTemplateBg || editedSlides.length < 1) return [];
    const slide = editedSlides[Math.max(0, viewerSlideIndex - 1)];
    if (!slide) return [];
    return resolveMimicTemplateBgEditorFieldsForSlide(
      slide,
      viewerSlideIndex,
      editedSlides.length,
      instagramHandleForPreview
    ).map((f) => f.role);
  }, [mimicTemplateBg, editedSlides, viewerSlideIndex, instagramHandleForPreview]);

  const templateBgFieldTexts = useMemo(() => {
    if (!mimicTemplateBg || editedSlides.length < 1) return [];
    const slide = editedSlides[Math.max(0, viewerSlideIndex - 1)];
    if (!slide) return [];
    return resolveMimicTemplateBgEditorFieldsForSlide(
      slide,
      viewerSlideIndex,
      editedSlides.length,
      instagramHandleForPreview
    ).map((f) => f.text);
  }, [mimicTemplateBg, editedSlides, viewerSlideIndex, instagramHandleForPreview]);

  const mimicReferenceUrlForViewer = useMemo(() => {
    if ((!mimicCarouselFlow && !tpGroundedCarouselReview) || !fullJob) return undefined;
    const gp = fullJob.generation_payload as Record<string, unknown> | undefined;
    const mimicV1 =
      gp?.mimic_v1 && typeof gp.mimic_v1 === "object" && !Array.isArray(gp.mimic_v1)
        ? (gp.mimic_v1 as Record<string, unknown>)
        : null;
    const tpRef = fullJob.top_performer_reference as
      | { reference_frame_urls?: string[] }
      | null
      | undefined;
    const referenceFrameUrls = Array.isArray(tpRef?.reference_frame_urls)
      ? tpRef!.reference_frame_urls
      : [];
    const fromMimic = mimicReferenceUrlForSlide(mimicV1, viewerSlideIndex, editedSlides.length, {
      referenceFrameUrls,
    });
    let fromFrames: string | undefined;
    if (referenceFrameUrls.length > 0 && mimicV1) {
      const sourceIdx = sourceSlideIndexForMimicOutput(
        mimicV1 as Parameters<typeof sourceSlideIndexForMimicOutput>[0],
        viewerSlideIndex
      );
      const frameIdx = Math.max(0, sourceIdx - 1);
      fromFrames =
        pickRenderableThumb(
          referenceFrameUrls[frameIdx],
          referenceFrameUrls[Math.min(frameIdx, referenceFrameUrls.length - 1)]
        ) ?? undefined;
    }
    return pickRenderableThumb(fromMimic, fromFrames) ?? undefined;
  }, [mimicCarouselFlow, tpGroundedCarouselReview, fullJob, viewerSlideIndex, editedSlides.length]);

  const referenceVideoUrl = useMemo(() => {
    if (!videoFlow || !fullJob) return undefined;
    const tpRef = fullJob.top_performer_reference as { source_video_url?: string | null } | null | undefined;
    const url = String(tpRef?.source_video_url ?? "").trim();
    return url || undefined;
  }, [videoFlow, fullJob]);

  useEffect(() => {
    setActiveTextBlockIndex(null);
  }, [viewerSlideIndex]);

  const handleDeleteMimicSlide = useCallback((slideIndex1Based: number) => {
    const idx = slideIndex1Based - 1;
    setEditedSlides((prev) => {
      if (prev.length <= 1 || idx < 0 || idx >= prev.length) return prev;
      const next = prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, index: i }));
      setViewerSlideIndex((cur) => {
        if (cur > slideIndex1Based) return cur - 1;
        return Math.min(cur, next.length);
      });
      return next;
    });
  }, []);

  const handleRegenerateMimicSlide = useCallback(
    async (slideIndex1Based: number) => {
      const project = (data?.project ?? projectFromUrl).trim();
      if (!execTaskId.trim() || !project) return;
      setRegenerateSlideBusy(true);
      try {
        const res = await fetch("/api/task/regenerate-carousel-slides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_id: execTaskId,
            project,
            slide_indices: [slideIndex1Based],
            ...(mimicRegenNote.trim() ? { regeneration_note: mimicRegenNote.trim().slice(0, 400) } : {}),
          }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string; message?: string };
        if ((!res.ok && res.status !== 202) || !json.ok) {
          throw new Error(json.error ?? json.message ?? `Regenerate failed (${res.status})`);
        }
        void registerReviewBackgroundJob({
          kind: "image_regenerate",
          taskId: execTaskId,
          project,
          slideIndices: [slideIndex1Based],
          startedMessage: "Image regenerate queued — you can leave this page.",
        });
        void refreshTaskAssets();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Regenerate failed");
      } finally {
        setRegenerateSlideBusy(false);
      }
    },
    [data?.project, projectFromUrl, execTaskId, refreshTaskAssets, mimicRegenNote]
  );

  const handleRegenerateAllMimicSlides = useCallback(async () => {
    const project = (data?.project ?? projectFromUrl).trim();
    if (!execTaskId.trim() || !project || editedSlides.length < 1) return;
    const slideIndices = Array.from({ length: editedSlides.length }, (_, i) => i + 1);
    setRegenerateSlideBusy(true);
    try {
      const res = await fetch("/api/task/regenerate-carousel-slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: execTaskId,
          project,
          slide_indices: slideIndices,
          ...(mimicRegenNote.trim() ? { regeneration_note: mimicRegenNote.trim().slice(0, 400) } : {}),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if ((!res.ok && res.status !== 202) || !json.ok) {
        throw new Error(json.error ?? json.message ?? `Regenerate failed (${res.status})`);
      }
      void registerReviewBackgroundJob({
        kind: "image_regenerate",
        taskId: execTaskId,
        project,
        slideIndices,
        startedMessage: "Image regenerate queued — you can leave this page.",
      });
      void refreshTaskAssets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regenerate failed");
    } finally {
      setRegenerateSlideBusy(false);
    }
  }, [data?.project, projectFromUrl, execTaskId, editedSlides.length, refreshTaskAssets, mimicRegenNote]);

  const decorateCarouselSlidesPayload = useCallback(
    (slidesPayload: CarouselSlidesPayload) => {
      const fs = Number(fontScale);
      if (Number.isFinite(fs) && fs > 0) slidesPayload.font_scale = fs;
      else delete slidesPayload.font_scale;
      mergeCarouselTypographyIntoPayload(slidesPayload, {
        carousel_headline_font_px: carouselHeadlineFontPx,
        carousel_body_font_px: carouselBodyFontPx,
        carousel_kicker_font_px: carouselKickerFontPx,
        carousel_cta_font_px: carouselCtaFontPx,
        carousel_handle_font_px: carouselHandleFontPx,
      });
      mergeCarouselThemeIntoPayload(slidesPayload, {
        carousel_paper: carouselPaperHex,
        carousel_ink: carouselInkHex,
      });
    },
    [
      fontScale,
      carouselHeadlineFontPx,
      carouselBodyFontPx,
      carouselKickerFontPx,
      carouselCtaFontPx,
      carouselHandleFontPx,
      carouselPaperHex,
      carouselInkHex,
    ]
  );

  const carouselLogoOverlay = useMemo(() => {
    if (!carouselLogoEnabled || !brandLogoReprintUrl.trim()) return undefined;
    return { url: brandLogoReprintUrl.trim(), position: "br" as const };
  }, [carouselLogoEnabled, brandLogoReprintUrl]);

  const carouselFrameOverlay = useMemo(() => {
    if (!carouselFrameEnabled || brandFrames.length === 0) return undefined;
    const frame = brandFrames.find((f) => f.assetId === carouselFrameAssetId) ?? brandFrames[0];
    if (!frame?.reprintUrl.trim()) return undefined;
    return { url: frame.reprintUrl.trim(), asset_id: frame.assetId };
  }, [carouselFrameEnabled, carouselFrameAssetId, brandFrames]);

  const carouselStylingRevisionKey = useMemo(
    () =>
      JSON.stringify({
        fontScale,
        carouselHeadlineFontPx,
        carouselBodyFontPx,
        carouselKickerFontPx,
        carouselCtaFontPx,
        carouselHandleFontPx,
        carouselPaperHex,
        carouselInkHex,
        carouselLogoEnabled,
        carouselFrameEnabled,
        carouselFrameAssetId,
      }),
    [
      fontScale,
      carouselHeadlineFontPx,
      carouselBodyFontPx,
      carouselKickerFontPx,
      carouselCtaFontPx,
      carouselHandleFontPx,
      carouselPaperHex,
      carouselInkHex,
      carouselLogoEnabled,
      carouselFrameEnabled,
      carouselFrameAssetId,
    ]
  );

  const textCarouselStylingPanel =
    carouselFlow && !tpGroundedCarouselReview && !videoFlow && !imageFlow;

  const videoBrandOverlayPreview = useMemo(() => {
    const logoUrl =
      videoLogoEnabled && brandLogoUrl.trim() ? brandLogoUrl.trim() : undefined;
    if (!videoFrameEnabled || brandFrames.length === 0) {
      return { logoUrl, frameUrl: undefined as string | undefined };
    }
    const frame = brandFrames.find((f) => f.assetId === videoFrameAssetId) ?? brandFrames[0];
    const frameUrl = frame?.displayUrl?.trim() || undefined;
    return { logoUrl, frameUrl };
  }, [videoLogoEnabled, brandLogoUrl, videoFrameEnabled, videoFrameAssetId, brandFrames]);

  const videoPreviewSidePanel = videoFlow ? (
    <VideoBrandStampControls
      taskId={execTaskId}
      projectSlug={(data?.project ?? projectFromUrl).trim()}
      brandLogoDisplayUrl={brandLogoUrl}
      logoEnabled={videoLogoEnabled}
      onLogoEnabledChange={setVideoLogoEnabled}
      brandFrames={brandFrames}
      frameEnabled={videoFrameEnabled}
      onFrameEnabledChange={setVideoFrameEnabled}
      selectedFrameAssetId={videoFrameAssetId}
      onSelectedFrameAssetIdChange={setVideoFrameAssetId}
      onApplied={() => {
        void refreshTaskAssets();
        void fetchTask();
      }}
    />
  ) : undefined;

  const carouselPreviewSidePanel = textCarouselStylingPanel ? (
    <CarouselBrandStylingPanel
      fontScale={fontScale}
      onFontScaleChange={setFontScale}
      carouselHeadlineFontPx={carouselHeadlineFontPx}
      onCarouselHeadlineFontPxChange={setCarouselHeadlineFontPx}
      carouselBodyFontPx={carouselBodyFontPx}
      onCarouselBodyFontPxChange={setCarouselBodyFontPx}
      carouselKickerFontPx={carouselKickerFontPx}
      onCarouselKickerFontPxChange={setCarouselKickerFontPx}
      carouselCtaFontPx={carouselCtaFontPx}
      onCarouselCtaFontPxChange={setCarouselCtaFontPx}
      carouselHandleFontPx={carouselHandleFontPx}
      onCarouselHandleFontPxChange={setCarouselHandleFontPx}
      brandPalette={brandPalette}
      brandLogoDisplayUrl={brandLogoUrl}
      logoEnabled={carouselLogoEnabled}
      onLogoEnabledChange={setCarouselLogoEnabled}
      brandFrames={brandFrames}
      frameEnabled={carouselFrameEnabled}
      onFrameEnabledChange={setCarouselFrameEnabled}
      selectedFrameAssetId={carouselFrameAssetId}
      onSelectedFrameAssetIdChange={setCarouselFrameAssetId}
      paperHex={carouselPaperHex}
      onPaperHexChange={setCarouselPaperHex}
      inkHex={carouselInkHex}
      onInkHexChange={setCarouselInkHex}
    />
  ) : undefined;

  const buildReprintTypographyPatch = useCallback(
    () =>
      buildCarouselRenderTypographyPatch(fontScale, {
        carousel_headline_font_px: carouselHeadlineFontPx,
        carousel_body_font_px: carouselBodyFontPx,
        carousel_kicker_font_px: carouselKickerFontPx,
        carousel_cta_font_px: carouselCtaFontPx,
        carousel_handle_font_px: carouselHandleFontPx,
      }),
    [
      fontScale,
      carouselHeadlineFontPx,
      carouselBodyFontPx,
      carouselKickerFontPx,
      carouselCtaFontPx,
      carouselHandleFontPx,
    ]
  );

  const handleMimicLayoutSaved = useCallback(
    (slideIndex: number, positions: Record<string, unknown>[]) => {
      setMimicLayoutPreviewRevision((v) => v + 1);
      setFullJob((prev) => {
        if (!prev) return prev;
        const gp =
          prev.generation_payload && typeof prev.generation_payload === "object" && !Array.isArray(prev.generation_payload)
            ? (prev.generation_payload as Record<string, unknown>)
            : {};
        const mimicV1 =
          gp.mimic_v1 && typeof gp.mimic_v1 === "object" && !Array.isArray(gp.mimic_v1)
            ? (gp.mimic_v1 as Record<string, unknown>)
            : {};
        const raw = mimicV1.docai_layer_positions;
        const existing =
          raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
        return {
          ...prev,
          generation_payload: {
            ...gp,
            mimic_v1: {
              ...mimicV1,
              docai_layer_positions: {
                ...existing,
                [String(slideIndex)]: positions,
              },
            },
          },
        };
      });
    },
    []
  );

  const buildSlideCopyOverridesForReprint = useCallback(
    (slideIndices: number[] | undefined) =>
      buildMimicReprintSlideCopyOverrides(editedSlides, mimicTemplateBg, slideIndices),
    [editedSlides, mimicTemplateBg]
  );

  const mimicCarouselInspectContext = useMemo(() => {
    if (!tpGroundedCarouselReview || editedSlides.length === 0) return null;
    const gp = fullJob?.generation_payload as Record<string, unknown> | undefined;
    const templateFromGp = String(gp?.template ?? carouselTemplate ?? "carousel_mimic_bg")
      .replace(/\.hbs$/i, "")
      .trim();
    const template = templateFromGp || "carousel_mimic_bg";
    return {
      template,
      getPayload: () => {
        const slidesPayload = buildSlidesJson(editedSlides, rawPayload ?? null);
        decorateCarouselSlidesPayload(slidesPayload);
        const mimicV1 =
          gp?.mimic_v1 && typeof gp.mimic_v1 === "object" && !Array.isArray(gp.mimic_v1)
            ? gp.mimic_v1
            : undefined;
        const bgFromGp =
          typeof gp?.background_image_url === "string" ? gp.background_image_url.trim() : "";
        return {
          ...slidesPayload,
          task_id: execTaskId,
          run_id: runId || undefined,
          ...(mimicV1 ? { mimic_v1: mimicV1 } : {}),
          ...(bgFromGp ? { background_image_url: bgFromGp } : {}),
        };
      },
      getBackgroundUrl: (slideIndex1Based: number) => {
        const pos = slideIndex1Based - 1;
        if (mimicPlateByPosition[pos]) return mimicPlateByPosition[pos];
        if (mimicBackgroundByPosition[pos]) return mimicBackgroundByPosition[pos];
        const platePositions = Object.keys(mimicPlateByPosition)
          .map(Number)
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);
        if (platePositions.length > 0) {
          const cycled = platePositions[pos % platePositions.length];
          if (cycled != null && mimicPlateByPosition[cycled]) return mimicPlateByPosition[cycled];
        }
        const bgPositions = Object.keys(mimicBackgroundByPosition)
          .map(Number)
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);
        if (bgPositions.length > 0) {
          const cycled = bgPositions[pos % bgPositions.length];
          if (cycled != null && mimicBackgroundByPosition[cycled]) {
            return mimicBackgroundByPosition[cycled];
          }
        }
        const mimicV1 =
          gp?.mimic_v1 && typeof gp.mimic_v1 === "object" && !Array.isArray(gp.mimic_v1)
            ? (gp.mimic_v1 as Record<string, unknown>)
            : null;
        const fromPayload =
          typeof gp?.background_image_url === "string" ? gp.background_image_url.trim() : "";
        const fromMimic =
          mimicV1 && typeof mimicV1.background_image_url === "string"
            ? mimicV1.background_image_url.trim()
            : "";
        const fromTaskAsset = taskAssets.find((a) => a.position === pos && a.public_url)?.public_url;
        return fromPayload || fromMimic || fromTaskAsset || undefined;
      },
    };
  }, [
    tpGroundedCarouselReview,
    editedSlides,
    fullJob,
    carouselTemplate,
    rawPayload,
    decorateCarouselSlidesPayload,
    execTaskId,
    runId,
    mimicPlateByPosition,
    mimicBackgroundByPosition,
    taskAssets,
  ]);

  const carouselLivePreview = useMemo(() => {
    if (videoFlow || imageFlow || editedSlides.length === 0) return null;

    if (tpGroundedCarouselReview && mimicTemplateBg && mimicCarouselInspectContext) {
      return {
        template: mimicCarouselInspectContext.template,
        taskId: execTaskId,
        runId: runId || "run",
        fontScale: "1",
        instagramHandle: instagramHandleForPreview,
        layoutRevisionKey: mimicLayoutPreviewRevision,
        getPayload: mimicCarouselInspectContext.getPayload,
        getBackgroundUrl: mimicCarouselInspectContext.getBackgroundUrl,
        getDocAiLayerPositions: (slideIndex1Based: number) => {
          const gp = fullJob?.generation_payload as Record<string, unknown> | undefined;
          const mimicV1 =
            gp?.mimic_v1 && typeof gp.mimic_v1 === "object" && !Array.isArray(gp.mimic_v1)
              ? (gp.mimic_v1 as Record<string, unknown>)
              : null;
          const raw = mimicV1?.docai_layer_positions;
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
          const rows = (raw as Record<string, unknown>)[String(slideIndex1Based)];
          return Array.isArray(rows) && rows.length > 0
            ? (rows as Record<string, unknown>[])
            : undefined;
        },
      };
    }

    if (tpGroundedCarouselReview || !carouselTemplate) return null;

    return {
      template: carouselTemplate,
      taskId: execTaskId,
      runId: runId || "run",
      fontScale,
      instagramHandle: instagramHandleForPreview,
      projectSlug: (data?.project ?? projectFromUrl ?? "").trim(),
      stylingRevisionKey: carouselStylingRevisionKey,
      logoOverlay: carouselLogoOverlay,
      frameOverlay: carouselFrameOverlay,
      getPayload: () => {
        const slidesPayload = buildSlidesJson(editedSlides, rawPayload ?? null);
        decorateCarouselSlidesPayload(slidesPayload);
        const gp = fullJob?.generation_payload as Record<string, unknown> | undefined;
        const mimicV1 =
          gp?.mimic_v1 && typeof gp.mimic_v1 === "object" && !Array.isArray(gp.mimic_v1)
            ? gp.mimic_v1
            : undefined;
        const bgFromGp =
          typeof gp?.background_image_url === "string" ? gp.background_image_url.trim() : "";
        return {
          ...slidesPayload,
          task_id: execTaskId,
          run_id: runId || undefined,
          ...(mimicV1 ? { mimic_v1: mimicV1 } : {}),
          ...(bgFromGp ? { background_image_url: bgFromGp } : {}),
        };
      },
      getBackgroundUrl: (slideIndex1Based: number) => {
        const pos = slideIndex1Based - 1;
        if (mimicBackgroundByPosition[pos]) return mimicBackgroundByPosition[pos];
        const positions = Object.keys(mimicBackgroundByPosition)
          .map(Number)
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);
        if (positions.length > 0) {
          const cycled = positions[pos % positions.length];
          if (cycled != null && mimicBackgroundByPosition[cycled]) {
            return mimicBackgroundByPosition[cycled];
          }
        }
        const fromAsset = mimicBackgroundByPosition[0];
        if (fromAsset) return fromAsset;
        const gp = rawPayload && typeof rawPayload === "object" ? rawPayload : null;
        const mimicV1 =
          gp?.mimic_v1 && typeof gp.mimic_v1 === "object" && !Array.isArray(gp.mimic_v1)
            ? (gp.mimic_v1 as Record<string, unknown>)
            : null;
        const fromPayload =
          typeof gp?.background_image_url === "string" ? gp.background_image_url.trim() : "";
        const fromMimic =
          mimicV1 && typeof mimicV1.background_image_url === "string"
            ? mimicV1.background_image_url.trim()
            : "";
        return fromPayload || fromMimic || undefined;
      },
    };
  }, [
    videoFlow,
    imageFlow,
    editedSlides.length,
    tpGroundedCarouselReview,
    mimicTemplateBg,
    mimicCarouselInspectContext,
    carouselTemplate,
    execTaskId,
    runId,
    fontScale,
    instagramHandleForPreview,
    carouselStylingRevisionKey,
    carouselLogoOverlay,
    carouselFrameOverlay,
    data?.project,
    projectFromUrl,
    mimicLayoutPreviewRevision,
    editedSlides,
    rawPayload,
    decorateCarouselSlidesPayload,
    mimicBackgroundByPosition,
    fullJob,
  ]);

  const finalSlidesJsonOverride =
    !videoFlow && !imageFlow && editedSlides.length > 0 && rawPayload !== undefined
      ? (() => {
          const slidesPayload = buildSlidesJson(editedSlides, rawPayload);
          decorateCarouselSlidesPayload(slidesPayload);
          return JSON.stringify(slidesPayload);
        })()
      : undefined;

  const debugBundleProps = {
    taskId: execTaskId,
    projectSlug: (data?.project ?? projectFromUrl).trim(),
    workbenchRow: data,
    fullJob,
    taskAssets,
    upstreamLineage,
    heygenSubmit: submittedHeygenPrompt,
    fetchMimicAudits: tpGroundedCarouselReview,
    reviewerUi: {
      edited_slides: !videoFlow && !imageFlow && editedSlides.length > 0 ? editedSlides : undefined,
      edited_caption: editedCaption,
      edited_title: editedTitle,
      edited_hook: editedHook,
      edited_hashtags: editedHashtags,
      edited_script: heygenWorkbench ? editedScript : undefined,
      carousel_template: carouselTemplate || undefined,
      has_unsaved_edits: hasEdits,
      edits_summary: editsSummary,
    },
  };

  return (
    <>
      <div className="detail-back">
        <Link href={navHref(marketerMode ? `/brand/${encodeURIComponent(projectFromUrl || data?.project || "")}/content` : "/review")}>
          ← Back to {marketerMode ? "content" : "Workbench"}
        </Link>
        {!marketerMode && runId && (
          <> · <Link href={navHref(`/r/${encodeURIComponent(runId)}`)}>Run: {runId}</Link></>
        )}
      </div>
      <h1 className="detail-title">{data?.generated_title || data?.generated_hook || task_id}</h1>
      {data && !loading ? (
        <div className="detail-header-row">
          <p className="detail-subtitle">
            {data.platform && <>{data.platform} · </>}
            {displayFlowLabel(data)}
            {displayFlowDetail(data) ? (
              <span className="detail-subtitle-detail">{displayFlowDetail(data)}</span>
            ) : null}
            {!marketerMode && <> · {task_id}</>}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {!marketerMode && !embeddedInAdmin ? <CopyTaskDebugBundleButton {...debugBundleProps} /> : null}
          </div>
        </div>
      ) : (
        <p className="detail-subtitle">
          {data?.platform && <>{data.platform} · </>}
          {data ? <>{displayFlowLabel(data)}</> : null}
          {data && displayFlowDetail(data) ? (
            <span className="detail-subtitle-detail">{displayFlowDetail(data)}</span>
          ) : null}
          {!marketerMode && data ? <> · {task_id}</> : !data ? task_id : null}
        </p>
      )}

      {error && (
        <div style={{ margin: "0 28px 16px", padding: 12, background: "var(--red-bg)", color: "var(--red)", borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}
      {textOverlayReprintFailure ? (
        <RenderFailureBanner
          headline={textOverlayReprintFailure.headline}
          technical={textOverlayReprintFailure.technical}
          failedSlide={textOverlayReprintFailure.failedSlide}
          kind="text_reprint"
          active={textOverlayReprint.active}
        />
      ) : textOverlayReprintBanner ? (
        <div
          className={`task-reprint-banner${textOverlayReprint.failed ? " task-reprint-banner--failed" : ""}${textOverlayReprint.active ? " task-reprint-banner--active" : ""}`}
          role="status"
        >
          {textOverlayReprintBanner}
        </div>
      ) : jobFailureBanner ? (
        <RenderFailureBanner
          technical={jobFailureBanner.replace(/^Job failed:\s*/i, "")}
          kind="job"
        />
      ) : layoutQcAttentionBanner ? (
        <div className="task-qc-warning-banner" role="status">
          {layoutQcAttentionBanner}
        </div>
      ) : null}
      {loading && !data && <div style={{ padding: 28, color: "var(--muted)" }}>Loading…</div>}

      {data && !loading && (
        <div className={`detail-grid${tpGroundedCarouselReview ? " detail-grid--mimic-carousel" : ""}`}>
          <div style={{ minWidth: 0 }}>
            <TaskViewer
              data={data}
              taskAssets={taskAssets}
              editedSlides={!videoFlow && !imageFlow && editedSlides.length > 0 ? editedSlides : undefined}
              onSlidesChange={!videoFlow && !imageFlow ? setEditedSlides : undefined}
              fallbackPreviewUrl={taskAssets[0]?.public_url}
              spokenScript={heygenWorkbench ? editedScript : undefined}
              onSpokenScriptChange={heygenWorkbench ? setEditedScript : undefined}
              carouselLivePreview={carouselLivePreview}
              carouselPreviewSidePanel={videoFlow ? videoPreviewSidePanel : carouselPreviewSidePanel}
              videoBrandOverlay={videoFlow ? videoBrandOverlayPreview : undefined}
              previewToolbar={
                marketerMode ? undefined : (
                  <CopyTaskDebugBundleButton {...debugBundleProps} variant="compact" />
                )
              }
              onCarouselSlideChange={setViewerSlideIndex}
              carouselActiveSlideIndex={tpGroundedCarouselReview ? viewerSlideIndex : undefined}
              referenceSlideUrl={
                mimicCarouselFlow || tpGroundedCarouselReview ? mimicReferenceUrlForViewer : undefined
              }
              referenceVideoUrl={referenceVideoUrl}
              projectHandle={tpGroundedCarouselReview ? instagramHandleForPreview : undefined}
              caption={videoFlow ? editedCaption : undefined}
              onCaptionChange={videoFlow ? setEditedCaption : undefined}
              hashtags={videoFlow ? editedHashtags : undefined}
              onHashtagsChange={videoFlow ? setEditedHashtags : undefined}
              activeTextBlockIndex={tpGroundedCarouselReview ? activeTextBlockIndex : undefined}
              onActiveTextBlockIndexChange={tpGroundedCarouselReview ? setActiveTextBlockIndex : undefined}
              mimicFullBleed={tpGroundedCarouselReview && !mimicTemplateBg}
              onMimicLayoutTextBlockChange={
                tpGroundedCarouselReview
                  ? (blockIndex, text) => mimicTextBlockUpdaterRef.current?.(blockIndex, text)
                  : undefined
              }
              onDeleteSlide={tpGroundedCarouselReview ? handleDeleteMimicSlide : undefined}
              onRegenerateSlide={tpGroundedCarouselReview ? handleRegenerateMimicSlide : undefined}
              onRegenerateAllSlides={
                tpGroundedCarouselReview && editedSlides.length > 1
                  ? handleRegenerateAllMimicSlides
                  : undefined
              }
              regenerateSlideBusy={tpGroundedCarouselReview ? regenerateSlideBusy : undefined}
              mimicRegenerationNote={tpGroundedCarouselReview ? mimicRegenNote : undefined}
              onMimicRegenerationNoteChange={tpGroundedCarouselReview ? setMimicRegenNote : undefined}
              layoutSlideBadges={tpGroundedCarouselReview ? layoutSlideBadges : undefined}
              slideRenderStatuses={slideRenderStatuses.length > 0 ? slideRenderStatuses : undefined}
              assetRefreshKey={assetRefreshKey}
              mimicTemplateBg={tpGroundedCarouselReview && mimicTemplateBg}
              carouselCopySidePanel={
                tpGroundedCarouselReview && fullJob ? (
                  <MimicCarouselLayerEditorPanel
                    job={fullJob}
                    taskId={execTaskId}
                    projectSlug={(data.project ?? projectFromUrl).trim()}
                    slideCount={editedSlides.length}
                    activeSlideIndex={viewerSlideIndex}
                    template={mimicCarouselInspectContext?.template ?? carouselTemplate}
                    instagramHandle={instagramHandleForPreview}
                    buildInspectPayload={
                      mimicCarouselInspectContext?.getPayload ?? carouselLivePreview?.getPayload
                    }
                    getBackgroundUrl={
                      mimicCarouselInspectContext?.getBackgroundUrl ?? carouselLivePreview?.getBackgroundUrl
                    }
                    onReprintComplete={refreshTaskAssets}
                    buildReprintTypographyPatch={buildReprintTypographyPatch}
                    buildSlideCopyOverrides={buildSlideCopyOverridesForReprint}
                    onMimicLayoutSaved={handleMimicLayoutSaved}
                    onSlideSelect={setViewerSlideIndex}
                    onDeleteSlide={handleDeleteMimicSlide}
                    regenerationNote={mimicRegenNote}
                    onRegenerationNoteChange={setMimicRegenNote}
                    assetRefreshKey={assetRefreshKey}
                    activeTextBlockIndex={activeTextBlockIndex}
                    onActiveTextBlockIndexChange={setActiveTextBlockIndex}
                    fullBleedMode={!mimicTemplateBg}
                    templateBgMode={mimicTemplateBg}
                    templateBgFieldRoles={templateBgFieldRoles}
                    templateBgFieldTexts={templateBgFieldTexts}
                    fullBleedSlotTexts={fullBleedSlotTexts}
                    brandPalette={brandPalette}
                    brandLogoUrl={brandLogoUrl}
                    brandLogoReprintUrl={brandLogoReprintUrl}
                    brandFrames={brandFrames}
                    resolveSlideFieldText={(slideIndex, fieldRole) => {
                      const slide = editedSlides[slideIndex - 1];
                      if (!slide) return "";
                      const fields = resolveMimicTemplateBgEditorFields(
                        slide,
                        slideIndex,
                        editedSlides.length
                      );
                      return fields.find((f) => f.role === fieldRole)?.text ?? "";
                    }}
                    onTemplateBgFieldTextChange={(slideIndex, fieldRole, text) => {
                      setEditedSlides((prev) => {
                        const idx = slideIndex - 1;
                        const slide = prev[idx];
                        if (!slide) return prev;
                        const fields = resolveMimicTemplateBgEditorFields(slide, slideIndex, prev.length);
                        const field = fields.find((f) => f.role === fieldRole);
                        if (!field) return prev;
                        return prev.map((s, i) =>
                          i === idx
                            ? applyMimicTemplateBgFieldEdit(s, slideIndex, prev.length, field.key, text)
                            : s
                        );
                      });
                    }}
                    registerTextBlockUpdater={(fn) => {
                      mimicTextBlockUpdaterRef.current = fn;
                    }}
                    onLayoutTextBlocksChange={
                      !mimicTemplateBg
                        ? (slideIndex, blocks) => {
                            const text_blocks = blocks
                              .filter((b) => b.role !== "handle")
                              .map((b) => ({
                                role:
                                  b.role === "headline" || b.role === "title" || b.role === "cta"
                                    ? "headline"
                                    : "body",
                                text: b.text.trim(),
                              }))
                              .filter((b) => b.text && !/^@[\w.]{2,}$/i.test(b.text));
                            if (text_blocks.length === 0) return;
                            setEditedSlides((prev) => {
                              const idx = slideIndex - 1;
                              const slide = prev[idx];
                              if (!slide) return prev;
                              const fields = mimicSlideFieldsFromTextBlocks(text_blocks);
                              return prev.map((s, i) =>
                                i === idx
                                  ? {
                                      ...s,
                                      text_blocks,
                                      on_slide_lines: fields.on_slide_lines,
                                      headline: fields.headline,
                                      body: fields.body,
                                    }
                                  : s
                              );
                            });
                          }
                        : undefined
                    }
                  />
                ) : undefined
              }
            />

            {tpGroundedCarouselReview ? (
              <MimicCarouselEdits
                variant="below-preview"
                defaultOpen={false}
                hook={editedHook}
                onHookChange={setEditedHook}
                caption={editedCaption}
                onCaptionChange={setEditedCaption}
                hashtags={editedHashtags}
                onHashtagsChange={setEditedHashtags}
              />
            ) : null}

            {!marketerMode && (
            <div className="mt-4">
              <JobInfoBar
                jobId={execTaskId}
                projectSlug={(data.project ?? "").trim()}
                platform={data.platform || undefined}
                flowType={data.flow_type || undefined}
                flowLabel={displayFlowLabel(data)}
                flowDetail={displayFlowDetail(data) ?? undefined}
                route={data.recommended_route || undefined}
                runId={runId || undefined}
                risk={data.risk_score || undefined}
                qc={data.qc_status || undefined}
                textReprint={textOverlayReprintBanner || undefined}
                storedOverrides={(data.overrides_from_last_review ?? "").trim() || undefined}
                lastIssueTags={(data.latest_rejection_tags ?? "").trim() || undefined}
                lineage={upstreamLineage}
                validationNode={<InspectValidationJson job={fullJob} />}
                mimicInspectNode={
                  tpGroundedCarouselReview && fullJob ? (
                    <MimicCarouselInspectPanel
                      job={fullJob}
                      taskId={execTaskId}
                      projectSlug={(data.project ?? projectFromUrl).trim()}
                      slideCount={editedSlides.length}
                      activeSlideIndex={viewerSlideIndex}
                      onInspectSlideChange={setViewerSlideIndex}
                      skipRenderInspect
                      template={mimicCarouselInspectContext?.template ?? carouselTemplate}
                      instagramHandle={instagramHandleForPreview}
                      buildInspectPayload={
                        mimicCarouselInspectContext?.getPayload ?? carouselLivePreview?.getPayload
                      }
                      getBackgroundUrl={
                        mimicCarouselInspectContext?.getBackgroundUrl ?? carouselLivePreview?.getBackgroundUrl
                      }
                    />
                  ) : undefined
                }
              />
              <JobJourneyPanel
                projectSlug={(data.project ?? projectFromUrl).trim()}
                taskId={execTaskId}
              />
            </div>
            )}
          </div>

          <div className={tpGroundedCarouselReview ? "mimic-decision-bar" : undefined} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {heygenWorkbench && (
              <HeyGenReviewEdits
                heygenAvatarId={heygenAvatarId}
                onHeygenAvatarIdChange={setHeygenAvatarId}
                heygenVoiceId={heygenVoiceId}
                onHeygenVoiceIdChange={setHeygenVoiceId}
                heygenForceRerender={heygenForceRerender}
                onHeygenForceRerenderChange={setHeygenForceRerender}
              />
            )}
            {videoFlow ? (
              <VideoReviewEdits
                videoPrompt={mediaPrompt}
                provider={videoPromptLabel}
                submittedHeygenPrompt={submittedHeygenPrompt}
                promptAnalysis={videoPromptAnalysis}
                onPromptAnalysisChange={setVideoPromptAnalysis}
                caption={editedCaption}
                onCaptionChange={setEditedCaption}
                hashtags={editedHashtags}
                onHashtagsChange={setEditedHashtags}
                hook={editedHook}
                onHookChange={setEditedHook}
                skipVideoRegeneration={skipVideoRegeneration}
                onSkipVideoRegenerationChange={setSkipVideoRegeneration}
              />
            ) : imageFlow ? (
              <ImageReviewEdits
                imagePrompt={mediaPrompt}
                provider={imagePromptLabel}
                promptAnalysis={imagePromptAnalysis}
                onPromptAnalysisChange={setImagePromptAnalysis}
                caption={editedCaption}
                onCaptionChange={setEditedCaption}
                hashtags={editedHashtags}
                onHashtagsChange={setEditedHashtags}
                hook={editedHook}
                onHookChange={setEditedHook}
                title={editedTitle}
                onTitleChange={setEditedTitle}
                skipImageRegeneration={skipImageRegeneration}
                onSkipImageRegenerationChange={setSkipImageRegeneration}
              />
            ) : tpGroundedCarouselReview ? null : (
              <CarouselEdits
                taskId={execTaskId}
                runId={runId || undefined}
                editedSlides={editedSlides}
                rawPayload={rawPayload ?? null}
                fontScale={fontScale}
                onFontScaleChange={setFontScale}
                carouselHeadlineFontPx={carouselHeadlineFontPx}
                onCarouselHeadlineFontPxChange={setCarouselHeadlineFontPx}
                carouselBodyFontPx={carouselBodyFontPx}
                onCarouselBodyFontPxChange={setCarouselBodyFontPx}
                carouselKickerFontPx={carouselKickerFontPx}
                onCarouselKickerFontPxChange={setCarouselKickerFontPx}
                carouselCtaFontPx={carouselCtaFontPx}
                onCarouselCtaFontPxChange={setCarouselCtaFontPx}
                carouselHandleFontPx={carouselHandleFontPx}
                onCarouselHandleFontPxChange={setCarouselHandleFontPx}
                paperHex={carouselPaperHex}
                onPaperHexChange={setCarouselPaperHex}
                inkHex={carouselInkHex}
                onInkHexChange={setCarouselInkHex}
                logoEnabled={carouselLogoEnabled}
                onLogoEnabledChange={setCarouselLogoEnabled}
                frameEnabled={carouselFrameEnabled}
                onFrameEnabledChange={setCarouselFrameEnabled}
                selectedFrameAssetId={carouselFrameAssetId}
                onSelectedFrameAssetIdChange={setCarouselFrameAssetId}
                brandPalette={brandPalette}
                brandLogoDisplayUrl={brandLogoUrl}
                brandFrames={brandFrames}
                stylingInPreviewPanel={textCarouselStylingPanel}
                finalTitleOverride={editedTitle}
                onFinalTitleOverrideChange={setEditedTitle}
                finalHookOverride={editedHook}
                onFinalHookOverrideChange={setEditedHook}
                generatedCaption={editedCaption}
                onCaptionChange={setEditedCaption}
                finalHashtagsOverride={editedHashtags}
                onFinalHashtagsOverrideChange={setEditedHashtags}
                extraFields={{
                  generated_title: (data.generated_title ?? "").trim(),
                  generated_hook: (data.generated_hook ?? "").trim(),
                }}
                exportAtEnd
              />
            )}
            <DecisionPanel
              taskId={execTaskId}
              projectSlug={(data.project ?? projectFromUrl).trim() || undefined}
              onSuccess={() => router.push(navHref("/review"))}
              existingDecision={decision}
              existingNotes={notes}
              existingRewriteCopy={data.rewrite_copy !== "false"}
              existingRegenerate={
                data.regenerate === "false" ? false : data.regenerate === "true" ? true : undefined
              }
              finalTitleOverride={videoFlow ? undefined : editedTitle}
              finalHookOverride={editedHook}
              finalCaptionOverride={editedCaption}
              finalHashtagsOverride={editedHashtags}
              finalSlidesJsonOverride={finalSlidesJsonOverride}
              includeHeyGenFields={heygenWorkbench}
              finalSpokenScriptOverride={heygenWorkbench ? editedScript : undefined}
              heygenAvatarId={heygenWorkbench ? heygenAvatarId : undefined}
              heygenVoiceId={heygenWorkbench ? heygenVoiceId : undefined}
              heygenForceRerender={heygenWorkbench ? heygenForceRerender : undefined}
              hasEdits={hasEdits}
              editsSummary={editsSummary}
              notesAddendum={imageFlow ? imagePromptAnalysis : videoFlow ? videoPromptAnalysis : undefined}
              notesAddendumLabel={
                imageFlow
                  ? `${imagePromptLabel} prompt analysis`
                  : videoFlow
                  ? `${videoPromptLabel} prompt analysis`
                  : undefined
              }
              skipVideoRegeneration={videoFlow ? skipVideoRegeneration : undefined}
              skipImageRegeneration={imageFlow ? skipImageRegeneration : undefined}
              showCarouselTemplateControl={carouselFlow && !videoFlow && !imageFlow && !tpGroundedCarouselReview}
              showCarouselSlideRework={carouselFlow && !videoFlow && !imageFlow && !tpGroundedCarouselReview}
              hideIssueTags={tpGroundedCarouselReview}
              mimicReviewMode={tpGroundedCarouselReview}
              carouselSlideCount={carouselSlideCount}
              existingSlideReworkIndices={existingSlideReworkIndices}
              existingCarouselReworkChangeTemplate={
                data.carousel_rework_change_template === "true"
                  ? true
                  : data.carousel_rework_change_template === "false"
                    ? false
                    : undefined
              }
            />
            {!videoFlow && !imageFlow && !tpGroundedCarouselReview && (
              <CarouselEditsExport
                taskId={execTaskId}
                runId={runId || undefined}
                editedSlides={editedSlides}
                rawPayload={rawPayload ?? null}
                finalTitleOverride={editedTitle}
                finalHookOverride={editedHook}
                generatedCaption={editedCaption}
                finalHashtagsOverride={editedHashtags}
                extraFields={{
                  generated_title: (data.generated_title ?? "").trim(),
                  generated_hook: (data.generated_hook ?? "").trim(),
                }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
