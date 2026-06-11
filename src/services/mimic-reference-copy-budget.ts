/**
 * Per-block copy budgets for top-performer mimic flows (template_bg + full_bleed).
 * Caps derive from Document AI / Nemotron reference `text_blocks` on each slide.
 */
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import { formatInstagramHandleForCta, isHandleTextBlock, looksLikeInstagramHandleText } from "../domain/instagram-handle.js";

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
  const branchNote =
    branch === "template_bg"
      ? "Copy is composited at Document AI bbox positions (HTML/CSS overlay on extracted backgrounds)."
      : branch === "full_bleed"
        ? "Copy is placed at reference text regions (HBS overlay or Flux bake depending on project render mode)."
        : "On-slide copy must fit reference text regions.";

  const lines = [
    "Mimic reference copy length (required — strict per placement line):",
    `- **Rule:** Rephrase the reference; **never** copy verbatim. Stay within **±${slack} characters** of each reference line (scale ${scale === 1 ? "1×" : `${scale}×`} reference length).`,
    `- **${branchNote}**`,
    "- **Per block:** When outputting `text_blocks[]`, emit **one block per reference line** (same roles, same order). Do not merge lines or expand into paragraphs.",
    "- **Handles:** Where the reference shows an @handle, use the **project @handle** from strategy context only — never the reference creator's handle.",
    "",
    "Per-slide / per-block character limits:",
  ];

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
  if (/title|headline|hook|cover|kicker/.test(r)) return "headline";
  if (/cta|handle/.test(r)) return "cta";
  if (/body|subtitle|caption|paragraph|sub/.test(r)) return "body";
  return "other";
}

function slideRows(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const slides = parsed.slides;
  if (!Array.isArray(slides)) return [];
  return slides.filter((s) => s && typeof s === "object" && !Array.isArray(s)) as Record<string, unknown>[];
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

/** Deterministic post-LLM clamp + handle substitution for mimic carousel copy. */
export function enforceMimicCopyBudgetOnParsedOutput(
  parsed: Record<string, unknown>,
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: { scale?: number; charSlack?: number; projectHandle?: string | null }
): Record<string, unknown> {
  if (layout.length === 0) return parsed;

  const slideBudgets = mimicCopySlideBudgets(layout, opts);
  const slides = slideRows(parsed);
  if (slides.length === 0) return parsed;

  const projectHandle = opts?.projectHandle ? formatInstagramHandleForCta(opts.projectHandle) : null;
  const outSlides = slides.map((slide, slideIdx) => {
    const layoutRow = layout[slideIdx] ?? layout.find((r) => r.slide_index === slideIdx + 1);
    const budget =
      slideBudgets.find((s) => s.slide_index === layoutRow?.slide_index) ??
      slideBudgets[slideIdx] ??
      null;
    if (!budget) return slide;

    const next: Record<string, unknown> = { ...slide };

    if (budget.blocks.length > 0) {
      let pool = textPoolFromSlide(slide);
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
