/**
 * Post-composite placement QA for mimic carousel DocAI text layers.
 * Pure geometry + scoring — pixel/contrast analysis lives in the service layer.
 */
import type { MimicDocAiLayerPositionLayer } from "./mimic-docai-layer-positions.js";
import {
  layersToPositionOverrides,
  mimicDocAiLayerPositionKey,
  mimicDocAiLayerRefKey,
  type MimicDocAiLayerPositionOverride,
} from "./mimic-docai-layer-positions.js";

export const MIMIC_LAYOUT_QC_SCHEMA = "layout_qc_v1" as const;
export const MIMIC_CANVAS_W = 1080;
export const MIMIC_CANVAS_H = 1350;
export const MIMIC_DOCAI_CANVAS_SAFE_MARGIN_PX = 48;

const MIMIC_FULL_BLEED_SUBJECT_ZONE = { x: 0.22, y: 0.26, w: 0.56, h: 0.48 };

function bboxIntersectsFullBleedSubjectZone(
  bbox: { x: number; y: number; w: number; h: number },
  gap = 0.01
): boolean {
  const z = MIMIC_FULL_BLEED_SUBJECT_ZONE;
  const zx = z.x - gap;
  const zy = z.y - gap;
  const zw = z.w + gap * 2;
  const zh = z.h + gap * 2;
  return bbox.x < zx + zw && bbox.x + bbox.w > zx && bbox.y < zy + zh && bbox.y + bbox.h > zy;
}

function nudgeBBoxAwayFromFullBleedSubjectZone(bbox: {
  x: number;
  y: number;
  w: number;
  h: number;
}): { x: number; y: number; w: number; h: number } {
  if (!bboxIntersectsFullBleedSubjectZone(bbox)) return bbox;
  const z = MIMIC_FULL_BLEED_SUBJECT_ZONE;
  const gap = 0.02;
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  const zcx = z.x + z.w / 2;
  const zcy = z.y + z.h / 2;
  let { x, y, w, h } = bbox;
  if (cx <= zcx) x = Math.max(0.02, z.x - w - gap);
  else x = Math.min(0.98 - w, z.x + z.w + gap);
  if (cy <= zcy) y = Math.max(0.02, z.y - h - gap);
  else y = Math.min(0.98 - h, z.y + z.h + gap);
  x = Math.max(0.02, Math.min(0.98 - w, x));
  y = Math.max(0.02, Math.min(0.98 - h, y));
  return { x, y, w, h };
}

export type MimicLayoutFindingKind =
  | "collision"
  | "overflow"
  | "margin"
  | "missing_text"
  | "duplicate_layer"
  | "low_contrast"
  | "subject_overlap";

export type MimicLayoutFindingSeverity = "blocking" | "warning";

export type MimicLayoutFinding = {
  check: MimicLayoutFindingKind;
  severity: MimicLayoutFindingSeverity;
  message: string;
  layer_key?: string;
  blocking: boolean;
};

export type MimicLayoutSlideQa = {
  slide_index: number;
  score: number;
  pass: boolean;
  badges: string[];
  findings: MimicLayoutFinding[];
};

export type MimicLayoutQcV1 = {
  schema_version: typeof MIMIC_LAYOUT_QC_SCHEMA;
  analyzed_at: string;
  iterations: number;
  /** True when no hard blockers remain (soft layout warnings may still exist). */
  pass: boolean;
  overall_score: number;
  /** True when operator should open layout editor before approving (any remaining findings). */
  review_attention: boolean;
  /** Legacy advisory flag; job status stays IN_REVIEW — use `review_attention` + slide findings. */
  block_review: boolean;
  slides: Record<string, MimicLayoutSlideQa>;
};

export type LayoutQaBox = {
  layer_key: string;
  role: string;
  text: string;
  x_px: number;
  y_px: number;
  w_px: number;
  h_px: number;
  hidden?: boolean;
};

export type LayoutQaPatch = {
  layer_key: string;
  x_px: number;
  y_px: number;
  fix_reason: MimicLayoutFindingKind;
};

const OVERLAP_GAP_PX = 18;
const MIN_CONTRAST_RATIO = 2.8;

export function layoutBoxFromLayer(layer: MimicDocAiLayerPositionLayer): LayoutQaBox {
  return {
    layer_key: mimicDocAiLayerPositionKey(layer),
    role: String(layer.role ?? "body"),
    text: String(layer.text ?? "").trim(),
    x_px: layer.x_px,
    y_px: layer.y_px,
    w_px: Math.max(40, layer.w_px ?? 200),
    h_px: Math.max(24, layer.h_px ?? 72),
  };
}

