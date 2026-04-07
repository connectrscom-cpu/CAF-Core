/**
 * Extract a single JSON object from model text (bare JSON, markdown ```json fences, or prose with an embedded { ... }).
 * Does not use OpenAI response_format json_object — models may answer naturally.
 */

/** First top-level `{` … `}` balanced for strings and escapes. */
function extractFirstJsonObjectSlice(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function stripMarkdownFence(raw: string): string {
  let s = raw.trim();
  const m = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```/im.exec(s);
  if (m) s = m[1].trim();
  return s;
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Parse the first JSON object found in `raw`. Returns null if none.
 */
export function parseJsonObjectFromLlmText(raw: string): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  const unfenced = stripMarkdownFence(raw);

  let obj = tryParseObject(unfenced);
  if (obj) return obj;

  const slice = extractFirstJsonObjectSlice(unfenced);
  if (slice) {
    obj = tryParseObject(slice);
    if (obj) return obj;
  }

  return tryParseObject(raw.trim());
}
