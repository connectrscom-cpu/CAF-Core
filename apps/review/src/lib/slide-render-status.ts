import type { CarouselRegenerateUiState } from "@/lib/carousel-regenerate-status";
import type { TextOverlayReprintUiState } from "@/lib/text-overlay-reprint-status";
import type { TaskAssetPreview } from "@/lib/media-url";

export type SlideRenderStatus = "ready" | "missing" | "pending" | "failed";

export interface SlideRenderState {
  slideIndex: number;
  status: SlideRenderStatus;
  error?: string | null;
}

/** Extract 1-based slide index from renderer error strings. */
export function parseFailedSlideFromError(error: string | null | undefined): number | null {
  if (!error) return null;
  const m =
    error.match(/Renderer slide (\d+)/i) ??
    error.match(/slide[_ ](\d+)/i) ??
    error.match(/position (\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function parseSlideIndicesLabel(label: string | null | undefined): number[] {
  if (!label || label === "all") return [];
  return label
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 1);
}

export function resolveSlideRenderStatuses(opts: {
  slideCount: number;
  taskAssets: TaskAssetPreview[];
  textOverlayReprint?: TextOverlayReprintUiState | null;
  carouselRegenerate?: CarouselRegenerateUiState | null;
  renderError?: string | null;
}): SlideRenderState[] {
  const { slideCount, taskAssets, textOverlayReprint, carouselRegenerate, renderError } = opts;
  const n = Math.max(1, slideCount);
  const failedSlide =
    parseFailedSlideFromError(textOverlayReprint?.error) ??
    parseFailedSlideFromError(carouselRegenerate?.error) ??
    parseFailedSlideFromError(renderError);

  const reprintSlides = parseSlideIndicesLabel(textOverlayReprint?.slide_indices);
  const regenSlides = Object.keys(carouselRegenerate?.slides ?? {})
    .map((k) => Number(k))
    .filter((x) => x >= 1);

  const assetByPosition = new Map<number, TaskAssetPreview>();
  for (const a of taskAssets) {
    if ((a.public_url ?? "").trim()) assetByPosition.set(a.position, a);
  }

  const out: SlideRenderState[] = [];
  for (let i = 0; i < n; i++) {
    const slideIndex = i + 1;
    let status: SlideRenderStatus = assetByPosition.has(i) ? "ready" : "missing";
    let error: string | null = null;

    const regenSlideStatus = carouselRegenerate?.slides?.[String(slideIndex)];
    if (regenSlideStatus === "failed") {
      status = "failed";
      error = carouselRegenerate?.error ?? "Image regenerate failed on this slide.";
    } else if (regenSlideStatus === "rendering" || regenSlideStatus === "pending") {
      status = "pending";
    }

    if (textOverlayReprint?.active) {
      const targetsAll = !reprintSlides.length || textOverlayReprint.slide_indices === "all slides";
      if (targetsAll || reprintSlides.includes(slideIndex)) status = "pending";
    }

    if (carouselRegenerate?.active) {
      if (!regenSlides.length || regenSlides.includes(slideIndex)) {
        if (status !== "failed") status = "pending";
      }
    }

    if (failedSlide === slideIndex) {
      status = "failed";
      error =
        textOverlayReprint?.error ??
        carouselRegenerate?.error ??
        renderError ??
        "This slide could not be rendered.";
    } else if (textOverlayReprint?.failed && !failedSlide) {
      const targetsAll = !reprintSlides.length || textOverlayReprint.slide_indices === "all slides";
      if (targetsAll || reprintSlides.includes(slideIndex)) {
        status = status === "ready" ? "failed" : status;
        error = textOverlayReprint.error;
      }
    }

    out.push({ slideIndex, status, error });
  }
  return out;
}

export function slideRenderStatusLabel(status: SlideRenderStatus): string {
  switch (status) {
    case "ready":
      return "Rendered";
    case "pending":
      return "Rendering…";
    case "failed":
      return "Failed";
    default:
      return "Missing";
  }
}

export function slideRenderStatusClass(status: SlideRenderStatus): string {
  return `slide-render-badge slide-render-badge--${status}`;
}

/** Marketer-facing headline; raw TypeError stays in diagnostics. */
export function marketerRenderFailureHeadline(opts: {
  failedSlide: number | null;
  kind: "text_reprint" | "image_regen" | "job";
}): string {
  const slide = opts.failedSlide;
  if (opts.kind === "text_reprint") {
    return slide
      ? `Slide ${slide} could not be updated — text overlay reprint failed. Try again or regenerate the slide image.`
      : "Text overlay reprint failed. Try again or regenerate affected slides.";
  }
  if (opts.kind === "image_regen") {
    return slide
      ? `Slide ${slide} image could not be regenerated. Check the reference and try again.`
      : "Image regenerate failed on one or more slides.";
  }
  return slide
    ? `Rendering failed on slide ${slide}. Open diagnostics below or retry from the slide editor.`
    : "Rendering failed. Open diagnostics below or retry from the slide editor.";
}
