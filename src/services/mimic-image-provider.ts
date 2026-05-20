import type { AppConfig } from "../config.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import type { Pool } from "pg";

export interface MimicImageEditParams {
  referenceUrl: string;
  prompt: string;
  size?: string;
  inputFidelity?: "high" | "low";
  quality?: string;
  /** Optional audit context */
  audit?: {
    db: Pool;
    projectId: string;
    runId: string | null;
    taskId: string;
    step: string;
  };
}

export interface MimicImageEditResult {
  buffer: Buffer;
  mimeType: string;
}

async function downloadReferenceAsBlob(referenceUrl: string): Promise<{ blob: Blob; mimeType: string }> {
  const res = await fetch(referenceUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to download mimic reference (${res.status}): ${referenceUrl.slice(0, 120)}`);
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return { blob: new Blob([buf], { type: mimeType }), mimeType };
}

/**
 * OpenAI Images API edit — reference-conditioned generation (gpt-image-1).
 */
export async function editImageFromReference(
  config: AppConfig,
  params: MimicImageEditParams
): Promise<MimicImageEditResult> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for mimic image generation");

  const started = Date.now();
  const { blob, mimeType: refMime } = await downloadReferenceAsBlob(params.referenceUrl);
  const form = new FormData();
  form.append("model", config.OPENAI_IMAGE_MODEL);
  form.append("prompt", params.prompt);
  form.append("image[]", blob, `reference.${refMime.includes("jpeg") ? "jpg" : "png"}`);
  form.append("size", params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE);
  form.append("quality", params.quality ?? config.MIMIC_IMAGE_QUALITY);
  form.append("input_fidelity", params.inputFidelity ?? config.MIMIC_IMAGE_INPUT_FIDELITY);
  form.append("n", "1");

  const base = config.OPENAI_API_BASE.replace(/\/$/, "");
  const res = await fetch(`${base}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const latencyMs = Math.max(0, Date.now() - started);
  const rawText = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    parsed = { raw: rawText.slice(0, 500) };
  }

  if (params.audit) {
    await tryInsertApiCallAudit(params.audit.db, {
      projectId: params.audit.projectId,
      runId: params.audit.runId,
      taskId: params.audit.taskId,
      step: params.audit.step,
      provider: "openai",
      model: config.OPENAI_IMAGE_MODEL,
      ok: res.ok,
      requestJson: {
        endpoint: `${base}/images/edits`,
        prompt: params.prompt.slice(0, 500),
        size: params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE,
        input_fidelity: params.inputFidelity ?? config.MIMIC_IMAGE_INPUT_FIDELITY,
      },
      responseJson: res.ok ? { data_count: Array.isArray(parsed.data) ? parsed.data.length : 0 } : parsed,
      latencyMs,
    });
  }

  if (!res.ok) {
    const errMsg =
      asRecord(parsed.error)?.message ??
      (typeof parsed.error === "string" ? parsed.error : rawText.slice(0, 300));
    throw new Error(`OpenAI image edit failed (${res.status}): ${String(errMsg)}`);
  }

  const data = Array.isArray(parsed.data) ? parsed.data : [];
  const first = asRecord(data[0]);
  const b64 = first?.b64_json;
  if (typeof b64 === "string" && b64.length > 0) {
    return { buffer: Buffer.from(b64, "base64"), mimeType: "image/png" };
  }
  const url = typeof first?.url === "string" ? first.url : null;
  if (url) {
    const dl = await fetch(url);
    if (!dl.ok) throw new Error(`Failed to download OpenAI image result (${dl.status})`);
    const ct = dl.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { buffer: Buffer.from(await dl.arrayBuffer()), mimeType: ct };
  }
  throw new Error("OpenAI image edit returned no image data");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}
