/**
 * HeyGen v3 asset upload — POST /v3/assets (multipart).
 * @see docs/HEYGEN_API_V3.md
 */
import type { AppConfig } from "../config.js";

export interface HeygenAssetUploadResult {
  asset_id: string;
  url?: string;
  mime_type?: string;
  size_bytes?: number;
}

function guessFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last && /\.[a-zA-Z0-9]{2,8}$/.test(last)) return last.slice(0, 128);
  } catch {
    /* ignore */
  }
  return "upload.bin";
}

/**
 * Upload a file buffer to HeyGen; returns `asset_id` for Video Agent `files`.
 */
export async function uploadBufferToHeygen(
  appConfig: AppConfig,
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<HeygenAssetUploadResult> {
  const apiKey = appConfig.HEYGEN_API_KEY?.trim();
  if (!apiKey) throw new Error("HEYGEN_API_KEY not configured");
  const base = appConfig.HEYGEN_API_BASE.replace(/\/$/, "");
  const url = `${base}/v3/assets`;

  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], { type: contentType || "application/octet-stream" }),
    filename
  );

  const res = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HeyGen POST /v3/assets failed ${res.status}: ${text.slice(0, 800)}`);
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`HeyGen /v3/assets: invalid JSON: ${text.slice(0, 200)}`);
  }
  const data = json.data as Record<string, unknown> | undefined;
  const assetId = (data?.asset_id as string) ?? (json.asset_id as string);
  if (!assetId || typeof assetId !== "string") {
    throw new Error(`HeyGen /v3/assets: missing asset_id in response: ${text.slice(0, 400)}`);
  }
  return {
    asset_id: assetId.trim(),
    url: typeof data?.url === "string" ? data.url : undefined,
    mime_type: typeof data?.mime_type === "string" ? data.mime_type : undefined,
    size_bytes: typeof data?.size_bytes === "number" ? data.size_bytes : undefined,
  };
}

export async function fetchUrlAndUploadToHeygen(
  appConfig: AppConfig,
  publicUrl: string
): Promise<HeygenAssetUploadResult> {
  const res = await fetch(publicUrl, { redirect: "follow" });
  if (!res.ok) throw new Error(`fetch brand asset URL failed ${res.status}: ${publicUrl.slice(0, 120)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 32 * 1024 * 1024) throw new Error("HeyGen asset max 32 MB");
  const ct = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  const filename = guessFilenameFromUrl(publicUrl);
  return uploadBufferToHeygen(appConfig, buf, filename, ct);
}
