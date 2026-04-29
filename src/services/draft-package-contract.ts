import { isCarouselFlow, isVideoFlow } from "../decision_engine/flow-kind.js";
import { slidesFromGeneratedOutput, slideHasRenderableContent } from "./carousel-render-pack.js";
import { extractSpokenScriptText, extractVideoPromptText } from "./video-gen-fields.js";

export type DraftPackageContractMode = "skip" | "warn" | "enforce";

export type DraftPackageValidation = {
  output: Record<string, unknown>;
  warnings: string[];
  errors: string[];
  package_type: "render_copy" | "heygen_package" | null;
};

function normalizeHashtags(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((x) => String(x ?? "").trim()).filter(Boolean);
  }
  if (typeof val === "string") {
    // accept "a, b, c" or "#a #b" shapes
    const t = val.trim();
    if (!t) return [];
    const parts = t.includes(",") ? t.split(",") : t.split(/\s+/);
    return parts.map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function ensureStringField(out: Record<string, unknown>, key: string, v: string): void {
  const t = v.trim();
  if (!t) return;
  const cur = out[key];
  if (typeof cur === "string" && cur.trim()) return;
  out[key] = t;
}

function inferPackageType(flowType: string | null | undefined): "render_copy" | "heygen_package" | null {
  if (isCarouselFlow(flowType ?? "")) return "render_copy";
  if (isVideoFlow(flowType ?? "")) return "heygen_package";
  return null;
}

function validateRenderCopy(out: Record<string, unknown>): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  const slides = slidesFromGeneratedOutput(out);
  const usable = slides.filter((s) => slideHasRenderableContent(s));
  if (usable.length === 0) {
    errors.push("render_copy: no renderable slides (headline/body missing across slide decks)");
  }

  // Caption + hashtags are expected by downstream publishing/review even for carousels.
  const caption = String(out.caption ?? out.primary_copy ?? "").trim();
  if (!caption) {
    warnings.push("render_copy: missing caption/primary_copy (will reduce publish readiness)");
  }
  const tags = normalizeHashtags(out.hashtags);
  if (tags.length === 0) {
    warnings.push("render_copy: missing hashtags (discoverability risk)");
  }
  return { warnings, errors };
}

function validateHeygenPackage(out: Record<string, unknown>): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  const spoken = extractSpokenScriptText(out, 1).trim();
  const prompt = extractVideoPromptText(out, 1).trim();
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
  const package_type =
    (typeof output.package_type === "string" && (output.package_type === "render_copy" || output.package_type === "heygen_package")
      ? (output.package_type as "render_copy" | "heygen_package")
      : inferred);

  if (package_type) {
    output.package_type = package_type;
  }

  if (package_type === "render_copy") {
    const r = validateRenderCopy(output);
    warnings.push(...r.warnings);
    errors.push(...r.errors);
    // Canonical fields, additive only.
    ensureStringField(output, "hook_text", String(output.hook_text ?? output.hook ?? output.headline ?? ""));
    ensureStringField(output, "primary_copy", String(output.primary_copy ?? output.caption ?? ""));
    ensureStringField(output, "cta_text", String(output.cta_text ?? output.cta ?? ""));
  } else if (package_type === "heygen_package") {
    const r = validateHeygenPackage(output);
    warnings.push(...r.warnings);
    errors.push(...r.errors);
  }

  return { output, warnings, errors, package_type };
}

