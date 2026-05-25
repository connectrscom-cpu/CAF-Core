import type { Pool } from "pg";
import {
  parseCarouselCompositeTemplateRow,
  type CarouselCompositeBackgroundPlates,
  type CarouselCompositeTemplateRecord,
} from "../domain/carousel-composite-template.js";
import type { CarouselCompositeLayoutSpec, CarouselCompositeTheme } from "../domain/carousel-composite-layout.js";

type DbRow = {
  id: string;
  project_id: string | null;
  template_key: string;
  display_name: string | null;
  canvas_width: number;
  canvas_height: number;
  background_plates_json: unknown;
  theme_json: unknown;
  layout_json: unknown;
  source_insights_id: string | null;
  source_evidence_row_id: string | null;
  metadata_json: unknown;
  active: boolean;
};

const SELECT_COLS = `
  id, project_id, template_key, display_name, canvas_width, canvas_height,
  background_plates_json, theme_json, layout_json,
  source_insights_id, source_evidence_row_id, metadata_json, active
`;

function mapRow(r: DbRow): CarouselCompositeTemplateRecord {
  return parseCarouselCompositeTemplateRow(r);
}

export async function getCarouselCompositeTemplateByKey(
  db: Pool,
  projectId: string,
  templateKey: string
): Promise<CarouselCompositeTemplateRecord | null> {
  const key = templateKey.trim();
  if (!key) return null;
  const res = await db.query<DbRow>(
    `SELECT ${SELECT_COLS}
     FROM caf_core.carousel_composite_templates
     WHERE active = true
       AND template_key = $2
       AND project_id = $1
     LIMIT 1`,
    [projectId, key]
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

export async function getCarouselCompositeTemplateByInsightsId(
  db: Pool,
  projectId: string,
  insightsId: string
): Promise<CarouselCompositeTemplateRecord | null> {
  const id = insightsId.trim();
  if (!id) return null;
  const res = await db.query<DbRow>(
    `SELECT ${SELECT_COLS}
     FROM caf_core.carousel_composite_templates
     WHERE active = true
       AND source_insights_id = $2
       AND project_id = $1
     LIMIT 1`,
    [projectId, id]
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

export async function upsertCarouselCompositeTemplate(
  db: Pool,
  row: {
    project_id: string;
    template_key: string;
    display_name?: string | null;
    canvas_width?: number;
    canvas_height?: number;
    background_plates: CarouselCompositeBackgroundPlates;
    theme: CarouselCompositeTheme;
    layout: CarouselCompositeLayoutSpec;
    source_insights_id?: string | null;
    source_evidence_row_id?: string | null;
    metadata_json?: Record<string, unknown>;
  }
): Promise<CarouselCompositeTemplateRecord> {
  const res = await db.query<DbRow>(
    `INSERT INTO caf_core.carousel_composite_templates (
       project_id, template_key, display_name, canvas_width, canvas_height,
       background_plates_json, theme_json, layout_json,
       source_insights_id, source_evidence_row_id, metadata_json, active, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11::jsonb, true, now())
     ON CONFLICT (project_id, template_key)
     DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, carousel_composite_templates.display_name),
       canvas_width = EXCLUDED.canvas_width,
       canvas_height = EXCLUDED.canvas_height,
       background_plates_json = EXCLUDED.background_plates_json,
       theme_json = EXCLUDED.theme_json,
       layout_json = EXCLUDED.layout_json,
       source_insights_id = COALESCE(EXCLUDED.source_insights_id, carousel_composite_templates.source_insights_id),
       source_evidence_row_id = COALESCE(EXCLUDED.source_evidence_row_id, carousel_composite_templates.source_evidence_row_id),
       metadata_json = carousel_composite_templates.metadata_json || EXCLUDED.metadata_json,
       active = true,
       updated_at = now()
     RETURNING ${SELECT_COLS}`,
    [
      row.project_id,
      row.template_key,
      row.display_name ?? null,
      row.canvas_width ?? 1080,
      row.canvas_height ?? 1350,
      JSON.stringify(row.background_plates),
      JSON.stringify(row.theme),
      JSON.stringify(row.layout),
      row.source_insights_id ?? null,
      row.source_evidence_row_id ?? null,
      JSON.stringify(row.metadata_json ?? {}),
    ]
  );
  if (!res.rows[0]) throw new Error("upsert carousel composite template failed");
  return mapRow(res.rows[0]);
}

export async function listCarouselCompositeTemplateKeys(
  db: Pool,
  projectId: string
): Promise<string[]> {
  const res = await db.query<{ template_key: string }>(
    `SELECT template_key FROM caf_core.carousel_composite_templates
     WHERE active = true AND project_id = $1
     ORDER BY template_key ASC`,
    [projectId]
  );
  return res.rows.map((r) => r.template_key);
}

/** All active composite templates for a project — general carousel pool (no pin required). */
export async function listActiveCarouselCompositeTemplates(
  db: Pool,
  projectId: string
): Promise<CarouselCompositeTemplateRecord[]> {
  const res = await db.query<DbRow>(
    `SELECT ${SELECT_COLS}
     FROM caf_core.carousel_composite_templates
     WHERE active = true AND project_id = $1
     ORDER BY template_key ASC`,
    [projectId]
  );
  return res.rows.map(mapRow);
}
