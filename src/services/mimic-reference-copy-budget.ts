/**
 * Per-block copy budgets for top-performer mimic flows (template_bg + full_bleed).
 * Caps derive from Document AI / Nemotron reference `text_blocks` on each slide.
 */
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import type { MimicReferenceCopySlot } from "./mimic-copy-slots.js";
import {
  normalizeLlmSlideToCopySlots,
} from "./mimic-copy-slots.js";
import {
  collectInstagramHandlesFromText,
  formatInstagramHandleForCta,
  isHandleTextBlock,
  looksLikeInstagramHandleText,
  stripLeadingInstagramHandle,
  substituteReferenceHandlesInText,
} from "../domain/instagram-handle.js";

export {
  formatInstagramHandleForCta,
  isHandleTextBlock,
  looksLikeInstagramHandleText,
} from "../domain/instagram-handle.js";

export const DEFAULT_MIMIC_COPY_CHAR_SLACK = 4;
export const DEFAULT_MIMIC_COPY_REFERENCE_SCALE = 1;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function referenceCharCount(row: MimicSlideCopyLayoutForLlm): number {
  const direct = String(row.reference_on_screen_text ?? "").trim();
  if (direct.length > 0) return direct.length;
  const blocks = row.text_blocks ?? [];
  return blocks.reduce((sum, b) => sum + String(b.text ?? "").trim().length, 0);
}

export function parseMimicCopyCharSlack(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 32) return Math.round(raw);
  const n = Number(String(raw ?? "").trim());
  if (Number.isFinite(n) && n >= 0 && n <= 32) return Math.round(n);
  return DEFAULT_MIMIC_COPY_CHAR_SLACK;
}

export function parseMimicCopyReferenceScale(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw <= 1.5) return raw;
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return DEFAULT_MIMIC_COPY_REFERENCE_SCALE;
  if (s === "2/3" || s === "two_thirds") return 2 / 3;
  const n = Number(s.replace(/x$/i, "").trim());
  if (Number.isFinite(n) && n > 0 && n <= 1.5) return n;
  return DEFAULT_MIMIC_COPY_REFERENCE_SCALE;
}

export type MimicCopySlotLineBudget = {
  reference_text: string;
  reference_chars: number;
  max_chars: number;
  min_chars: number;
};

export type MimicCopySlotBudget = {
  slide_index: number;
  slot_index: number;
  llm_field: string;
  split: string;
  reference_text: string;
  reference_chars: number;
  max_chars: number;
  min_chars: number;
  block_count: number;
  /** One budget per OCR box when a slot spans multiple reference lines. */
  line_budgets?: MimicCopySlotLineBudget[];
};

function lineBudgetForText(referenceText: string, scale: number, slack: number): MimicCopySlotLineBudget {
  const ref = referenceText.trim();
  const refLen = ref.length;
  const scaled = refLen > 0 ? Math.max(1, Math.round(refLen * scale)) : 24;
  return {
    reference_text: ref,
    reference_chars: refLen,
    max_chars: refLen > 0 ? scaled + slack : 80 + slack,
    min_chars: refLen > 0 ? Math.max(1, scaled - slack) : 1,
  };
}

function slotBudget(
  slideIndex: number,
  slot: MimicReferenceCopySlot,
  scale: number,
  slack: number
): MimicCopySlotBudget {
  const blockTexts = slot.block_texts.map((t) => t.trim()).filter(Boolean);
  const ref = slot.reference_text.trim();
  const lineBudgets =
    blockTexts.length > 1 ? blockTexts.map((t) => lineBudgetForText(t, scale, slack)) : undefined;
  const primary = lineBudgets?.[0] ?? lineBudgetForText(blockTexts[0] ?? ref, scale, slack);
  return {
    slide_index: slideIndex,
    slot_index: slot.slot_index,
    llm_field: slot.llm_field,
    split: slot.split,
    reference_text: ref || primary.reference_text,
    reference_chars: primary.reference_chars,
    max_chars: primary.max_chars,
    min_chars: primary.min_chars,
    block_count: Math.max(1, blockTexts.length || slot.block_indices.length),
    line_budgets: lineBudgets,
  };
}

