/** DB/jsonb sometimes surfaces `overall_candidates_json` as a string — row caps must still apply. */
function normalizeOverallCandidatesJson(pack: Record<string, unknown>): Record<string, unknown> {
  const o = { ...pack };
  const oc = o.overall_candidates_json;
  if (typeof oc === "string") {
    try {
      const parsed = JSON.parse(oc) as unknown;
      if (Array.isArray(parsed)) o.overall_candidates_json = parsed;
    } catch {
      /* keep string; trimDeepStrings will cap length */
    }
  }
  return o;
}

function trimDeepStrings(v: unknown, maxLen: number, depth = 0): unknown {
  if (depth > 12) return v;
  if (typeof v === "string") {
    return v.length <= maxLen ? v : `${v.slice(0, maxLen)}…`;
  }
  if (Array.isArray(v)) return v.map((x) => trimDeepStrings(x, maxLen, depth + 1));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      out[k] = trimDeepStrings(val, maxLen, depth + 1);
    }
    return out;
  }
  return v;
}

export function budgetSignalPackContextForLlm(
  pack: Record<string, unknown>,
  limits: {
    maxTotalJsonChars: number;
    maxCandidateRows: number;
    maxStringFieldChars: number;
  }
): Record<string, unknown> {
  let o: Record<string, unknown> = normalizeOverallCandidatesJson({ ...pack });
  const oc = o.overall_candidates_json;
  if (Array.isArray(oc)) {
    o = { ...o, overall_candidates_json: oc.slice(0, limits.maxCandidateRows) };
  }
  o = trimDeepStrings(o, limits.maxStringFieldChars) as Record<string, unknown>;
  let json = JSON.stringify(o);
  while (json.length > limits.maxTotalJsonChars && Array.isArray(o.overall_candidates_json)) {
    const rows = o.overall_candidates_json as unknown[];
    if (rows.length <= 1) break;
    o = { ...o, overall_candidates_json: rows.slice(0, Math.max(1, rows.length - 2)) };
    json = JSON.stringify(o);
  }
  /** Last resort: drop bulky research blobs (templates still have candidate + strategy + brand). */
  const dropHeavyKeys = [
    "html_findings_raw",
    "html_summary",
    "ig_archetypes",
    "ig_7day_plan",
    "ig_top_examples",
    "tiktok_archetypes",
    "tiktok_7day_plan",
    "tiktok_top_examples",
    "reddit_archetypes",
    "reddit_top_examples",
    "reddit_subreddit_insights",
    "ig_summary",
    "tiktok_summary",
    "reddit_summary",
    "fb_summary",
  ] as const;
  for (const k of dropHeavyKeys) {
    if (json.length <= limits.maxTotalJsonChars) break;
    if (k in o && o[k] != null) {
      o = { ...o, [k]: null };
      json = JSON.stringify(o);
    }
  }
  return o;
}

export function buildVideoScriptInputJsonString(
  candidateData: Record<string, unknown>,
  generatedOutput: Record<string, unknown>,
  opts?: { includeVideoScript?: boolean }
): string {
  const out: Record<string, unknown> = { candidate: candidateData };
  if (opts?.includeVideoScript) {
    const keys = ["spoken_script", "video_script", "script", "dialogue"];
    const picked: Record<string, unknown> = {};
    for (const k of keys) {
      if (k in generatedOutput) picked[k] = generatedOutput[k];
    }
    if (Object.keys(picked).length) out.existing_output = picked;
  }
  return JSON.stringify(out);
}
