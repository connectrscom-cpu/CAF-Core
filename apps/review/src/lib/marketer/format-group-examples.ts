import { pickInspectionMediaPreviewUrl, pickRenderableThumb } from "./inspection-media";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function normalizeFormatKey(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "unknown";
  return (s.split("|")[0] ?? s).trim() || "unknown";
}

export interface FormatGroupExample {
  insightsId: string;
  title: string;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  postUrl: string | null;
  platform: string;
  isVideo: boolean;
}

function vgEntries(pack: Record<string, unknown> | null): Record<string, unknown>[] {
  const derived = asRecord(pack?.derived_globals_json);
  const vg = asRecord(derived?.visual_guidelines_pack_v1);
  return asArray(vg?.entries)
    .map((x) => asRecord(x))
    .filter((x): x is Record<string, unknown> => x != null);
}

function entryByInsightsId(pack: Record<string, unknown> | null, insightsId: string): Record<string, unknown> | null {
  for (const entry of vgEntries(pack)) {
    if (str(entry.insights_id) === insightsId) return entry;
  }
  return null;
}

function exampleIdsFromPack(
  pack: Record<string, unknown> | null,
  lane: "carousel" | "video" | "image",
  formatKey: string
): string[] {
  const derived = asRecord(pack?.derived_globals_json);
  const tpk = asRecord(derived?.top_performer_knowledge_v1);
  const lanes = asRecord(tpk?.media_lanes);
  const slice = asRecord(lanes?.[lane]);
  const want = normalizeFormatKey(formatKey);

  for (const raw of asArray(slice?.content_format_groups)) {
    const g = asRecord(raw);
    if (!g) continue;
    const key = normalizeFormatKey(str(g.content_format_key) || str(g.content_format_pattern));
    if (key !== want) continue;
    return asArray(g.example_insights_ids).map((id) => str(id)).filter(Boolean).slice(0, 4);
  }

  const vg = asRecord(derived?.visual_guidelines_pack_v1);
  for (const raw of asArray(vg?.visual_guideline_cues_by_format)) {
    const g = asRecord(raw);
    if (!g) continue;
    const key = normalizeFormatKey(str(g.format_key) || str(g.format_pattern));
    if (key !== want) continue;
    return asArray(g.example_insights_ids).map((id) => str(id)).filter(Boolean).slice(0, 4);
  }

  return [];
}

function bestThumbnailFromEntry(entry: Record<string, unknown>): string | null {
  const im = inspectionMediaFromEntry(entry);
  if (!im?.items.length) return null;
  const ranked = pickInspectionMediaPreviewUrl(im);
  if (ranked) return ranked;
  for (const it of im.items) {
    const found = pickRenderableThumb(it.public_url, it.vision_fetch_url);
    if (found) return found;
  }
  return null;
}

export function enrichFormatExamplesFromEvidence(
  examples: FormatGroupExample[],
  evidencePosts: Array<{ insightsId: string; thumbnailUrl: string | null }>
): FormatGroupExample[] {
  const byId = new Map(evidencePosts.map((p) => [p.insightsId, p.thumbnailUrl]));
  return examples.map((ex) => ({
    ...ex,
    thumbnailUrl: pickRenderableThumb(ex.thumbnailUrl, byId.get(ex.insightsId), ex.mediaUrl),
    mediaUrl: pickRenderableThumb(ex.mediaUrl, byId.get(ex.insightsId), ex.thumbnailUrl),
  }));
}

function inspectionMediaFromEntry(entry: Record<string, unknown>) {
  const im = asRecord(entry.inspection_media);
  if (!im) return null;
  return {
    items: asArray(im.items)
      .map((it) => {
        const o = asRecord(it);
        return o
          ? {
              role: str(o.role),
              public_url: str(o.public_url) || null,
              vision_fetch_url: str(o.vision_fetch_url) || null,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null),
  };
}

function isVideoEntry(entry: Record<string, unknown>, lane: "carousel" | "video" | "image"): boolean {
  if (lane === "video") return true;
  const tier = str(entry.analysis_tier).toLowerCase();
  if (tier.includes("video")) return true;
  const im = inspectionMediaFromEntry(entry);
  const roles = new Set((im?.items ?? []).map((it) => it.role));
  return roles.has("video_frame") || roles.has("source_video");
}

function pickVideoUrl(entry: Record<string, unknown>): string | null {
  const im = inspectionMediaFromEntry(entry);
  if (!im?.items.length) return null;
  for (const it of im.items) {
    if (it.role === "source_video" || it.role === "video_frame") {
      const u = (it.vision_fetch_url ?? it.public_url ?? "").trim();
      if (u) return u;
    }
  }
  for (const it of im.items) {
    const u = (it.public_url ?? it.vision_fetch_url ?? "").trim();
    if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) return u;
  }
  return null;
}

function humanPlatform(entry: Record<string, unknown>): string {
  const kind = str(entry.evidence_kind).toLowerCase();
  if (kind.includes("instagram")) return "Instagram";
  if (kind.includes("tiktok")) return "TikTok";
  if (kind.includes("facebook")) return "Facebook";
  if (kind.includes("youtube")) return "YouTube";
  return str(entry.evidence_platform) || "Social";
}

export function buildFormatGroupExample(
  pack: Record<string, unknown> | null,
  insightsId: string,
  lane: "carousel" | "video" | "image"
): FormatGroupExample | null {
  const entry = entryByInsightsId(pack, insightsId);
  if (!entry) return null;

  const isVideo = isVideoEntry(entry, lane);
  const thumbnailUrl = bestThumbnailFromEntry(entry);
  const mediaUrl = isVideo ? pickVideoUrl(entry) ?? thumbnailUrl : thumbnailUrl;
  const title =
    str(entry.hook_snippet) ||
    str(entry.title) ||
    str(entry.why_it_worked).slice(0, 80) ||
    "Research example";

  return {
    insightsId,
    title: title.length > 100 ? `${title.slice(0, 98)}…` : title,
    thumbnailUrl,
    mediaUrl,
    postUrl: str(entry.evidence_post_url) || str(entry.post_url) || null,
    platform: humanPlatform(entry),
    isVideo,
  };
}

export function resolveFormatGroupExamples(
  pack: Record<string, unknown> | null,
  lane: "carousel" | "video" | "image",
  formatKey: string,
  explicitIds?: string[],
  limit = 3
): FormatGroupExample[] {
  const ids =
    explicitIds?.length ? explicitIds : exampleIdsFromPack(pack, lane, formatKey);
  const out: FormatGroupExample[] = [];
  for (const id of ids) {
    const ex = buildFormatGroupExample(pack, id, lane);
    if (ex) out.push(ex);
    if (out.length >= limit) break;
  }
  return out;
}
