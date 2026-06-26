/**
 * Reference-mimic metadata on `content_jobs.generation_payload.mimic_v1`.
 * Written during Generate (draft phase); consumed during Render.
 */

export type MimicMode = "image_full" | "template_bg" | "carousel_visual";

export type MimicSlideRenderMode = "hbs" | "full_bleed";

export type MimicImageInputMode = "reference_edit" | "analysis_t2i";

export interface MimicFluxImagePromptRow {
  slide_index: number;
  source_slide_index?: number | null;
  flux_image_prompt: string;
  image_input_mode: MimicImageInputMode;
  safe_zone_hint?: string | null;
  generated_at?: string | null;
}

export type MimicFluxImagePromptsBySlide = Record<string, MimicFluxImagePromptRow>;

export interface MimicReferenceItem {
  index: number;
  role: string;
  vision_fetch_url: string;
  preview_url?: string | null;
  /** Supabase object key — re-signed at render when signed URLs expire. */
  bucket?: string | null;
  object_path?: string | null;
  /** 1-based index in the source Instagram carousel (may differ from `index` when videos were omitted). */
  source_slide_index?: number | null;
  /** Archived frame was a video clip (should never be mimicked). */
  is_video_slide?: boolean;
  content_type?: string | null;
  source_url?: string | null;
}

export interface MimicSlidePlan {
  slide_index: number;
  render_mode: MimicSlideRenderMode;
  reference_index: number;
  /** 1-based index in the source Instagram deck (stable across promo/video drops). */
  source_slide_index?: number | null;
}

export type MimicExecutionMode = "classic" | "why_mimic";

export interface MimicPayloadV1 {
  schema_version: 1;
  /**
   * `why_mimic` — strategic copy + SIL-grounded image prompts (FLOW_WHY_MIMIC_CAROUSEL).
   * Omitted or `classic` — fidelity mimic (rephrase reference + aesthetic-driven visuals).
   */
  execution_mode?: MimicExecutionMode;
  mode: MimicMode;
  /** Manual override set by a reviewer — takes precedence over the automatic classifier. */
  mode_override?: MimicMode | null;
  classified_at: string;
  source_insights_id: string;
  source_evidence_row_id?: string | null;
  analysis_tier: string;
  /** True when carousel/image tier was used as fallback for missing deep tier. */
  reference_tier_fallback?: boolean;
  reference_items: MimicReferenceItem[];
  /** Full archived inspection frames before promo filtering — used to expand back to deck length at render. */
  archive_reference_items?: MimicReferenceItem[];
  /** Supabase folder for archived inspection media (when present on guideline entry). */
  storage_folder_prefix?: string | null;
  storage_folder_label?: string | null;
  /** Slim upstream vision analysis — pattern, blueprint, deck system (no signed URLs). */
  visual_guideline?: Record<string, unknown>;
  twist_brief: { visual_only: true; legal_note: string };
  slide_plans?: MimicSlidePlan[];
  background_image_url?: string | null;
  render?: {
    started_at?: string;
    finished_at?: string;
    qc?: Record<string, unknown>;
  };
  /** Reviewer layout editor — preserved across pick/merge; consumed at render via raw mimic_v1. */
  docai_layer_positions?: Record<string, unknown>;
  /** Per-slide Flux text-to-image prompts (analysis_t2i mode). Keyed by output slide index string. */
  flux_image_prompts?: MimicFluxImagePromptsBySlide;
  /**
   * Why Mimic — projected `slide_intelligence_v1` bundle for this reference
   * (per-slide role/mechanism/why + deck `why_analysis`). Read-only intelligence
   * consumed by generation, Review, and Brand Translation; never gates render.
   * See `src/domain/slide-intelligence.ts`.
   */
  slide_intelligence?: Record<string, unknown>;
  /**
   * Brand-Aware Why Mimic — projected `brand_execution_brief_v1`: the reference's
   * intent remapped onto this project's active brand profile (symbol_map, palette,
   * tone) with the strategic thesis held constant. Present only when the project
   * has an active brand profile. Read-only; never gates render.
   * See `src/domain/brand-translation.ts`.
   */
  brand_execution_brief?: Record<string, unknown>;
}

