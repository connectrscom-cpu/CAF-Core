import type { Pool } from "pg";
import { listEvidenceRowsForRating, type EvidenceRowWithRating } from "../repositories/inputs-evidence.js";
import { extractEvidenceDisplayFields } from "./inputs-evidence-display.js";

export type HashtagLeaderboardEntry = {
  hashtag: string;
  /** Raw frequency across evidence rows (deduped per row). */
  count: number;
  /** Sum of per-row weights (defaults to 1 for unrated rows). */
  weight: number;
  /** Average evidence rating score across rows that contributed (0–1), null if none rated. */
  avg_rating_score: number | null;
};

function normalizeHashtag(raw: string): string | null {
  let t = String(raw ?? "").trim();
  if (!t) return null;
  // tolerate "tag" (no #) when coming from comma-separated lists
  if (!t.startsWith("#")) t = `#${t}`;
  // Strip trailing punctuation / noise
  t = t.replace(/[.,;:!?)\]}]+$/g, "");
  // Basic validity: must start with # + a letter, then letters/numbers/underscore (unicode letters ok)
  const m = t.match(/^#[\p{L}][\p{L}\p{N}_]{1,49}$/u);
  if (!m) return null;
  // Keep the display form lowercase to avoid duplicates (#AI vs #ai)
  return `#${t.slice(1).toLowerCase()}`;
}

function extractHashtagsFromText(s: string): string[] {
  const text = String(s ?? "");
  if (!text.trim()) return [];
  const hits = text.match(/#[\p{L}][\p{L}\p{N}_]{1,49}/gu) ?? [];
  return hits;
}

function extractHashtagsFromLooseList(s: string): string[] {
  const text = String(s ?? "").trim();
  if (!text) return [];
  // Accept "tag1, tag2 | #tag3" style exports.
  const parts = text
    .split(/[\s,;|]+/g)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts;
}

function ratingWeightFromRow(r: EvidenceRowWithRating): { weight: number; rating: number | null } {
  const raw = r.rating_score;
  const n = raw == null ? Number.NaN : parseFloat(String(raw));
  if (!Number.isFinite(n)) return { weight: 1, rating: null };
  const clamped = Math.max(0, Math.min(1, n));
  // Weight is proportional to rating but never 0 so unrated/low-rated still contribute minimally.
  return { weight: 0.25 + clamped, rating: clamped };
}

export function computeHashtagLeaderboardFromEvidenceRows(
  rows: EvidenceRowWithRating[],
  opts?: { limit?: number }
): HashtagLeaderboardEntry[] {
  const limit = Math.min(Math.max(opts?.limit ?? 80, 1), 300);

  type Acc = { count: number; weight: number; ratedSum: number; ratedN: number };
  const byTag = new Map<string, Acc>();

  for (const r of rows) {
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    const disp = extractEvidenceDisplayFields(r.evidence_kind, payload);
    const combined = `${disp.caption ?? ""}\n${disp.hashtags ?? ""}`.trim();
    if (!combined) continue;

    const candidates = [
      ...extractHashtagsFromText(combined),
      ...(disp.hashtags ? extractHashtagsFromLooseList(disp.hashtags) : []),
    ];

    const unique = new Set<string>();
    for (const c of candidates) {
      const n = normalizeHashtag(c);
      if (n) unique.add(n);
    }
    if (unique.size === 0) continue;

    const w = ratingWeightFromRow(r);
    for (const tag of unique) {
      const cur = byTag.get(tag) ?? { count: 0, weight: 0, ratedSum: 0, ratedN: 0 };
      cur.count += 1;
      cur.weight += w.weight;
      if (w.rating != null) {
        cur.ratedSum += w.rating;
        cur.ratedN += 1;
      }
      byTag.set(tag, cur);
    }
  }

  const out: HashtagLeaderboardEntry[] = [];
  for (const [hashtag, a] of byTag.entries()) {
    out.push({
      hashtag,
      count: a.count,
      weight: Math.round(a.weight * 1000) / 1000,
      avg_rating_score: a.ratedN > 0 ? Math.round((a.ratedSum / a.ratedN) * 1000) / 1000 : null,
    });
  }

  out.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (b.count !== a.count) return b.count - a.count;
    return a.hashtag.localeCompare(b.hashtag);
  });

  return out.slice(0, limit);
}

export async function computeHashtagLeaderboardForEvidenceImport(
  db: Pool,
  projectId: string,
  importId: string,
  opts?: {
    /** Max evidence rows to scan (bounded). */
    max_rows?: number;
    /** Max unique hashtags to return (bounded). */
    limit?: number;
  }
): Promise<{ leaderboard: HashtagLeaderboardEntry[]; rows_scanned: number }> {
  const maxRows = Math.min(Math.max(opts?.max_rows ?? 5000, 1), 15000);

  const rows = await listEvidenceRowsForRating(db, projectId, importId, maxRows);
  const leaderboard = computeHashtagLeaderboardFromEvidenceRows(rows, { limit: opts?.limit });
  return { leaderboard, rows_scanned: rows.length };
}

