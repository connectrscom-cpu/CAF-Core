import { RESEARCH_RUN_PLATFORMS } from "./research-adapters";

export interface MarketerPackNotes {
  marketer_title?: string;
  platforms?: string[];
  postMaxAgeDays?: number;
  startedAt?: string;
  brief_scope?: "overall" | "platform";
  parent_signal_pack_id?: string;
}

export function parsePackNotes(raw: string | null | undefined): {
  plain: string | null;
  marketer: MarketerPackNotes;
} {
  if (!raw?.trim()) return { plain: null, marketer: {} };
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (j && typeof j === "object" && !Array.isArray(j)) {
      const nested = j.marketer;
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        return { plain: null, marketer: nested as MarketerPackNotes };
      }
      if ("marketer_title" in j || "platforms" in j || "postMaxAgeDays" in j) {
        return { plain: null, marketer: j as MarketerPackNotes };
      }
    }
  } catch {
    /* plain text notes */
  }
  return { plain: raw.trim(), marketer: {} };
}

export function serializePackNotes(
  marketer: MarketerPackNotes,
  existingRaw?: string | null
): string {
  const { marketer: existing } = parsePackNotes(existingRaw);
  const merged: MarketerPackNotes = { ...existing, ...marketer };
  const cleaned = Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v != null && v !== "")
  );
  return JSON.stringify({ marketer: cleaned });
}

export function formatBriefDate(created: string): string {
  const d = new Date(created);
  if (Number.isNaN(d.getTime())) return created.slice(0, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** True for admin-generated notes/filenames that should not be shown to marketers. */
export function isUpstreamAutoBriefNote(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  const t = text.trim();
  if (/^Built from inputs idea list\b/i.test(t)) return true;
  if (/^Marketer-generated from intelligence\b/i.test(t)) return true;
  if (/^from_idea_list:/i.test(t)) return true;
  return false;
}

export function formatResearchPlatformLabels(platformIds: string[]): string {
  if (!platformIds.length) return "";
  const map = Object.fromEntries(RESEARCH_RUN_PLATFORMS.map((p) => [p.id, p.label]));
  return platformIds.map((id) => map[id.toLowerCase()] ?? id).join(", ");
}

export function formatBriefTimestamp(created: string): string {
  const d = new Date(created);
  if (Number.isNaN(d.getTime())) {
    return created.slice(0, 16).replace("T", " ");
  }
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

export function buildDefaultResearchBriefTitle(opts: {
  createdAt: string;
  brandDisplayName: string;
  platforms: string[];
}): string {
  const brand = opts.brandDisplayName.trim() || "Brand";
  const when = formatBriefTimestamp(opts.createdAt || new Date().toISOString());
  const platforms = formatResearchPlatformLabels(opts.platforms);
  if (platforms) return `${when} · ${brand} · ${platforms}`;
  return `${when} · ${brand}`;
}

export function applyResearchBriefDisplayNames(
  brief: {
    createdAt: string;
    platforms: string[];
    notes: string | null;
  },
  brandDisplayName: string,
  uploadFilename?: string | null
): { userTitle: string; label: string } {
  const { marketer, plain } = parsePackNotes(brief.notes);
  const brand = brandDisplayName.trim() || "Brand";

  if (marketer.marketer_title?.trim()) {
    const userTitle = marketer.marketer_title.trim();
    return {
      userTitle,
      label: `${brand} · ${userTitle} · ${formatBriefDate(brief.createdAt)}`,
    };
  }

  if (plain && !isUpstreamAutoBriefNote(plain)) {
    return {
      userTitle: plain,
      label: `${brand} · ${plain} · ${formatBriefDate(brief.createdAt)}`,
    };
  }

  const fromFilename = uploadFilename?.trim().replace(/\.[^.]+$/, "") ?? "";
  if (fromFilename && !isUpstreamAutoBriefNote(fromFilename)) {
    return {
      userTitle: fromFilename,
      label: `${brand} · ${fromFilename} · ${formatBriefDate(brief.createdAt)}`,
    };
  }

  const displayTitle = buildDefaultResearchBriefTitle({
    createdAt: brief.createdAt,
    brandDisplayName: brand,
    platforms: brief.platforms,
  });
  return { userTitle: displayTitle, label: displayTitle };
}
