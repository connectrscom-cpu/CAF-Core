import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  DEFAULT_CAROUSEL_COMPOSITE_LAYOUT,
  slideRoleForIndex,
} from "../domain/carousel-composite-layout.js";
import type {
  CarouselCompositeBackgroundPlate,
  CarouselCompositeBackgroundPlates,
  CarouselCompositeTemplateRecord,
} from "../domain/carousel-composite-template.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import { upsertCarouselCompositeTemplate } from "../repositories/carousel-composite-templates.js";
import { addProjectCarouselTemplate } from "../repositories/project-config.js";
import { pickMimicEvidenceTemplateTheme } from "./mimic-evidence-carousel-template.js";
import { extractMimicSlideBackground } from "./mimic-carousel-render.js";
import { compositeTemplatePinName } from "../domain/carousel-composite-template.js";
import { logPipelineEvent } from "./pipeline-logger.js";

function safeTemplateKeyFromInsights(insightsId: string, evidenceRowId: string | null | undefined): string {
  const ins = insightsId.replace(/[^a-zA-Z0-9_-]/g, "").slice(-24) || "ref";
  const row = evidenceRowId ? `e${evidenceRowId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}` : "";
  const joined = row ? `mimic_${row}_${ins}` : `mimic_${ins}`;
  return joined.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

function referenceIndexForRole(
  mimic: MimicPayloadV1,
  role: "cover" | "body" | "cta",
  refCount: number
): number {
  if (refCount <= 1) return 1;
  if (role === "cover") return 1;
  if (role === "cta") return refCount;
  return Math.min(2, refCount);
}

async function extractPlateForReferenceIndex(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; run_id: string },
  mimic: MimicPayloadV1,
  refIndex: number
): Promise<CarouselCompositeBackgroundPlate | null> {
  const url = await extractMimicSlideBackground(db, config, job, mimic, refIndex);
  if (!url) return null;
  return { public_url: url, object_path: url, bucket: config.SUPABASE_ASSETS_BUCKET };
}

/**
 * Build or refresh a reusable composite template from a top-performer mimic reference.
 * Background plates are extracted once per insights_id and stored for later listicle jobs.
 */
export async function ensureMimicCarouselCompositeTemplate(
  db: Pool,
  config: AppConfig,
  projectId: string,
  job: { id: string; task_id: string; project_id: string; run_id: string },
  mimic: MimicPayloadV1
): Promise<CarouselCompositeTemplateRecord> {
  const insightsId = mimic.source_insights_id?.trim();
  if (!insightsId) throw new Error("mimic composite template requires source_insights_id");

  const templateKey = safeTemplateKeyFromInsights(insightsId, mimic.source_evidence_row_id);
  const refCount = Math.max(mimic.reference_items.length, 1);
  const theme = pickMimicEvidenceTemplateTheme(mimic.visual_guideline);

  const roles: Array<"cover" | "body" | "cta"> = ["cover", "body", "cta"];
  const background_plates: CarouselCompositeBackgroundPlates = {};

  for (const role of roles) {
    const refIdx = referenceIndexForRole(mimic, role, refCount);
    const plate = await extractPlateForReferenceIndex(db, config, job, mimic, refIdx);
    if (plate) background_plates[role] = plate;
  }

  if (!background_plates.cover && !background_plates.body) {
    throw new Error("mimic composite template: no background plates extracted from reference");
  }

  const record = await upsertCarouselCompositeTemplate(db, {
    project_id: projectId,
    template_key: templateKey,
    display_name: `Mimic composite · ${insightsId}`,
    background_plates,
    theme,
    layout: DEFAULT_CAROUSEL_COMPOSITE_LAYOUT,
    source_insights_id: insightsId,
    source_evidence_row_id: mimic.source_evidence_row_id ?? null,
    metadata_json: {
      built_from_task_id: job.task_id,
      mimic_mode: mimic.mode,
      reference_count: refCount,
    },
  });

  await addProjectCarouselTemplate(db, projectId, compositeTemplatePinName(templateKey));

  logPipelineEvent("info", "render", "mimic composite template stored", {
    run_id: job.run_id,
    task_id: job.task_id,
    data: {
      template_key: templateKey,
      insights_id: insightsId,
      roles: Object.keys(background_plates),
    },
  });

  return record;
}

export { slideRoleForIndex };
