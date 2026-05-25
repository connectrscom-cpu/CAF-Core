import {
  mergeCarouselCompositeLayout,
  mergeCarouselCompositeTheme,
  type CarouselCompositeLayoutSpec,
  type CarouselCompositeSlideRole,
  type CarouselCompositeTheme,
} from "./carousel-composite-layout.js";

export interface CarouselCompositeBackgroundPlate {
  bucket?: string | null;
  object_path?: string | null;
  public_url?: string | null;
  mime_type?: string | null;
}

export type CarouselCompositeBackgroundPlates = Partial<
  Record<CarouselCompositeSlideRole, CarouselCompositeBackgroundPlate>
>;

export interface CarouselCompositeTemplateRecord {
  id: string;
  project_id: string | null;
  template_key: string;
  display_name: string | null;
  canvas_width: number;
  canvas_height: number;
  background_plates: CarouselCompositeBackgroundPlates;
  theme: CarouselCompositeTheme;
  layout: CarouselCompositeLayoutSpec;
  source_insights_id: string | null;
  source_evidence_row_id: string | null;
  metadata_json: Record<string, unknown>;
  active: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function parsePlate(raw: unknown): CarouselCompositeBackgroundPlate | null {
  const o = asRecord(raw);
  if (!o) return null;
  const public_url = typeof o.public_url === "string" ? o.public_url.trim() : "";
  const object_path = typeof o.object_path === "string" ? o.object_path.trim() : "";
  if (!public_url && !object_path) return null;
  return {
    bucket: typeof o.bucket === "string" ? o.bucket.trim() : null,
    object_path: object_path || null,
    public_url: public_url || null,
    mime_type: typeof o.mime_type === "string" ? o.mime_type.trim() : null,
  };
}

export function parseCarouselCompositeTemplateRow(row: {
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
}): CarouselCompositeTemplateRecord {
  const platesRaw = asRecord(row.background_plates_json) ?? {};
  const background_plates: CarouselCompositeBackgroundPlates = {};
  for (const role of ["cover", "body", "cta"] as const) {
    const p = parsePlate(platesRaw[role]);
    if (p) background_plates[role] = p;
  }
  return {
    id: row.id,
    project_id: row.project_id,
    template_key: row.template_key,
    display_name: row.display_name,
    canvas_width: row.canvas_width,
    canvas_height: row.canvas_height,
    background_plates,
    theme: mergeCarouselCompositeTheme(asRecord(row.theme_json)),
    layout: mergeCarouselCompositeLayout(asRecord(row.layout_json)),
    source_insights_id: row.source_insights_id,
    source_evidence_row_id: row.source_evidence_row_id,
    metadata_json: asRecord(row.metadata_json) ?? {},
    active: row.active,
  };
}

export function compositeTemplatePinName(templateKey: string): string {
  return `composite:${templateKey}`;
}
