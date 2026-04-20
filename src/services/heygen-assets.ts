/**
 * HeyGen v3 asset upload — POST /v3/assets (multipart).
 * @see docs/HEYGEN_API_V3.md
 */
import type { AppConfig } from "../config.js";
import {
  downloadBufferFromUrl,
  getSupabaseStorageClient,
  storageDownloadKeyCandidates,
} from "./supabase-storage.js";

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
  const bytes = Uint8Array.from(buffer);
  form.append("file", new Blob([bytes], { type: contentType || "application/octet-stream" }), filename);

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

/**
 * Download a brand asset (by public URL) and upload it to HeyGen.
 *
 * Uses {@link downloadBufferFromUrl} instead of raw `fetch()` so that
 * Supabase-hosted assets work even when the bucket is **private** or the
 * `/storage/v1/object/public/...` path returns 400: the helper detects
 * same-project Supabase URLs and falls back to the service-role client
 * (`storage.from(bucket).download(key)`) or a signed URL.
 */
export async function fetchUrlAndUploadToHeygen(
  appConfig: AppConfig,
  publicUrl: string
): Promise<HeygenAssetUploadResult> {
  const buf = await downloadBufferFromUrl(appConfig, publicUrl);
  if (buf.length > 32 * 1024 * 1024) throw new Error("HeyGen asset max 32 MB");
  const filename = guessFilenameFromUrl(publicUrl);
  const ct = inferContentTypeFromFilename(filename);
  return uploadBufferToHeygen(appConfig, buf, filename, ct);
}

function inferContentTypeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

/**
 * Download a Supabase-stored asset via the service-role client and upload to HeyGen.
 * Preferred over {@link fetchUrlAndUploadToHeygen} when the row has a `storage_path`
 * because it never depends on the bucket being public.
 */
export async function fetchStoragePathAndUploadToHeygen(
  appConfig: AppConfig,
  bucket: string,
  storagePath: string,
  labelForFilename?: string | null
): Promise<HeygenAssetUploadResult> {
  const client = getSupabaseStorageClient(appConfig);
  if (!client) throw new Error("Supabase not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required)");
  const b = (bucket || appConfig.SUPABASE_ASSETS_BUCKET || "assets").trim() || "assets";
  const candidates = storageDownloadKeyCandidates(b, storagePath);
  let lastErr = "storage download failed";
  for (const key of candidates) {
    const { data, error } = await client.storage.from(b).download(key);
    if (!error && data) {
      const buf = Buffer.from(await data.arrayBuffer());
      if (buf.length > 32 * 1024 * 1024) throw new Error("HeyGen asset max 32 MB");
      const derivedName = key.split("/").filter(Boolean).pop() || "upload.bin";
      const filename = (labelForFilename && labelForFilename.trim()) || derivedName;
      const ct = inferContentTypeFromFilename(filename);
      return uploadBufferToHeygen(appConfig, buf, filename, ct);
    }
    lastErr = error?.message ?? lastErr;
  }
  throw new Error(
    `Supabase storage download failed for ${storagePath} (tried: ${candidates.join(", ")}): ${lastErr}`
  );
}