export function mimicCopySlotBudgets(
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: { scale?: number; charSlack?: number }
): MimicCopySlotBudget[] {
  const scale = parseMimicCopyReferenceScale(opts?.scale ?? DEFAULT_MIMIC_COPY_REFERENCE_SCALE);
  const slack = parseMimicCopyCharSlack(opts?.charSlack ?? DEFAULT_MIMIC_COPY_CHAR_SLACK);
  const out: MimicCopySlotBudget[] = [];
  for (const row of layout) {
    const slots = row.copy_slots_v1 ?? [];
    for (const slot of slots) {
      if (!slot.reference_text.trim()) continue;
      out.push(slotBudget(row.slide_index, slot, scale, slack));
    }
  }
  return out;
}

export type MimicCopyBlockBudget = {
  slide_index: number;
  block_index: number;
  role: string | null;
  reference_text: string;
  reference_chars: number;
  max_chars: number;
  min_chars: number;
  is_handle_block: boolean;
};

export type MimicCopySlideBudget = {
  slide_index: number;
  reference_chars: number;
  max_chars: number;
  min_chars: number;
  blocks: MimicCopyBlockBudget[];
};

function blockBudget(
  slideIndex: number,
  blockIndex: number,
  role: string | null,
  referenceText: string,
  scale: number,
  slack: number
): MimicCopyBlockBudget {
  const ref = referenceText.trim();
  const refLen = ref.length;
  const scaled = refLen > 0 ? Math.max(1, Math.round(refLen * scale)) : 24;
  const max_chars = refLen > 0 ? scaled + slack : 80 + slack;
  const min_chars = refLen > 0 ? Math.max(1, scaled - slack) : 1;
  return {
    slide_index: slideIndex,
    block_index: blockIndex,
    role,
    reference_text: ref,
    reference_chars: refLen,
    max_chars,
    min_chars,
    is_handle_block: isHandleTextBlock(role, ref),
  };
}

/** Per text-block budgets from reference placement lines (preferred). */
export function mimicCopyBlockBudgets(
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: { scale?: number; charSlack?: number }
): MimicCopyBlockBudget[] {
  const scale = parseMimicCopyReferenceScale(opts?.scale ?? DEFAULT_MIMIC_COPY_REFERENCE_SCALE);
  const slack = parseMimicCopyCharSlack(opts?.charSlack ?? DEFAULT_MIMIC_COPY_CHAR_SLACK);
  const out: MimicCopyBlockBudget[] = [];

  for (const row of layout) {
    const blocks = row.text_blocks ?? [];
    if (blocks.length > 0) {
      blocks.forEach((b, i) => {
        const text = String(b.text ?? "").trim();
        if (!text) return;
        out.push(blockBudget(row.slide_index, i, b.role ?? null, text, scale, slack));
      });
      continue;
    }
    const ref = String(row.reference_on_screen_text ?? "").trim();
    if (ref) {
      out.push(blockBudget(row.slide_index, 0, null, ref, scale, slack));
    }
  }
  return out;
}

export function mimicCopySlideBudgets(
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: { scale?: number; charSlack?: number }
): MimicCopySlideBudget[] {
  const scale = parseMimicCopyReferenceScale(opts?.scale ?? DEFAULT_MIMIC_COPY_REFERENCE_SCALE);
  const slack = parseMimicCopyCharSlack(opts?.charSlack ?? DEFAULT_MIMIC_COPY_CHAR_SLACK);
  const blockBudgets = mimicCopyBlockBudgets(layout, { scale, charSlack: slack });

  return layout.map((row) => {
    const blocks = blockBudgets.filter((b) => b.slide_index === row.slide_index);
    const refChars = referenceCharCount(row);
    if (blocks.length > 0) {
      const max_chars = blocks.reduce((m, b) => m + b.max_chars, 0);
      const min_chars = blocks.reduce((m, b) => m + b.min_chars, 0);
      return { slide_index: row.slide_index, reference_chars: refChars, max_chars, min_chars, blocks };
    }
    const scaled = refChars > 0 ? Math.max(1, Math.round(refChars * scale)) : 80;
    return {
      slide_index: row.slide_index,
      reference_chars: refChars,
      max_chars: scaled + slack,
      min_chars: Math.max(1, scaled - slack),
      blocks: [],
    };
  });
}

