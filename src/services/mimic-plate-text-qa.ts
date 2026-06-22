import sharp from "sharp";
import type { AppConfig } from "../config.js";
import { documentAiEnabled } from "./document-ai-auth.js";
import { processImageWithDocumentAiEnterpriseOcr } from "./document-ai-enterprise-ocr.js";
import {
  MimicPlateTextPollutionError,
  plateTextQaVerdict,
} from "../domain/mimic-plate-text-qa.js";
import { logPipelineEvent } from "./pipeline-logger.js";

export interface MimicPlateTextQaResult {
  passed: boolean;
  method: "document_ai" | "sharp_heuristic" | "skipped";
  detectedText: string[];
  suspicious: string[];
}

/** Downsampled block variance heuristic when Document AI is off. */
async function detectTextLikeRegionsHeuristic(buffer: Buffer): Promise<string[]> {
  const { data, info } = await sharp(buffer)
    .resize(270, 338, { fit: "inside" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const block = 24;
  let textLikeBlocks = 0;
  let totalBlocks = 0;
  for (let y = 0; y + block <= height; y += block) {
    for (let x = 0; x + block <= width; x += block) {
      totalBlocks++;
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const v = data[(y + dy) * width + (x + dx)] ?? 0;
          sum += v;
          sumSq += v * v;
          n++;
        }
      }
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      const std = Math.sqrt(Math.max(0, variance));
      if (std > 28 && mean > 35 && mean < 220) textLikeBlocks++;
    }
  }
  if (totalBlocks === 0) return [];
  const ratio = textLikeBlocks / totalBlocks;
  return ratio >= 0.07 ? [`heuristic_text_like_blocks:${(ratio * 100).toFixed(1)}%`] : [];
}

export async function auditMimicBackgroundPlateText(
  config: AppConfig,
  buffer: Buffer,
  mimeType: string,
  slideIndex: number,
  opts?: { taskId?: string; runId?: string }
): Promise<MimicPlateTextQaResult> {
  if (config.MIMIC_PLATE_TEXT_QA_ENABLED === false) {
    return { passed: true, method: "skipped", detectedText: [], suspicious: [] };
  }

  let detectedText: string[] = [];
  let method: MimicPlateTextQaResult["method"] = "sharp_heuristic";

  if (documentAiEnabled(config)) {
    try {
      const ocr = await processImageWithDocumentAiEnterpriseOcr(config, buffer, mimeType, slideIndex);
      detectedText = (ocr.text_layers ?? [])
        .map((l) => String(l.text ?? "").trim())
        .filter(Boolean);
      method = "document_ai";
    } catch (err) {
      logPipelineEvent("warn", "render", "mimic plate text QA Document AI failed — heuristic fallback", {
        task_id: opts?.taskId,
        run_id: opts?.runId,
        data: { slide_index: slideIndex, error: err instanceof Error ? err.message : String(err) },
      });
      detectedText = await detectTextLikeRegionsHeuristic(buffer);
      method = "sharp_heuristic";
    }
  } else {
    detectedText = await detectTextLikeRegionsHeuristic(buffer);
  }

  const { passed, suspicious } = plateTextQaVerdict(detectedText);
  return { passed, method, detectedText, suspicious };
}

export async function assertMimicBackgroundPlateTextFree(
  config: AppConfig,
  buffer: Buffer,
  mimeType: string,
  slideIndex: number,
  job: { task_id: string; run_id?: string }
): Promise<MimicPlateTextQaResult> {
  const result = await auditMimicBackgroundPlateText(config, buffer, mimeType, slideIndex, {
    taskId: job.task_id,
    runId: job.run_id,
  });
  if (!result.passed && config.MIMIC_PLATE_TEXT_QA_FAIL_ON_DETECT !== false) {
    throw new MimicPlateTextPollutionError({
      taskId: job.task_id,
      slideIndex,
      detectedText: result.suspicious.length > 0 ? result.suspicious : result.detectedText,
      method: result.method,
    });
  }
  if (!result.passed) {
    logPipelineEvent("warn", "render", "mimic plate text QA detected suspicious text (non-fatal)", {
      task_id: job.task_id,
      run_id: job.run_id,
      data: {
        slide_index: slideIndex,
        method: result.method,
        suspicious: result.suspicious.slice(0, 8),
      },
    });
  }
  return result;
}