export function visibleLayoutBoxes(layers: MimicDocAiLayerPositionLayer[]): LayoutQaBox[] {
  return layers
    .filter((l) => String(l.text ?? "").trim().length > 0)
    .map(layoutBoxFromLayer);
}

function boxesOverlap(a: LayoutQaBox, b: LayoutQaBox, gap = 0): boolean {
  const ax2 = a.x_px + a.w_px + gap;
  const ay2 = a.y_px + a.h_px + gap;
  const bx2 = b.x_px + b.w_px + gap;
  const by2 = b.y_px + b.h_px + gap;
  return a.x_px < bx2 && ax2 > b.x_px && a.y_px < by2 && ay2 > b.y_px;
}

function boxOverflowsSafeMargin(box: LayoutQaBox, margin = MIMIC_DOCAI_CANVAS_SAFE_MARGIN_PX): boolean {
  if (box.x_px < margin) return true;
  if (box.y_px < margin) return true;
  if (box.x_px + box.w_px > MIMIC_CANVAS_W - margin) return true;
  if (box.y_px + box.h_px > MIMIC_CANVAS_H - margin) return true;
  return false;
}

/** Box clipped by canvas edge — engineering failure, not a soft polish issue. */
function boxSeverelyClippedByCanvas(box: LayoutQaBox): boolean {
  const slack = 8;
  return (
    box.x_px < -slack ||
    box.y_px < -slack ||
    box.x_px + box.w_px > MIMIC_CANVAS_W + slack ||
    box.y_px + box.h_px > MIMIC_CANVAS_H + slack
  );
}

function boxIntersectsSubjectZone(box: LayoutQaBox): boolean {
  return bboxIntersectsFullBleedSubjectZone({
    x: box.x_px / MIMIC_CANVAS_W,
    y: box.y_px / MIMIC_CANVAS_H,
    w: box.w_px / MIMIC_CANVAS_W,
    h: box.h_px / MIMIC_CANVAS_H,
  });
}

export function detectBoxCollisions(boxes: LayoutQaBox[]): MimicLayoutFinding[] {
  const findings: MimicLayoutFinding[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (boxesOverlap(a, b, OVERLAP_GAP_PX)) {
        findings.push({
          check: "collision",
          severity: "blocking",
          blocking: true,
          layer_key: b.layer_key,
          message: `Text box overlaps "${a.role}" (${a.layer_key.slice(0, 24)})`,
        });
      }
    }
  }
  return findings;
}

export function detectMarginViolations(boxes: LayoutQaBox[]): MimicLayoutFinding[] {
  const findings: MimicLayoutFinding[] = [];
  for (const box of boxes) {
    if (boxSeverelyClippedByCanvas(box)) {
      findings.push({
        check: "overflow",
        severity: "blocking",
        blocking: true,
        layer_key: box.layer_key,
        message: "Text box clipped by slide edge",
      });
      continue;
    }
    if (boxOverflowsSafeMargin(box)) {
      findings.push({
        check: "margin",
        severity: "warning",
        blocking: false,
        layer_key: box.layer_key,
        message: "Text box extends outside safe margins",
      });
    }
  }
  return findings;
}

export function detectSubjectOverlap(boxes: LayoutQaBox[]): MimicLayoutFinding[] {
  const findings: MimicLayoutFinding[] = [];
  for (const box of boxes) {
    const role = box.role.toLowerCase();
    if (role === "handle" || role === "cta") continue;
    if (!boxIntersectsSubjectZone(box)) continue;
    findings.push({
      check: "subject_overlap",
      severity: "warning",
      blocking: false,
      layer_key: box.layer_key,
      message: "Text box overlaps center subject zone",
    });
  }
  return findings;
}

export function detectDuplicateLayers(boxes: LayoutQaBox[]): MimicLayoutFinding[] {
  const findings: MimicLayoutFinding[] = [];
  const byRef = new Map<string, LayoutQaBox[]>();
  for (const box of boxes) {
    const ref = mimicDocAiLayerRefKey({
      role: box.role,
      ref_x: box.x_px / MIMIC_CANVAS_W,
      ref_y: box.y_px / MIMIC_CANVAS_H,
      x_pct: box.x_px / MIMIC_CANVAS_W,
      y_pct: box.y_px / MIMIC_CANVAS_H,
    });
    const list = byRef.get(ref) ?? [];
    list.push(box);
    byRef.set(ref, list);
  }
  for (const [, group] of byRef) {
    if (group.length < 2) continue;
    for (let i = 1; i < group.length; i++) {
      const dup = group[i]!;
      findings.push({
        check: "duplicate_layer",
        severity: "warning",
        blocking: false,
        layer_key: dup.layer_key,
        message: "Duplicate text layer at same reference position",
      });
    }
  }
  return findings;
}

