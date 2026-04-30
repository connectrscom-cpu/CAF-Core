import { isCarouselFlow, isVideoFlow } from "../decision_engine/flow-kind.js";
import { slidesFromGeneratedOutput, slideHasRenderableContent } from "./carousel-render-pack.js";
import { extractExplicitVideoPromptText, extractSpokenScriptText, extractVideoPromptText } from "./video-gen-fields.js";

export type DraftPackageContractMode = "skip" | "warn" | "enforce";

export type DraftPackageType = "carousel_package" | "heygen_package";

export type DraftPackageValidation = {
  output: Record<string, unknown>;
  warnings: string[];
  errors: string[];
  /** Canonical package type (legacy `render_copy` is normalized to `carousel_package`). */
  package_type: DraftPackageType | null;
};

function normalizeHashtags(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val
      .map((x) => String(x ?? "").trim())
      .map((t) => t.replace(/^#+/, "").trim())
      .filter(Boolean)
      .map((t) => t.replace(/[^\p{L}\p{N}_]+/gu, "").toLowerCase())
      .filter(Boolean);
  }
  if (typeof val === "string") {
    // accept "a, b, c" or "#a #b" shapes
    const t = val.trim();
    if (!t) return [];
    const parts = t.includes(",") ? t.split(",") : t.split(/\s+/);
    return parts
      .map((x) => x.trim())
      .map((x) => x.replace(/^#+/, "").trim())
      .filter(Boolean)
      .map((x) => x.replace(/[^\p{L}\p{N}_]+/gu, "").toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function extractHashtagsFromCaptionText(caption: string): string[] {
  const re = /#[\w\u00c0-\u024f]+/gu;
  const matches = [...String(caption ?? "").matchAll(re)].map((m) =>
    String(m[0] ?? "")
      .trim()
      .replace(/^#+/, "")
      .replace(/[^\p{L}\p{N}_]+/gu, "")
      .toLowerCase()
  );
  return matches.filter(Boolean);
}

function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const t = String(x ?? "").trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function ensureStringField(out: Record<string, unknown>, key: string, v: string): void {
  const t = v.trim();
  if (!t) return;
  const cur = out[key];
  if (typeof cur === "string" && cur.trim()) return;
  out[key] = t;
}

function normalizeCarouselFieldToObject(out: Record<string, unknown>): void {
  const c = out.carousel;
  if (Array.isArray(c)) {
    const slides = c
      .filter((x) => x && typeof x === "object" && !Array.isArray(x))
      .map((x) => {
        const r = x as Record<string, unknown>;
        return {
          headline: String(r.headline ?? r.title ?? "").trim(),
          body: String(r.body ?? r.text ?? r.caption ?? "").trim(),
        };
      })
      .filter((s) => s.headline || s.body);
    out.carousel = { slides };
    return;
  }
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const rec = c as Record<string, unknown>;
    if (Array.isArray(rec.slides)) return;
  }
}

function inferPackageType(flowType: string | null | undefined): DraftPackageType | null {
  if (isCarouselFlow(flowType ?? "")) return "carousel_package";
  if (isVideoFlow(flowType ?? "")) return "heygen_package";
  return null;
}

function validateCarouselPackage(out: Record<string, unknown>): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  const slides = slidesFromGeneratedOutput(out);
  const usable = slides.filter((s) => slideHasRenderableContent(s));
  if (usable.length === 0) {
    errors.push("carousel_package: no renderable slides (headline/body missing across slide decks)");
  }

  // Caption + hashtags are expected by downstream publishing/review even for carousels.
  const caption = String(out.caption ?? out.primary_copy ?? "").trim();
  if (!caption) {
    warnings.push("carousel_package: missing caption/primary_copy (will reduce publish readiness)");
  }
  const tags = normalizeHashtags(out.hashtags);
  if (tags.length === 0) {
    warnings.push("carousel_package: missing hashtags (discoverability risk)");
  }
  return { warnings, errors };
}

function validateHeygenPackage(
  flowType: string | null | undefined,
  out: Record<string, unknown>
): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  const spoken = extractSpokenScriptText(out, 1).trim();
  const wantsExplicitPrompt = /VID_PROMPT|video_prompt|prompt_generator|Video_Prompt_Generator/i.test(
    String(flowType ?? "")
  );
  const prompt = wantsExplicitPrompt
    ? extractExplicitVideoPromptText(out, 1).trim()
    : extractVideoPromptText(out, 1).trim();
  if (!spoken && !prompt) {
    errors.push("heygen_package: missing spoken_script/script and missing video_prompt (nothing executable for HeyGen)");
  }

  const caption = String(out.caption ?? "").trim();
  if (!caption) {
    warnings.push("heygen_package: missing caption (publish readiness + review context weaker)");
  }
  const tags = normalizeHashtags(out.hashtags);
  if (tags.length === 0) {
    warnings.push("heygen_package: missing hashtags (discoverability risk)");
  }

  // Duration target is advisory but helps control ultra-short renders.
  const dur = out.video_duration_target_seconds ?? out.estimated_runtime_seconds;
  const n = Number(dur);
  if (dur != null && (!Number.isFinite(n) || n <= 0)) {
    warnings.push("heygen_package: duration target present but not numeric/positive");
  }

  return { warnings, errors };
}

/**
 * Validate and lightly normalize generated_output into a strict execution-ready DraftPackage.
 * This is intentionally tolerant: it adds canonical fields (package_type) and emits warnings
 * rather than reshaping the whole payload.
 */
export function validateAndNormalizeDraftPackage(
  flowType: string | null | undefined,
  parsed: Record<string, unknown>
): DraftPackageValidation {
  const output: Record<string, unknown> = { ...parsed };
  const warnings: string[] = [];
  const errors: string[] = [];

  const inferred = inferPackageType(flowType);
  const rawType = typeof output.package_type === "string" ? output.package_type.trim() : "";
  const normalizedFromOutput: DraftPackageType | null =
    rawType === "heygen_package"
      ? "heygen_package"
      : rawType === "carousel_package"
        ? "carousel_package"
        : rawType === "render_copy"
          ? "carousel_package"
          : null;

  const package_type = normalizedFromOutput ?? inferred;

  if (package_type) {
    output.package_type = package_type;
  }

  if (package_type === "carousel_package") {
    const r = validateCarouselPackage(output);
    warnings.push(...r.warnings);
    errors.push(...r.errors);
    normalizeCarouselFieldToObject(output);
    // Normalize hashtags into a stable list form when present.
    if (output.hashtags != null) output.hashtags = uniq(normalizeHashtags(output.hashtags));
    else if (typeof output.caption === "string") {
      const fromCap = extractHashtagsFromCaptionText(output.caption);
      if (fromCap.length > 0) output.hashtags = uniq(fromCap);
    }
    // Canonical fields, additive only.
    ensureStringField(output, "hook_text", String(output.hook_text ?? output.hook ?? output.headline ?? ""));
    ensureStringField(output, "primary_copy", String(output.primary_copy ?? output.caption ?? ""));
    ensureStringField(output, "cta_text", String(output.cta_text ?? output.cta ?? ""));
  } else if (package_type === "heygen_package") {
    // Normalize hashtags to bare tokens, and try extracting from caption if present.
    const ht = uniq(normalizeHashtags(output.hashtags));
    if (ht.length > 0) output.hashtags = ht;
    else {
      const cap = String(output.caption ?? "").trim();
      if (cap) {
        const fromCap = extractHashtagsFromCaptionText(cap);
        if (fromCap.length > 0) output.hashtags = uniq(fromCap);
      }
    }
    const r = validateHeygenPackage(flowType, output);
    warnings.push(...r.warnings);
    errors.push(...r.errors);
  }

  return { output, warnings, errors, package_type };
}

