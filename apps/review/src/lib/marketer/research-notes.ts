export interface MarketerPackNotes {
  marketer_title?: string;
  platforms?: string[];
  postMaxAgeDays?: number;
  startedAt?: string;
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
