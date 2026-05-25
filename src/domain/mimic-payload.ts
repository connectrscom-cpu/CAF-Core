/**
 * Reference-mimic metadata on `content_jobs.generation_payload.mimic_v1`.
 * Written during Generate (draft phase); consumed during Render.
 */

export type MimicMode = "image_full" | "template_bg" | "carousel_visual";

export type MimicSlideRenderMode = "hbs" | "full_bleed";

export interface MimicReferenceItem {
  index: number;
  role: string;
  vision_fetch_url: string;
  preview_url?: string | null;
  /** Supabase object key — re-signed at render when signed URLs expire. */
  bucket?: string | null;
  object_path?: string | null;
}

export interface MimicSlidePlan {
  slide_index: number;
  render_mode: MimicSlideRenderMode;
  reference_index: number;
}

export interface MimicPayloadV1 {
  schema_version: 1;
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
    reference_items.push({
      index: Number(o.index ?? reference_items.length + 1) || reference_items.length + 1,
      role: String(o.role ?? "reference"),
      vision_fetch_url: url,
      preview_url: typeof o.preview_url === "string" ? o.preview_url : null,
      bucket: typeof o.bucket === "string" && o.bucket.trim() ? o.bucket.trim() : null,
      object_path:
        typeof o.object_path === "string" && o.object_path.trim() ? o.object_path.trim() : null,
    });
  }
  if (reference_items.length === 0) return null;
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

  return {
    schema_version: 1,
    mode,
    mode_override,
    classified_at: String(rec.classified_at ?? ""),
    source_insights_id: String(rec.source_insights_id ?? ""),
    source_evidence_row_id:
      rec.source_evidence_row_id != null ? String(rec.source_evidence_row_id) : null,
    analysis_tier: String(rec.analysis_tier ?? ""),
    reference_tier_fallback: rec.reference_tier_fallback === true,
    reference_items,
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
  };
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
  return { ...payload, [MIMIC_PAYLOAD_KEY]: mimic };
}
