import { resolveBrandAssetUploadUrl } from "@/lib/brand-asset-upload-url";
import type { MoodboardAsset } from "@/components/marketer/BrandBibleAssetInspectModal";

type CreatedAsset = {
  id: string;
  kind: string;
  label: string | null;
  public_url: string | null;
  storage_path: string | null;
  metadata_json?: Record<string, unknown>;
};

async function uploadFile(slug: string, file: File): Promise<{ public_url: string | null; storage_path: string | null }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(resolveBrandAssetUploadUrl(slug), { method: "POST", body: fd });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 400) || `Upload failed (${res.status})`);
  const json = JSON.parse(text) as { public_url?: string | null; storage_path?: string | null };
  return { public_url: json.public_url ?? null, storage_path: json.storage_path ?? null };
}

async function createBrandAssetRow(
  slug: string,
  payload: Record<string, unknown>
): Promise<CreatedAsset> {
  const qs = `?project=${encodeURIComponent(slug)}`;
  const res = await fetch(`/api/project-config/brand-assets${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t.slice(0, 280) || "Could not save brand asset");
  }
  const json = (await res.json()) as { brand_asset?: CreatedAsset; ok?: boolean };
  const row = json.brand_asset;
  if (!row?.id) throw new Error("Upload saved but asset id missing");
  return row;
}

function toMoodboardAsset(row: CreatedAsset): MoodboardAsset {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    public_url: row.public_url,
    metadata_json: row.metadata_json,
  };
}

/** Upload one or more reference images and register them as brand assets. */
export async function uploadBrandReferenceImages(
  slug: string,
  files: File[],
  opts: { labelPrefix: string; kind?: "logo" | "reference_image" | "other" }
): Promise<MoodboardAsset[]> {
  const kind = opts.kind ?? "reference_image";
  const prefix = opts.labelPrefix.trim() || "Asset";
  const out: MoodboardAsset[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const up = await uploadFile(slug, file);
    const label = files.length > 1 ? `${prefix} ${i + 1}` : prefix;
    const row = await createBrandAssetRow(slug, {
      kind,
      label,
      public_url: up.public_url,
      storage_path: up.storage_path,
      metadata_json: { original_filename: file.name },
    });
    out.push(toMoodboardAsset(row));
  }

  return out;
}
