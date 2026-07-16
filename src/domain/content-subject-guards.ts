/**
 * Heuristics to keep personal-life milestones out of research examples /
 * market intelligence (e.g. a chef’s wedding anniversary ≠ food content).
 */
const STRONG_PERSONAL_LIFE_PHRASES = [
  "wedding anniversary",
  "happy anniversary",
  "years married",
  "years of marriage",
  "our wedding",
  "wedding day",
  "got married",
  "we got married",
  "my wife",
  "my husband",
  "baby shower",
  "gender reveal",
  "funeral",
  "obituary",
  "honeymoon",
] as const;

/** Soft exclude terms for pre-LLM subject_relevance (projects can override). */
export const DEFAULT_PERSONAL_LIFE_EXCLUDE_KEYWORDS: string[] = [
  "wedding anniversary",
  "happy anniversary",
  "years married",
  "our wedding",
  "wedding day",
  "baby shower",
  "gender reveal",
  "honeymoon",
];

export function looksLikePersonalLifeMilestone(text: string): boolean {
  const t = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!t) return false;
  if (STRONG_PERSONAL_LIFE_PHRASES.some((p) => t.includes(p))) return true;
  // Wedding + marriage language together (avoids false positives on "wedding cake recipe").
  if (t.includes("wedding") && (t.includes("married") || t.includes("marriage") || t.includes("bride") || t.includes("groom"))) {
    return true;
  }
  return false;
}

export function mergePersonalLifeExcludes(excludeKeywords: string[] | undefined | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const term of [...DEFAULT_PERSONAL_LIFE_EXCLUDE_KEYWORDS, ...(excludeKeywords ?? [])]) {
    const k = term.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(term.trim());
  }
  return out;
}
