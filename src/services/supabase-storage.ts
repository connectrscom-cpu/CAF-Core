/**
 * Supabase Storage uploads for rendered assets (carousels, HeyGen video, scenes, audio).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";

let cached: SupabaseClient | null = null;

export function getSupabaseStorageClient(config: AppConfig): SupabaseClient | null {
  const url = config.SUPABASE_URL?.trim();
  const key = config.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  if (!cached) cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export function resetSupabaseClientForTests(): void {
  cached = null;
}

/**
 * Canonical object keys in the Supabase bucket: first segment matches the bucket id (e.g. bucket
 * `assets` → keys `assets/scenes/...`, `assets/videos/...`) so the dashboard shows Buckets → assets → assets → …
 */
export function assetObjectKeyInBucket(bucket: string, relativePath: string): string {
  const b = (bucket || "assets").trim() || "assets";
  let p = relativePath.replace(/^\/+/, "").trim();
  if (!p) return `${b}/unnamed`;
  if (p.startsWith(`${b}/`)) return p;
  return `${b}/${p}`;
}

/** Top-level segments after the in-bucket root (e.g. assets/scenes → "scenes"). */
export const SUPABASE_ASSET_TOP_LEVEL_PREFIXES = [
  "audios",
  "audios_muxed",
  "carousels",
  "scenes",
  "subtitles",
  "videos",
  "videos_edit",
] as const;

const PREFIX_INIT_MARKER = "__caf_storage_init.txt";
const PREFIX_INIT_BODY = Buffer.from(
  "CAF Core — placeholder so this prefix appears in Storage before the first real upload. Safe to delete.\n",
  "utf8"
);

/**
 * For each known prefix, if the bucket has no objects under that path yet, upload a small marker file.
 * Supabase/S3 have no empty folders; this makes new environments show the same tree as your prior setup.
 */
export async function ensureSupabaseAssetFolderPrefixes(config: AppConfig): Promise<void> {
  if (!config.SUPABASE_ENSURE_ASSET_PREFIXES) return;
  const client = getSupabaseStorageClient(config);
  if (!client) return;
  const bucket = config.SUPABASE_ASSETS_BUCKET || "assets";

  for (const prefix of SUPABASE_ASSET_TOP_LEVEL_PREFIXES) {
    const basePath = assetObjectKeyInBucket(bucket, prefix);
    const { data: listed, error: listErr } = await client.storage.from(bucket).list(basePath, { limit: 1 });
    if (listErr) {
      continue;
    }
    if (listed && listed.length > 0) {
      continue;
    }
    const markerPath = `${basePath}/${PREFIX_INIT_MARKER}`;
    const { error: upErr } = await client.storage.from(bucket).upload(markerPath, PREFIX_INIT_BODY, {
      contentType: "text/plain; charset=utf-8",
      upsert: true,
    });
    if (upErr) {
      continue;
    }
  }
}

export interface UploadResult {
  bucket: string;
  object_path: string;
  public_url: string | null;
}

export async function uploadBuffer(
  config: AppConfig,
  objectPath: string,
  body: Buffer,
  contentType: string
): Promise<UploadResult> {
  const client = getSupabaseStorageClient(config);
  const bucket = config.SUPABASE_ASSETS_BUCKET || "assets";
  if (!client) {
    throw new Error("Supabase not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required for upload)");
  }
  const key = assetObjectKeyInBucket(bucket, objectPath);
  const { error } = await client.storage.from(bucket).upload(key, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data: pub } = client.storage.from(bucket).getPublicUrl(key);
  return {
    bucket,
    object_path: key,
    public_url: pub?.publicUrl ?? null,
  };
}

/**
 * Some bad uploads used object keys like `assets/assets/scenes/...` inside bucket `assets` (triple
 * "assets" in the public URL). Collapse **repeated** `{bucket}/` at the start only — do **not** strip
 * a single `assets/` prefix: legitimate keys are `assets/scenes/...` (folder `assets` then `scenes`).
 */
