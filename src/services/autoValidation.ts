/**
 * Lightweight auto-validation heuristics (replace with model-based rubric later).
 */
export function computeAutoValidationScores(input: {
  hook?: string;
  caption?: string;
  banned_substrings?: string[];
}): {
  format_ok: boolean;
  hook_score: number;
  clarity_score: number;
  banned_hits: string[];
  overall_score: number;
  pass_auto: boolean;
} {
  const hook = (input.hook ?? "").trim();
  const caption = (input.caption ?? "").trim();
  const banned = input.banned_substrings ?? [];
  const banned_hits = banned.filter((b) => {
    const low = `${hook} ${caption}`.toLowerCase();
    return low.includes(b.toLowerCase());
  });

  const hookLen = hook.length;
  const hook_score =
    hookLen === 0 ? 0 : hookLen < 20 ? 0.4 : hookLen > 200 ? 0.5 : Math.min(1, 0.5 + hookLen / 120);

  const words = caption.split(/\s+/).filter(Boolean).length;
  const clarity_score = words === 0 ? 0.3 : Math.min(1, 0.4 + Math.min(words, 80) / 100);

  const format_ok = hookLen > 0 && words > 0;
  let overall = (hook_score * 0.45 + clarity_score * 0.55) * (banned_hits.length > 0 ? 0.2 : 1);
  overall = Math.round(overall * 10000) / 10000;
  const pass_auto = format_ok && banned_hits.length === 0 && overall >= 0.72;

  return {
    format_ok,
    hook_score: Math.round(hook_score * 10000) / 10000,
    clarity_score: Math.round(clarity_score * 10000) / 10000,
    banned_hits,
    overall_score: overall,
    pass_auto,
  };
}
