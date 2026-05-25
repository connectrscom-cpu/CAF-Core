/**
 * Unified carousel template pool: HBS (.hbs via Puppeteer) + stored composite (Sharp on PNG backgrounds).
 * Normal FLOW_CAROUSEL jobs pick deterministically from the combined pool.
 */
import type { Pool } from "pg";
import {
  CAROUSEL_COMPOSITE_TEMPLATE_PREFIX,
  compositeTemplateKeyFromRef,
  isCompositeTemplateKey,
} from "../domain/carousel-composite-layout.js";
import {
  compositeTemplatePinName,
  type CarouselCompositeTemplateRecord,
} from "../domain/carousel-composite-template.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import {
  getCarouselCompositeTemplateByInsightsId,
  getCarouselCompositeTemplateByKey,
  listActiveCarouselCompositeTemplates,
} from "../repositories/carousel-composite-templates.js";
import {
  CAROUSEL_TEMPLATE_EXCLUDE_FOR_NEXT_RENDER_KEY,
  explicitCarouselTemplateBaseName,
  listHbsCarouselTemplateCandidates,
} from "./carousel-render-pack.js";
import { mimicCarouselPrefersComposite } from "./carousel-composite-template-resolver.js";

export type CarouselTemplatePoolEntry =
  | { kind: "hbs"; pool_id: string; hbs_base: string }
  | { kind: "composite"; pool_id: string; composite: CarouselCompositeTemplateRecord };

export type CarouselRenderPlan = {
  mode: "hbs" | "composite";
  hbs_template: string | null;
  composite_template: CarouselCompositeTemplateRecord | null;
  /** Value stored on job `template` / render manifest. */
  template_label: string;
  template_pin: string;
};

function normalizePoolId(raw: string): string {
  return raw.trim().toLowerCase();
}

