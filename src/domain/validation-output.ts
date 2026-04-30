import { z } from "zod";
import { isCarouselFlow, isVideoFlow } from "../decision_engine/flow-kind.js";
import { slidesJsonForReviewUi } from "../services/review-ui-slides.js";
import { pickGeneratedOutputOrEmpty, type GenerationPayloadLike } from "./generation-payload-output.js";

const decisionSchema = z.enum(["APPROVED", "NEEDS_EDIT", "REJECTED"]);
export type ValidationDecision = z.infer<typeof decisionSchema>;

const contentKindSchema = z.enum(["carousel", "video", "image", "unknown"]);
export type ValidationContentKind = z.infer<typeof contentKindSchema>;

const issueTagSchema = z.string().min(1);

/**
 * Location references are intentionally lightweight so we can keep them stable across
 * formats while still allowing per-format UI affordances (slide index, scene index, etc.).
 */
export const validationLocationSchema = z.object({
  area: z.string().min(1),
  slide_index: z.number().int().nonnegative().optional(),
  scene_index: z.number().int().nonnegative().optional(),
  timecode: z.string().min(1).optional(),
});
export type ValidationLocation = z.infer<typeof validationLocationSchema>;

export const validationFindingSchema = z.object({
  code: z.string().min(1).optional(),
  label: z.string().min(1),
  severity: z.enum(["info", "warn", "error"]).default("warn"),
  location: validationLocationSchema.optional(),
  message: z.string().min(1),
  suggestion: z.string().min(1).optional(),
  example_fix: z.string().min(1).optional(),
});
export type ValidationFinding = z.infer<typeof validationFindingSchema>;

export const reviewedCarouselSlideSchema = z.object({
  index: z.number().int().nonnegative(),
  headline: z.string().optional(),
  body: z.string().optional(),
  handle: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});
export type ReviewedCarouselSlide = z.infer<typeof reviewedCarouselSlideSchema>;

export const reviewedContentSchema = z.object({
  title: z.string().optional(),
  hook: z.string().optional(),
  caption: z.string().optional(),
  hashtags: z.string().optional(),
  /** Carousel-only: normalized slide list (not a JSON string). */
  slides: z.array(reviewedCarouselSlideSchema).optional(),
  /** Video-only: reviewer-edited VO / script. */
  spoken_script: z.string().optional(),
});
export type ReviewedContent = z.infer<typeof reviewedContentSchema>;

export const reworkHintsSchema = z.object({
  /**
   * Core routing boolean:
   * - true  => downstream should regenerate assets (renderers / HeyGen) when applicable
   * - false => bypass render/provider calls and reuse existing assets (copy-only changes)
   */
  regenerate: z.boolean().optional(),
  rewrite_copy: z.boolean().optional(),
  skip_video_regeneration: z.boolean().optional(),
  skip_image_regeneration: z.boolean().optional(),
  heygen_avatar_id: z.string().optional(),
  heygen_voice_id: z.string().optional(),
  heygen_force_rerender: z.boolean().optional(),
});
export type ReworkHints = z.infer<typeof reworkHintsSchema>;

export const validationOutputV1Schema = z.object({
  schema_version: z.literal("v1"),
  submitted_at: z.string().min(1),
  decision: decisionSchema,
  validator: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  issue_tags: z.array(issueTagSchema).default([]),
  content_kind: contentKindSchema,
  reviewed_content: reviewedContentSchema,
  rework_hints: reworkHintsSchema.default({}),
  findings: z.array(validationFindingSchema).default([]),
  /** Free-form extension space for new UI panels without breaking older readers. */
  metadata: z.record(z.unknown()).default({}),
});
export type ValidationOutputV1 = z.infer<typeof validationOutputV1Schema>;

export type ValidationOutput = ValidationOutputV1;

function inferContentKind(flowType: string | null | undefined): ValidationContentKind {
  const ft = String(flowType ?? "").trim();
  if (!ft) return "unknown";
  // Image flows are narrow in Core today; keep heuristic explicit.
  if (/^FLOW_IMG_/i.test(ft)) return "image";
  if (isVideoFlow(ft)) return "video";
  if (isCarouselFlow(ft)) return "carousel";
  return "unknown";
}

function safeParseSlides(slidesJson: string | null | undefined): ReviewedCarouselSlide[] | undefined {
  const raw = (slidesJson ?? "").trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const out: ReviewedCarouselSlide[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const it = parsed[i] as unknown;
      if (!it || typeof it !== "object" || Array.isArray(it)) continue;
      const rec = it as Record<string, unknown>;
      const idx =
        typeof rec.index === "number" && Number.isInteger(rec.index) && rec.index >= 0
          ? rec.index
          : i;
      out.push({
        index: idx,
        headline: typeof rec.headline === "string" ? rec.headline : undefined,
        body: typeof rec.body === "string" ? rec.body : undefined,
        handle: typeof rec.handle === "string" ? rec.handle : undefined,
        meta: undefined,
      });
    }
    return out.length ? out : undefined;
  } catch {
    return undefined;
  }
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function inferRegenerateFromOverrides(
  flowType: string | null | undefined,
  overrides: Record<string, unknown>
): boolean {
  // Explicit override wins.
  if (typeof overrides.regenerate === "boolean") return overrides.regenerate;

  // Skip flags mean "do not call render/provider" for that lane.
  if (overrides.skip_video_regeneration === true) return false;
  if (overrides.skip_image_regeneration === true) return false;

  // Carousel: slide edits imply re-render; caption/hashtags-only can reuse assets.
  if (typeof overrides.final_slides_json_override === "string" && overrides.final_slides_json_override.trim()) {
    return true;
  }

  // Video/HeyGen: script/provider id edits usually imply re-render.
  if (
    typeof overrides.final_spoken_script_override === "string" && overrides.final_spoken_script_override.trim()
  ) {
    return true;
  }
  if (typeof overrides.heygen_force_rerender === "boolean" && overrides.heygen_force_rerender === true) {
    return true;
  }
  if (typeof overrides.heygen_avatar_id === "string" && overrides.heygen_avatar_id.trim()) return true;
  if (typeof overrides.heygen_voice_id === "string" && overrides.heygen_voice_id.trim()) return true;

  // Default: copy-only changes (caption/hashtags/hook/title) do not require re-render.
  // We keep this default even for unknown flows; consumers can tighten later per flow_type.
  void flowType;
  return false;
}

