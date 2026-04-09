/**
 * Publication / review metadata appended to LLM system prompts and optional output shaping.
 */

export const PUBLICATION_SYSTEM_ADDENDUM = `Publication contract: include platform-appropriate caption, CTA, and hashtags when the output schema asks for them. Obey platform_constraints.max_hashtags when present. Do not invent URLs or handles not implied by candidate/signal context.`;

export function maxHashtagsFromPlatformConstraints(platformConstraints: unknown): number | null {
  if (!platformConstraints || typeof platformConstraints !== "object") return null;
  const pc = platformConstraints as Record<string, unknown>;
  const n = Number(pc.max_hashtags);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function truncateHashtagsInText(s: string, maxTags: number): string {
  const re = /#[\w\u00c0-\u024f]+/gu;
  const matches = [...s.matchAll(re)];
  if (matches.length <= maxTags) return s;
  const drop = matches.length - maxTags;
  let i = 0;
  return s.replace(re, (tag) => {
    i += 1;
    return i <= drop ? "" : tag;
  }).replace(/\s{2,}/g, " ").trim();
}

export function enrichGeneratedOutputForReview(
  _flowType: string,
  output: Record<string, unknown>,
  opts?: { maxHashtags?: number | null }
): Record<string, unknown> {
  const max = opts?.maxHashtags;
  if (max == null || max < 0) return { ...output };
  const o = { ...output };
  for (const k of ["caption", "cta", "description", "post_caption"]) {
    const v = o[k];
    if (typeof v === "string") o[k] = truncateHashtagsInText(v, max);
  }
  const nested = o.content;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const c = { ...(nested as Record<string, unknown>) };
    for (const k of ["caption", "cta"]) {
      const v = c[k];
      if (typeof v === "string") c[k] = truncateHashtagsInText(v, max);
    }
    o.content = c;
  }
  return o;
}
