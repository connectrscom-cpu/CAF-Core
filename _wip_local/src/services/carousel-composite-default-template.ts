import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { DEFAULT_CAROUSEL_COMPOSITE_LAYOUT, DEFAULT_CAROUSEL_COMPOSITE_THEME } from "../domain/carousel-composite-layout.js";
import { compositeTemplatePinName } from "../domain/carousel-composite-template.js";
import {
  getCarouselCompositeTemplateByKey,
  upsertCarouselCompositeTemplate,
} from "../repositories/carousel-composite-templates.js";
import { addProjectCarouselTemplate } from "../repositories/project-config.js";

export const DEFAULT_LISTICLE_COMPOSITE_TEMPLATE_KEY = "listicle_stack_v1";

/**
 * Project-scoped listicle composite template with solid-color backgrounds (theme.paper).
 * Pin as `composite:listicle_stack_v1` on a project for non-mimic carousel jobs.
 */
export async function ensureDefaultListicleCompositeTemplate(
  db: Pool,
  projectId: string
): Promise<string> {
  const existing = await getCarouselCompositeTemplateByKey(db, projectId, DEFAULT_LISTICLE_COMPOSITE_TEMPLATE_KEY);
  if (existing) return existing.template_key;

  await upsertCarouselCompositeTemplate(db, {
    project_id: projectId,
    template_key: DEFAULT_LISTICLE_COMPOSITE_TEMPLATE_KEY,
    display_name: "Listicle stack (composite)",
    background_plates: {},
    theme: DEFAULT_CAROUSEL_COMPOSITE_THEME,
    layout: DEFAULT_CAROUSEL_COMPOSITE_LAYOUT,
    metadata_json: { kind: "default_listicle", solid_background: true },
  });
  await addProjectCarouselTemplate(db, projectId, compositeTemplatePinName(DEFAULT_LISTICLE_COMPOSITE_TEMPLATE_KEY));
  return DEFAULT_LISTICLE_COMPOSITE_TEMPLATE_KEY;
}
