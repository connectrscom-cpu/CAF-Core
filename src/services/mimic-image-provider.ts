import type { AppConfig } from "../config.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import type { Pool } from "pg";

export type MimicImageProvider = "openai" | "nvidia" | "dashscope";

export interface MimicImageEditParams {
  referenceUrl: string;
  prompt: string;
  size?: string;
  inputFidelity?: "high" | "low";
  quality?: string;
  /** Second image for cross-slide consistency (DashScope multi-image input). */
  previousSlideUrl?: string;
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

function dashScopeGenerationUrl(apiBase: string): string {
  const base = apiBaseUrl(apiBase);
  if (base.includes("/services/aigc/multimodal-generation/generation")) return base;
  return `${base}/services/aigc/multimodal-generation/generation`;
}

/** CAF carousel size `1024x1536` → DashScope `1024*1536`. */
export function dashScopeSizeParam(size: string | undefined): string {
  const trimmed = (size ?? "").trim();
  if (!trimmed || trimmed === "auto") return "1024*1536";
  return trimmed.replace(/x/gi, "*");
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

/** Resolve mimic render provider (DashScope Qwen, NVIDIA NIM, or OpenAI gpt-image-1). */
export function resolveMimicImageCall(config: AppConfig): MimicImageCallConfig {
  const provider = config.MIMIC_IMAGE_PROVIDER;

  if (provider === "dashscope") {
    const model = config.MIMIC_IMAGE_DASHSCOPE_MODEL.trim() || "qwen-image-edit-max";
    return {
      provider: "dashscope",
      model,
      apiKey: config.DASHSCOPE_API_KEY?.trim() ?? "",
      editsEndpoint: dashScopeGenerationUrl(config.DASHSCOPE_API_BASE),
      providerLabel: mimicProviderLabel("dashscope", model),
    };
  }

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
    if (call.provider === "dashscope") {
      throw new Error("DASHSCOPE_API_KEY is required when MIMIC_IMAGE_PROVIDER=dashscope");
    }
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

export function isVisualGenAiUnavailableError(message: string): boolean {
  return message.includes("Visual GenAI endpoint is not available");
}

/** Probe hosted NVIDIA Visual GenAI (/images/edits). 404 = unavailable; 4xx with body = route exists. */
export async function isNvidiaVisualGenAiReachable(config: AppConfig): Promise<boolean> {
  if (config.MIMIC_IMAGE_PROVIDER !== "nvidia") return true;
  const key = config.NVIDIA_NIM_API_KEY?.trim();
  if (!key) return false;
  const form = new FormData();
  form.append("model", nvidiaImageEditModelId(config.MIMIC_IMAGE_NVIDIA_MODEL));
  form.append("prompt", "probe");
  form.append("n", "1");
  const res = await fetch(imagesEditsUrl(config.NVIDIA_NIM_API_BASE), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const rawText = await res.text();
  return !isNvidiaVisualGenAiUnavailable(res.status, rawText);
}

async function referencePassthroughResult(
  config: AppConfig,
  params: MimicImageEditParams,
  blob: Blob,
  refMime: string
): Promise<MimicImageEditResult> {
  const buffer = Buffer.from(await blob.arrayBuffer());
  if (params.audit) {
    const call = resolveMimicImageCall(config);
    await tryInsertApiCallAudit(params.audit.db, {
      projectId: params.audit.projectId,
      runId: params.audit.runId,
      taskId: params.audit.taskId,
      step: params.audit.step,
      provider: call.provider,
      model: call.model,
      ok: true,
      requestJson: {
        endpoint: call.editsEndpoint,
        mimic_provider: call.provider,
        fallback: "reference_passthrough",
        fallback_reason: "visual_genai_unavailable",
        prompt: params.prompt,
        reference_url: params.referenceUrl,
      },
      responseJson: { used_reference_bytes: buffer.length, mime_type: refMime },
      latencyMs: 0,
    });
  }
  return { buffer, mimeType: refMime };
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

function buildNvidiaEditForm(
  call: MimicImageCallConfig,
  config: AppConfig,
  params: MimicImageEditParams,
  blob: Blob,
  refMime: string
): FormData {
  const form = new FormData();
  form.append("model", nvidiaImageEditModelId(call.model));
  form.append("prompt", params.prompt);
  form.append("image[]", blob, referenceFilename(refMime));
  form.append("size", params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE);
  form.append("n", "1");
  form.append("response_format", "b64_json");
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
      prompt: args.params.prompt,
      reference_url: args.params.referenceUrl,
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
  if (provider === "dashscope") return "DashScope Qwen image edit";
  if (provider === "nvidia") return "NVIDIA NIM Qwen image edit";
  return "OpenAI image edit";
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
  refMime: string
): Promise<MimicImageEditResult> {
  const call = resolveMimicImageCall(config);
  if (!call.apiKey) throw new Error("NVIDIA_NIM_API_KEY is required when MIMIC_IMAGE_PROVIDER=nvidia");
  return postImageEdit({
    call,
    config,
    params,
    body: buildNvidiaEditForm(call, config, params, blob, refMime),
    contentType: "multipart",
    extraRequest: { response_format: "b64_json" },
  });
}

function buildDashScopeEditBody(
  call: MimicImageCallConfig,
  config: AppConfig,
  params: MimicImageEditParams
): Record<string, unknown> {
  const content: Array<Record<string, string>> = [{ image: params.referenceUrl }];
  if (params.previousSlideUrl) {
    content.push({ image: params.previousSlideUrl });
  }
  content.push({ text: params.prompt });

  return {
    model: call.model,
    input: {
      messages: [{ role: "user", content }],
    },
    parameters: {
      n: 1,
      watermark: false,
      negative_prompt:
        "watermark, logo, @handle, instagram handle, brand tag, exact copy, duplicate illustration, landscape, horizontal",
      prompt_extend: false,
      size: dashScopeSizeParam(params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE),
    },
  };
}

async function parseDashScopeImageEditResponse(parsed: Record<string, unknown>): Promise<MimicImageEditResult> {
  const code = typeof parsed.code === "string" ? parsed.code.trim() : "";
  if (code) {
    const message = typeof parsed.message === "string" ? parsed.message : code;
    throw new Error(`DashScope Qwen image edit failed: ${message}`);
  }
  const output = asRecord(parsed.output);
  const choices = Array.isArray(output?.choices) ? output!.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const content = Array.isArray(message?.content) ? message!.content : [];
  for (const item of content) {
    const rec = asRecord(item);
    const imageRef = typeof rec?.image === "string" ? rec.image.trim() : "";
    if (!imageRef) continue;
    if (imageRef.startsWith("data:")) {
      const b64 = imageRef.split(",")[1];
      if (b64) return { buffer: Buffer.from(b64, "base64"), mimeType: "image/png" };
    }
    const dl = await fetch(imageRef, { redirect: "follow" });
    if (!dl.ok) throw new Error(`Failed to download DashScope image (${dl.status})`);
    const mimeType = dl.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { buffer: Buffer.from(await dl.arrayBuffer()), mimeType };
  }
  throw new Error("DashScope Qwen image edit returned no image data");
}

const DASHSCOPE_MAX_RETRIES = 3;
const DASHSCOPE_RETRY_BASE_MS = 8_000;

function isDashScopeRetryable(status: number): boolean {
  return status === 429 || status === 503;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function editViaDashScope(config: AppConfig, params: MimicImageEditParams): Promise<MimicImageEditResult> {
  const call = resolveMimicImageCall(config);
  if (!call.apiKey) throw new Error("DASHSCOPE_API_KEY is required when MIMIC_IMAGE_PROVIDER=dashscope");
  const body = buildDashScopeEditBody(call, config, params);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= DASHSCOPE_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = DASHSCOPE_RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 2_000;
      await sleep(backoff);
    }

    const started = Date.now();
    const res = await fetch(call.editsEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${call.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
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
        ok: res.ok && !parsed.code,
        requestJson: {
          endpoint: call.editsEndpoint,
          mimic_provider: call.provider,
          prompt: params.prompt,
          reference_url: params.referenceUrl,
          size: dashScopeSizeParam(params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE),
          input: body.input,
          parameters: body.parameters,
          ...(attempt > 0 ? { retry_attempt: attempt } : {}),
        },
        responseJson: res.ok ? { request_id: parsed.request_id } : parsed,
        latencyMs,
      });
    }

    if (!res.ok) {
      const errMsg =
        typeof parsed.message === "string"
          ? parsed.message
          : asRecord(parsed.error)?.message ?? rawText.slice(0, 300);
      lastError = new Error(`${providerErrorLabel("dashscope")} failed (${res.status}): ${String(errMsg)}`);
      if (isDashScopeRetryable(res.status) && attempt < DASHSCOPE_MAX_RETRIES) continue;
      throw lastError;
    }

    return parseDashScopeImageEditResponse(parsed);
  }

  throw lastError ?? new Error("DashScope image edit: max retries exceeded");
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

  if (config.MIMIC_IMAGE_PROVIDER === "dashscope") {
    return editViaDashScope(config, params);
  }

  const { blob, mimeType: refMime } = await downloadReferenceAsBlob(params.referenceUrl);

  if (config.MIMIC_IMAGE_PROVIDER !== "nvidia") {
    return editViaOpenAi(config, params, blob, refMime);
  }

  try {
    return await editViaNvidia(config, params, blob, refMime);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isVisualGenAiUnavailableError(msg)) {
      throw err;
    }
    const canFallback =
      config.MIMIC_IMAGE_NVIDIA_FALLBACK_OPENAI && Boolean(config.OPENAI_API_KEY?.trim());
    if (canFallback) {
      return editViaOpenAi(config, params, blob, refMime, {
        fallback_from: "nvidia",
        fallback_reason: "visual_genai_unavailable",
      });
    }
    throw new Error(
      `${msg} Mimic render cannot passthrough the reference image — configure OPENAI_API_KEY with ` +
        "MIMIC_IMAGE_NVIDIA_FALLBACK_OPENAI=1 or use MIMIC_IMAGE_PROVIDER=dashscope."
    );
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}
