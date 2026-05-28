/**
 * Compact inspection / evidence-media references for visual guideline entries.
 */
import type { AppConfig } from "../config.js";
import { createSignedUrlForObjectKey } from "./supabase-storage.js";

/** Fresh signed URLs for Review thumbnails (private `assets` bucket). */
const DISPLAY_SIGNED_URL_TTL_SEC = 3600;

export interface VisualGuidelineMediaItem {
  role: string;
  object_path: string | null;
  bucket: string | null;
  public_url: string | null;
  vision_fetch_url: string | null;
  index: number | null;
  source_slide_index?: number | null;
  is_video_slide?: boolean;
  content_type?: string | null;
  source_url?: string | null;
}

export interface VisualGuidelineInspectionMedia {
  storage_bucket: string | null;
  /** Common object-key prefix (folder) for Supabase Storage browser. */
  folder_prefix: string | null;
  /** Human hint: `bucket · folder_prefix` */
  storage_folder_label: string | null;
  items: VisualGuidelineMediaItem[];
  skipped_reason: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function commonPathPrefix(paths: string[]): string | null {
  const clean = paths.map((p) => p.replace(/^\/+/, "").trim()).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) {
    const p = clean[0]!;
    const i = p.lastIndexOf("/");
    return i > 0 ? p.slice(0, i + 1) : p;
  }
  const parts = clean[0]!.split("/");
  let end = 0;
  for (let i = 0; i < parts.length; i++) {
    if (clean.every((p) => p.split("/")[i] === parts[i])) end = i + 1;
    else break;
  }
  if (end <= 0) return null;
  return `${parts.slice(0, end).join("/")}/`;
}

export function compactStoredInspectionMedia(raw: unknown): VisualGuidelineInspectionMedia | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const itemsRaw = Array.isArray(rec.items) ? rec.items : [];
  const items: VisualGuidelineMediaItem[] = [];
  const paths: string[] = [];
  let bucket: string | null = null;

  for (const it of itemsRaw) {
    const o = asRecord(it);
    if (!o) continue;
    const objectPath =
      typeof o.object_path === "string" && o.object_path.trim()
        ? o.object_path.trim()
        : null;
    const b = typeof o.bucket === "string" && o.bucket.trim() ? o.bucket.trim() : null;
    if (b && !bucket) bucket = b;
    if (objectPath) paths.push(objectPath);
    const pub = typeof o.public_url === "string" && o.public_url.trim() ? o.public_url.trim() : null;
    const vision =
      typeof o.vision_fetch_url === "string" && o.vision_fetch_url.trim()
        ? o.vision_fetch_url.trim()
        : null;
    const sourceSlide =
      o.source_slide_index != null && Number.isFinite(Number(o.source_slide_index))
        ? Number(o.source_slide_index)
        : null;
    items.push({
      role: String(o.role ?? "asset"),
      object_path: objectPath,
      bucket: b,
      public_url: pub,
      vision_fetch_url: vision,
      index: typeof o.index === "number" ? o.index : null,
      source_slide_index: sourceSlide != null && sourceSlide > 0 ? sourceSlide : null,
      is_video_slide: o.is_video_slide === true,
      content_type: typeof o.content_type === "string" ? o.content_type : null,
      source_url: typeof o.source_url === "string" ? o.source_url : null,
    });
  }

  const folder_prefix = commonPathPrefix(paths);
  const storage_folder_label =
    bucket && folder_prefix ? `${bucket} · ${folder_prefix}` : bucket ?? folder_prefix;

  return {
    storage_bucket: bucket,
    folder_prefix,
    storage_folder_label,
    items,
    skipped_reason: typeof rec.skipped_reason === "string" ? rec.skipped_reason : null,
  };
}

import type { EvidenceMediaStorageRow } from "../repositories/inputs-evidence-media.js";

