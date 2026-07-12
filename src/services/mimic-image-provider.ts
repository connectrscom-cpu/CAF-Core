import type { AppConfig } from "../config.js";
import type { MimicBflModelSlug } from "../domain/mimic-bfl-model.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import type { Pool } from "pg";
import { appConfigWithMimicBflModel } from "./mimic-project-config.js";
import { finalizeMimicImageModelPrompt } from "./mimic-prompt-builder.js";
import { downloadBufferFromUrl } from "./supabase-storage.js";

export type MimicImageProvider = "openai" | "nvidia" | "dashscope" | "bfl";

export interface MimicImageEditParams {
  /** Required for reference_edit; omitted for analysis_t2i text-to-image. */
  referenceUrl?: string;
  /** Additional reference images (BFL input_image_2 … input_image_8). First URL may duplicate referenceUrl. */
  referenceUrls?: string[];
  prompt: string;
  size?: string;
  inputFidelity?: "high" | "low";
  quality?: string;
  /** Project-level BFL model override (flux-2-klein-4b | flux-2-flex). */
  bflModelOverride?: MimicBflModelSlug | null;
  /** Optional audit context */
  audit?: {
    db: Pool;
    projectId: string;
    runId: string | null;
    taskId: string;
    step: string;
  };
  /** When true, skip art-only hard guard (legacy Flux text-bake — disabled in pipeline). */
  allowOnImageText?: boolean;
}

export interface MimicSlideImageParams extends MimicImageEditParams {
  /** When ≤25%, uses low input fidelity on reference edit. */
  visualSimilarityPct?: number;
  /** When analysis_t2i, generates from prompt only (no reference pixels). */
  imageInputMode?: "reference_edit" | "analysis_t2i";
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

function withArtOnlyImagePrompt(params: MimicImageEditParams): MimicImageEditParams {
  const prompt = finalizeMimicImageModelPrompt(params.prompt, {
    allowOnImageText: params.allowOnImageText,
  });
  if (prompt === params.prompt) return params;
  return { ...params, prompt };
}

/** Collect unique reference URLs (max 8) for BFL multi-reference Flux calls. */
export function collectMimicImageReferenceUrls(params: MimicImageEditParams): string[] {
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    const url = String(raw ?? "").trim();
    if (url && !out.includes(url)) out.push(url);
  };
  add(params.referenceUrl);
  for (const u of params.referenceUrls ?? []) add(u);
  return out.slice(0, 8);
}

function bflInputImageFieldKey(index0: number): string {
  return index0 === 0 ? "input_image" : `input_image_${index0 + 1}`;
}

async function attachBflReferenceImages(
  config: AppConfig,
  body: Record<string, unknown>,
  urls: string[]
): Promise<void> {
  const capped = urls.slice(0, 8);
  for (let i = 0; i < capped.length; i++) {
    body[bflInputImageFieldKey(i)] = await bflImageInputFromUrl(config, capped[i]!, `reference ${i + 1}`);
  }
}

function apiBaseUrl(base: string): string {
  return base.replace(/\/$/, "");
}

function imagesEditsUrl(apiBase: string): string {
  const base = apiBaseUrl(apiBase);
  return base.endsWith("/images/edits") ? base : `${base}/images/edits`;
}

