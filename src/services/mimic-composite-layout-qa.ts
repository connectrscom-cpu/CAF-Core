import sharp from "sharp";
import type { AppConfig } from "../config.js";
import type { MimicDocAiLayerPositionLayer } from "../domain/mimic-docai-layer-positions.js";
import {
  buildLayoutQcPayload,
  contrastFinding,
  detectBoxCollisions,
  detectDuplicateLayers,
  detectMarginViolations,
  detectMissingText,
  detectSubjectOverlap,
  findingsToBadges,
  proposeLayoutNudgePatches,
  scoreLayoutFindings,
  slideLayoutAutoFixWarranted,
  slidePassesLayoutQa,
  visibleLayoutBoxes,
  type LayoutQaPatch,
  type MimicLayoutSlideQa,
} from "../domain/mimic-composite-layout-qa.js";
import { downloadBufferFromUrl } from "./supabase-storage.js";
import { logPipelineEvent } from "./pipeline-logger.js";

function parseHexLuminance(hex: string): number {
  const h = hex.replace(/^#/, "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Sample mean luminance under a box region on the composite PNG. */
export async function sampleBoxRegionLuminance(
  pngBuffer: Buffer,
  box: { x_px: number; y_px: number; w_px: number; h_px: number }
): Promise<number> {
  const meta = await sharp(pngBuffer).metadata();
  const imgW = meta.width ?? 1080;
  const imgH = meta.height ?? 1350;
  const scaleX = imgW / 1080;
  const scaleY = imgH / 1350;
  const left = Math.max(0, Math.floor(box.x_px * scaleX));
  const top = Math.max(0, Math.floor(box.y_px * scaleY));
  const width = Math.max(1, Math.min(imgW - left, Math.ceil(box.w_px * scaleX)));
  const height = Math.max(1, Math.min(imgH - top, Math.ceil(box.h_px * scaleY)));
  const { data } = await sharp(pngBuffer)
    .extract({ left, top, width, height })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!data.length) return 0.5;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += (data[i] ?? 0) / 255;
  return sum / data.length;
}

export async function estimateTextContrastUnderBox(
  pngBuffer: Buffer,
  box: { x_px: number; y_px: number; w_px: number; h_px: number },
  textColorHex = "#111111"
): Promise<number> {
  const bgLum = await sampleBoxRegionLuminance(pngBuffer, box);
  const textLum = parseHexLuminance(textColorHex);
  return contrastRatio(bgLum, textLum);
}

export type AnalyzeSlideLayoutOpts = {
  slideIndex1Based: number;
  pngBuffer?: Buffer | null;
  layers: MimicDocAiLayerPositionLayer[];
  expectedCopy?: { headline?: string; body?: string };
  minPassScore?: number;
  checkContrast?: boolean;
};

export async function analyzeSlideCompositeLayout(
  opts: AnalyzeSlideLayoutOpts
): Promise<MimicLayoutSlideQa> {
  const boxes = visibleLayoutBoxes(opts.layers);
  const findings = [
    ...detectBoxCollisions(boxes),
    ...detectMarginViolations(boxes),
    ...detectSubjectOverlap(boxes),
    ...detectDuplicateLayers(boxes),
    ...(opts.expectedCopy ? detectMissingText(boxes, opts.expectedCopy) : []),
  ];

  if (opts.checkContrast !== false && opts.pngBuffer && opts.pngBuffer.length > 0) {
    for (const box of boxes) {
      try {
        const ratio = await estimateTextContrastUnderBox(opts.pngBuffer, box);
        const cf = contrastFinding(box.layer_key, ratio);
        if (cf) findings.push(cf);
      } catch {
        // Non-fatal — geometry checks still apply
      }
    }
  }

  const score = scoreLayoutFindings(findings);
  const minScore = opts.minPassScore ?? 0.72;
  return {
    slide_index: opts.slideIndex1Based,
    score,
    pass: slidePassesLayoutQa(findings, minScore),
    badges: findingsToBadges(findings),
    findings,
  };
}

export async function loadSlidePngBuffer(
  config: AppConfig,
  publicUrl: string | null | undefined
): Promise<Buffer | null> {
  const url = String(publicUrl ?? "").trim();
  if (!url) return null;
  try {
    return await downloadBufferFromUrl(config, url);
  } catch {
    return null;
  }
}

export function collectLayoutPatchesForSlide(
  layers: MimicDocAiLayerPositionLayer[],
  slideQa: MimicLayoutSlideQa
): LayoutQaPatch[] {
  if (!slideLayoutAutoFixWarranted(slideQa.findings)) return [];
  const boxes = visibleLayoutBoxes(layers);
  return proposeLayoutNudgePatches(boxes, slideQa.findings);
}

export function summarizeLayoutQc(
  slideResults: MimicLayoutSlideQa[],
  opts: { iterations: number; blockReview: boolean }
) {
  return buildLayoutQcPayload(slideResults, opts);
}

export function logLayoutQcSummary(
  taskId: string,
  payload: ReturnType<typeof buildLayoutQcPayload>
): void {
  const failed = Object.values(payload.slides).filter((s) => !s.pass);
  logPipelineEvent(payload.pass ? "info" : "warn", "qc", "mimic composite layout QA finished", {
    task_id: taskId,
    data: {
      pass: payload.pass,
      overall_score: payload.overall_score,
      block_review: payload.block_review,
      iterations: payload.iterations,
      failed_slides: failed.map((s) => s.slide_index),
    },
  });
}
