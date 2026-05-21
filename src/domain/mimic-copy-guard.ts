import { pickGeneratedOutput } from "./generation-payload-output.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordTokens(s: string): string[] {
  return normalizeForCompare(s)
    .split(" ")
    .filter((w) => w.length > 2);
}

/** Jaccard-like overlap on word tokens (0–1). */
export function copyWordOverlapRatio(a: string, b: string): number {
  const ta = new Set(wordTokens(a));
  const tb = new Set(wordTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) {
    if (tb.has(w)) inter++;
  }
  return inter / Math.min(ta.size, tb.size);
}

export function copyTooSimilarToReference(
  generated: string,
  referenceTexts: string[],
  threshold = 0.68
): boolean {
  const g = normalizeForCompare(generated);
  if (g.length < 24) return false;
  for (const raw of referenceTexts) {
    const r = normalizeForCompare(raw);
    if (r.length < 24) continue;
    if (copyWordOverlapRatio(g, r) >= threshold) return true;
    const probe = r.slice(0, Math.min(140, r.length));
    if (probe.length >= 48 && g.includes(probe)) return true;
  }
  return false;
}

export function referenceCopyTextsFromGuideline(entry: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const t = String(v ?? "").trim();
    if (t.length >= 12) out.push(t);
  };

  add(entry.hook_text_preview);
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  add(aes.deck_as_whole_summary);
  add(aes.video_as_whole_summary);

  const slides = Array.isArray(aes.slides) ? aes.slides : [];
  for (const s of slides) {
    const slide = asRecord(s);
    add(slide?.on_image_text);
    add(slide?.body);
    add(slide?.headline);
  }

  return out;
}

/** On-image + caption copy fields used for image mimic divergence checks. */
export function extractImageMimicCopyFields(gen: Record<string, unknown>): {
  on_image_copy: string;
  caption: string;
} {
  const cover = asRecord(gen.cover);
  const parts: string[] = [];
  const push = (v: unknown) => {
    const t = String(v ?? "").trim();
    if (t) parts.push(t);
  };

  push(gen.hook_text ?? gen.hook ?? gen.headline);
  push(cover?.cover_title);
  push(cover?.cover_subtitle);
  push(cover?.kicker);

  const slides = Array.isArray(gen.slides) ? gen.slides : [];
  const first = asRecord(slides[0]);
  push(first?.headline ?? first?.body ?? first?.panel_title);

  const onImage =
    parts.join("\n\n").trim() || String(gen.primary_copy ?? gen.caption ?? "").trim();
  const caption = String(gen.caption ?? gen.primary_copy ?? onImage).trim();

  return { on_image_copy: onImage, caption };
}

export function assertMimicCopyDiffersFromReference(
  generationPayload: Record<string, unknown>,
  guidelineEntry: Record<string, unknown>
): void {
  const gen = pickGeneratedOutput(generationPayload);
  if (!gen) return;

  const refs = referenceCopyTextsFromGuideline(guidelineEntry);
  if (refs.length === 0) return;

  const { on_image_copy, caption } = extractImageMimicCopyFields(gen);
  const fields = [on_image_copy, caption].filter((s) => s.length >= 24);

  const slides = Array.isArray(gen.slides) ? gen.slides : [];
  for (const s of slides) {
    const slide = asRecord(s);
    const body = String(slide?.body ?? slide?.headline ?? "").trim();
    if (body.length >= 24) fields.push(body);
  }

  for (const field of fields) {
    if (copyTooSimilarToReference(field, refs)) {
      throw new Error(
        "Mimic copy is too similar to the archived top-performer reference text. Regenerate with fresh brand wording — do not reuse reference sentences verbatim."
      );
    }
  }
}

/** Same helper for render-time gpt-image-1 prompt injection. */
export function onImageCopyForMimicRender(payload: Record<string, unknown>): string {
  const gen = pickGeneratedOutput(payload);
  if (!gen) return "";
  return extractImageMimicCopyFields(gen).on_image_copy;
}