function imagesGenerationsUrl(apiBase: string): string {
  const base = apiBaseUrl(apiBase);
  return base.endsWith("/images/generations") ? base : `${base}/images/generations`;
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

function bflSubmitEndpoint(apiBase: string, model: string): string {
  const base = apiBaseUrl(apiBase);
  const slug = model.trim().replace(/^\//, "");
  return `${base}/v1/${slug}`;
}

/** True when the configured BFL slug is FLUX.2 [flex] (typography-tuned; accepts steps/guidance). */
export function isBflFlexModel(model: string): boolean {
  const slug = model.trim().toLowerCase().replace(/^\//, "");
  return slug === "flux-2-flex" || slug.endsWith("-flex");
}

/** Optional FLUX.2 [flex] tuning params for BFL edit requests. */
export function bflFlexTuningParams(config: AppConfig): { steps: number; guidance: number } | null {
  const model = config.MIMIC_IMAGE_BFL_MODEL.trim() || "flux-2-flex";
  if (!isBflFlexModel(model)) return null;
  return {
    steps: config.MIMIC_IMAGE_BFL_STEPS,
    guidance: config.MIMIC_IMAGE_BFL_GUIDANCE,
  };
}

/** CAF `1024x1536` → BFL width/height (0 = model default per API docs). */
export function bflFluxDimensions(size: string | undefined): { width: number; height: number } {
  const trimmed = (size ?? "1024x1536").trim();
  if (!trimmed || trimmed === "auto") return { width: 1024, height: 1536 };
  const match = /^(\d+)x(\d+)$/i.exec(trimmed);
  if (!match) return { width: 1024, height: 1536 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function bflOutputMimeType(format: string): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

/** Resolve mimic render provider (BFL FLUX, DashScope Qwen, NVIDIA NIM, or OpenAI gpt-image-1). */
export function resolveMimicImageCall(config: AppConfig): MimicImageCallConfig {
  const provider = config.MIMIC_IMAGE_PROVIDER;

  if (provider === "bfl") {
    const model = config.MIMIC_IMAGE_BFL_MODEL.trim() || "flux-2-flex";
    return {
      provider: "bfl",
      model,
      apiKey: config.BFL_API_KEY?.trim() ?? "",
      editsEndpoint: bflSubmitEndpoint(config.BFL_API_BASE, model),
      providerLabel: mimicProviderLabel("bfl", model),
    };
  }

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

export function mimicImageProviderAssetLabel(
  config: AppConfig,
  bflModelOverride?: MimicBflModelSlug | null
): string {
  return resolveMimicImageCall(appConfigWithMimicBflModel(config, bflModelOverride)).providerLabel;
}

export function assertMimicImageProviderConfigured(config: AppConfig): MimicImageCallConfig {
  const call = resolveMimicImageCall(config);
  if (!call.apiKey) {
    if (call.provider === "bfl") {
      throw new Error("BFL_API_KEY is required when MIMIC_IMAGE_PROVIDER=bfl");
    }
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
  if (provider === "bfl") return "BFL FLUX image edit";
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
  const content: Array<Record<string, string>> = [{ image: params.referenceUrl! }, { text: params.prompt }];

  return {
    model: call.model,
    input: {
      messages: [{ role: "user", content }],
    },
    parameters: {
      n: 1,
      watermark: false,
      negative_prompt: MIMIC_ART_ONLY_NEGATIVE_PROMPT,
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

const BFL_MAX_RETRIES = 3;
const BFL_RETRY_BASE_MS = 10_000;
const BFL_TERMINAL_FAILURE = new Set(["Error", "Failed", "Task not found", "Request Moderated", "Content Moderated"]);

/** BFL 503 / busy dependency errors — safe to re-submit the whole job after backoff. */
export function isBflTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\((429|502|503|504)\)/.test(msg)) return true;
  return /temporarily unavailable|service unavailable|rate limit|try again later|overloaded/i.test(msg);
}

function bflFailureDetail(parsed: Record<string, unknown>, rawText = ""): string {
  const details = asRecord(parsed.details);
  const nested = details?.error;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  if (typeof parsed.detail === "string" && parsed.detail.trim()) return parsed.detail.trim();
  return JSON.stringify(parsed.details ?? parsed).slice(0, 400) || rawText.slice(0, 400);
}

function isBflTransientPollFailure(status: number, parsed: Record<string, unknown>, rawText = ""): boolean {
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  const pollStatus = typeof parsed.status === "string" ? parsed.status : "";
  if (pollStatus === "Error" || pollStatus === "Failed") {
    return isBflTransientError(new Error(bflFailureDetail(parsed, rawText)));
  }
  return false;
}

/** True when buffer magic bytes look like a raster image BFL can consume. */
export function isReadableImageBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  const sig6 = buf.subarray(0, 6).toString("ascii");
  if (sig6 === "GIF87a" || sig6 === "GIF89a") return true;
  return buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
}

/**
 * BFL fetches `input_image` URLs from their servers — private Supabase buckets and signed URLs often
 * return HTML/403, which surfaces as poll Error "Invalid or corrupted image input". Download via CAF
 * (service-role) and send base64 instead.
 */
async function bflImageInputFromUrl(config: AppConfig, imageUrl: string, label: string): Promise<string> {
  const trimmed = imageUrl.trim();
  if (!trimmed) throw new Error(`${providerErrorLabel("bfl")} ${label}: empty image URL`);
  const buf = await downloadBufferFromUrl(config, trimmed);
  if (!isReadableImageBuffer(buf)) {
    throw new Error(
      `${providerErrorLabel("bfl")} ${label}: downloaded ${buf.length} bytes but not a valid JPEG/PNG/GIF/WebP`
    );
  }
  return buf.toString("base64");
}

function bflResultSampleUrl(result: Record<string, unknown>): string | null {
  const resultObj = asRecord(result.result);
  const sample = resultObj?.sample;
  return typeof sample === "string" && sample.trim() ? sample.trim() : null;
}

async function pollBflFluxTask(args: {
  config: AppConfig;
  call: MimicImageCallConfig;
  pollingUrl: string;
  taskId: string;
  startedMs: number;
}): Promise<Record<string, unknown>> {
  const deadline = args.startedMs + args.config.MIMIC_IMAGE_BFL_POLL_MAX_MS;
  const interval = args.config.MIMIC_IMAGE_BFL_POLL_INTERVAL_MS;

  while (Date.now() < deadline) {
    await sleep(interval);
    const res = await fetch(args.pollingUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-key": args.call.apiKey,
      },
    });
    const rawText = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      parsed = { raw: rawText.slice(0, 500) };
    }

    if (!res.ok) {
      const detail = bflFailureDetail(parsed, rawText);
      throw new Error(`${providerErrorLabel("bfl")} poll failed (${res.status}): ${detail}`);
    }

    const status = typeof parsed.status === "string" ? parsed.status : "";
    if (status === "Ready") return parsed;
    if (BFL_TERMINAL_FAILURE.has(status) || status === "Error" || status === "Failed") {
      throw new Error(
        `${providerErrorLabel("bfl")} task ${args.taskId} failed (${status}): ${bflFailureDetail(parsed, rawText)}`
      );
    }
  }

  throw new Error(
    `${providerErrorLabel("bfl")} timed out after ${args.config.MIMIC_IMAGE_BFL_POLL_MAX_MS}ms (task ${args.taskId})`
  );
}

async function editViaBflOnce(config: AppConfig, params: MimicImageEditParams): Promise<MimicImageEditResult> {
  const call = resolveMimicImageCall(config);
  if (!call.apiKey) throw new Error("BFL_API_KEY is required when MIMIC_IMAGE_PROVIDER=bfl");

  const refUrls = collectMimicImageReferenceUrls(params);
  if (refUrls.length === 0) {
    throw new Error("referenceUrl is required for reference-conditioned mimic image edit");
  }

  const { width, height } = bflFluxDimensions(params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE);
  const outputFormat = config.MIMIC_IMAGE_BFL_OUTPUT_FORMAT;
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    width,
    height,
    safety_tolerance: config.MIMIC_IMAGE_BFL_SAFETY_TOLERANCE,
    output_format: outputFormat,
    ...(!params.allowOnImageText ? { negative_prompt: MIMIC_ART_ONLY_NEGATIVE_PROMPT } : {}),
  };
  await attachBflReferenceImages(config, body, refUrls);
  const flexTuning = bflFlexTuningParams(config);
  if (flexTuning) {
    body.steps = flexTuning.steps;
    body.guidance = flexTuning.guidance;
  }

  const started = Date.now();
  const submitRes = await fetch(call.editsEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-key": call.apiKey,
    },
    body: JSON.stringify(body),
  });

  const submitLatencyMs = Math.max(0, Date.now() - started);
  const submitRaw = await submitRes.text();
  let submitParsed: Record<string, unknown> = {};
  try {
    submitParsed = JSON.parse(submitRaw) as Record<string, unknown>;
  } catch {
    submitParsed = { raw: submitRaw.slice(0, 500) };
  }

  if (!submitRes.ok) {
    const detail =
      typeof submitParsed.detail === "string"
        ? submitParsed.detail
        : bflFailureDetail(submitParsed, submitRaw);
    if (params.audit) {
      await tryInsertApiCallAudit(params.audit.db, {
        projectId: params.audit.projectId,
        runId: params.audit.runId,
        taskId: params.audit.taskId,
        step: params.audit.step,
        provider: call.provider,
        model: call.model,
        ok: false,
        requestJson: {
          endpoint: call.editsEndpoint,
          mimic_provider: call.provider,
          prompt: params.prompt,
          reference_url: params.referenceUrl,
          width,
          height,
          output_format: outputFormat,
        },
        responseJson: submitParsed,
        latencyMs: submitLatencyMs,
      });
    }
    throw new Error(`${providerErrorLabel("bfl")} submit failed (${submitRes.status}): ${detail}`);
  }

  const taskId = typeof submitParsed.id === "string" ? submitParsed.id : "";
  const pollingUrl = typeof submitParsed.polling_url === "string" ? submitParsed.polling_url : "";
  if (!taskId || !pollingUrl) {
    throw new Error(`${providerErrorLabel("bfl")} submit returned no id/polling_url`);
  }

  const pollStarted = Date.now();
  const pollResult = await pollBflFluxTask({
    config,
    call,
    pollingUrl,
    taskId,
    startedMs: pollStarted,
  });
  const sampleUrl = bflResultSampleUrl(pollResult);
  if (!sampleUrl) {
    throw new Error(`${providerErrorLabel("bfl")} task ${taskId} ready but missing result.sample URL`);
  }

  const dl = await fetch(sampleUrl, { redirect: "follow" });
  if (!dl.ok) {
    throw new Error(`${providerErrorLabel("bfl")} failed to download result (${dl.status})`);
  }
  const mimeType = dl.headers.get("content-type")?.split(";")[0]?.trim() || bflOutputMimeType(outputFormat);
  const buffer = Buffer.from(await dl.arrayBuffer());
  const latencyMs = Math.max(0, Date.now() - started);

  if (params.audit) {
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
        prompt: params.prompt,
        reference_url: params.referenceUrl,
        width,
        height,
        output_format: outputFormat,
        bfl_task_id: taskId,
      },
      responseJson: {
        status: pollResult.status,
        sample_url: sampleUrl,
        bytes: buffer.length,
      },
      latencyMs,
    });
  }

  return { buffer, mimeType };
}