/**
 * Build the stored validation output contract from the decision body + current job payload.
 * This intentionally:
 * - uses reviewer overrides when present (edited content),
 * - otherwise falls back to the job's latest generated output,
 * - keeps findings empty until the UI captures per-location diagnoses.
 */
export function buildValidationOutputV1(input: {
  submittedAtIso: string;
  decision: ValidationDecision;
  validator?: string | null;
  notes?: string | null;
  rejection_tags?: unknown[] | null;
  overrides_json?: Record<string, unknown> | null;
  flow_type?: string | null;
  generation_payload?: GenerationPayloadLike;
}): ValidationOutputV1 {
  const overrides = input.overrides_json ?? {};
  const gp = (input.generation_payload ?? undefined) as GenerationPayloadLike;
  const gen = pickGeneratedOutputOrEmpty(gp);

  const content_kind = inferContentKind(input.flow_type);
  const regenerate = inferRegenerateFromOverrides(input.flow_type, overrides);

  const reviewed_title =
    pickString(overrides, "final_title_override") ??
    pickString(gen, "title", "headline") ??
    pickString((gp && typeof gp === "object" ? (gp as Record<string, unknown>) : {}), "title");
  const reviewed_hook =
    pickString(overrides, "final_hook_override") ??
    pickString(gen, "hook", "hook_line", "opening_line") ??
    pickString((gp && typeof gp === "object" ? (gp as Record<string, unknown>) : {}), "hook");
  const reviewed_caption =
    pickString(overrides, "final_caption_override") ??
    pickString(gen, "caption", "post_caption") ??
    pickString((gp && typeof gp === "object" ? (gp as Record<string, unknown>) : {}), "caption");
  const reviewed_hashtags =
    pickString(overrides, "final_hashtags_override") ??
    pickString(gen, "hashtags") ??
    pickString((gp && typeof gp === "object" ? (gp as Record<string, unknown>) : {}), "hashtags");

  const slidesJson =
    pickString(overrides, "final_slides_json_override") ??
    slidesJsonForReviewUi(input.flow_type ?? null, (gp ?? null) as Record<string, unknown> | null);
  const slides = content_kind === "carousel" ? safeParseSlides(slidesJson) : undefined;

  const spoken_script =
    pickString(overrides, "final_spoken_script_override") ??
    pickString(gen, "spoken_script", "script", "voiceover_script");

  const issue_tags = Array.isArray(input.rejection_tags)
    ? input.rejection_tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  const rework_hints: ReworkHints = {
    regenerate,
    rewrite_copy: typeof overrides.rewrite_copy === "boolean" ? overrides.rewrite_copy : undefined,
    skip_video_regeneration:
      typeof overrides.skip_video_regeneration === "boolean" ? overrides.skip_video_regeneration : undefined,
    skip_image_regeneration:
      typeof overrides.skip_image_regeneration === "boolean" ? overrides.skip_image_regeneration : undefined,
    heygen_avatar_id: pickString(overrides, "heygen_avatar_id"),
    heygen_voice_id: pickString(overrides, "heygen_voice_id"),
    heygen_force_rerender:
      typeof overrides.heygen_force_rerender === "boolean" ? overrides.heygen_force_rerender : undefined,
  };

  const out: ValidationOutputV1 = {
    schema_version: "v1",
    submitted_at: input.submittedAtIso,
    decision: input.decision,
    validator: input.validator ?? null,
    notes: input.notes ?? null,
    issue_tags,
    content_kind,
    reviewed_content: {
      ...(reviewed_title ? { title: reviewed_title } : {}),
      ...(reviewed_hook ? { hook: reviewed_hook } : {}),
      ...(reviewed_caption ? { caption: reviewed_caption } : {}),
      ...(reviewed_hashtags ? { hashtags: reviewed_hashtags } : {}),
      ...(slides ? { slides } : {}),
      ...(spoken_script ? { spoken_script } : {}),
    },
    rework_hints,
    findings: [],
    metadata: {},
  };

  // Assert shape (defensive: never write invalid JSON contract).
  const parsed = validationOutputV1Schema.safeParse(out);
  if (!parsed.success) {
    return {
      schema_version: "v1",
      submitted_at: input.submittedAtIso,
      decision: input.decision,
      validator: input.validator ?? null,
      notes: input.notes ?? null,
      issue_tags,
      content_kind,
      reviewed_content: {},
      rework_hints,
      findings: [
        {
          label: "validation_output_build_failed",
          severity: "warn",
          message: "Failed to build structured validation output; stored minimal fallback.",
        },
      ],
      metadata: { error: parsed.error.flatten() },
    };
  }

  return parsed.data;
}