export function buildMimicReferenceCopyBudgetSystemBlock(
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: { scale?: number; charSlack?: number; branch?: "template_bg" | "full_bleed" | "default" }
): string {
  const slideBudgets = mimicCopySlideBudgets(layout, opts);
  if (slideBudgets.length === 0) return "";

  const scale = parseMimicCopyReferenceScale(opts?.scale ?? DEFAULT_MIMIC_COPY_REFERENCE_SCALE);
  const slack = parseMimicCopyCharSlack(opts?.charSlack ?? DEFAULT_MIMIC_COPY_CHAR_SLACK);
  const branch = opts?.branch ?? "default";
  const slotBudgets = mimicCopySlotBudgets(layout, opts);
  const branchNote =
    branch === "template_bg"
      ? "Copy is composited at Document AI bbox positions (HTML/CSS overlay on extracted backgrounds)."
      : branch === "full_bleed"
        ? "Copy is placed at reference text regions (HBS overlay or Flux bake depending on project render mode)."
        : "On-slide copy must fit reference text regions.";

  const lines = [
    slotBudgets.length > 0
      ? "Mimic reference copy length (required — strict per placement slot):"
      : "Mimic reference copy length (required — strict per placement line):",
    `- **Rule:** Rephrase the reference; **never** copy verbatim. Match the **reference character count at each OCR box** (±${slack} chars). Preserve the same on-screen reading volume — do not compress, omit lines, or merge boxes.`,
    `- **${branchNote}**`,
  ];

  if (slotBudgets.length > 0) {
    lines.push(
      "- **Copy slots:** Each `copy_slots_v1` row maps to one or more OCR boxes. Emit **one `text_blocks[]` entry per OCR box** (same order as `reference_chars_per_line` within each slot).",
      "- **Grouped headline slots:** When `split: line_per_block`, write **one headline line per OCR box** at the reference character count for that box.",
      "- **Multi-stack body slides:** When a slide has multiple body OCR lines, write **one `text_blocks[]` body line per box** — same count and similar length as the reference.",
      "- **Decor title + body stacks:** When the reference keeps a fixed label (zodiac sign, segment title) plus separate body regions, write `headline` as **label + hook phrase** and emit **one body slot per spatial stack**.",
      "- **Handles:** Where the reference shows an @handle, use the **project @handle** from strategy context only — never the reference creator's handle.",
      "",
      "Per-slide copy slots:"
    );
    for (const b of slotBudgets) {
      if (b.line_budgets && b.line_budgets.length > 1) {
        const perLine = b.line_budgets
          .map(
            (lb, i) =>
              `OCR line ${i + 1} ref ${lb.reference_chars} chars → **max ${lb.max_chars} chars** (aim ${lb.min_chars}–${lb.max_chars})`
          )
          .join("; ");
        lines.push(
          `- Slide ${b.slide_index}, slot ${b.slot_index + 1} **${b.llm_field}** (${b.block_count} OCR boxes): ${perLine}.`
        );
        continue;
      }
      const splitNote = b.split === "line_per_block" ? " (split across lines)" : "";
      lines.push(
        `- Slide ${b.slide_index}, slot ${b.slot_index + 1} **${b.llm_field}**${splitNote}: reference ${b.reference_chars} chars → **max ${b.max_chars} chars** (aim ${b.min_chars}–${b.max_chars}).`
      );
    }
  } else {
    lines.push(
      "- **Per block:** When outputting `text_blocks[]`, emit **one block per reference line** (same roles, same order). Do not merge lines or expand into paragraphs.",
      "- **Handles:** Where the reference shows an @handle, use the **project @handle** from strategy context only — never the reference creator's handle.",
      "",
      "Per-slide / per-block character limits:"
    );
    for (const slide of slideBudgets) {
      if (slide.blocks.length > 0) {
        for (const b of slide.blocks) {
          if (b.reference_chars <= 0) continue;
          const roleLabel = b.role ? ` (${b.role})` : "";
          lines.push(
            `- Slide ${b.slide_index}, line ${b.block_index + 1}${roleLabel}: reference ${b.reference_chars} chars → **max ${b.max_chars} chars** (aim ${b.min_chars}–${b.max_chars}).`
          );
        }
      } else if (slide.reference_chars > 0) {
        lines.push(
          `- Slide ${slide.slide_index}: reference ~${slide.reference_chars} chars → **max ~${slide.max_chars} chars** combined on-screen.`
        );
      }
    }
  }

  lines.push(
    "",
    "If a line would exceed its max, rewrite shorter — do not truncate mid-word in the model output."
  );

  return lines.join("\n");
}

