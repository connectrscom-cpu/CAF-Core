/**
 * Per-slide copy length caps for FLOW_TOP_PERFORMER_MIMIC_CAROUSEL `carousel_visual` / full_bleed branch.
 * Targets ~2/3 of each slide's `reference_on_screen_text` so Flux-baked text stays short and legible.
 */
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";

export const DEFAULT_MIMIC_FULL_BLEED_COPY_REFERENCE_SCALE = 0.5;

export function parseMimicFullBleedCopyReferenceScale(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw <= 1.5) return raw;
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return DEFAULT_MIMIC_FULL_BLEED_COPY_REFERENCE_SCALE;
  if (s === "2/3" || s === "two_thirds") return 2 / 3;
  const n = Number(s.replace(/x$/i, "").trim());
  if (Number.isFinite(n) && n > 0 && n <= 1.5) return n;
  return DEFAULT_MIMIC_FULL_BLEED_COPY_REFERENCE_SCALE;
}

function referenceCharCount(row: MimicSlideCopyLayoutForLlm): number {
  const direct = String(row.reference_on_screen_text ?? "").trim();
  if (direct.length > 0) return direct.length;
  const blocks = row.text_blocks ?? [];
  return blocks.reduce((sum, b) => sum + String(b.text ?? "").trim().length, 0);
}

export function mimicFullBleedCopyLengthTargets(
  layout: MimicSlideCopyLayoutForLlm[],
  scale: number
): Array<{ slide_index: number; reference_chars: number; target_max_chars: number }> {
  const s = scale > 0 && scale <= 1.5 ? scale : DEFAULT_MIMIC_FULL_BLEED_COPY_REFERENCE_SCALE;
  return layout.map((row) => {
    const ref = referenceCharCount(row);
    const floor = ref <= 40 ? Math.max(12, Math.round(ref * s)) : Math.max(24, Math.round(ref * s));
    const cap = ref > 0 ? Math.max(floor, Math.round(ref * s)) : 80;
    return {
      slide_index: row.slide_index,
      reference_chars: ref,
      target_max_chars: cap,
    };
  });
}

export function buildMimicFullBleedCopyLengthSystemBlock(
  layout: MimicSlideCopyLayoutForLlm[],
  scale: number
): string {
  const targets = mimicFullBleedCopyLengthTargets(layout, scale);
  if (targets.length === 0) return "";

  const lines = [
    "Mimic full-bleed on-slide copy length (required — text is baked into Flux images):",
    `- **Scale:** ~${Math.round(scale * 100)}% of each slide's \`reference_on_screen_text\` length (not generic carousel depth targets).`,
    "- **Per slide:** Match the reference **line count** and **reading time**; do not expand short meme/iMessage bubbles into paragraphs.",
    "- **Headlines:** One short line when the reference has one title line (e.g. \"how you should text your {sign} friend\").",
    "- **Body / bubble text:** Prefer the same number of sentences as the reference; never exceed the per-slide max below.",
    "",
    "Per-slide character caps (headline + body combined, approximate):",
  ];

  for (const t of targets) {
    if (t.reference_chars <= 0) continue;
    lines.push(
      `- Slide ${t.slide_index}: reference ~${t.reference_chars} chars → **max ~${t.target_max_chars} chars** on-screen for this slide.`
    );
  }

  lines.push(
    "",
    "If the reference slide is a single short bubble (under ~60 chars), keep your output under ~40 chars unless the brief requires more."
  );

  return lines.join("\n");
}
