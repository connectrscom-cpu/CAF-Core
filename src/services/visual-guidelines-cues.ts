/**
 * Dedupe and cap visual guideline cue lines per format (avoid 50 near-duplicate carousel tips).
 */

const DEFAULT_MAX_CUES_PER_FORMAT = 10;

function cueFingerprint(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of cueFingerprint(s).split(" ")) {
    if (w.length > 3) out.add(w);
  }
  return out;
}

function wordOverlapRatio(a: string, b: string): number {
  const sa = wordSet(a);
  const sb = wordSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let hit = 0;
  for (const w of sa) {
    if (sb.has(w)) hit++;
  }
  return hit / sa.size;
}

function isSamePerformanceThemeLine(a: string, b: string): boolean {
  const fa = cueFingerprint(a);
  const fb = cueFingerprint(b);
  const performanceLead =
    /\b(humor|relat|engag|resonat|audience|popular|share|interact)\b/.test(fa) &&
    /\b(humor|relat|engag|resonat|audience|popular|share|interact)\b/.test(fb);
  if (!performanceLead) return false;
  const deckLead = /\b(the deck|the carousel|this (instagram )?carousel)\b/.test(fa);
  const deckLeadB = /\b(the deck|the carousel|this (instagram )?carousel)\b/.test(fb);
  if (deckLead && deckLeadB) return true;
  if (wordOverlapRatio(a, b) >= 0.45 && fa.length > 40 && fb.length > 40) return true;
  if (fa.includes("humor") && fb.includes("humor")) {
    const engagement = ["audience", "engag", "resonat", "relat", "popular", "share"];
    const ha = engagement.filter((w) => fa.includes(w)).length;
    const hb = engagement.filter((w) => fb.includes(w)).length;
    if (ha >= 2 && hb >= 2) return true;
  }
  return false;
}

/** True if `candidate` repeats an idea already kept in `existing`. */
export function isRedundantCue(candidate: string, existing: string[]): boolean {
  const fc = cueFingerprint(candidate);
  if (fc.length < 10) return false;
  for (const e of existing) {
    const fe = cueFingerprint(e);
    if (fc === fe) return true;
    const shorter = fc.length <= fe.length ? fc : fe;
    const longer = fc.length > fe.length ? fc : fe;
    if (shorter.length >= 36 && longer.includes(shorter)) return true;
    if (wordOverlapRatio(candidate, e) >= 0.72) return true;
    if (isSamePerformanceThemeLine(candidate, e)) return true;
  }
  return false;
}

/** Prefer short actionable steps over long generic carousel summaries. */
function cuePriorityScore(s: string): number {
  const t = s.trim();
  if (/^(create|use|choose|select|ensure|add|design|include|maintain|arrange|craft|pick)\b/i.test(t)) {
    return 4;
  }
  if (t.length <= 90) return 3;
  if (/^(the deck|the carousel|this instagram|this carousel)\b/i.test(t)) return 0;
  if (t.length > 160) return 1;
  return 2;
}

/**
 * Drop near-duplicates and keep at most `max` cues, biased toward actionable lines.
 */
export function compactCueList(cues: string[], max = DEFAULT_MAX_CUES_PER_FORMAT): string[] {
  const unique: string[] = [];
  for (const raw of cues) {
    const t = raw.trim();
    if (t.length < 4) continue;
    const line = t.length > 220 ? `${t.slice(0, 220)}…` : t;
    if (isRedundantCue(line, unique)) continue;
    unique.push(line);
  }
  unique.sort((a, b) => cuePriorityScore(b) - cuePriorityScore(a));
  const out: string[] = [];
  for (const c of unique) {
    if (isRedundantCue(c, out)) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

export const FORMAT_PATTERN_HINTS: Record<string, string> = {
  listicle: "Swipeable slide deck — one list item or sign per slide (classic IG carousel).",
  educational: "Teach or explain; clear takeaway per slide.",
  text_on_screen: "Message is mostly on-screen text; optional voiceover.",
  talking_head: "Creator on camera; face + speech drive the hook.",
  mixed: "Combines talking head, B-roll, and text overlays.",
  video: "Short-form video (Reels/TikTok style).",
  post: "Single image or short caption-led post.",
  unknown: "Format not classified by the vision model.",
};

export function formatPatternHint(formatKey: string): string | null {
  const k = formatKey.trim().toLowerCase();
  return FORMAT_PATTERN_HINTS[k] ?? null;
}