async function editViaBfl(config: AppConfig, params: MimicImageEditParams): Promise<MimicImageEditResult> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= BFL_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = BFL_RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 3_000;
      await sleep(backoff);
    }
    try {
      return await editViaBflOnce(config, params);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < BFL_MAX_RETRIES && isBflTransientError(lastError)) continue;
      throw lastError;
    }
  }
  throw lastError ?? new Error(`${providerErrorLabel("bfl")}: max retries exceeded`);
}

const MIMIC_ART_ONLY_NEGATIVE_PROMPT =
  "text, words, letters, numbers, typography, headline, subhead, caption, watermark, logo, @handle, instagram handle, brand tag, UI labels, lorem ipsum, gibberish text, readable copy, exact copy, duplicate illustration, landscape, horizontal, near-duplicate, same composition";

const DASHSCOPE_GENERATION_NEGATIVE_PROMPT = MIMIC_ART_ONLY_NEGATIVE_PROMPT;

function buildDashScopeGenerateBody(
  call: MimicImageCallConfig,
  config: AppConfig,
  params: Pick<MimicImageEditParams, "prompt" | "size">
): Record<string, unknown> {
  return {
    model: call.model,
    input: {
      messages: [{ role: "user", content: [{ text: params.prompt }] }],
    },
    parameters: {
      n: 1,
      watermark: false,
      negative_prompt: DASHSCOPE_GENERATION_NEGATIVE_PROMPT,
      prompt_extend: false,
      size: dashScopeSizeParam(params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE),
    },
  };
}

