import type { SignalPackRow } from "../repositories/signal-packs.js";
import { parseIdeasV2 } from "../domain/signal-pack-ideas-v2.js";

/** Rows for admin UI (manual idea pick, previews) — not planner JSON. */
export interface SignalPackIdeaUiRow {
  idea_id: string;
  title: string;
  detail: string;
  platform: string;
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
    });
  }
  return out;
}