export function truncateMimicCopyToMax(text: string, maxChars: number): string {
  const t = String(text ?? "").trim();
  if (!t || maxChars <= 0) return "";
  if (t.length <= maxChars) return t;
  if (maxChars <= 1) return t.slice(0, maxChars);
  const slice = t.slice(0, maxChars - 1).trimEnd();
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxChars * 0.55)) return `${slice.slice(0, lastSpace).trimEnd()}…`;
  return `${slice}…`;
}

function roleBucket(role: string | null): string {
  const r = (role ?? "").toLowerCase();
  if (/title|headline|hook|cover|kicker|subheadline/.test(r)) return "headline";
  if (/cta|handle/.test(r)) return "cta";
  if (/body|subtitle|caption|paragraph/.test(r)) return "body";
  return "other";
}

function slideRows(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const slides = parsed.slides;
  if (!Array.isArray(slides)) return [];
  return slides.filter((s) => s && typeof s === "object" && !Array.isArray(s)) as Record<string, unknown>[];
}

function referenceHandlesFromLayout(layout: MimicSlideCopyLayoutForLlm[]): string[] {
  const handles = new Set<string>();
  for (const row of layout) {
    for (const b of row.text_blocks ?? []) {
      const text = String(b.text ?? "").trim();
      if (!text) continue;
      if (isHandleTextBlock(b.role ?? null, text)) {
        handles.add(formatInstagramHandleForCta(text));
      } else {
        for (const h of collectInstagramHandlesFromText(text)) handles.add(h);
      }
    }
    for (const h of collectInstagramHandlesFromText(String(row.reference_on_screen_text ?? ""))) handles.add(h);
  }
  return [...handles].filter(Boolean);
}

function sanitizeSlideCopyFields(
  slide: Record<string, unknown>,
  referenceHandles: string[],
  projectHandle: string | null
): Record<string, unknown> {
  const next = { ...slide };
  const scrub = (raw: unknown): string => {
    let text = substituteReferenceHandlesInText(String(raw ?? "").trim(), referenceHandles, projectHandle);
    const stripped = stripLeadingInstagramHandle(text, referenceHandles);
    if (stripped.handle) {
      text = stripped.remainder;
    }
    return text.trim();
  };

  for (const key of ["headline", "title", "body", "subtitle", "kicker", "panel_title", "panel_body"] as const) {
    if (next[key] != null && String(next[key]).trim()) {
      if (key === "body" || key === "subtitle" || key === "panel_body") {
        const lines = String(next[key])
          .split(/\n/)
          .map((line) => scrub(line))
          .filter((line) => line && !looksLikeInstagramHandleText(line));
        next[key] = lines.join("\n");
      } else {
        next[key] = scrub(next[key]);
      }
    }
  }

  if (Array.isArray(next.text_blocks)) {
    next.text_blocks = next.text_blocks.map((item) => {
      const rec = asRecord(item);
      if (!rec) return item;
      const role = String(rec.role ?? "");
      const refText = String(rec.text ?? "").trim();
      if (isHandleTextBlock(role, refText) && projectHandle) {
        return { ...rec, text: formatInstagramHandleForCta(projectHandle) };
      }
      return { ...rec, text: scrub(rec.text) };
    });
  }

  return next;
}