async function generateViaDashScope(
  config: AppConfig,
  params: MimicImageEditParams
): Promise<MimicImageEditResult> {
  const call = resolveMimicImageCall(config);
  if (!call.apiKey) throw new Error("DASHSCOPE_API_KEY is required when MIMIC_IMAGE_PROVIDER=dashscope");
  const body = buildDashScopeGenerateBody(call, config, params);

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
        generation_mode: "text_to_image",
        prompt: params.prompt,
        size: dashScopeSizeParam(params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE),
        input: body.input,
        parameters: body.parameters,
      },
      responseJson: res.ok ? { request_id: parsed.request_id } : parsed,
      latencyMs,
    });
  }

  if (!res.ok || parsed.code) {
    throw new Error(
      `${providerErrorLabel("dashscope")} text-to-image failed (${res.status}): ${String(parsed.message ?? rawText.slice(0, 200))}`
    );
  }

  return parseDashScopeImageEditResponse(parsed);
}

async function generateViaBflOnce(config: AppConfig, params: MimicImageEditParams): Promise<MimicImageEditResult> {
  const call = resolveMimicImageCall(config);
  if (!call.apiKey) throw new Error("BFL_API_KEY is required when MIMIC_IMAGE_PROVIDER=bfl");

  const refUrls = collectMimicImageReferenceUrls(params);
  const { width, height } = bflFluxDimensions(params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE);
  const outputFormat = config.MIMIC_IMAGE_BFL_OUTPUT_FORMAT;
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    width,
    height,
    safety_tolerance: config.MIMIC_IMAGE_BFL_SAFETY_TOLERANCE,
    output_format: outputFormat,
    ...(!params.allowOnImageText ? { negative_prompt: MIMIC_ART_ONLY_NEGATIVE_PROMPT } : {}),
  };
  if (refUrls.length > 0) {
    await attachBflReferenceImages(config, body, refUrls);
  }
  const flexTuning = bflFlexTuningParams(config);
  if (flexTuning) {
    body.steps = flexTuning.steps;
    body.guidance = flexTuning.guidance;
  }

  const started = Date.now();
  const submitRes = await fetch(call.editsEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-key": call.apiKey,
    },
    body: JSON.stringify(body),
  });

  const submitLatencyMs = Math.max(0, Date.now() - started);
  const submitRaw = await submitRes.text();
  let submitParsed: Record<string, unknown> = {};
  try {
    submitParsed = JSON.parse(submitRaw) as Record<string, unknown>;
  } catch {
    submitParsed = { raw: submitRaw.slice(0, 500) };
  }

  if (!submitRes.ok) {
    const detail =
      typeof submitParsed.detail === "string"
        ? submitParsed.detail
        : JSON.stringify(submitParsed.detail ?? submitParsed).slice(0, 300);
    if (params.audit) {
      await tryInsertApiCallAudit(params.audit.db, {
        projectId: params.audit.projectId,
        runId: params.audit.runId,
        taskId: params.audit.taskId,
        step: params.audit.step,
        provider: call.provider,
        model: call.model,
        ok: false,
        requestJson: {
          endpoint: call.editsEndpoint,
          mimic_provider: call.provider,
          generation_mode: "text_to_image",
          prompt: params.prompt,
          width,
          height,
          output_format: outputFormat,
        },
        responseJson: submitParsed,
        latencyMs: submitLatencyMs,
      });
    }
    throw new Error(`${providerErrorLabel("bfl")} text-to-image submit failed (${submitRes.status}): ${detail}`);
  }

  const taskId = typeof submitParsed.id === "string" ? submitParsed.id : "";
  const pollingUrl = typeof submitParsed.polling_url === "string" ? submitParsed.polling_url : "";
  if (!taskId || !pollingUrl) {
    throw new Error(`${providerErrorLabel("bfl")} text-to-image submit returned no id/polling_url`);
  }

  const pollStarted = Date.now();
  const pollResult = await pollBflFluxTask({
    config,
    call,
    pollingUrl,
    taskId,
    startedMs: pollStarted,
  });
  const sampleUrl = bflResultSampleUrl(pollResult);
  if (!sampleUrl) {
    throw new Error(`${providerErrorLabel("bfl")} text-to-image task ${taskId} ready but missing result.sample URL`);
  }

  const dl = await fetch(sampleUrl, { redirect: "follow" });
  if (!dl.ok) {
    throw new Error(`${providerErrorLabel("bfl")} failed to download text-to-image result (${dl.status})`);
  }
  const mimeType = dl.headers.get("content-type")?.split(";")[0]?.trim() || bflOutputMimeType(outputFormat);
  const buffer = Buffer.from(await dl.arrayBuffer());
  const latencyMs = Math.max(0, Date.now() - started);

  if (params.audit) {
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
        generation_mode: "text_to_image",
        prompt: params.prompt,
        width,
        height,
        output_format: outputFormat,
        bfl_task_id: taskId,
      },
      responseJson: {
        status: pollResult.status,
        sample_url: sampleUrl,
        bytes: buffer.length,
      },
      latencyMs,
    });
  }

  return { buffer, mimeType };
}

