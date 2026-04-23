/**
 * Video deep analysis uses **pre-extracted frames + transcript** (no raw full-video file in Core).
 * Ingestion / workers should populate `payload_json.analysis_frame_urls` (HTTPS URLs, e.g. Supabase)
 * and optionally `transcript` / `analysis_transcript`.
 */

function firstStr(payload: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = payload[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function parseUrlArray(raw: unknown, maxFrames: number): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x).trim())
      .filter((u) => /^https:\/\//i.test(u))
      .slice(0, maxFrames);
  }
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const a = JSON.parse(raw) as unknown;
      return parseUrlArray(a, maxFrames);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * HTTPS image URLs suitable for vision (sampled frames from a video or story).
 */
export function parseVideoAnalysisFrameUrls(
  payload: Record<string, unknown>,
  maxFrames = 12
): string[] {
  const keys = ["analysis_frame_urls", "evidence_frame_urls", "frame_urls", "thumbnail_urls"];
  for (const k of keys) {
    const arr = parseUrlArray(payload[k], maxFrames);
    if (arr.length > 0) return arr;
  }
  return [];
}

export function parseVideoAnalysisTranscript(payload: Record<string, unknown>, maxChars = 8000): string {
  const t = firstStr(payload, [
    "transcript",
    "analysis_transcript",
    "caption",
    "Caption",
    "body_text",
    "main_text",
  ]);
  if (!t) return "";
  return t.length > maxChars ? t.slice(0, maxChars) + "…" : t;
}
