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

/** Catalog model id for NVIDIA Visual GenAI (often without vendor prefix). */
export function nvidiaImageEditModelId(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "qwen-image-edit";
  if (trimmed.includes("/")) {
    return trimmed.split("/").pop()!.trim() || "qwen-image-edit";
  }
  return trimmed;
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
      if (config.MIMIC_IMAGE_NVIDIA_FALLBACK_OPENAI && config.OPENAI_API_KEY?.trim()) {
        return resolveMimicImageCall({ ...config, MIMIC_IMAGE_PROVIDER: "openai" });
      }
      throw new Error("NVIDIA_NIM_API_KEY is required when MIMIC_IMAGE_PROVIDER=nvidia");
    }
    throw new Error("OPENAI_API_KEY is required when MIMIC_IMAGE_PROVIDER=openai");
  }
  return call;
}

export function isNvidiaVisualGenAiUnavailable(status: number, rawText: string): boolean {
  return status === 404 || /page not found/i.test(rawText);
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

function buildOpenAiEditForm(
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
  form.append("quality", params.quality ?? config.MIMIC_IMAGE_QUALITY);
  form.append("input_fidelity", params.inputFidelity ?? config.MIMIC_IMAGE_INPUT_FIDELITY);
  return form;
}

function buildNvidiaEditJsonBody(
  call: MimicImageCallConfig,
  config: AppConfig,
  params: MimicImageEditParams,
  refMime: string,
  imageBuffer: Buffer
): Record<string, unknown> {
  const imageB64 = imageBuffer.toString("base64");
  return {
    model: nvidiaImageEditModelId(call.model),
    prompt: params.prompt,
    image: `data:${refMime};base64,${imageB64}`,
    size: params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE,
    n: 1,
    response_format: "b64_json",
  };
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

async function auditImageEditCall(args: {
  params: MimicImageEditParams;
  call: MimicImageCallConfig;
  config: AppConfig;
  res: Response;
  parsed: Record<string, unknown>;
  latencyMs: number;
  extraRequest?: Record<string, unknown>;
}): Promise<void> {
  if (!args.params.audit) return;
  await tryInsertApiCallAudit(args.params.audit.db, {
    projectId: args.params.audit.projectId,
    runId: args.params.audit.runId,
    taskId: args.params.audit.taskId,
    step: args.params.audit.step,
    provider: args.call.provider,
    model: args.call.model,
    ok: args.res.ok,
    requestJson: {
      endpoint: args.call.editsEndpoint,
      mimic_provider: args.call.provider,
      prompt: args.params.prompt.slice(0, 500),
      size: args.params.size ?? args.config.MIMIC_IMAGE_DEFAULT_SIZE,
      ...(args.call.provider === "openai"
        ? { input_fidelity: args.params.inputFidelity ?? args.config.MIMIC_IMAGE_INPUT_FIDELITY }
        : { response_format: "b64_json" }),
      ...args.extraRequest,
    },
    responseJson: args.res.ok
      ? { data_count: Array.isArray(args.parsed.data) ? args.parsed.data.length : 0 }
      : args.parsed,
    latencyMs: args.latencyMs,
  });
}

function providerErrorLabel(provider: MimicImageProvider): string {
  return provider === "nvidia" ? "NVIDIA NIM Qwen image edit" : "OpenAI image edit";
}

function nvidiaUnavailableMessage(status: number, rawText: string): string {
  return (
    `${providerErrorLabel("nvidia")} failed (${status}): Visual GenAI endpoint is not available on ` +
    `integrate.api.nvidia.com for this API key (Nemotron chat works; /images/edits does not). ` +
    `Set MIMIC_IMAGE_PROVIDER=openai or enable MIMIC_IMAGE_NVIDIA_FALLBACK_OPENAI. ` +
    `Detail: ${rawText.slice(0, 120).trim()}`
  );
}

async function postImageEdit(args: {
  call: MimicImageCallConfig;
  config: AppConfig;
  params: MimicImageEditParams;
  body: BodyInit;
  contentType: "multipart" | "json";
  extraRequest?: Record<string, unknown>;
}): Promise<MimicImageEditResult> {
  const started = Date.now();
  const headers: Record<string, string> = { Authorization: `Bearer ${args.call.apiKey}` };
  if (args.contentType === "json") {
    headers["Content-Type"] = "application/json";
    headers.Accept = "application/json";
  }

  const res = await fetch(args.call.editsEndpoint, {
    method: "POST",
    headers,
    body: args.body,
  });

  const latencyMs = Math.max(0, Date.now() - started);
  const rawText = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    parsed = { raw: rawText.slice(0, 500) };
  }

  await auditImageEditCall({
    params: args.params,
    call: args.call,
    config: args.config,
    res,
    parsed,
    latencyMs,
    extraRequest: args.extraRequest,
  });

  if (!res.ok) {
    const errMsg =
      asRecord(parsed.error)?.message ??
      (typeof parsed.error === "string" ? parsed.error : rawText.slice(0, 300));
    if (args.call.provider === "nvidia" && isNvidiaVisualGenAiUnavailable(res.status, rawText)) {
      throw new Error(nvidiaUnavailableMessage(res.status, rawText));
    }
    throw new Error(`${providerErrorLabel(args.call.provider)} failed (${res.status}): ${String(errMsg)}`);
  }

  return parseImageEditResponse(parsed);
}

async function editViaOpenAi(
  config: AppConfig,
  params: MimicImageEditParams,
  blob: Blob,
  refMime: string,
  extraRequest?: Record<string, unknown>
): Promise<MimicImageEditResult> {
  const call = resolveMimicImageCall({ ...config, MIMIC_IMAGE_PROVIDER: "openai" });
  if (!call.apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI image edit");
  return postImageEdit({
    call,
    config,
    params,
    body: buildOpenAiEditForm(call, config, params, blob, refMime),
    contentType: "multipart",
    extraRequest,
  });
}

async function editViaNvidia(
  config: AppConfig,
  params: MimicImageEditParams,
  blob: Blob,
  refMime: string,
  imageBuffer: Buffer
): Promise<MimicImageEditResult> {
  const call = resolveMimicImageCall(config);
  if (!call.apiKey) throw new Error("NVIDIA_NIM_API_KEY is required when MIMIC_IMAGE_PROVIDER=nvidia");
  return postImageEdit({
    call,
    config,
    params,
    body: JSON.stringify(buildNvidiaEditJsonBody(call, config, params, refMime, imageBuffer)),
    contentType: "json",
  });
}

/**
 * Reference-conditioned image edit/generate for mimic flows.
 * Downloads archived inspection media (signed Supabase URL) and sends it to the configured provider.
 */
export async function editImageFromReference(
  config: AppConfig,
  params: MimicImageEditParams
): Promise<MimicImageEditResult> {
  assertMimicImageProviderConfigured(config);
  const { blob, mimeType: refMime } = await downloadReferenceAsBlob(params.referenceUrl);
  const imageBuffer = Buffer.from(await blob.arrayBuffer());

  if (config.MIMIC_IMAGE_PROVIDER !== "nvidia") {
    return editViaOpenAi(config, params, blob, refMime);
  }

  try {
    return await editViaNvidia(config, params, blob, refMime, imageBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const canFallback =
      config.MIMIC_IMAGE_NVIDIA_FALLBACK_OPENAI && Boolean(config.OPENAI_API_KEY?.trim());
    if (!canFallback || !msg.includes("Visual GenAI endpoint is not available")) {
      throw err;
    }
    return editViaOpenAi(config, params, blob, refMime, {
      fallback_from: "nvidia",
      fallback_reason: "visual_genai_unavailable",
    });
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}