export function detectMissingText(
  boxes: LayoutQaBox[],
  expected: { headline?: string; body?: string }
): MimicLayoutFinding[] {
  const headline = String(expected.headline ?? "").trim();
  const body = String(expected.body ?? "").trim();
  const expectsCopy = headline.length >= 4 || body.length >= 12;
  const visibleText = boxes.map((b) => b.text).join("\n").trim();
  if (!expectsCopy) return [];
  // Hard block only when the slide should have copy but layout boxes are empty.
  if (visibleText.length === 0) {
    return [
      {
        check: "missing_text",
        severity: "blocking",
        blocking: true,
        message: "No on-slide copy in layout boxes after render",
      },
    ];
  }
  return [];
}

export function contrastFinding(
  layerKey: string,
  contrastRatio: number | null
): MimicLayoutFinding | null {
  if (contrastRatio == null || !Number.isFinite(contrastRatio)) return null;
  if (contrastRatio >= MIN_CONTRAST_RATIO) return null;
  return {
    check: "low_contrast",
    severity: "warning",
    blocking: false,
    layer_key: layerKey,
    message: `Low text contrast (${contrastRatio.toFixed(1)}:1)`,
  };
}

export function findingsToBadges(findings: MimicLayoutFinding[]): string[] {
  if (findings.length === 0) return ["pass"];
  const badges = new Set<string>();
  for (const f of findings) {
    if (f.check === "collision") badges.add("collision");
    else if (f.check === "overflow" || f.check === "margin") badges.add("overflow");
    else if (f.check === "missing_text") badges.add("missing");
    else if (f.check === "duplicate_layer") badges.add("duplicate");
    else if (f.check === "low_contrast") badges.add("contrast");
    else if (f.check === "subject_overlap") badges.add("collision");
  }
  return [...badges];
}

export function scoreLayoutFindings(findings: MimicLayoutFinding[]): number {
  if (findings.length === 0) return 1;
  let penalty = 0;
  for (const f of findings) {
    penalty += f.blocking ? 0.22 : 0.08;
  }
  return Math.max(0, Math.min(1, 1 - penalty));
}

/** Findings that justify a hard BLOCKED status (not merely layout editor attention). */
export function isHardLayoutReviewBlocker(finding: MimicLayoutFinding): boolean {
  return finding.blocking === true;
}

export function slideHasHardLayoutFailure(findings: MimicLayoutFinding[]): boolean {
  return findings.some(isHardLayoutReviewBlocker);
}

/** Soft issues still trigger auto-reprint attempts and Review badges. */
export function slideNeedsLayoutAttention(findings: MimicLayoutFinding[]): boolean {
  return findings.length > 0;
}

export function slidePassesLayoutQa(findings: MimicLayoutFinding[], _minScore = 0.72): boolean {
  return !slideHasHardLayoutFailure(findings);
}

export function slideLayoutAutoFixWarranted(findings: MimicLayoutFinding[]): boolean {
  return findings.some((f) =>
    ["collision", "margin", "overflow", "subject_overlap"].includes(f.check)
  );
}

export function proposeLayoutNudgePatches(
  boxes: LayoutQaBox[],
  findings: MimicLayoutFinding[]
): LayoutQaPatch[] {
  const patches: LayoutQaPatch[] = [];
  const patched = new Map<string, LayoutQaBox>(boxes.map((b) => [b.layer_key, { ...b }]));

  for (const f of findings) {
    if (!f.layer_key) continue;
    const box = patched.get(f.layer_key);
    if (!box) continue;

    if (f.check === "collision") {
      const others = [...patched.values()].filter((b) => b.layer_key !== box.layer_key);
      let dy = 0;
      for (const other of others) {
        if (!boxesOverlap(box, other, 0)) continue;
        const overlap = box.y_px + box.h_px + OVERLAP_GAP_PX - other.y_px;
        if (overlap > dy) dy = overlap;
      }
      if (dy > 0) {
        box.y_px = Math.min(MIMIC_CANVAS_H - box.h_px - MIMIC_DOCAI_CANVAS_SAFE_MARGIN_PX, box.y_px + dy);
        patched.set(box.layer_key, box);
        patches.push({
          layer_key: box.layer_key,
          x_px: box.x_px,
          y_px: box.y_px,
          fix_reason: "collision",
        });
      }
    }

    if (f.check === "margin" || f.check === "overflow") {
      const m = MIMIC_DOCAI_CANVAS_SAFE_MARGIN_PX;
      let { x_px, y_px } = box;
      if (x_px < m) x_px = m;
      if (y_px < m) y_px = m;
      if (x_px + box.w_px > MIMIC_CANVAS_W - m) x_px = MIMIC_CANVAS_W - m - box.w_px;
      if (y_px + box.h_px > MIMIC_CANVAS_H - m) y_px = MIMIC_CANVAS_H - m - box.h_px;
      if (x_px !== box.x_px || y_px !== box.y_px) {
        box.x_px = x_px;
        box.y_px = y_px;
        patched.set(box.layer_key, box);
        patches.push({ layer_key: box.layer_key, x_px, y_px, fix_reason: f.check });
      }
    }

    if (f.check === "subject_overlap") {
      const norm = {
        x: box.x_px / MIMIC_CANVAS_W,
        y: box.y_px / MIMIC_CANVAS_H,
        w: box.w_px / MIMIC_CANVAS_W,
        h: box.h_px / MIMIC_CANVAS_H,
      };
      const nudged = nudgeBBoxAwayFromFullBleedSubjectZone(norm);
      const x_px = Math.round(nudged.x * MIMIC_CANVAS_W);
      const y_px = Math.round(nudged.y * MIMIC_CANVAS_H);
      if (x_px !== box.x_px || y_px !== box.y_px) {
        box.x_px = x_px;
        box.y_px = y_px;
        patched.set(box.layer_key, box);
        patches.push({ layer_key: box.layer_key, x_px, y_px, fix_reason: "subject_overlap" });
      }
    }
  }

  const deduped = new Map<string, LayoutQaPatch>();
  for (const p of patches) deduped.set(p.layer_key, p);
  return [...deduped.values()];
}