export function compactEvidenceMediaRows(rows: EvidenceMediaStorageRow[]): VisualGuidelineInspectionMedia | null {
  if (!rows.length) return null;
  const items: VisualGuidelineMediaItem[] = [];
  const paths: string[] = [];
  let bucket: string | null = null;

  for (const r of rows) {
    const objectPath = r.storage_path?.trim() || null;
    const b = r.storage_bucket?.trim() || null;
    if (b && !bucket) bucket = b;
    if (objectPath) paths.push(objectPath);
    const pub = r.public_url?.trim() || (r.source_url.startsWith("https://") ? r.source_url.trim() : null);
    items.push({
      role: r.asset_role || "evidence_media",
      object_path: objectPath,
      bucket: b,
      public_url: pub,
      vision_fetch_url: pub,
      index: r.slide_index,
    });
  }

  const folder_prefix = commonPathPrefix(paths);
  return {
    storage_bucket: bucket,
    folder_prefix,
    storage_folder_label:
      bucket && folder_prefix ? `${bucket} · ${folder_prefix}` : bucket ?? folder_prefix,
    items,
    skipped_reason: null,
  };
}

/** Merge inspection archive + evidence_media rows (dedupe by object_path / public_url). */
export function mergeInspectionMedia(
  fromInsight: VisualGuidelineInspectionMedia | null,
  fromEvidence: VisualGuidelineInspectionMedia | null
): VisualGuidelineInspectionMedia | null {
  if (!fromInsight && !fromEvidence) return null;
  const items: VisualGuidelineMediaItem[] = [];
  const seen = new Set<string>();
  const push = (it: VisualGuidelineMediaItem) => {
    const k = (it.object_path ?? it.public_url ?? it.vision_fetch_url ?? "").toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    items.push(it);
  };
  for (const it of fromInsight?.items ?? []) push(it);
  for (const it of fromEvidence?.items ?? []) push(it);

  const paths = items.map((i) => i.object_path).filter((p): p is string => !!p);
  const bucket = fromInsight?.storage_bucket ?? fromEvidence?.storage_bucket ?? null;
  const folder_prefix =
    commonPathPrefix(paths) ?? fromInsight?.folder_prefix ?? fromEvidence?.folder_prefix ?? null;

  return {
    storage_bucket: bucket,
    folder_prefix,
    storage_folder_label:
      bucket && folder_prefix ? `${bucket} · ${folder_prefix}` : bucket ?? folder_prefix,
    items,
    skipped_reason: fromInsight?.skipped_reason ?? fromEvidence?.skipped_reason ?? null,
  };
}

/** Optional Supabase dashboard deep-link when project URL is configured. */
export function supabaseStoragePublicUrl(config: AppConfig, bucket: string, objectPath: string): string | null {
  const base = config.SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!base || !bucket || !objectPath) return null;
  const key = objectPath.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function normalizeFormatPattern(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "unknown";
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

/** Primary format token for grouping (first segment before `|`). */
export function primaryFormatKey(formatPattern: string): string {
  const t = formatPattern.split("|")[0]?.trim();
  return t || "unknown";
}

const THUMBNAIL_ROLES = ["carousel_slide", "video_frame", "evidence_media"] as const;

/** Best URL for `<img src>` — prefer signed vision URL over public path that may 403. */
export function pickInspectionMediaPreviewUrl(media: VisualGuidelineInspectionMedia | null): string | null {
  if (!media?.items?.length) return null;
  const items = media.items;
  const ranked = [
    ...items.filter((it) => THUMBNAIL_ROLES.includes(it.role as (typeof THUMBNAIL_ROLES)[number])),
    ...items,
  ];
  const seen = new Set<string>();
  for (const it of ranked) {
    const u = (it.vision_fetch_url ?? it.public_url ?? "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    return u;
  }
  return null;
}

/** Re-sign stored object keys so Review can load thumbnails from private buckets. */
export async function signInspectionMediaForDisplay(
  config: AppConfig,
  media: VisualGuidelineInspectionMedia | null
): Promise<VisualGuidelineInspectionMedia | null> {
  if (!media?.items?.length) return media;
  const items: VisualGuidelineMediaItem[] = [];
  for (const it of media.items) {
    let vision_fetch_url = it.vision_fetch_url;
    if (it.bucket && it.object_path) {
      const signed = await createSignedUrlForObjectKey(
        config,
        it.bucket,
        it.object_path,
        DISPLAY_SIGNED_URL_TTL_SEC
      );
      if ("signedUrl" in signed) vision_fetch_url = signed.signedUrl;
    }
    items.push({ ...it, vision_fetch_url });
  }
  return { ...media, items };
}