export const MIMIC_PAYLOAD_KEY = "mimic_v1";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function pickMimicPayload(payload: unknown): MimicPayloadV1 | null {
  const gp = asRecord(payload);
  if (!gp) return null;
  const raw = gp[MIMIC_PAYLOAD_KEY];
  const rec = asRecord(raw);
  if (!rec || rec.schema_version !== 1) return null;
  const mode = rec.mode;
  if (mode !== "image_full" && mode !== "template_bg" && mode !== "carousel_visual") return null;
  const refs = Array.isArray(rec.reference_items) ? rec.reference_items : [];
  const reference_items: MimicReferenceItem[] = [];
  for (const r of refs) {
    const o = asRecord(r);
    if (!o) continue;
    const url = String(o.vision_fetch_url ?? "").trim();
    if (!url) continue;
    const sourceSlide =
      o.source_slide_index != null && Number.isFinite(Number(o.source_slide_index))
        ? Number(o.source_slide_index)
        : null;
    reference_items.push({
      index: Number(o.index ?? reference_items.length + 1) || reference_items.length + 1,
      role: String(o.role ?? "reference"),
      vision_fetch_url: url,
      preview_url: typeof o.preview_url === "string" ? o.preview_url : null,
      bucket: typeof o.bucket === "string" && o.bucket.trim() ? o.bucket.trim() : null,
      object_path:
        typeof o.object_path === "string" && o.object_path.trim() ? o.object_path.trim() : null,
      source_slide_index: sourceSlide != null && sourceSlide > 0 ? sourceSlide : null,
      is_video_slide: o.is_video_slide === true,
      content_type: typeof o.content_type === "string" ? o.content_type : null,
      source_url: typeof o.source_url === "string" ? o.source_url : null,
    });
  }
  if (reference_items.length === 0) return null;

  const parseRefList = (rawList: unknown): MimicReferenceItem[] => {
    if (!Array.isArray(rawList)) return [];
    const out: MimicReferenceItem[] = [];
    for (const r of rawList) {
      const o = asRecord(r);
      if (!o) continue;
      const url = String(o.vision_fetch_url ?? "").trim();
      if (!url) continue;
      const sourceSlide =
        o.source_slide_index != null && Number.isFinite(Number(o.source_slide_index))
          ? Number(o.source_slide_index)
          : null;
      out.push({
        index: Number(o.index ?? out.length + 1) || out.length + 1,
        role: String(o.role ?? "reference"),
        vision_fetch_url: url,
        preview_url: typeof o.preview_url === "string" ? o.preview_url : null,
        bucket: typeof o.bucket === "string" && o.bucket.trim() ? o.bucket.trim() : null,
        object_path:
          typeof o.object_path === "string" && o.object_path.trim() ? o.object_path.trim() : null,
        source_slide_index: sourceSlide != null && sourceSlide > 0 ? sourceSlide : null,
        is_video_slide: o.is_video_slide === true,
        content_type: typeof o.content_type === "string" ? o.content_type : null,
        source_url: typeof o.source_url === "string" ? o.source_url : null,
      });
    }
    return out;
  };

  const archive_reference_items = (() => {
    const parsed = parseRefList(rec.archive_reference_items);
    return parsed.length > 0 ? parsed : undefined;
  })();
  const slide_plans: MimicSlidePlan[] | undefined = Array.isArray(rec.slide_plans)
    ? rec.slide_plans
        .map((s) => {
          const o = asRecord(s);
          if (!o) return null;
          const rm = o.render_mode === "full_bleed" ? "full_bleed" : "hbs";
          return {
            slide_index: Number(o.slide_index) || 0,
            render_mode: rm as MimicSlideRenderMode,
            reference_index: Number(o.reference_index) || 1,
          };
        })
        .filter((x): x is MimicSlidePlan => x != null && x.slide_index > 0)
    : undefined;

  const mode_override =
    rec.mode_override === "image_full" || rec.mode_override === "template_bg" || rec.mode_override === "carousel_visual"
      ? rec.mode_override
      : null;

  const execution_mode =
    rec.execution_mode === "why_mimic" || rec.execution_mode === "classic"
      ? rec.execution_mode
      : undefined;

  return {
    schema_version: 1,
    ...(execution_mode ? { execution_mode } : {}),
    mode,
    mode_override,
    classified_at: String(rec.classified_at ?? ""),
    source_insights_id: String(rec.source_insights_id ?? ""),
    source_evidence_row_id:
      rec.source_evidence_row_id != null ? String(rec.source_evidence_row_id) : null,
    analysis_tier: String(rec.analysis_tier ?? ""),
    reference_tier_fallback: rec.reference_tier_fallback === true,
    reference_items,
    archive_reference_items,
    storage_folder_prefix:
      typeof rec.storage_folder_prefix === "string" && rec.storage_folder_prefix.trim()
        ? rec.storage_folder_prefix.trim()
        : null,
    storage_folder_label:
      typeof rec.storage_folder_label === "string" && rec.storage_folder_label.trim()
        ? rec.storage_folder_label.trim()
        : null,
    visual_guideline: asRecord(rec.visual_guideline) ?? undefined,
    twist_brief: {
      visual_only: true,
      legal_note:
        String(asRecord(rec.twist_brief)?.legal_note ?? "") ||
        "Recreate the visual pattern only; do not copy logos, faces, or copyrighted imagery verbatim.",
    },
    slide_plans: slide_plans?.length ? slide_plans : undefined,
    render: asRecord(rec.render) ?? undefined,
    ...(rec.docai_layer_positions != null
      ? { docai_layer_positions: rec.docai_layer_positions as Record<string, unknown> }
      : {}),
    ...(parseFluxImagePrompts(rec.flux_image_prompts)
      ? { flux_image_prompts: parseFluxImagePrompts(rec.flux_image_prompts)! }
      : {}),
    ...(asRecord(rec.slide_intelligence)
      ? { slide_intelligence: rec.slide_intelligence as Record<string, unknown> }
      : {}),
    ...(asRecord(rec.brand_execution_brief)
      ? { brand_execution_brief: rec.brand_execution_brief as Record<string, unknown> }
      : {}),
  };
}