export function normalizeStorageObjectPath(bucket: string, objectPath: string): string {
  let p = objectPath.replace(/^\/+/, "").trim();
  if (!bucket) return p;
  const double = `${bucket}/${bucket}/`;
  while (p.startsWith(double)) {
    p = p.slice(bucket.length + 1);
  }
  return p;
}

/** Match Supabase Storage public object URLs: /storage/v1/object/public/{bucket}/{objectPath} */
const SUPABASE_PUBLIC_OBJECT_RE = /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/;

/** Try keys oldest-first: URL path, then with in-bucket root, then without root (legacy flat). */
export function storageDownloadKeyCandidates(bucket: string, objectPath: string): string[] {
  const n = normalizeStorageObjectPath(bucket, objectPath);
  const ordered: string[] = [];
  const add = (s: string) => {
    const t = s.replace(/^\/+/, "").trim();
    if (t && !ordered.includes(t)) ordered.push(t);
  };
  add(n);
  add(assetObjectKeyInBucket(bucket, n));
  if (n.startsWith(`${bucket}/`)) {
    add(n.slice(bucket.length + 1));
  }
  return ordered;
}

function tryParseSupabasePublicObjectUrl(url: string): { bucket: string; objectPath: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const m = parsed.pathname.match(SUPABASE_PUBLIC_OBJECT_RE);
  if (!m?.[1] || !m[2]) return null;
  return { bucket: m[1], objectPath: decodeURIComponent(m[2]) };
}

/**
 * Download bytes from a URL. For same-project Supabase public URLs, uses the service-role client so
 * fetches work even when anonymous GET on the public URL fails (e.g. policy quirks, malformed double-bucket paths).
 */

/**
 * Signed URL for an object. Tries the same path variants as {@link storageDownloadKeyCandidates} because
 * `from(bucket).createSignedUrl(path)` applies `_getFinalPath` (`{bucket}/{path}`) — one variant matches how the object was uploaded.
 */
export async function createSignedUrlForObjectKey(
  config: AppConfig,
  bucket: string,
  objectKey: string,
  expiresSec: number
): Promise<{ signedUrl: string } | { error: string }> {
  const client = getSupabaseStorageClient(config);
  if (!client) return { error: "Supabase client not configured" };
  const b = bucket.trim() || "assets";
  const normalized = objectKey.replace(/^\/+/, "").trim();
  if (!normalized) return { error: "empty object key" };
  const candidates = storageDownloadKeyCandidates(b, normalized);
  let lastErr = "createSignedUrl failed";
  for (const path of candidates) {
    const { data, error } = await client.storage.from(b).createSignedUrl(path, expiresSec);
    if (!error && data?.signedUrl) return { signedUrl: data.signedUrl };
    lastErr = error?.message ?? lastErr;
  }
  return { error: `${lastErr} (tried paths: ${candidates.join(", ")})` };
}

function fetchInitWithOptionalTimeout(config: AppConfig): RequestInit | undefined {
  const ms = config.STORAGE_HTTP_FETCH_TIMEOUT_MS;
  if (ms > 0) return { signal: AbortSignal.timeout(ms) };
  return undefined;
}

