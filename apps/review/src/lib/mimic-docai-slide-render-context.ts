import {
  applySlideCopyToRenderContext,
  pickSlideByCarouselIndex,
  slideHeadlineBodyForRender,
  slideHasRenderableContent,
} from "@caf-core-carousel/carousel-render-pack";
import {
  applyMimicDocAiLayerPositionOverrides,
  isCustomAddedMimicDocAiLayerKey,
  mimicDocAiLayerPositionKey,
  pickMimicDocAiLayerPositionsForSlide,
  coerceTemplateBgInspectOverrides,
  type MimicDocAiLayerPositionOverride,
} from "@caf-core-carousel/mimic-docai-layer-positions";
import {
  buildMimicDocAiRenderTextLayers,
  formatMimicTextBackingBackground,
  inferMimicCarouselTheme,
  mimicDocAiLayersCoverLlmCopy,
  mimicPayloadHasDocAiTextLayout,
} from "@caf-core-carousel/mimic-slide-typography";
import { templateBgLlmSlideForDocAi } from "@/lib/mimic-template-bg";

export type MimicDocAiEnrichedSlide = {
  renderContext: Record<string, unknown>;
  docaiTextLayers: Array<Record<string, unknown> & { layer_key: string }>;
  docaiLayerCount: number;
  docaiLayerPositions: MimicDocAiLayerPositionOverride[];
  usesDocAi: boolean;
};

export function mergeDocAiLayerPositionsIntoMimicV1(
  mimicV1: Record<string, unknown>,
  slideIndex1Based: number,
  overrides: MimicDocAiLayerPositionOverride[] | null | undefined
): Record<string, unknown> {
  if (!overrides?.length) return mimicV1;
  const raw = mimicV1.docai_layer_positions;
  const existing =
    raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  return {
    ...mimicV1,
    docai_layer_positions: {
      ...existing,
      [String(slideIndex1Based)]: overrides,
    },
  };
}

/** Same DocAI overlay path Core uses for text-overlay reprint (renderer + fit script). */
export function enrichSlideRenderContextWithMimicDocAi(
  renderContext: Record<string, unknown>,
  mimicV1: Record<string, unknown>,
  slideIndex1Based: number,
  usableSlides: Record<string, unknown>[],
  opts?: {
    instagramHandle?: string;
    textBacking?: boolean;
    textBackingColor?: string | null;
    layerPosOverrides?: MimicDocAiLayerPositionOverride[] | null;
  }
): MimicDocAiEnrichedSlide {
  const usesDocAi = mimicPayloadHasDocAiTextLayout(
    mimicV1 as Parameters<typeof mimicPayloadHasDocAiTextLayout>[0]
  );
  const textBacking = opts?.textBacking !== false;
  const textBackingColor = textBacking
    ? formatMimicTextBackingBackground(opts?.textBackingColor)
    : undefined;
  const totalSlides = usableSlides.length;
  const rawLlmSlide = pickSlideByCarouselIndex(usableSlides, slideIndex1Based);
  const mimicMode = String(mimicV1.mode ?? "").trim();
  const llmSlideForDocAi =
    mimicMode === "template_bg" && totalSlides > 0
      ? templateBgLlmSlideForDocAi(slideIndex1Based, totalSlides, rawLlmSlide)
      : rawLlmSlide;
  const isTemplateBg = mimicMode === "template_bg";
  const rawLayerPosOverrides =
    opts?.layerPosOverrides ?? pickMimicDocAiLayerPositionsForSlide(mimicV1, slideIndex1Based);
  const hasReviewerLayout = Boolean(rawLayerPosOverrides?.length);

  if (!usesDocAi) {
    return {
      renderContext,
      docaiTextLayers: [],
      docaiLayerCount: 0,
      docaiLayerPositions: rawLayerPosOverrides ?? [],
      usesDocAi: false,
    };
  }

  const theme = inferMimicCarouselTheme(mimicV1.visual_guideline as Record<string, unknown>);
  let docAiLayers = buildMimicDocAiRenderTextLayers(
    mimicV1 as Parameters<typeof buildMimicDocAiRenderTextLayers>[0],
    slideIndex1Based,
    llmSlideForDocAi,
    { ink: theme.ink, body: theme.body },
    {
      projectHandle: opts?.instagramHandle || null,
      textBacking,
      textBackingColor,
      avoidCenterSubject: textBacking && !hasReviewerLayout,
      totalSlides,
    }
  );
  const layerPosOverrides =
    isTemplateBg && rawLayerPosOverrides?.length
      ? coerceTemplateBgInspectOverrides(docAiLayers, rawLayerPosOverrides)
      : rawLayerPosOverrides;
  if (layerPosOverrides?.length) {
    docAiLayers = applyMimicDocAiLayerPositionOverrides(docAiLayers, layerPosOverrides, {
      applySavedTextOnBaseLayers: !isTemplateBg,
    });
    if (textBacking) {
      docAiLayers = docAiLayers.map((layer) => ({ ...layer, text_backing: true }));
    }
  }

  const customOverrides = (layerPosOverrides ?? []).filter(
    (o) => isCustomAddedMimicDocAiLayerKey(o.layer_key) && !o.hidden
  );
  const customLayerStart = docAiLayers.length - customOverrides.length;
  const docaiTextLayers = docAiLayers.map((layer, index) => {
    const customOverride =
      index >= customLayerStart && customOverrides.length > 0
        ? customOverrides[index - customLayerStart]
        : undefined;
    return {
      ...layer,
      layer_key: customOverride?.layer_key ?? mimicDocAiLayerPositionKey(layer),
    };
  }) as Array<Record<string, unknown> & { layer_key: string }>;

  const useDocAiLayers =
    docAiLayers.length > 0 &&
    (hasReviewerLayout || mimicDocAiLayersCoverLlmCopy(docAiLayers, llmSlideForDocAi));

  let nextContext = renderContext;
  if (useDocAiLayers) {
    nextContext = {
      ...renderContext,
      mimic_render_text_layers: docAiLayers,
      mimic_use_docai_layers: true,
      ...(textBacking
        ? {
            mimic_text_backing: true,
            mimic_text_backing_color: textBackingColor,
            ...(hasReviewerLayout ? {} : { mimic_avoid_center_subject: true }),
          }
        : {}),
    };
  } else if (slideHasRenderableContent(llmSlideForDocAi)) {
    nextContext = applySlideCopyToRenderContext(
      renderContext,
      slideIndex1Based,
      slideHeadlineBodyForRender(llmSlideForDocAi)
    );
  }

  return {
    renderContext: nextContext,
    docaiTextLayers,
    docaiLayerCount: docAiLayers.length,
    docaiLayerPositions: layerPosOverrides ?? [],
    usesDocAi: true,
  };
}
