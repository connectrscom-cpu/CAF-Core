/**
 * Learning evidence from operator actions that were previously invisible to
 * the editorial loop:
 *
 *   1. Edit diffs — the before→after of `final_*` overrides vs the job's
 *      `generated_output` at review time. What operators change (not just
 *      which fields) is the strongest ground truth about desired output.
 *   2. Reprint events — mimic text-overlay reprints signal layout/typography
 *      dissatisfaction that never shows up as a review decision.
 *
 * Both land as `learning_observations` rows (existing table, new source_types
 * `editorial_edit_diff` / `reprint_event`) so the editorial analyzer and its
 * OpenAI synthesis can consume them without a new store. All recorders are
 * fire-and-forget safe: failures must never affect review/reprint flows.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { insertObservation } from "../repositories/learning-evidence.js";

const DIFF_VALUE_MAX_CHARS = 600;

export interface EditDiffEntry {
  field: string;
  before: string;
  after: string;
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function cap(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= DIFF_VALUE_MAX_CHARS ? t : `${t.slice(0, DIFF_VALUE_MAX_CHARS)}…`;
}

/** First non-empty string among generated_output locations for a copy field. */
function beforeValue(gen: Record<string, unknown>, field: string): string {
  const car = asRec(gen.carousel);
  switch (field) {
    case "title":
      return str(gen.title) || str(gen.generated_title);
    case "hook":
      return str(gen.hook) || str(gen.generated_hook);
    case "caption":
      return str(gen.caption) || str(car?.caption) || str(car?.post_caption);
    case "hashtags":
      return str(gen.hashtags) || str(car?.hashtags);
    case "spoken_script":
      return str(gen.spoken_script) || str(gen.script);
    default:
      return "";
  }
}

function slidesTextDigest(slides: unknown[]): string {
  const parts: string[] = [];
  for (const s of slides.slice(0, 12)) {
    const rec = asRec(s);
    if (!rec) continue;
    const text =
      str(rec.body) || str(rec.text) || str(rec.content) || str(rec.headline) || str(rec.title);
    if (text) parts.push(text);
  }
  return parts.join(" | ");
}

function findSlides(gen: Record<string, unknown>): unknown[] | null {
  const candidates: unknown[] = [
    asRec(gen.slide_deck)?.slides,
    asRec(gen.variation)?.slides,
    gen.slides,
    gen.carousel,
    asRec(gen.carousel)?.slides,
    asRec(gen.content)?.slides,
    asRec(gen.variation_content)?.carousel,
    asRec(gen.variation_content)?.slides,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return null;
}

function parseOverrideSlides(raw: string): unknown[] | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const parsed: unknown = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed;
    const o = asRec(parsed);
    if (o && Array.isArray(o.slides)) return o.slides;
  } catch {
    return null;
  }
  return null;
}

const FLAT_FIELD_MAP: Array<{ overrideKey: string; field: string }> = [
  { overrideKey: "final_title_override", field: "title" },
  { overrideKey: "final_hook_override", field: "hook" },
  { overrideKey: "final_caption_override", field: "caption" },
  { overrideKey: "final_hashtags_override", field: "hashtags" },
  { overrideKey: "final_spoken_script_override", field: "spoken_script" },
];

/**
 * Pure: compare `final_*` overrides against the generated output and return
 * the fields that actually changed, with capped before/after text.
 */
export function buildEditorialEditDiffs(
  generatedOutput: Record<string, unknown> | null | undefined,
  overrides: Record<string, unknown> | null | undefined
): EditDiffEntry[] {
  const gen = generatedOutput ?? {};
  const ov = overrides ?? {};
  const diffs: EditDiffEntry[] = [];

  for (const { overrideKey, field } of FLAT_FIELD_MAP) {
    const after = str(ov[overrideKey]);
    if (!after) continue;
    const before = beforeValue(gen, field);
    if (before === after) continue;
    diffs.push({ field, before: cap(before), after: cap(after) });
  }

  const slidesRaw = str(ov.final_slides_json_override);
  if (slidesRaw) {
    const afterSlides = parseOverrideSlides(slidesRaw);
    if (afterSlides && afterSlides.length > 0) {
      const beforeSlides = findSlides(gen);
      const beforeDigest = beforeSlides ? slidesTextDigest(beforeSlides) : "";
      const afterDigest = slidesTextDigest(afterSlides);
      if (afterDigest && beforeDigest !== afterDigest) {
        diffs.push({
          field: "slides",
          before: cap(beforeDigest),
          after: cap(afterDigest),
        });
      }
    }
  }

  return diffs;
}

