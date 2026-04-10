/**
 * Publication / review metadata appended to LLM system prompts and optional output shaping.
 */

export const PUBLICATION_SYSTEM_ADDENDUM = `Publication contract:
- If the output schema includes caption/description/hashtags fields, fill them.
- Ground your wording in the provided evidence: candidate + signal_pack + signal_pack_publication_hints (themes/keywords/hashtag seeds). Prefer specific, research-backed keywords over generic tags.
- Obey platform_constraints.max_hashtags when present.
- Do not invent URLs or handles not implied by candidate/signal context.
- If a schema has both "caption" and "description"/"post_caption", treat caption as the on-platform post text and description as supporting context (no duplication).
- For carousels or any schema with a **cta** / final-slide call to action: use strong imperatives (Follow, Save, Share, Comment, Tag) and repeat or pair with the **@handle** when the handle is present in context (never fabricate handles).`;

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

function truncateHashtagsList(tags: string[], maxTags: number): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    out.push(t);
    if (out.length >= maxTags) break;
  }
  return out;
}

export function enrichGeneratedOutputForReview(
  _flowType: string,
  output: Record<string, unknown>,
  opts?: { maxHashtags?: number | null }
): Record<string, unknown> {
  const max = opts?.maxHashtags;
  if (max == null || max < 0) return { ...output };
  const o = { ...output };

  // Standalone hashtags field (common in video flows / some schemas)
  if (Array.isArray(o.hashtags)) {
    const flat = o.hashtags
      .filter((t): t is string => typeof t === "string" && t.trim() !== "")
      .map((t) => t.trim());
    if (flat.length > max) o.hashtags = truncateHashtagsList(flat, max);
  } else if (typeof o.hashtags === "string") {
    o.hashtags = truncateHashtagsInText(o.hashtags, max);
  }

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
    const tags = c.hashtags;
    if (Array.isArray(tags)) {
      const flat = tags
        .filter((t): t is string => typeof t === "string" && t.trim() !== "")
        .map((t) => t.trim());
      if (flat.length > max) c.hashtags = truncateHashtagsList(flat, max);
    } else if (typeof tags === "string") {
      c.hashtags = truncateHashtagsInText(tags, max);
    }
    o.content = c;
  }
  return o;
}
