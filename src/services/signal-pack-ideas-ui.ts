import type { SignalPackRow } from "../repositories/signal-packs.js";
import { parseIdeasV2 } from "../domain/signal-pack-ideas-v2.js";

/** Rows for admin UI (manual idea pick, previews) — not planner JSON. */
export interface SignalPackIdeaUiRow {
  idea_id: string;
  title: string;
  detail: string;
  platform: string;
  format: string;
}

const FORMAT_TAB_ORDER = ["video", "carousel", "post", "thread", "blog", "slides", "script", "memo"] as const;

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

export function formatTabLabel(tab: string): string {
  if (tab === "other") return "Other";
  return tab.charAt(0).toUpperCase() + tab.slice(1);
}

export function groupIdeasByFormatTab(rows: SignalPackIdeaUiRow[]): Map<string, SignalPackIdeaUiRow[]> {
  const map = new Map<string, SignalPackIdeaUiRow[]>();
  for (const row of rows) {
    const tab = normalizeIdeaFormatTab(row.format);
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

/**
 * Normalize pack `ideas_json` into human-readable rows (rich schema or legacy flat rows).
 */
export function buildSignalPackIdeasForUi(signalPack: SignalPackRow | null): SignalPackIdeaUiRow[] {
  if (!signalPack) return [];
  const rich = parseIdeasV2(signalPack.ideas_json);
  if (rich.length > 0) {
    return rich.map((i) => {
      const detailBits = [i.three_liner?.trim(), i.thesis?.trim()].filter(Boolean);
      const detail =
        detailBits.join(" — ").slice(0, 560) || i.title.trim();
      return {
        idea_id: i.id,
        title: i.title.trim(),
        detail,
        platform: String(i.platform ?? "Multi"),
        format: String(i.format ?? "post"),
      };
    });
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
    out.push({
      idea_id,
      title: content_idea || idea_id,
      detail: summary || content_idea || "—",
      platform: String(o.platform ?? o.target_platform ?? "Multi"),
      format: String(o.format ?? o.content_format ?? "post"),
    });
  }
  return out;
}
