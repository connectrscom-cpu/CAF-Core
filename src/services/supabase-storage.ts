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
  const { error } = await client.storage.from(bucket).upload(objectPath, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data: pub } = client.storage.from(bucket).getPublicUrl(objectPath);
  return {
    bucket,
    object_path: objectPath,
    public_url: pub?.publicUrl ?? null,
  };
}

export async function downloadUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
