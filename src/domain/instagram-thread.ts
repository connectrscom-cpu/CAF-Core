/**
 * `generation_payload.instagram_thread_v1` — multi-part Instagram thread (caption chain).
 */
export const INSTAGRAM_THREAD_V1_KEY = "instagram_thread_v1";

export interface InstagramThreadPartV1 {
  index: number;
  text: string;
}

export interface InstagramThreadV1 {
  parts: InstagramThreadPartV1[];
  hook_part?: string | null;
  cta_part?: string | null;
  hashtags?: string[];
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function hashtagsFromUnknown(v: unknown): string[] {
  if (Array.isArray(v)) {
    return [...new Set(v.map((x) => str(x).replace(/^#+/, "")).filter(Boolean))].slice(0, 8);
  }
  return [];
}

function partsFromGenerated(generated: Record<string, unknown>): InstagramThreadPartV1[] {
  const raw = generated.parts ?? generated.thread_parts ?? generated.slides;
  const out: InstagramThreadPartV1[] = [];
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const row = raw[i];
      const text =
        typeof row === "string"
          ? str(row)
          : row && typeof row === "object" && !Array.isArray(row)
            ? str((row as Record<string, unknown>).text) ||
              str((row as Record<string, unknown>).caption) ||
              str((row as Record<string, unknown>).body)
            : "";
      if (text) out.push({ index: i + 1, text });
    }
  }
  if (out.length === 0) {
    const single =
      str(generated.caption) ||
      str(generated.post_text) ||
      str(generated.body) ||
      [str(generated.hook), str(generated.body_text)].filter(Boolean).join("\n\n");
    if (single) out.push({ index: 1, text: single });
  }
  return out.slice(0, 10);
}

export function pickInstagramThreadV1(
  payload: Record<string, unknown> | null | undefined
): InstagramThreadV1 | null {
  const raw = payload?.[INSTAGRAM_THREAD_V1_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const partsIn = Array.isArray(row.parts) ? row.parts : [];
  const parts: InstagramThreadPartV1[] = [];
  for (let i = 0; i < partsIn.length; i++) {
    const p = partsIn[i];
    const text =
      typeof p === "string"
        ? str(p)
        : p && typeof p === "object" && !Array.isArray(p)
          ? str((p as Record<string, unknown>).text)
          : "";
    if (text) parts.push({ index: i + 1, text });
  }
  if (parts.length === 0) return null;
  return {
    parts,
    hook_part: str(row.hook_part) || parts[0]?.text || null,
    cta_part: str(row.cta_part) || parts[parts.length - 1]?.text || null,
    hashtags: hashtagsFromUnknown(row.hashtags),
  };
}

export function buildInstagramThreadV1FromGenerated(generated: Record<string, unknown>): InstagramThreadV1 {
  const parts = partsFromGenerated(generated);
  return {
    parts,
    hook_part: str(generated.hook_part) || str(generated.hook) || parts[0]?.text || null,
    cta_part: str(generated.cta_part) || str(generated.cta) || parts[parts.length - 1]?.text || null,
    hashtags: hashtagsFromUnknown(generated.hashtags),
  };
}

export function mergeInstagramThreadV1(
  payload: Record<string, unknown>,
  slice: InstagramThreadV1
): Record<string, unknown> {
  return { ...payload, [INSTAGRAM_THREAD_V1_KEY]: slice };
}

export const INSTAGRAM_THREAD_LLM_SYSTEM_APPENDIX = `You are writing an **Instagram thread** — a chain of 3–8 short caption parts posted as replies (thread style).

Return valid JSON with:
- "parts": array of objects, each with "text" (string, ≤500 chars per part). Part 1 is the hook; last part may include a soft CTA.
- "hashtags": array of 3–8 tags without # prefix (only on the final part conceptually; list them once here).

Rules:
- Each part must stand alone but flow as a narrative.
- No slide/image briefs. This is text-only thread copy.
- Conversational, mobile-friendly line breaks within each part.
- Do not write LinkedIn long-form or Reddit title/body shape.`;