export function applyLayoutQaPatchesToOverrides(
  baseLayers: MimicDocAiLayerPositionLayer[],
  existing: MimicDocAiLayerPositionOverride[] | null | undefined,
  patches: LayoutQaPatch[]
): MimicDocAiLayerPositionOverride[] {
  const base =
    existing && existing.length > 0 ? [...existing] : layersToPositionOverrides(baseLayers);
  if (patches.length === 0) return base;
  const byKey = new Map(base.map((o) => [o.layer_key, { ...o }]));
  const byRef = new Map(base.map((o) => [mimicDocAiLayerRefKeyFromOverride(o, baseLayers), o.layer_key]));

  for (const patch of patches) {
    let row = byKey.get(patch.layer_key);
    if (!row) {
      const ref = mimicDocAiLayerRefKeyFromOverrideKey(patch.layer_key);
      const altKey = byRef.get(ref);
      if (altKey) row = byKey.get(altKey);
    }
    if (!row) {
      row = { layer_key: patch.layer_key, x_px: patch.x_px, y_px: patch.y_px };
      byKey.set(patch.layer_key, row);
    } else {
      row.x_px = patch.x_px;
      row.y_px = patch.y_px;
    }
  }
  return [...byKey.values()];
}

function mimicDocAiLayerRefKeyFromOverrideKey(layerKey: string): string {
  const colon = layerKey.indexOf(":");
  return colon >= 0 ? layerKey.slice(0, colon) : layerKey;
}

function mimicDocAiLayerRefKeyFromOverride(
  o: MimicDocAiLayerPositionOverride,
  baseLayers: MimicDocAiLayerPositionLayer[]
): string {
  const fromKey = mimicDocAiLayerRefKeyFromOverrideKey(o.layer_key);
  const match = baseLayers.find((l) => mimicDocAiLayerPositionKey(l) === o.layer_key);
  if (match) return mimicDocAiLayerRefKey(match);
  return fromKey;
}

export function buildLayoutQcPayload(
  slideResults: MimicLayoutSlideQa[],
  opts: { iterations: number; blockReview: boolean }
): MimicLayoutQcV1 {
  const scores = slideResults.map((s) => s.score);
  const overall =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 1;
  const pass = slideResults.every((s) => s.pass);
  const review_attention = slideResults.some((s) => slideNeedsLayoutAttention(s.findings));
  const slides: Record<string, MimicLayoutSlideQa> = {};
  for (const s of slideResults) slides[String(s.slide_index)] = s;
  return {
    schema_version: MIMIC_LAYOUT_QC_SCHEMA,
    analyzed_at: new Date().toISOString(),
    iterations: opts.iterations,
    pass,
    overall_score: Math.round(overall * 1000) / 1000,
    review_attention,
    block_review: opts.blockReview,
    slides,
  };
}

export function shouldHardBlockReviewFromSlides(slideResults: MimicLayoutSlideQa[]): boolean {
  return slideResults.some((s) => slideHasHardLayoutFailure(s.findings));
}

export function pickLayoutQcFromPayload(gp: Record<string, unknown> | null | undefined): MimicLayoutQcV1 | null {
  const raw = gp?.layout_qc;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (rec.schema_version !== MIMIC_LAYOUT_QC_SCHEMA) return null;
  return raw as MimicLayoutQcV1;
}