function stablePoolIndexFromSeed(poolSize: number, seed: string): number {
  if (poolSize <= 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % poolSize;
}

function normalizeTemplateKey(raw: string): string {
  return compositeTemplateKeyFromRef(raw).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

function planFromComposite(template: CarouselCompositeTemplateRecord): CarouselRenderPlan {
  return {
    mode: "composite",
    hbs_template: null,
    composite_template: template,
    template_label: template.template_key,
    template_pin: compositeTemplatePinName(template.template_key),
  };
}

function planFromHbs(base: string): CarouselRenderPlan {
  const label = base.replace(/\.hbs$/i, "");
  return {
    mode: "hbs",
    hbs_template: label,
    composite_template: null,
    template_label: label,
    template_pin: `${label}.hbs`,
  };
}

export async function buildCarouselTemplatePool(
  db: Pool,
  projectId: string,
  rendererBaseUrl: string,
  opts?: {
    projectPinnedTemplates?: string[];
    excludePoolId?: string;
    includeComposite?: boolean;
  }
): Promise<CarouselTemplatePoolEntry[]> {
  const pins = opts?.projectPinnedTemplates ?? [];
  const hbsPins = pins.filter((p) => !isCompositeTemplateKey(p));

  const excludeRaw = opts?.excludePoolId ?? "";
  const exclude = excludeRaw ? normalizePoolId(excludeRaw) : "";
  const excludeHbsBase = exclude.startsWith(CAROUSEL_COMPOSITE_TEMPLATE_PREFIX)
    ? undefined
    : exclude.replace(/\.hbs$/i, "");

  const hbsBases = await listHbsCarouselTemplateCandidates(rendererBaseUrl, {
    allowedTemplates: hbsPins.length > 0 ? hbsPins : undefined,
    excludeBase: excludeHbsBase,
  });

  const pool: CarouselTemplatePoolEntry[] = [];
  for (const base of hbsBases) {
    const pool_id = normalizePoolId(base);
    if (exclude && pool_id === exclude) continue;
    pool.push({ kind: "hbs", pool_id, hbs_base: base });
  }

  if (opts?.includeComposite !== false) {
    const composites = await listActiveCarouselCompositeTemplates(db, projectId);
    for (const composite of composites) {
      const pool_id = normalizePoolId(compositeTemplatePinName(composite.template_key));
      if (exclude && pool_id === exclude) continue;
      pool.push({ kind: "composite", pool_id, composite });
    }
  }

  return pool;
}

export function pickFromCarouselTemplatePool(
  pool: CarouselTemplatePoolEntry[],
  seed: string
): CarouselTemplatePoolEntry | null {
  if (pool.length === 0) return null;
  const idx = stablePoolIndexFromSeed(pool.length, seed);
  return pool[idx] ?? null;
}

/**
 * Choose HBS vs composite for carousel render.
 * - Explicit payload template wins.
 * - Mimic template_bg prefers composite for its insights_id (build if missing — caller handles).
 * - Otherwise: unified pool of all project composites + HBS candidates (stable pick per task_id).
 */
export async function pickCarouselRenderPlan(
  db: Pool,
  projectId: string,
  rendererBaseUrl: string,
  generationPayload: Record<string, unknown>,
  opts?: {
    projectPinnedTemplates?: string[];
    implicitPickSeed?: string | null;
    compositeEnabled?: boolean;
    mimicPayload?: MimicPayloadV1 | null;
    isMimicCarousel?: boolean;
  }
): Promise<CarouselRenderPlan | null> {
  const render = generationPayload.render as Record<string, unknown> | undefined;
  const explicitCompositeKey =
    typeof render?.composite_template_key === "string" ? render.composite_template_key.trim() : "";
  const explicitBase = explicitCarouselTemplateBaseName(generationPayload);

  if (explicitCompositeKey) {
    const row = await getCarouselCompositeTemplateByKey(db, projectId, normalizeTemplateKey(explicitCompositeKey));
    if (row) return planFromComposite(row);
  }

  if (explicitBase && isCompositeTemplateKey(explicitBase)) {
    const row = await getCarouselCompositeTemplateByKey(
      db,
      projectId,
      normalizeTemplateKey(explicitBase)
    );
    if (row) return planFromComposite(row);
  }

  if (explicitBase && !isCompositeTemplateKey(explicitBase)) {
    return planFromHbs(explicitBase);
  }

  const mimic = opts?.mimicPayload;
  const isMimic = opts?.isMimicCarousel === true;
  if (isMimic && mimic && mimicCarouselPrefersComposite(mimic) && opts?.compositeEnabled !== false) {
    if (mimic.source_insights_id?.trim()) {
      const byInsights = await getCarouselCompositeTemplateByInsightsId(
        db,
        projectId,
        mimic.source_insights_id
      );
      if (byInsights) return planFromComposite(byInsights);
    }
    return null;
  }

  if (opts?.compositeEnabled === false) {
    const excludeRaw = generationPayload[CAROUSEL_TEMPLATE_EXCLUDE_FOR_NEXT_RENDER_KEY];
    const hbs = await listHbsCarouselTemplateCandidates(rendererBaseUrl, {
      allowedTemplates: opts.projectPinnedTemplates?.filter((p) => !isCompositeTemplateKey(p)),
      excludeBase:
        typeof excludeRaw === "string" && excludeRaw.trim() ? excludeRaw.trim() : undefined,
    });
    const seed = opts?.implicitPickSeed?.trim() || "default";
    const idx = stablePoolIndexFromSeed(hbs.length, seed);
    return planFromHbs(hbs[idx] ?? "default");
  }

  const excludeRaw = generationPayload[CAROUSEL_TEMPLATE_EXCLUDE_FOR_NEXT_RENDER_KEY];
  const excludePoolId =
    typeof excludeRaw === "string" && excludeRaw.trim() ? normalizePoolId(excludeRaw) : undefined;

  const pool = await buildCarouselTemplatePool(db, projectId, rendererBaseUrl, {
    projectPinnedTemplates: opts?.projectPinnedTemplates,
    excludePoolId,
    includeComposite: true,
  });

  const seed = opts?.implicitPickSeed?.trim() || "default";
  const picked = pickFromCarouselTemplatePool(pool, seed);
  if (!picked) {
    return planFromHbs("default");
  }
  if (picked.kind === "composite") return planFromComposite(picked.composite);
  return planFromHbs(picked.hbs_base);
}
