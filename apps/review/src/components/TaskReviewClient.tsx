"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TaskViewer } from "@/components/TaskViewer";
import { DecisionPanel } from "@/components/DecisionPanel";
import { MimicCarouselEdits } from "@/components/MimicCarouselEdits";
import { CarouselEdits, CarouselEditsExport } from "@/components/CarouselEdits";
import {
  buildCarouselRenderTypographyPatch,
  buildSlidesJson,
  createSyntheticSlides,
  mergeCarouselTypographyIntoPayload,
  parseSlidesFromJson,
  enrichMimicSlidesFromVisualGuideline,
  readCarouselTypographyFromFullJob,
  type CarouselSlidesPayload,
} from "@/lib/carousel-slides";
import type { NormalizedSlide } from "@/lib/carousel-slides";
import type { ReviewQueueRow } from "@/lib/types";
import { taskAssetsToPreviewRows, type TaskAssetPreview } from "@/lib/media-url";
import { decodeTaskIdParam } from "@/lib/task-id";
import { useReviewProject } from "@/components/ReviewProjectContext";
import { taskApiQuery } from "@/lib/task-links";
import { HeyGenReviewEdits } from "@/components/HeyGenReviewEdits";
import { VideoReviewEdits } from "@/components/VideoReviewEdits";
import { ImageReviewEdits } from "@/components/ImageReviewEdits";
import { isHeyGenReviewFlow } from "@/lib/heygen-review-flow";
import { isCarouselFlow, isImageFlow, isVideoFlow } from "@/lib/flow-kind";
import { InspectValidationJson } from "@/components/InspectValidationJson";
import { MimicCarouselInspectPanel } from "@/components/MimicCarouselInspectPanel";
import { MimicCarouselLayerEditorPanel } from "@/components/MimicCarouselLayerEditorPanel";
import { CopyTaskDebugBundleButton } from "@/components/CopyTaskDebugBundleButton";
import { isMimicCarouselFlow } from "@/lib/flow-kind";

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
  const task_id = useMemo(() => decodeTaskIdParam(taskIdParam), [taskIdParam]);

  const [data, setData] = useState<ReviewQueueRow | null>(null);
  const [taskAssets, setTaskAssets] = useState<TaskAssetPreview[]>([]);
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
  const [carouselTypoBaseline, setCarouselTypoBaseline] = useState({
    carousel_headline_font_px: "",
    carousel_body_font_px: "",
    carousel_kicker_font_px: "",
    carousel_cta_font_px: "",
    carousel_handle_font_px: "",
  });
  const carouselTypoSeededForTask = useRef<string | null>(null);
  const mimicOcrEnrichedForTask = useRef<string | null>(null);

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
    setSubmittedHeygenPrompt(null);
    setUpstreamLineage(null);
    setFullJob(null);
    setProjectStrategyHandle("");
    mimicOcrEnrichedForTask.current = null;
  }, [task_id]);

  useEffect(() => {
    if (initialSlides.length > 0) {
      if (taskAssets.length > initialSlides.length) {
        const nExtra = taskAssets.length - initialSlides.length;
        const extra: NormalizedSlide[] = Array.from({ length: nExtra }, (_, i) => ({
          index: initialSlides.length + i,
          type: "body",
          headline: "",
          body: "",
          handle: "",
        }));
        setEditedSlides([...initialSlides, ...extra]);
      } else {
        setEditedSlides(initialSlides);
      }
      return;
    }
    if (taskAssets.length > 0) {
      setEditedSlides((prev) =>
        prev.length !== taskAssets.length ? createSyntheticSlides(taskAssets.length) : prev
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

  const fetchTask = useCallback(async () => {
    if (!task_id) return;
    setLoading(true);
    setError(null);
    try {
      const qs = taskApiQuery(task_id, projectFromUrl);
      const [taskRes, assetsRes] = await Promise.all([
        fetch(`/api/task?${qs}`),
        fetch(`/api/task/assets?${qs}`),
      ]);
      if (taskRes.status === 404) {
        setError("Task not found");
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
        setTaskAssets(taskAssetsToPreviewRows(rows, { flowTypeHint: flowHint, cacheBust: Date.now() }));
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
      setLoading(false);
    }
  }, [task_id, projectFromUrl]);

  useEffect(() => { fetchTask(); }, [fetchTask]);

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

  useEffect(() => {
    if (!mimicCarouselFlow || !fullJob || editedSlides.length === 0) return;
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
    if (!vg) return;
    mimicOcrEnrichedForTask.current = execTaskId;
    setEditedSlides((prev) => {
      if (prev.length === 0) return prev;
      return enrichMimicSlidesFromVisualGuideline(prev, vg);
    });
  }, [mimicCarouselFlow, fullJob, editedSlides.length, execTaskId]);

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
    },
    [
      fontScale,
      carouselHeadlineFontPx,
      carouselBodyFontPx,
      carouselKickerFontPx,
      carouselCtaFontPx,
      carouselHandleFontPx,
    ]
  );

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

  const carouselLivePreview = useMemo(() => {
    // Mimic carousel slides are final Qwen-generated PNGs — no HBS template to live-preview.
    if (videoFlow || imageFlow || mimicCarouselFlow || !carouselTemplate || editedSlides.length === 0) return null;
    return {
      template: carouselTemplate,
      taskId: execTaskId,
      runId: runId || "run",
      fontScale,
      instagramHandle: instagramHandleForPreview,
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
    carouselTemplate,
    execTaskId,
    runId,
    fontScale,
    instagramHandleForPreview,
    editedSlides,
    rawPayload,
    decorateCarouselSlidesPayload,
    mimicBackgroundByPosition,
    fullJob,
  ]);

  const mimicCarouselInspectContext = useMemo(() => {
    if (!mimicCarouselFlow || editedSlides.length === 0) return null;
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
    mimicCarouselFlow,
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
    fetchMimicAudits: mimicCarouselFlow,
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
        <Link href={navHref("/")}>← Back to Workbench</Link>
        {runId && (
          <> · <Link href={navHref(`/r/${encodeURIComponent(runId)}`)}>Run: {runId}</Link></>
        )}
      </div>
      <h1 className="detail-title">{data?.generated_title || task_id}</h1>
      {data && !loading ? (
        <div className="detail-header-row">
          <p className="detail-subtitle">
            {data.platform && <>{data.platform} · </>}
            {data.flow_type && <>{data.flow_type} · </>}
            {task_id}
          </p>
          <CopyTaskDebugBundleButton {...debugBundleProps} />
        </div>
      ) : (
        <p className="detail-subtitle">
          {data?.platform && <>{data.platform} · </>}
          {data?.flow_type && <>{data.flow_type} · </>}
          {task_id}
        </p>
      )}

      {error && (
        <div style={{ margin: "0 28px 16px", padding: 12, background: "var(--red-bg)", color: "var(--red)", borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}
      {loading && !data && <div style={{ padding: 28, color: "var(--muted)" }}>Loading…</div>}

      {data && !loading && (
        <div className={`detail-grid${mimicCarouselFlow ? " detail-grid--mimic-carousel" : ""}`}>
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
              previewToolbar={<CopyTaskDebugBundleButton {...debugBundleProps} variant="compact" />}
              onCarouselSlideChange={setViewerSlideIndex}
              carouselActiveSlideIndex={mimicCarouselFlow ? viewerSlideIndex : undefined}
              carouselCopySidePanel={
                mimicCarouselFlow && fullJob ? (
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
                    onReprintComplete={fetchTask}
                    buildReprintTypographyPatch={buildReprintTypographyPatch}
                    onMimicLayoutSaved={handleMimicLayoutSaved}
                    onSlideSelect={setViewerSlideIndex}
                  />
                ) : undefined
              }
            />

            <div className="card mt-4 surface-teal">
              <div className="card-header">Task Info</div>
              <div className="info-row"><span className="info-label">Task ID</span><span className="info-value font-mono">{execTaskId}</span></div>
              {(data.project ?? "").trim() && (
                <div className="info-row"><span className="info-label">Project</span><span className="info-value">{(data.project ?? "").trim()}</span></div>
              )}
              <div className="info-row"><span className="info-label">Platform</span><span className="info-value">{data.platform || "—"}</span></div>
              <div className="info-row"><span className="info-label">Flow type</span><span className="info-value">{data.flow_type || "—"}</span></div>
              <div className="info-row"><span className="info-label">Route</span><span className="info-value">{data.recommended_route || "—"}</span></div>
              <div className="info-row"><span className="info-label">Run ID</span><span className="info-value">{runId || "—"}</span></div>
              <div className="info-row"><span className="info-label">Risk</span><span className="info-value">{data.risk_score || "—"}</span></div>
              <div className="info-row"><span className="info-label">QC</span><span className="info-value">{data.qc_status || "—"}</span></div>
              {(data.overrides_from_last_review ?? "").trim() !== "" && (
                <div className="info-row">
                  <span className="info-label">Stored overrides</span>
                  <span className="info-value" title="Fields with text on the latest NEEDS_EDIT row">
                    {(data.overrides_from_last_review ?? "").trim()}
                  </span>
                </div>
              )}
              {(data.latest_rejection_tags ?? "").trim() !== "" && (
                <div className="info-row">
                  <span className="info-label">Last issue tags</span>
                  <span className="info-value font-mono" style={{ fontSize: 12 }}>
                    {(data.latest_rejection_tags ?? "").trim()}
                  </span>
                </div>
              )}
            </div>

            {mimicCarouselFlow && fullJob ? (
              <details className="mimic-inspect-details mt-4">
                <summary className="mimic-inspect-details__summary">Advanced — mimic package inspect</summary>
                <MimicCarouselInspectPanel
                  job={fullJob}
                  taskId={execTaskId}
                  projectSlug={(data.project ?? projectFromUrl).trim()}
                  slideCount={editedSlides.length}
                  activeSlideIndex={viewerSlideIndex}
                  onInspectSlideChange={setViewerSlideIndex}
                  template={mimicCarouselInspectContext?.template ?? carouselTemplate}
                  instagramHandle={instagramHandleForPreview}
                  buildInspectPayload={
                    mimicCarouselInspectContext?.getPayload ?? carouselLivePreview?.getPayload
                  }
                  getBackgroundUrl={
                    mimicCarouselInspectContext?.getBackgroundUrl ?? carouselLivePreview?.getBackgroundUrl
                  }
                />
              </details>
            ) : null}

            <div className="card mt-4 surface-purple">
              <div className="card-header">Upstream lineage (inspect fields)</div>
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--fg-secondary)" }}>
                Run → Signal pack → Idea → Grounding insights → Evidence rows.
              </p>
              <details style={{ marginTop: 10, fontSize: 13 }}>
                <summary style={{ cursor: "pointer", color: "var(--fg-secondary)" }}>
                  {upstreamLineage ? "Show lineage JSON" : "No lineage loaded"}
                </summary>
                <pre className="slides-json" style={{ marginTop: 8 }}>
                  {JSON.stringify(upstreamLineage, null, 2)}
                </pre>
              </details>
            </div>

            <div className="mt-4">
              <InspectValidationJson job={fullJob} />
            </div>
          </div>

          <div className={mimicCarouselFlow ? "mimic-review-sidebar" : undefined} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            ) : mimicCarouselFlow ? (
              <MimicCarouselEdits fontScale={fontScale} onFontScaleChange={setFontScale} />
            ) : (
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
              onSuccess={() => router.push(navHref("/"))}
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
              showCarouselTemplateControl={carouselFlow && !videoFlow && !imageFlow && !mimicCarouselFlow}
              showCarouselSlideRework={carouselFlow && !videoFlow && !imageFlow && !mimicCarouselFlow}
              hideIssueTags={mimicCarouselFlow}
              mimicReviewMode={mimicCarouselFlow}
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
            {!videoFlow && !imageFlow && !mimicCarouselFlow && (
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