async function storageDownloadWithTimeout(
  config: AppConfig,
  client: SupabaseClient,
  bucket: string,
  key: string
): Promise<{ data: Blob | null; error: { message: string } | null }> {
  const ms = config.STORAGE_HTTP_FETCH_TIMEOUT_MS;
  const p = client.storage.from(bucket).download(key);
  if (ms <= 0) return p;
  const timeout = new Promise<never>((_, rej) => {
    setTimeout(() => rej(new Error(`Supabase storage download timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]);
}

export async function downloadBufferFromUrl(config: AppConfig, url: string): Promise<Buffer> {
  const u = url.trim();
  const fetchInit = fetchInitWithOptionalTimeout(config);
  const parsed = tryParseSupabasePublicObjectUrl(u);
  const base = config.SUPABASE_URL?.trim();
  if (parsed && base) {
    try {
      const urlHost = new URL(u).hostname;
      const projectHost = new URL(base).hostname;
      if (urlHost === projectHost) {
        const client = getSupabaseStorageClient(config);
        if (client) {
          const b = parsed.bucket;
          const candidates = storageDownloadKeyCandidates(b, parsed.objectPath);
          for (const key of candidates) {
            const { data, error } = await storageDownloadWithTimeout(config, client, b, key);
            if (!error && data) {
              return Buffer.from(await data.arrayBuffer());
            }
          }
          for (const key of candidates) {
            const signed = await createSignedUrlForObjectKey(config, b, key, 3600);
            if ("signedUrl" in signed) {
              const r = fetchInit
                ? await fetch(signed.signedUrl, fetchInit)
                : await fetch(signed.signedUrl);
              if (r.ok) return Buffer.from(await r.arrayBuffer());
            }
          }
        }
      }
    } catch {
      /* fall through to fetch */
    }
  }

  const res = fetchInit ? await fetch(u, fetchInit) : await fetch(u);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${u}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function downloadUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** In-bucket path to the task’s scene clips folder (matches Sora upload keys under `scenes/{run}/{task}/`). */
export function sceneTaskFolderKeyInBucket(config: AppConfig, runId: string, taskId: string): string {
  const bucket = config.SUPABASE_ASSETS_BUCKET || "assets";
  const safeRun = runId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTask = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return assetObjectKeyInBucket(bucket, `scenes/${safeRun}/${safeTask}`);
}

function compareSceneMp4Filenames(a: string, b: string): number {
  const s1 = a.match(/^sora_scene_(\d+)\.mp4$/i);
  const s2 = b.match(/^sora_scene_(\d+)\.mp4$/i);
  if (s1 && s2) return Number(s1[1]) - Number(s2[1]);
  if (s1) return -1;
  if (s2) return 1;
  const i1 = a.match(/^scene_(\d+)_imported\.mp4$/i);
  const i2 = b.match(/^scene_(\d+)_imported\.mp4$/i);
  if (i1 && i2) return Number(i1[1]) - Number(i2[1]);
  if (i1) return -1;
  if (i2) return 1;
  return a.localeCompare(b);
}

/**
 * List `.mp4` objects under `assets/scenes/{sanitized_run}/{sanitized_task}/` and return fetchable URLs
 * (signed when possible — private buckets return 400 on `/object/public/...` even when the path is correct).
 * Sorted: `sora_scene_N.mp4`, then `scene_N_imported.mp4`, then name.
 */
export async function listSceneFolderMp4PublicUrls(
  config: AppConfig,
  runId: string,
  taskId: string
): Promise<{ folder_key: string; filenames: string[]; public_urls: string[] }> {
  const client = getSupabaseStorageClient(config);
  if (!client) {
    throw new Error("Supabase not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required)");
  }
  const bucket = config.SUPABASE_ASSETS_BUCKET || "assets";
  const folderKey = sceneTaskFolderKeyInBucket(config, runId, taskId);
  const { data, error } = await client.storage.from(bucket).list(folderKey, {
    limit: 200,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new Error(`Supabase list failed for ${folderKey}: ${error.message}`);
  const rows = data ?? [];
  const mp4Names = rows
    .map((f) => f.name)
    .filter(
      (n): n is string =>
        Boolean(n) &&
        /\.mp4$/i.test(n) &&
        n !== PREFIX_INIT_MARKER &&
        !n.endsWith("/")
    );
  const filenames = [...mp4Names].sort(compareSceneMp4Filenames);
  const signedTtlSec = 7200;
  const public_urls: string[] = [];
  for (const name of filenames) {
    const key = `${folderKey}/${name}`;
    const signed = await createSignedUrlForObjectKey(config, bucket, key, signedTtlSec);
    if ("error" in signed) {
      throw new Error(
        `createSignedUrl failed for ${key}: ${signed.error}. ` +
          "Private buckets need a working service role and storage.objects read policy; do not rely on /object/public/ URLs."
      );
    }
    public_urls.push(signed.signedUrl);
  }
  return { folder_key: folderKey, filenames, public_urls };
}
