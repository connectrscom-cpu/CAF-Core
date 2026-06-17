import type { SignalPackRow } from "../repositories/signal-packs.js";
import { parseIdeasV2 } from "../domain/signal-pack-ideas-v2.js";

/** Rows for admin UI (manual idea pick, previews) — not planner JSON. */
export interface SignalPackIdeaUiRow {
  idea_id: string;
  title: string;
  detail: string;
  platform: string;
  format: string;
  content_lens?: string;
  carousel_style?: string;
  execution_profile?: string;
  video_style?: string;
  /** True when format=carousel and style is visual_first or mixed (FLOW_VISUAL_FIRST_CAROUSEL lane). */
  visual_first_carousel?: boolean;
  /** Human label for manual-pick Style column. */
  carousel_lane_label?: string;
}

const FORMAT_TAB_ORDER = [
  "video",
  "carousel_visual",
  "carousel",
  "post",
  "thread",
  "blog",
  "slides",
  "script",
  "memo",
] as const;

export const CAROUSEL_VISUAL_FIRST_TAB = "carousel_visual";

/** Normalize pack format strings into stable tab keys. */
export function normalizeIdeaFormatTab(format: unknown): string {
  const f = String(format ?? "")
    .trim()
    .toLowerCase();
  if (!f) return "other";
  if (f.includes("carousel")) return "carousel";
  if (f.includes("video") || f.includes("reel") || f.includes("short")) return "video";
  if (f.includes("thread")) return "thread";
  if (f.includes("post") || f.includes("static") || f.includes("image")) return "post";
  if (f.includes("blog")) return "blog";
  if (f.includes("slide")) return "slides";
  if (f.includes("script")) return "script";
  if (f.includes("memo")) return "memo";
  if ((FORMAT_TAB_ORDER as readonly string[]).includes(f)) return f;
  return "other";
}

export function normalizeCarouselStyle(raw: unknown, fallback?: unknown): string {
  const s = String(raw ?? fallback ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  return s;
}

export function isVisualFirstCarouselIdea(row: {
  format?: unknown;
  carousel_style?: unknown;
  execution_profile?: unknown;
}): boolean {
  if (normalizeIdeaFormatTab(row.format) !== "carousel") return false;
  const style = normalizeCarouselStyle(row.carousel_style, row.execution_profile);
  return style === "visual_first" || style === "mixed";
}

export function carouselLaneLabel(row: {
  format?: unknown;
  carousel_style?: unknown;
  execution_profile?: unknown;
}): string {
  if (normalizeIdeaFormatTab(row.format) !== "carousel") return "";
  const style = normalizeCarouselStyle(row.carousel_style, row.execution_profile);
  if (style === "visual_first") return "Visual-first";
  if (style === "mixed") return "Mixed";
  if (style === "text_heavy") return "Text-heavy";
  return style ? style.replace(/_/g, " ") : "Carousel";
}

/** Tab key for Runs manual idea picker (splits visual-first carousels from text-heavy). */
export function ideaPickTabKey(row: {
  format?: unknown;
  carousel_style?: unknown;
  execution_profile?: unknown;
}): string {
  if (isVisualFirstCarouselIdea(row)) return CAROUSEL_VISUAL_FIRST_TAB;
  return normalizeIdeaFormatTab(row.format);
}

export function formatTabLabel(tab: string): string {
  if (tab === CAROUSEL_VISUAL_FIRST_TAB) return "Carousel · visual-first";
  if (tab === "carousel") return "Carousel · text-heavy";
  if (tab === "other") return "Other";
  return tab.charAt(0).toUpperCase() + tab.slice(1);
}

export function groupIdeasByFormatTab(rows: SignalPackIdeaUiRow[]): Map<string, SignalPackIdeaUiRow[]> {
  const map = new Map<string, SignalPackIdeaUiRow[]>();
  for (const row of rows) {
    const tab = ideaPickTabKey(row);
    const list = map.get(tab) ?? [];
    list.push(row);
    map.set(tab, list);
  }
  return map;
}

export function orderedFormatTabs(rows: SignalPackIdeaUiRow[]): string[] {
  const grouped = groupIdeasByFormatTab(rows);
  const tabs: string[] = [];
  for (const k of FORMAT_TAB_ORDER) {
    if ((grouped.get(k)?.length ?? 0) > 0) tabs.push(k);
  }
  if ((grouped.get("other")?.length ?? 0) > 0) tabs.push("other");
  return tabs;
}

function rowFromRichIdea(i: ReturnType<typeof parseIdeasV2>[number]): SignalPackIdeaUiRow {
  const detailBits = [i.three_liner?.trim(), i.thesis?.trim()].filter(Boolean);
  const detail = detailBits.join(" — ").slice(0, 560) || i.title.trim();
  const visualFirst = isVisualFirstCarouselIdea(i);
  return {
    idea_id: i.id,
    title: i.title.trim(),
    detail,
    platform: String(i.platform ?? "Multi"),
    format: String(i.format ?? "post"),
    content_lens: i.content_lens,
    carousel_style: i.carousel_style,
    execution_profile: i.execution_profile,
    video_style: i.video_style,
    visual_first_carousel: visualFirst || undefined,
    carousel_lane_label: carouselLaneLabel(i) || undefined,
  };
}

/**
 * Normalize pack `ideas_json` into human-readable rows (rich schema or legacy flat rows).
 */
export function buildSignalPackIdeasForUi(signalPack: SignalPackRow | null): SignalPackIdeaUiRow[] {
  if (!signalPack) return [];
  const rich = parseIdeasV2(signalPack.ideas_json);
  if (rich.length > 0) {
    return rich.map(rowFromRichIdea);
  }

  const raw = signalPack.ideas_json;
  if (!Array.isArray(raw)) return [];
  const out: SignalPackIdeaUiRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const idea_id = String(o.idea_id ?? o.id ?? "").trim();
    if (!idea_id) continue;
    const content_idea = String(o.content_idea ?? o.title ?? "").trim();
    const summary = String(o.summary ?? o.three_liner ?? "").trim();
    const visualFirst = isVisualFirstCarouselIdea(o);
    out.push({
      idea_id,
      title: content_idea || idea_id,
      detail: summary || content_idea || "—",
      platform: String(o.platform ?? o.target_platform ?? "Multi"),
      format: String(o.format ?? o.content_format ?? "post"),
      content_lens: o.content_lens != null ? String(o.content_lens) : undefined,
      carousel_style: o.carousel_style != null ? String(o.carousel_style) : undefined,
      execution_profile: o.execution_profile != null ? String(o.execution_profile) : undefined,
      video_style: o.video_style != null ? String(o.video_style) : undefined,
      visual_first_carousel: visualFirst || undefined,
      carousel_lane_label: carouselLaneLabel(o) || undefined,
    });
  }
  return out;
}