async function generateViaBfl(config: AppConfig, params: MimicImageEditParams): Promise<MimicImageEditResult> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= BFL_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = BFL_RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 3_000;
      await sleep(backoff);
    }
    try {
      return await generateViaBflOnce(config, params);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < BFL_MAX_RETRIES && isBflTransientError(lastError)) continue;
      throw lastError;
    }
  }
  throw lastError ?? new Error(`${providerErrorLabel("bfl")} text-to-image: max retries exceeded`);
}

async function generateViaOpenAi(config: AppConfig, params: MimicImageEditParams): Promise<MimicImageEditResult> {
  const call = resolveMimicImageCall({ ...config, MIMIC_IMAGE_PROVIDER: "openai" });
  if (!call.apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI text-to-image");

  const endpoint = imagesGenerationsUrl(config.OPENAI_API_BASE);
  const body = JSON.stringify({
    model: call.model,
    prompt: params.prompt,
    size: params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE,
    n: 1,
    quality: params.quality ?? config.MIMIC_IMAGE_QUALITY,
  });

  const started = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${call.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body,
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
        endpoint,
        mimic_provider: call.provider,
        generation_mode: "text_to_image",
        prompt: params.prompt,
        size: params.size ?? config.MIMIC_IMAGE_DEFAULT_SIZE,
      },
      responseJson: res.ok
        ? { data_count: Array.isArray(parsed.data) ? parsed.data.length : 0 }
        : parsed,
      latencyMs,
    });
  }

  if (!res.ok) {
    const errMsg =
      asRecord(parsed.error)?.message ??
      (typeof parsed.error === "string" ? parsed.error : rawText.slice(0, 300));
    throw new Error(`${providerErrorLabel("openai")} text-to-image failed (${res.status}): ${String(errMsg)}`);
  }

  return parseImageEditResponse(parsed);
}

