/**
 * @deprecated Prefer `mimic-reference-copy-budget.ts` — re-exports for backward compatibility.
 */
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import {
  DEFAULT_MIMIC_COPY_REFERENCE_SCALE,
  buildMimicReferenceCopyBudgetSystemBlock,
  mimicCopySlideBudgets,
  parseMimicCopyReferenceScale,
} from "./mimic-reference-copy-budget.js";

export const DEFAULT_MIMIC_FULL_BLEED_COPY_REFERENCE_SCALE = DEFAULT_MIMIC_COPY_REFERENCE_SCALE;

export function parseMimicFullBleedCopyReferenceScale(raw: unknown): number {
  return parseMimicCopyReferenceScale(raw);
}

export function mimicFullBleedCopyLengthTargets(
  layout: MimicSlideCopyLayoutForLlm[],
  scale: number
): Array<{ slide_index: number; reference_chars: number; target_max_chars: number }> {
  return mimicCopySlideBudgets(layout, { scale }).map((s) => ({
    slide_index: s.slide_index,
    reference_chars: s.reference_chars,
    target_max_chars: s.max_chars,
  }));
}

export function buildMimicFullBleedCopyLengthSystemBlock(
  layout: MimicSlideCopyLayoutForLlm[],
  scale: number
): string {
  return buildMimicReferenceCopyBudgetSystemBlock(layout, { scale, branch: "full_bleed" });
}