function textPoolFromSlide(slide: Record<string, unknown>): Array<{ bucket: string; text: string }> {
  const pool: Array<{ bucket: string; text: string }> = [];
  const blocks = slide.text_blocks;
  if (Array.isArray(blocks)) {
    for (const item of blocks) {
      const rec = asRecord(item);
      if (!rec) continue;
      const text = String(rec.text ?? "").trim();
      if (!text) continue;
      pool.push({ bucket: roleBucket(String(rec.role ?? "")), text });
    }
    if (pool.length > 0) return pool;
  }
  for (const key of ["headline", "title", "kicker", "body", "subtitle", "panel_title", "panel_body"] as const) {
    const text = String(slide[key] ?? "").trim();
    if (text) pool.push({ bucket: roleBucket(key), text });
  }
  return pool;
}

function applyBudgetToText(
  text: string,
  budget: MimicCopyBlockBudget,
  projectHandle: string | null
): string {
  if (budget.is_handle_block && projectHandle) {
    return formatInstagramHandleForCta(projectHandle);
  }
  return truncateMimicCopyToMax(text, budget.max_chars);
}


function slotTotalMaxChars(budget: MimicCopySlotBudget): number {
  if (budget.line_budgets && budget.line_budgets.length > 1) {
    return budget.line_budgets.reduce((sum, line) => sum + line.max_chars, 0);
  }
  return budget.max_chars;
}

function applyBudgetToSlotText(
  text: string,
  budget: MimicCopySlotBudget,
  slot: MimicReferenceCopySlot,
  projectHandle: string | null
): string {
  if (budget.llm_field === "handle" && projectHandle) {
    return formatInstagramHandleForCta(projectHandle);
  }

  const blockTexts = slot.block_texts.map((t) => t.trim()).filter(Boolean);
  const maxChars = blockTexts.length > 1 ? slotTotalMaxChars(budget) : budget.max_chars;
  return truncateMimicCopyToMax(String(text ?? "").replace(/\n/g, " ").trim(), maxChars);
}

function enforceSlideCopyWithSlotBudgets(
  slide: Record<string, unknown>,
  slotBudgets: MimicCopySlotBudget[],
  layoutSlots: MimicReferenceCopySlot[],
  projectHandle: string | null,
  referenceHandles: string[],
  scale: number,
  slack: number
): Record<string, unknown> {
  const sanitized = sanitizeSlideCopyFields(slide, referenceHandles, projectHandle);
  const budgetBySlot = new Map(slotBudgets.map((b) => [b.slot_index, b]));
  const slotByIndex = new Map(layoutSlots.map((s) => [s.slot_index, s]));

  return normalizeLlmSlideToCopySlots(sanitized, layoutSlots, {
    projectHandle,
    referenceHandles,
    applyMaxChars: (slotIndex, _llmField, text) => {
      const budget = budgetBySlot.get(slotIndex);
      const slot = slotByIndex.get(slotIndex);
      if (!budget || !slot) return text;
      return applyBudgetToSlotText(text, budget, slot, projectHandle);
    },
    clampOcrLine: (lineText, referenceChars) => {
      const refLen = Math.max(0, referenceChars);
      const max = refLen > 0 ? Math.max(1, Math.round(refLen * scale)) + slack : 80 + slack;
      return truncateMimicCopyToMax(lineText, max);
    },
  });
}