function parseFluxImagePrompts(raw: unknown): MimicFluxImagePromptsBySlide | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const out: MimicFluxImagePromptsBySlide = {};
  for (const [key, rows] of Object.entries(rec)) {
    const row = asRecord(rows);
    if (!row) continue;
    const prompt = String(row.flux_image_prompt ?? "").trim();
    if (!prompt) continue;
    const slideIndex = Number(row.slide_index) || Number(key);
    if (!Number.isFinite(slideIndex) || slideIndex < 1) continue;
    const modeRaw = String(row.image_input_mode ?? "analysis_t2i").trim();
    const image_input_mode: MimicImageInputMode =
      modeRaw === "reference_edit" ? "reference_edit" : "analysis_t2i";
    out[String(slideIndex)] = {
      slide_index: slideIndex,
      source_slide_index:
        row.source_slide_index != null && Number.isFinite(Number(row.source_slide_index))
          ? Number(row.source_slide_index)
          : null,
      flux_image_prompt: prompt,
      image_input_mode,
      safe_zone_hint:
        typeof row.safe_zone_hint === "string" && row.safe_zone_hint.trim()
          ? row.safe_zone_hint.trim()
          : null,
      generated_at: typeof row.generated_at === "string" ? row.generated_at : null,
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function pickMimicFluxImagePromptForSlide(
  mimic: MimicPayloadV1 | null | undefined,
  slideIndex1Based: number
): MimicFluxImagePromptRow | null {
  const map = mimic?.flux_image_prompts;
  if (!map) return null;
  const direct = map[String(slideIndex1Based)];
  if (direct?.flux_image_prompt?.trim()) return direct;
  const plan = mimic?.slide_plans?.find((p) => p.slide_index === slideIndex1Based);
  const sourceIdx = plan?.source_slide_index;
  if (sourceIdx != null && sourceIdx > 0) {
    const fromSource = map[String(sourceIdx)];
    if (fromSource?.flux_image_prompt?.trim()) return fromSource;
  }
  return null;
}

export function hasMimicPayload(payload: unknown): boolean {
  return pickMimicPayload(payload) != null;
}

export function requireMimicPayloadForRender(payload: unknown): MimicPayloadV1 {
  const m = pickMimicPayload(payload);
  if (!m) {
    throw new Error(
      "mimic_v1 missing or invalid on generation_payload — re-run Generate Jobs after enabling top-performer archive"
    );
  }
  return m;
}

export function mergeMimicPayloadSlice(
  payload: Record<string, unknown>,
  mimic: MimicPayloadV1
): Record<string, unknown> {
  const existing = asRecord(payload[MIMIC_PAYLOAD_KEY]);
  const docai_layer_positions: Record<string, unknown> | undefined =
    existing?.docai_layer_positions != null
      ? (existing.docai_layer_positions as Record<string, unknown>)
      : mimic.docai_layer_positions;
  return {
    ...payload,
    [MIMIC_PAYLOAD_KEY]: {
      ...mimic,
      ...(docai_layer_positions != null ? { docai_layer_positions } : {}),
    },
  };
}
