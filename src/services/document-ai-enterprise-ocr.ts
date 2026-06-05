/**
 * Google Document AI Enterprise OCR (computeStyleInfo) for carousel slide images.
 * @see https://docs.cloud.google.com/document-ai/docs/enterprise-document-ocr
 */
import type { AppConfig } from "../config.js";
import {
  assertDocumentAiConfigured,
  documentAiProcessUrl,
  getDocumentAiAccessToken,
} from "./document-ai-auth.js";
import { parseDocumentAiResponseToSlideOcr } from "./document-ai-response-parse.js";
import type { CarouselDocumentAiSlideOcr } from "../domain/carousel-slide-analysis.js";
import { sniffImageMedia } from "./inputs-top-performer-media-archive.js";
import { downloadBufferFromUrl } from "./supabase-storage.js";

const PROCESS_TIMEOUT_MS = 120_000;

function mimeFromUrl(url: string): string {
  const u = url.toLowerCase().split("?")[0] ?? "";
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export async function fetchImageBytesForDocumentAi(
  config: AppConfig,
  url: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const u = url.trim();
  if (u.startsWith("data:image/")) {
    const m = u.match(/^data:(image\/[^;]+);base64,(.+)$/i);
    if (!m?.[1] || !m[2]) throw new Error("invalid data:image URL");
    const buffer = Buffer.from(m[2], "base64");
    return { buffer, mimeType: m[1].toLowerCase() };
  }

  try {
    const buffer = await downloadBufferFromUrl(config, u);
    const sniffed = sniffImageMedia(buffer);
    const mimeType = sniffed?.contentType ?? mimeFromUrl(u);
    return { buffer, mimeType };
  } catch (e) {
    throw new Error(`image fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function processImageWithDocumentAiEnterpriseOcr(
  config: AppConfig,
  imageBytes: Buffer,
  mimeType: string,
  slideIndex: number
): Promise<CarouselDocumentAiSlideOcr> {
  assertDocumentAiConfigured(config);
  const token = await getDocumentAiAccessToken(config);
  const endpoint = documentAiProcessUrl(config);

  const body = {
    rawDocument: {
      content: imageBytes.toString("base64"),
      mimeType,
    },
    processOptions: {
      ocrConfig: {
        premiumFeatures: {
          computeStyleInfo: true,
        },
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROCESS_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`Document AI OCR failed (${res.status}): ${rawText.slice(0, 800)}`);
    }
    const parsed = JSON.parse(rawText) as { document?: Record<string, unknown> };
    const doc = parsed.document;
    if (!doc || typeof doc !== "object") {
      throw new Error("Document AI response missing document");
    }
    return parseDocumentAiResponseToSlideOcr(doc, slideIndex);
  } finally {
    clearTimeout(timer);
  }
}

export async function processCarouselSlideUrlWithDocumentAi(
  config: AppConfig,
  imageUrl: string,
  slideIndex: number
): Promise<CarouselDocumentAiSlideOcr> {
  const { buffer, mimeType } = await fetchImageBytesForDocumentAi(config, imageUrl);
  return processImageWithDocumentAiEnterpriseOcr(config, buffer, mimeType, slideIndex);
}

export async function processCarouselSlideUrlsWithDocumentAi(
  config: AppConfig,
  imageUrls: string[]
): Promise<{ ocrBySlide: Map<number, CarouselDocumentAiSlideOcr>; errors: string[] }> {
  const ocrBySlide = new Map<number, CarouselDocumentAiSlideOcr>();
  const errors: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i]?.trim();
    if (!url) continue;
    const slideIndex = i + 1;
    try {
      const ocr = await processCarouselSlideUrlWithDocumentAi(config, url, slideIndex);
      ocrBySlide.set(slideIndex, ocr);
    } catch (e) {
      errors.push(`slide ${slideIndex}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ocrBySlide, errors };
}
