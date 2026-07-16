/**
 * Subject-relevance gate for pre-LLM scoring (e.g. LinkedIn posts vs brand keywords).
 * Config: `criteria_json.pre_llm.subject_relevance`.
 */
import type { Pool } from "pg";
import { listSourceRows } from "../repositories/inputs-sources.js";
import { mergePersonalLifeExcludes } from "./content-subject-guards.js";

export interface SubjectRelevanceConfig {
  include_keywords?: string[];
  include_hashtags?: string[];
  exclude_keywords?: string[];
  /** Minimum subject score (0–1) when include lists are non-empty. */
  min_score?: number;
  subject_weight?: number;
  performance_weight?: number;
  /** Empty = apply to all post kinds that use the blend path. */
  apply_to_kinds?: string[];
}

export const DEFAULT_SUBJECT_RELEVANCE: SubjectRelevanceConfig = {
  min_score: 0.2,
  subject_weight: 0.35,
  performance_weight: 0.65,
  /** Apply across social evidence — not LinkedIn-only. */
  apply_to_kinds: [
    "instagram_post",
    "tiktok_video",
    "facebook_post",
    "linkedin_post",
    "reddit_post",
  ],
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normTerm(raw: string): string {
  return raw.trim().toLowerCase();
}

function parseKeywordLines(lines: string[]): { includes: string[]; excludes: string[] } {
  const includes: string[] = [];
  const excludes: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const excludeMatch = trimmed.match(/^-\s*(.+)$/) || trimmed.match(/^exclude:\s*(.+)$/i);
    if (excludeMatch) excludes.push(excludeMatch[1]!.trim());
    else includes.push(trimmed);
  }
  return { includes, excludes };
}

export function parseSubjectRelevanceConfig(raw: unknown): SubjectRelevanceConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const readList = (key: string): string[] => {
    const v = o[key];
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x).trim()).filter(Boolean);
  };
  const includes = readList("include_keywords");
  const hashtags = readList("include_hashtags");
  const excludes = readList("exclude_keywords");
  const min_score =
    typeof o.min_score === "number" && Number.isFinite(o.min_score) ? clamp(o.min_score, 0, 1) : DEFAULT_SUBJECT_RELEVANCE.min_score!;
  const subject_weight =
    typeof o.subject_weight === "number" && Number.isFinite(o.subject_weight) && o.subject_weight >= 0
      ? o.subject_weight
      : DEFAULT_SUBJECT_RELEVANCE.subject_weight!;
  const performance_weight =
    typeof o.performance_weight === "number" && Number.isFinite(o.performance_weight) && o.performance_weight >= 0
      ? o.performance_weight
      : DEFAULT_SUBJECT_RELEVANCE.performance_weight!;
  const apply_to_kinds = readList("apply_to_kinds");
  return {
    include_keywords: includes,
    include_hashtags: hashtags,
    exclude_keywords: excludes,
    min_score,
    subject_weight,
    performance_weight,
    apply_to_kinds: apply_to_kinds.length ? apply_to_kinds : [...(DEFAULT_SUBJECT_RELEVANCE.apply_to_kinds ?? [])],
  };
}

export function appliesSubjectRelevance(evidenceKind: string, cfg: SubjectRelevanceConfig | null): boolean {
  if (!cfg) return false;
  const kinds = cfg.apply_to_kinds ?? [];
  if (!kinds.length) return true;
  return kinds.includes(evidenceKind);
}

export function hasSubjectRelevanceLists(cfg: SubjectRelevanceConfig | null): boolean {
  if (!cfg) return false;
  return (
    (cfg.include_keywords?.length ?? 0) +
      (cfg.include_hashtags?.length ?? 0) +
      (cfg.exclude_keywords?.length ?? 0) >
    0
  );
}

export function extractSearchablePostText(payload: Record<string, unknown>): string {
  const parts = [
    payload.title,
    payload.Title,
    payload.body_text,
    payload.content,
    payload.caption,
    payload.Caption,
    payload.main_text,
    payload.text,
    payload.hashtags,
    payload.Hashtags,
    payload.tags,
  ]
    .map((x) => (x != null ? String(x) : ""))
    .filter(Boolean);
  return parts.join(" ").toLowerCase();
}

function termMatches(text: string, term: string): boolean {
  const t = normTerm(term);
  if (!t) return false;
  if (t.startsWith("#")) return text.includes(t) || text.includes(t.slice(1));
  return text.includes(t);
}

export function computeSubjectRelevanceScore(
  payload: Record<string, unknown>,
  cfg: SubjectRelevanceConfig
): {
  score: number;
  matched_includes: string[];
  matched_excludes: string[];
} {
  const text = extractSearchablePostText(payload);
  const includes = [...(cfg.include_keywords ?? []), ...(cfg.include_hashtags ?? [])];
  const excludes = mergePersonalLifeExcludes(cfg.exclude_keywords);

  const matched_excludes = excludes.filter((term) => termMatches(text, term));
  if (matched_excludes.length > 0) {
    return { score: 0, matched_includes: [], matched_excludes };
  }

  if (includes.length === 0) {
    return { score: 1, matched_includes: [], matched_excludes: [] };
  }

  const matched_includes = includes.filter((term) => termMatches(text, term));
  if (matched_includes.length === 0) {
    return { score: 0, matched_includes, matched_excludes: [] };
  }

  const ratio = matched_includes.length / includes.length;
  const score = clamp(0.3 + ratio * 0.7, 0, 1);
  return { score, matched_includes, matched_excludes: [] };
}

export function blendPerformanceAndSubject(
  performanceScore: number,
  subjectScore: number,
  cfg: SubjectRelevanceConfig
): number {
  const subW = cfg.subject_weight ?? DEFAULT_SUBJECT_RELEVANCE.subject_weight!;
  const perfW = cfg.performance_weight ?? DEFAULT_SUBJECT_RELEVANCE.performance_weight!;
  const total = subW + perfW;
  if (total <= 0) return clamp(performanceScore, 0, 1);
  return clamp((perfW * performanceScore + subW * subjectScore) / total, 0, 1);
}

/** Fill empty subject lists from Research → LinkedIn keywords watchlist. */
export async function enrichCriteriaWithLinkedInKeywords(
  db: Pool,
  projectId: string,
  criteria: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const preIn = criteria.pre_llm;
  const pre =
    preIn && typeof preIn === "object" && !Array.isArray(preIn) ? ({ ...(preIn as Record<string, unknown>) } as Record<string, unknown>) : {};
  const existing = parseSubjectRelevanceConfig(pre.subject_relevance);
  if (hasSubjectRelevanceLists(existing)) {
    return criteria;
  }

  const rows = await listSourceRows(db, projectId, "linkedinkeywords");
  if (!rows.length) return criteria;

  const lines = rows
    .map((r) => String((r.payload_json as Record<string, unknown>)?.Name ?? (r.payload_json as Record<string, unknown>)?.keyword ?? "").trim())
    .filter(Boolean);
  const { includes, excludes } = parseKeywordLines(lines);
  if (!includes.length && !excludes.length) return criteria;

  const hashtagIncludes = includes.filter((k) => k.startsWith("#"));
  const keywordIncludes = includes.filter((k) => !k.startsWith("#"));

  const merged: SubjectRelevanceConfig = {
    ...DEFAULT_SUBJECT_RELEVANCE,
    ...(existing ?? {}),
    include_keywords: keywordIncludes,
    include_hashtags: hashtagIncludes,
    exclude_keywords: excludes,
  };

  return {
    ...criteria,
    pre_llm: {
      ...pre,
      subject_relevance: merged,
    },
  };
}
