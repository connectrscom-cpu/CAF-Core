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
  let o: Record<string, unknown> = { ...pack };
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
