import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import { resolveTemplateStorageFromMimic } from "../domain/mimic-template-library.js";
import { addProjectCarouselTemplate } from "../repositories/project-config.js";
import {
  injectMimicBackgroundPlateSupport,
  pickMimicLayoutBaseTemplate,
  MIMIC_FULL_BLEED_RENDER_TEMPLATE,
} from "./mimic-carousel-template-layout.js";
import { inferMimicCarouselTheme } from "./mimic-slide-typography.js";

/** Persisted on `generation_payload` — links render template to top-performer evidence. */
export const MIMIC_EVIDENCE_TEMPLATE_PAYLOAD_KEY = "mimic_evidence_template";

export interface MimicEvidenceTemplateRecord {
  template_base: string;
  template_file_name: string;
  /** Built-in or project `.hbs` forked before palette/bg injection (template_bg only). */
  layout_base_template: string;
  source_insights_id: string;
  source_evidence_row_id: string | null;
  task_id: string;
  path_written: string;
  created_at: string;
  reused_existing: boolean;
  template_storage_quality: string;
  template_storage_reason: string;
  pinned_to_project: boolean;
}

const TEMPLATE_BASE_RE = /^[a-zA-Z0-9_-]{3,48}$/;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/**
 * Traceable template base: `mimic_e{evidence_row_id}_{insights_id_slug}`.
 * Same evidence always resolves to the same template file (idempotent re-render).
 */
export function mimicEvidenceTemplateBaseName(mimic: Pick<MimicPayloadV1, "source_insights_id" | "source_evidence_row_id">): string {
  const rowRaw = String(mimic.source_evidence_row_id ?? "").trim();
  const insRaw = String(mimic.source_insights_id ?? "").trim();
  const rowPart = rowRaw ? `e${rowRaw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}` : "";
  const insSlug = insRaw.replace(/[^a-zA-Z0-9_-]/g, "").slice(-24) || "ref";
  const joined = rowPart ? `mimic_${rowPart}_${insSlug}` : `mimic_${insSlug}`;
  const safe = joined.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  if (TEMPLATE_BASE_RE.test(safe)) return safe;
  const fallback = `mimic_${insSlug}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  return TEMPLATE_BASE_RE.test(fallback) ? fallback : "mimic_top_performer_ref";
}

export function pickMimicEvidenceTemplateTheme(
  visualGuideline: Record<string, unknown> | undefined
): { paper: string; ink: string; body: string; text_shadow_headline: string; text_shadow_body: string } {
  return inferMimicCarouselTheme(visualGuideline);
}

async function templateFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function injectRootTheme(
  source: string,
  theme: {
    paper: string;
    ink: string;
    body: string;
    text_shadow_headline: string;
    text_shadow_body: string;
  }
): string {
  const inject = `
    /* mimic_evidence_template — palette from top-performer analysis */
    :root{
      --paper: ${theme.paper};
      --ink: ${theme.ink};
      --body: ${theme.body};
      --text-shadow-headline: ${theme.text_shadow_headline};
      --text-shadow-body: ${theme.text_shadow_body};
    }
`;
  if (source.includes(":root{")) {
    return source.replace(/:root\s*\{[^}]*\}/m, inject.trim());
  }
  return source.replace("</style>", `${inject}</style>`);
}

/**
 * Writes an evidence-specific `.hbs` fork for **template_bg** mimic only.
 * Full-bleed (`carousel_visual`) uses shared `carousel_mimic_bg.hbs` + runtime Document AI positioning.
 */
export async function ensureMimicEvidenceCarouselTemplate(
  db: Pool,
  config: AppConfig,
  projectId: string,
  job: { id: string; task_id: string },
  mimic: MimicPayloadV1,
  opts?: { projectPinnedTemplates?: string[] }
): Promise<MimicEvidenceTemplateRecord> {
  if (mimic.mode !== "template_bg") {
    throw new Error(
      `ensureMimicEvidenceCarouselTemplate is template_bg only (got ${mimic.mode}); full-bleed uses ${MIMIC_FULL_BLEED_RENDER_TEMPLATE}.`
    );
  }
  const templateBase = mimicEvidenceTemplateBaseName(mimic);
  const templateFileName = `${templateBase}.hbs`;
  const tplDir = config.CAROUSEL_TEMPLATES_DIR;
  const outPath = path.join(tplDir, templateFileName);
  const reusedExisting = await templateFileExists(outPath);
  const storage = resolveTemplateStorageFromMimic(mimic);
  const pinned_to_project = storage.pin_project_template;

  const theme = pickMimicEvidenceTemplateTheme(mimic.visual_guideline);
  const layoutBaseTemplate = pickMimicLayoutBaseTemplate(mimic, opts?.projectPinnedTemplates ?? []);

  const refreshSource = async (): Promise<string> => {
    const readBase = async (base: string): Promise<string> => {
      const basePath = path.join(tplDir, `${base}.hbs`);
      return readFile(basePath, "utf8");
    };
    let source: string;
    try {
      source = await readBase(layoutBaseTemplate);
    } catch {
      source = await readBase("carousel_mimic_bg");
    }
    source = injectMimicBackgroundPlateSupport(source);
    source = injectRootTheme(source, theme);
    return source;
  };

  if (!reusedExisting) {
    let source = await refreshSource();
    const traceComment = [
      "<!--",
      "  mimic_evidence_template",
      `  layout_base_template=${layoutBaseTemplate}`,
      `  source_insights_id=${mimic.source_insights_id}`,
      `  source_evidence_row_id=${mimic.source_evidence_row_id ?? ""}`,
      `  analysis_tier=${mimic.analysis_tier}`,
      `  seeded_by_task_id=${job.task_id}`,
      "-->",
    ].join("\n");
    source = source.replace("<!DOCTYPE html>", `<!DOCTYPE html>\n${traceComment}`);
    await writeFile(outPath, source, "utf8");
  } else {
    const source = await refreshSource();
    await writeFile(outPath, source, "utf8");
  }

  if (pinned_to_project) {
    await addProjectCarouselTemplate(db, projectId, templateFileName);
  }

  const record: MimicEvidenceTemplateRecord = {
    template_base: templateBase,
    template_file_name: templateFileName,
    layout_base_template: layoutBaseTemplate,
    source_insights_id: mimic.source_insights_id,
    source_evidence_row_id: mimic.source_evidence_row_id ?? null,
    task_id: job.task_id,
    path_written: outPath,
    created_at: new Date().toISOString(),
    reused_existing: reusedExisting,
    template_storage_quality: storage.quality,
    template_storage_reason: storage.reason,
    pinned_to_project,
  };

  await db.query(
    `UPDATE caf_core.content_jobs
     SET generation_payload = jsonb_set(
           COALESCE(generation_payload, '{}'::jsonb),
           '{mimic_evidence_template}',
           $1::jsonb,
           true
         ),
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(record), job.id]
  );

  return record;
}