export async function recordEditorialEditDiffObservation(
  db: Pool,
  args: {
    project_id: string;
    task_id: string;
    flow_type: string | null;
    platform: string | null;
    decision: string | null;
    validator: string | null;
    submitted: boolean;
    generated_output: Record<string, unknown> | null;
    overrides: Record<string, unknown> | null;
  }
): Promise<void> {
  const diffs = buildEditorialEditDiffs(args.generated_output, args.overrides);
  if (diffs.length === 0) return;
  await insertObservation(db, {
    observation_id: `edit_diff_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    scope_type: "project",
    project_id: args.project_id,
    source_type: "editorial_edit_diff",
    flow_type: args.flow_type,
    platform: args.platform,
    observation_type: "edit_diff",
    entity_ref: args.task_id,
    payload_json: {
      task_id: args.task_id,
      decision: args.decision,
      validator: args.validator,
      submitted: args.submitted,
      diffs,
    },
    confidence: null,
    observed_at: new Date().toISOString(),
  });
}

export async function recordReprintObservation(
  db: Pool,
  args: {
    project_id: string;
    task_id: string;
    flow_type: string | null;
    platform: string | null;
    slide_indices: number[] | null;
    /** Which knobs the operator touched (typography, layer positions, copy, backing, overlays). */
    adjustments: string[];
  }
): Promise<void> {
  await insertObservation(db, {
    observation_id: `reprint_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    scope_type: "project",
    project_id: args.project_id,
    source_type: "reprint_event",
    flow_type: args.flow_type,
    platform: args.platform,
    observation_type: "reprint",
    entity_ref: args.task_id,
    payload_json: {
      task_id: args.task_id,
      slide_indices: args.slide_indices ?? [],
      adjustments: args.adjustments,
    },
    confidence: null,
    observed_at: new Date().toISOString(),
  });
}

/** Compact digest of recent edit/reprint observations for LLM synthesis input. */
export interface EditEvidenceDigest {
  edit_count: number;
  reprint_count: number;
  edited_field_counts: Record<string, number>;
  reprint_adjustment_counts: Record<string, number>;
  example_diffs: Array<{ task_id: string; field: string; before: string; after: string }>;
}

export function buildEditEvidenceDigest(
  observations: Array<Record<string, unknown>>,
  opts?: { max_examples?: number }
): EditEvidenceDigest {
  const maxExamples = Math.max(0, opts?.max_examples ?? 12);
  const fieldCounts: Record<string, number> = {};
  const adjustmentCounts: Record<string, number> = {};
  const examples: EditEvidenceDigest["example_diffs"] = [];
  let editCount = 0;
  let reprintCount = 0;

  for (const obs of observations) {
    const source = str(obs.source_type);
    const payload = asRec(obs.payload_json) ?? {};
    if (source === "editorial_edit_diff") {
      editCount += 1;
      const taskId = str(payload.task_id);
      const diffs = Array.isArray(payload.diffs) ? payload.diffs : [];
      for (const d of diffs) {
        const rec = asRec(d);
        if (!rec) continue;
        const field = str(rec.field);
        if (!field) continue;
        fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
        if (examples.length < maxExamples) {
          examples.push({
            task_id: taskId,
            field,
            before: cap(str(rec.before)),
            after: cap(str(rec.after)),
          });
        }
      }
    } else if (source === "reprint_event") {
      reprintCount += 1;
      const adjustments = Array.isArray(payload.adjustments) ? payload.adjustments : [];
      for (const a of adjustments) {
        const key = str(a);
        if (!key) continue;
        adjustmentCounts[key] = (adjustmentCounts[key] ?? 0) + 1;
      }
    }
  }

  return {
    edit_count: editCount,
    reprint_count: reprintCount,
    edited_field_counts: fieldCounts,
    reprint_adjustment_counts: adjustmentCounts,
    example_diffs: examples,
  };
}
