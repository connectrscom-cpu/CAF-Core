import type { AppConfig } from "../config.js";
import type { MimicPayloadV1, MimicReferenceItem } from "../domain/mimic-payload.js";
import { createSignedUrlForObjectKey } from "./supabase-storage.js";

/** Fresh signed URLs for OpenAI image edit downloads (private Supabase buckets). */
const MIMIC_REFERENCE_SIGNED_URL_TTL_SEC = 3600;

export async function refreshMimicReferenceFetchUrl(
  config: AppConfig,
  item: MimicReferenceItem
): Promise<string> {
  const bucket = item.bucket?.trim();
  const objectPath = item.object_path?.trim();
  if (bucket && objectPath) {
    const signed = await createSignedUrlForObjectKey(
      config,
      bucket,
      objectPath,
      MIMIC_REFERENCE_SIGNED_URL_TTL_SEC
    );
    if ("signedUrl" in signed) return signed.signedUrl;
  }
  return item.vision_fetch_url;
}

export async function refreshMimicPayloadReferenceUrls(
  config: AppConfig,
  mimic: MimicPayloadV1
): Promise<MimicPayloadV1> {
  const reference_items = await Promise.all(
    mimic.reference_items.map(async (item) => ({
      ...item,
      vision_fetch_url: await refreshMimicReferenceFetchUrl(config, item),
    }))
  );
  return { ...mimic, reference_items };
}