/**
 * Text-to-image generation for bold mimic variants (no reference pixels sent to the model).
 */
export async function generateImageFromPrompt(
  config: AppConfig,
  params: MimicImageEditParams
): Promise<MimicImageEditResult> {
  params = withArtOnlyImagePrompt(params);
  const refUrls = collectMimicImageReferenceUrls(params);
  const effectiveConfig = appConfigWithMimicBflModel(config, params.bflModelOverride);
  assertMimicImageProviderConfigured(effectiveConfig);

  if (refUrls.length > 0 && effectiveConfig.MIMIC_IMAGE_PROVIDER !== "bfl") {
    return editImageFromReference(effectiveConfig, {
      ...params,
      referenceUrl: refUrls[0],
      ...(refUrls.length > 1 ? { referenceUrls: refUrls.slice(1) } : {}),
    });
  }

  if (effectiveConfig.MIMIC_IMAGE_PROVIDER === "bfl") {
    try {
      return await generateViaBfl(effectiveConfig, params);
    } catch (err) {
      const canFallback =
        effectiveConfig.MIMIC_IMAGE_BFL_FALLBACK_DASHSCOPE &&
        Boolean(effectiveConfig.DASHSCOPE_API_KEY?.trim());
      if (canFallback && isBflModerationError(err)) {
        try {
          return await generateViaDashScope(effectiveConfig, params);
        } catch (dashErr) {
          if (isDashScopeAuthError(dashErr) && effectiveConfig.OPENAI_API_KEY?.trim()) {
            return generateViaOpenAi(effectiveConfig, params);
          }
          throw dashErr;
        }
      }
      throw err;
    }
  }

  if (effectiveConfig.MIMIC_IMAGE_PROVIDER === "dashscope") {
    try {
      return await generateViaDashScope(effectiveConfig, params);
    } catch {
      return editImageFromReference(effectiveConfig, {
        ...params,
        inputFidelity: "low",
      });
    }
  }

  if (effectiveConfig.MIMIC_IMAGE_PROVIDER === "openai") {
    return generateViaOpenAi(effectiveConfig, params);
  }

  if (effectiveConfig.OPENAI_API_KEY?.trim()) {
    return generateViaOpenAi(effectiveConfig, params);
  }

  return editImageFromReference(effectiveConfig, {
    ...params,
    inputFidelity: "low",
  });
}

