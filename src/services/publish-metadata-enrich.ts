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

export function maxSlidesFromPlatformConstraints(platformConstraints: unknown): number | null {
  if (!platformConstraints || typeof platformConstraints !== "object") return null;
  const pc = platformConstraints as Record<string, unknown>;
  const n = Number(pc.slide_max);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
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

function truncateCarouselSlides<T>(slides: T[], maxSlides: number): T[] {
  if (!Array.isArray(slides)) return [];
  if (!Number.isFinite(maxSlides) || maxSlides < 1) return slides;
  if (slides.length <= maxSlides) return slides;
  if (maxSlides === 1) return [slides[0]!];
  if (maxSlides === 2) return [slides[0]!, slides[slides.length - 1]!];
  const keepFirst = slides[0]!;
  const keepLast = slides[slides.length - 1]!;
  const middleKeep = slides.slice(1, 1 + (maxSlides - 2));
  return [keepFirst, ...middleKeep, keepLast];
}

function clampStructureVariableSlideCount(o: Record<string, unknown>, n: number): void {
  if (!Number.isFinite(n) || n < 0) return;
  const sv =
    o.structure_variables && typeof o.structure_variables === "object" && !Array.isArray(o.structure_variables)
      ? { ...(o.structure_variables as Record<string, unknown>) }
      : null;
  if (!sv) return;
  sv.slide_count = Math.floor(n);
  o.structure_variables = sv;
}

export function enrichGeneratedOutputForReview(
  _flowType: string,
  output: Record<string, unknown>,
  opts?: { maxHashtags?: number | null; maxSlides?: number | null }
): Record<string, unknown> {
  const o = { ...output };
  const maxTags = opts?.maxHashtags;
  const maxSlides = opts?.maxSlides;

  // Standalone hashtags field (common in video flows / some schemas)
  if (maxTags != null && maxTags >= 0) {
    if (Array.isArray(o.hashtags)) {
      const flat = o.hashtags
        .filter((t): t is string => typeof t === "string" && t.trim() !== "")
        .map((t) => t.trim());
      if (flat.length > maxTags) o.hashtags = truncateHashtagsList(flat, maxTags);
    } else if (typeof o.hashtags === "string") {
      o.hashtags = truncateHashtagsInText(o.hashtags, maxTags);
    }

    for (const k of ["caption", "cta", "description", "post_caption"]) {
      const v = o[k];
      if (typeof v === "string") o[k] = truncateHashtagsInText(v, maxTags);
    }
  }

  if (maxSlides != null && maxSlides >= 1) {
    if (Array.isArray(o.slides)) {
      o.slides = truncateCarouselSlides(o.slides, maxSlides);
      clampStructureVariableSlideCount(o, (o.slides as unknown[]).length);
    }
    if (Array.isArray(o.variations) && o.variations.length > 0) {
      const v0 = o.variations[0];
      if (v0 && typeof v0 === "object" && !Array.isArray(v0)) {
        const vRec = { ...(v0 as Record<string, unknown>) };
        if (Array.isArray(vRec.slides)) {
          vRec.slides = truncateCarouselSlides(vRec.slides, maxSlides);
          const vars = [...(o.variations as unknown[])];
          vars[0] = vRec;
          o.variations = vars;
          clampStructureVariableSlideCount(o, (vRec.slides as unknown[]).length);
        }
      }
    }
  }

  const nested = o.content;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const c = { ...(nested as Record<string, unknown>) };
    let changed = false;

    if (maxTags != null && maxTags >= 0) {
      for (const k of ["caption", "cta"]) {
        const v = c[k];
        if (typeof v === "string") {
          c[k] = truncateHashtagsInText(v, maxTags);
          changed = true;
        }
      }
      const tags = c.hashtags;
      if (Array.isArray(tags)) {
        const flat = tags
          .filter((t): t is string => typeof t === "string" && t.trim() !== "")
          .map((t) => t.trim());
        if (flat.length > maxTags) {
          c.hashtags = truncateHashtagsList(flat, maxTags);
          changed = true;
        }
      } else if (typeof tags === "string") {
        c.hashtags = truncateHashtagsInText(tags, maxTags);
        changed = true;
      }
    }

    if (maxSlides != null && maxSlides >= 1) {
      if (Array.isArray(c.slides)) {
        c.slides = truncateCarouselSlides(c.slides, maxSlides);
        changed = true;
      }
      if (Array.isArray(c.carousel)) {
        c.carousel = truncateCarouselSlides(c.carousel, maxSlides);
        changed = true;
      }
    }

    if (changed) o.content = c;
  }

  return o;
}
