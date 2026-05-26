import type { Pool } from "pg";
import {
  MIMIC_PROMPT_NAME_IMAGE_FULL,
  MIMIC_PROMPT_NAME_TEMPLATE_BG,
  MIMIC_PROMPT_NAME_CAROUSEL_SLIDE,
  MIMIC_PROMPT_NAME_TEMPLATE_BG_COMPOSE,
  type MimicPromptOverrides,
} from "./mimic-prompt-builder.js";

let _cachedOverrides: MimicPromptOverrides | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 60_000;

/**
 * Load Qwen prompt overrides from `prompt_labs_overrides` table.
 * Caches for 60s to avoid per-slide DB lookups during a render batch.
 */
export async function loadMimicPromptOverrides(db: Pool): Promise<MimicPromptOverrides | null> {
  const now = Date.now();
  if (_cachedOverrides && now - _cacheTs < CACHE_TTL_MS) return _cachedOverrides;

  const rows = await db.query<{ prompt_name: string; user_prompt_template: string | null }>(
    `SELECT prompt_name, user_prompt_template
     FROM caf_core.prompt_labs_overrides
     WHERE prompt_name = ANY($1)`,
    [[MIMIC_PROMPT_NAME_IMAGE_FULL, MIMIC_PROMPT_NAME_TEMPLATE_BG, MIMIC_PROMPT_NAME_CAROUSEL_SLIDE, MIMIC_PROMPT_NAME_TEMPLATE_BG_COMPOSE]]
  );

  if (rows.rows.length === 0) {
    _cachedOverrides = null;
    _cacheTs = now;
    return null;
  }

  const byName = new Map(rows.rows.map((r) => [r.prompt_name, r.user_prompt_template]));
  _cachedOverrides = {
    image_full: byName.get(MIMIC_PROMPT_NAME_IMAGE_FULL) || null,
    template_bg: byName.get(MIMIC_PROMPT_NAME_TEMPLATE_BG) || null,
    carousel_slide_visual: byName.get(MIMIC_PROMPT_NAME_CAROUSEL_SLIDE) || null,
    template_bg_compose: byName.get(MIMIC_PROMPT_NAME_TEMPLATE_BG_COMPOSE) || null,
  };
  _cacheTs = now;
  return _cachedOverrides;
}

/** Reset the in-memory override cache (for tests or hot-reload). */
export function clearMimicPromptOverrideCache(): void {
  _cachedOverrides = null;
  _cacheTs = 0;
}