/**
 * Mimic slide render entry — reference edit or analysis-driven text-to-image.
 */
export async function generateMimicSlideImage(
  config: AppConfig,
  params: MimicSlideImageParams
): Promise<MimicImageEditResult> {
  const refUrls = collectMimicImageReferenceUrls(params);
  const withRefs =
    refUrls.length > 0
      ? {
          ...params,
          referenceUrl: refUrls[0],
          ...(refUrls.length > 1 ? { referenceUrls: refUrls } : {}),
        }
      : params;
  if (params.imageInputMode === "analysis_t2i") {
    return generateImageFromPrompt(config, withRefs);
  }
  return editImageFromReference(config, {
    ...withRefs,
    inputFidelity: "low",
  });
}

/**
 * Reference-conditioned image edit/generate for mimic flows.
 * Downloads archived inspection media (signed Supabase URL) and sends it to the configured provider.
 */
function isBflModerationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Request Moderated") ||
    msg.includes("Content Moderated") ||
    msg.includes("Content Policy Violation")
  );
}

function isDashScopeAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("(403)") && /not authenticated|invalid api|unauthorized/i.test(msg);
}

export async function editImageFromReference(
  config: AppConfig,
  params: MimicImageEditParams
): Promise<MimicImageEditResult> {
  const refUrls = collectMimicImageReferenceUrls(params);
  if (refUrls.length === 0) {
    throw new Error("referenceUrl is required for reference-conditioned mimic image edit");
  }
  params = withArtOnlyImagePrompt({
    ...params,
    referenceUrl: refUrls[0],
    ...(refUrls.length > 1 ? { referenceUrls: refUrls } : {}),
  });
  const effectiveConfig = appConfigWithMimicBflModel(config, params.bflModelOverride);
  assertMimicImageProviderConfigured(effectiveConfig);

  if (effectiveConfig.MIMIC_IMAGE_PROVIDER === "bfl") {
    try {
      return await editViaBfl(effectiveConfig, params);
    } catch (err) {
      const canFallback =
        effectiveConfig.MIMIC_IMAGE_BFL_FALLBACK_DASHSCOPE &&
        Boolean(effectiveConfig.DASHSCOPE_API_KEY?.trim());
      if (canFallback && isBflModerationError(err)) {
        try {
          return await editViaDashScope(effectiveConfig, params);
        } catch (dashErr) {
          if (isDashScopeAuthError(dashErr) && effectiveConfig.OPENAI_API_KEY?.trim()) {
            const { blob, mimeType: refMime } = await downloadReferenceAsBlob(refUrls[0]!);
            return editViaOpenAi(effectiveConfig, params, blob, refMime);
          }
          throw dashErr;
        }
      }
      throw err;
    }
  }

  if (effectiveConfig.MIMIC_IMAGE_PROVIDER === "dashscope") {
    return editViaDashScope(effectiveConfig, params);
  }

  const { blob, mimeType: refMime } = await downloadReferenceAsBlob(refUrls[0]!);

  if (effectiveConfig.MIMIC_IMAGE_PROVIDER !== "nvidia") {
    return editViaOpenAi(effectiveConfig, params, blob, refMime);
  }

  try {
    return await editViaNvidia(effectiveConfig, params, blob, refMime);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isVisualGenAiUnavailableError(msg)) {
      throw err;
    }
    const canFallback =
      effectiveConfig.MIMIC_IMAGE_NVIDIA_FALLBACK_OPENAI && Boolean(effectiveConfig.OPENAI_API_KEY?.trim());
    if (canFallback) {
      return editViaOpenAi(effectiveConfig, params, blob, refMime, {
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