/** Deterministic post-LLM clamp + handle substitution for mimic carousel copy. */
export function enforceMimicCopyBudgetOnParsedOutput(
  parsed: Record<string, unknown>,
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: { scale?: number; charSlack?: number; projectHandle?: string | null }
): Record<string, unknown> {
  if (layout.length === 0) return parsed;

  const scale = parseMimicCopyReferenceScale(opts?.scale ?? DEFAULT_MIMIC_COPY_REFERENCE_SCALE);
  const slack = parseMimicCopyCharSlack(opts?.charSlack ?? DEFAULT_MIMIC_COPY_CHAR_SLACK);
  const slideBudgets = mimicCopySlideBudgets(layout, { scale, charSlack: slack });
  const slotBudgets = mimicCopySlotBudgets(layout, { scale, charSlack: slack });
  const slides = slideRows(parsed);
  if (slides.length === 0) return parsed;

  const projectHandle = opts?.projectHandle ? formatInstagramHandleForCta(opts.projectHandle) : null;
  const referenceHandles = referenceHandlesFromLayout(layout);
  const outSlides = slides.map((slide, slideIdx) => {
    const layoutRow = layout[slideIdx] ?? layout.find((r) => r.slide_index === slideIdx + 1);
    const slideIndex = layoutRow?.slide_index ?? slideIdx + 1;
    const rowSlotBudgets = slotBudgets.filter((b) => b.slide_index === slideIndex);
    const layoutSlots = layoutRow?.copy_slots_v1 ?? [];
    if (rowSlotBudgets.length > 0 && layoutSlots.length > 0) {
      return enforceSlideCopyWithSlotBudgets(
        slide,
        rowSlotBudgets,
        layoutSlots,
        projectHandle,
        referenceHandles,
        scale,
        slack
      );
    }

    const budget =
      slideBudgets.find((s) => s.slide_index === slideIndex) ?? slideBudgets[slideIdx] ?? null;
    if (!budget) return sanitizeSlideCopyFields(slide, referenceHandles, projectHandle);

    const next: Record<string, unknown> = sanitizeSlideCopyFields(slide, referenceHandles, projectHandle);

    if (budget.blocks.length > 0) {
      let pool = textPoolFromSlide(next);
      const newBlocks: Record<string, unknown>[] = [];
      for (let bi = 0; bi < budget.blocks.length; bi++) {
        const b = budget.blocks[bi]!;
        const bucket = roleBucket(b.role);
        let text = "";
        const matchIdx = pool.findIndex((p) => p.bucket === bucket);
        if (matchIdx >= 0) {
          text = pool[matchIdx]!.text;
          pool = [...pool.slice(0, matchIdx), ...pool.slice(matchIdx + 1)];
        } else if (bi < pool.length) {
          text = pool[bi]!.text;
          pool = [...pool.slice(0, bi), ...pool.slice(bi + 1)];
        }
        text = applyBudgetToText(text, b, projectHandle);
        newBlocks.push({
          role: b.role ?? bucket,
          text,
        });
      }
      if (pool.length > 0 && newBlocks.length > 0) {
        const last = newBlocks[newBlocks.length - 1]!;
        const tail = pool.map((p) => p.text).filter(Boolean).join("\n");
        if (tail) {
          const merged = [String(last.text ?? ""), tail].filter(Boolean).join("\n");
          last.text = applyBudgetToText(merged, budget.blocks[budget.blocks.length - 1]!, projectHandle);
        }
      }
      next.text_blocks = newBlocks;
      if (newBlocks[0]?.text) next.headline = String(newBlocks[0].text);
      if (newBlocks.length > 1) {
        next.body = newBlocks
          .slice(1)
          .map((blk) => String(blk.text ?? ""))
          .filter(Boolean)
          .join("\n");
      }
      return next;
    }

    const max = budget.max_chars;
    const headline = String(next.headline ?? next.title ?? "").trim();
    const body = String(next.body ?? next.subtitle ?? "").trim();
    if (headline) next.headline = truncateMimicCopyToMax(headline, max);
    if (body) next.body = truncateMimicCopyToMax(body, max);
    return next;
  });

  return { ...parsed, slides: outSlides };
}
