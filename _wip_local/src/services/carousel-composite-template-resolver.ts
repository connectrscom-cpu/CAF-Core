import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  compositeTemplateKeyFromRef,
  isCompositeTemplateKey,
  type CarouselCompositeSlideRole,
} from "../domain/carousel-composite-layout.js";
import { compositeTemplatePinName, type CarouselCompositeTemplateRecord } from "../domain/carousel-composite-template.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import {
  getCarouselCompositeTemplateByInsightsId,
  getCarouselCompositeTemplateByKey,
} from "../repositories/carousel-composite-templates.js";
import {
  explicitCarouselTemplateBaseName,
  type CarouselRenderCtaOptions,
} from "./carousel-render-pack.js";

export type CompositeTemplateResolveResult = {
  template: CarouselCompositeTemplateRecord;
  template_pin: string;
};

function normalizeKey(raw: string): string {
  return compositeTemplateKeyFromRef(raw).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

/**
 * Resolve a composite template for carousel render when `CAROUSEL_COMPOSITE_ENABLED`.
 * Priority: explicit composite: key → mimic insights template → pinned composite template.
 */
export async function resolveCarouselCompositeTemplate(
  db: Pool,
  projectId: string,
  generationPayload: Record<string, unknown>,
  opts?: {
    mimicPayload?: MimicPayloadV1 | null;
    projectPinnedTemplates?: string[];
    implicitPickSeed?: string | null;
  }
): Promise<CompositeTemplateResolveResult | null> {
  const render = generationPayload.render as Record<string, unknown> | undefined;
  const explicitCompositeKey =
    typeof render?.composite_template_key === "string" ? render.composite_template_key.trim() : "";
  const explicitBase = explicitCarouselTemplateBaseName(generationPayload);
  const fromExplicit =
    explicitCompositeKey ||
    (explicitBase && isCompositeTemplateKey(explicitBase) ? compositeTemplateKeyFromRef(explicitBase) : "");

  if (fromExplicit) {
    const key = normalizeKey(fromExplicit);
    const row = await getCarouselCompositeTemplateByKey(db, projectId, key);
    if (row) return { template: row, template_pin: compositeTemplatePinName(row.template_key) };
  }

  const mimic = opts?.mimicPayload;
  if (mimic?.source_insights_id?.trim()) {
    const byInsights = await getCarouselCompositeTemplateByInsightsId(db, projectId, mimic.source_insights_id);
    if (byInsights) {
      return { template: byInsights, template_pin: compositeTemplatePinName(byInsights.template_key) };
    }
  }

  const pins = opts?.projectPinnedTemplates ?? [];
  for (const pin of pins) {
    if (!isCompositeTemplateKey(pin)) continue;
    const key = normalizeKey(pin);
    const row = await getCarouselCompositeTemplateByKey(db, projectId, key);
    if (row) return { template: row, template_pin: compositeTemplatePinName(row.template_key) };
  }

  const seed = opts?.implicitPickSeed?.trim();
  if (seed) {
    const compositeKeys = pins.filter(isCompositeTemplateKey).map((p) => normalizeKey(p));
    if (compositeKeys.length > 0) {
      let h = 2166136261;
      for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = (h >>> 0) % compositeKeys.length;
      const row = await getCarouselCompositeTemplateByKey(db, projectId, compositeKeys[idx]!);
      if (row) return { template: row, template_pin: compositeTemplatePinName(row.template_key) };
    }
  }

  return null;
}

/** True when mimic carousel should prefer composite over HBS (text-heavy / template_bg). */
export function mimicCarouselPrefersComposite(mimic: MimicPayloadV1 | null | undefined): boolean {
  if (!mimic) return false;
  return mimic.mode === "template_bg" || mimic.mode === "carousel_visual";
}

export function slideRoleUsesCompositeHbsFallback(
  mimic: MimicPayloadV1 | null | undefined,
  slideMode: "full_bleed" | "hbs" | null
): boolean {
  if (slideMode === "full_bleed") return false;
  if (!mimic) return true;
  return slideMode === "hbs" || mimic.mode === "template_bg";
}

export type { CarouselRenderCtaOptions, CarouselCompositeSlideRole };
