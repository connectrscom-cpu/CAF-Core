import type { AppConfig } from "../config.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import type { Pool } from "pg";

export type MimicImageProvider = "openai" | "nvidia";

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

export interface MimicImageCallConfig {
  provider: MimicImageProvider;
  model: string;
  apiKey: string;
  editsEndpoint: string;
  /** Stored on assets / render_manifest for traceability. */
  providerLabel: string;
}

function apiBaseUrl(base: string): string {
  return base.replace(/\/$/, "");
}

function imagesEditsUrl(apiBase: string): string {
  const base = apiBaseUrl(apiBase);
  return base.endsWith("/images/edits") ? base : `${base}/images/edits`;
}

function mimicProviderLabel(provider: MimicImageProvider, model: string): string {
  const trimmed = model.trim();
  const tail = trimmed.includes("/")
    ? trimmed.split("/").slice(1).join("-") || trimmed.split("/").pop()!
    : trimmed;
  return `${provider}-${tail}`;
}

/** Resolve mimic render provider (OpenAI gpt-image-1 or NVIDIA NIM Qwen image edit). */
export function resolveMimicImageCall(config: AppConfig): MimicImageCallConfig {
  const provider = config.MIMIC_IMAGE_PROVIDER;

  if (provider === "nvidia") {
    const model = config.MIMIC_IMAGE_NVIDIA_MODEL.trim() || "qwen/qwen-image-edit";
    return {
      provider: "nvidia",
      model,
      apiKey: config.NVIDIA_NIM_API_KEY?.trim() ?? "",
      editsEndpoint: imagesEditsUrl(config.NVIDIA_NIM_API_BASE),
      providerLabel: mimicProviderLabel("nvidia", model),
    };
  }

  const model = config.OPENAI_IMAGE_MODEL.trim() || "gpt-image-1";
  return {
    provider: "openai",
    model,
    apiKey: config.OPENAI_API_KEY?.trim() ?? "",
    editsEndpoint: imagesEditsUrl(config.OPENAI_API_BASE),
    providerLabel: mimicProviderLabel("openai", model),
  };
}

export function mimicImageProviderAssetLabel(config: AppConfig): string {
  return resolveMimicImageCall(config).providerLabel;
}

export function assertMimicImageProviderConfigured(config: AppConfig): MimicImageCallConfig {
  const call = resolveMimicImageCall(config);
  if (!call.apiKey) {
    if (call.provider === "nvidia") {
      throw new Error("NVIDIA_NIM_API_KEY is required when MIMIC_IMAGE_PROVIDER=nvidia");
    }
    throw new Error("OPENAI_API_KEY is required when MIMIC_IMAGE_PROVIDER=openai");
  }
  return call;
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

function referenceFilename(mimeType: string): string {
  return `reference.${mimeType.includes("jpeg") ? "jpg" : "png"}`;
}

function buildEditForm(
  call: MimicImageCallConfig,
  config: AppConfig,
  params: MimicImageEditParams,
  blob: Blob,
  refMime: string
): FormData {
  const form = new FormData();
  form.append("model", call.model);
  form.append("prompt", params.prompt);
  form.append("image[]", blob, referenceFilename(refMime));
  form.append("size", params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE);
  form.append("n", "1");

  if (call.provider === "openai") {
    form.append("quality", params.quality ?? config.MIMIC_IMAGE_QUALITY);
    form.append("input_fidelity", params.inputFidelity ?? config.MIMIC_IMAGE_INPUT_FIDELITY);
  }

  return form;
}

async function parseImageEditResponse(parsed: Record<string, unknown>): Promise<MimicImageEditResult> {
  const data = Array.isArray(parsed.data) ? parsed.data : [];
  const first = asRecord(data[0]);
  const b64 = first?.b64_json;
  if (typeof b64 === "string" && b64.length > 0) {
    return { buffer: Buffer.from(b64, "base64"), mimeType: "image/png" };
  }
  const url = typeof first?.url === "string" ? first.url : null;
  if (url) {
    const dl = await fetch(url);
    if (!dl.ok) throw new Error(`Failed to download image edit result (${dl.status})`);
    const ct = dl.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { buffer: Buffer.from(await dl.arrayBuffer()), mimeType: ct };
  }
  throw new Error("Image edit returned no image data");
}

/**
 * Reference-conditioned image edit/generate for mimic flows.
 * Downloads archived inspection media (signed Supabase URL) and sends it to the configured provider.
 */
export async function editImageFromReference(
  config: AppConfig,
  params: MimicImageEditParams
): Promise<MimicImageEditResult> {
  const call = assertMimicImageProviderConfigured(config);
  const started = Date.now();
  const { blob, mimeType: refMime } = await downloadReferenceAsBlob(params.referenceUrl);
  const form = buildEditForm(call, config, params, blob, refMime);

  const res = await fetch(call.editsEndpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${call.apiKey}` },
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
      provider: call.provider,
      model: call.model,
      ok: res.ok,
      requestJson: {
        endpoint: call.editsEndpoint,
        mimic_provider: call.provider,
        prompt: params.prompt.slice(0, 500),
        size: params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE,
        ...(call.provider === "openai"
          ? { input_fidelity: params.inputFidelity ?? config.MIMIC_IMAGE_INPUT_FIDELITY }
          : {}),
      },
      responseJson: res.ok ? { data_count: Array.isArray(parsed.data) ? parsed.data.length : 0 } : parsed,
      latencyMs,
    });
  }

  if (!res.ok) {
    const errMsg =
      asRecord(parsed.error)?.message ??
      (typeof parsed.error === "string" ? parsed.error : rawText.slice(0, 300));
    const label = call.provider === "nvidia" ? "NVIDIA NIM Qwen image edit" : "OpenAI image edit";
    throw new Error(`${label} failed (${res.status}): ${String(errMsg)}`);
  }

  return parseImageEditResponse(parsed);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}
