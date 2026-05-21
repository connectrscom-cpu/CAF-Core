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

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

const VISUAL_GUIDELINE_BLOB_KEYS = ["inspection_media", "stored_inspection_media_json"] as const;

/** Drop signed URLs and binary inspection payloads — mimic/render resolve media separately. */
export function slimVisualGuidelineEntryForLlm(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if ((VISUAL_GUIDELINE_BLOB_KEYS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export function slimDerivedGlobalsForLlm(
  derivedGlobals: Record<string, unknown> | null | undefined,
  opts?: { maxVisualGuidelineEntries?: number; maxHashtagLeaderboardRows?: number }
): Record<string, unknown> | null {
  if (!derivedGlobals) return null;
  const maxEntries = opts?.maxVisualGuidelineEntries ?? 6;
  const maxTags = opts?.maxHashtagLeaderboardRows ?? 30;
  const out: Record<string, unknown> = { ...derivedGlobals };

  if (Array.isArray(out.hashtag_leaderboard_v1)) {
    out.hashtag_leaderboard_v1 = (out.hashtag_leaderboard_v1 as unknown[]).slice(0, maxTags);
  }

  const vgp = asRecord(out.visual_guidelines_pack_v1);
  if (vgp && Array.isArray(vgp.entries)) {
    out.visual_guidelines_pack_v1 = {
      ...vgp,
      entries: (vgp.entries as unknown[])
        .slice(0, maxEntries)
        .map((e) => slimVisualGuidelineEntryForLlm(asRecord(e) ?? {})),
    };
  }

  return out;
}

function resolveCandidateIdeaIds(candidateData: Record<string, unknown> | null | undefined): string[] {
  if (!candidateData) return [];
  const ids = new Set<string>();
  for (const key of ["idea_id", "candidate_id"] as const) {
    const raw = String(candidateData[key] ?? "").trim();
    if (!raw) continue;
    ids.add(raw);
    const base = raw.split("_FLOW_")[0]?.trim();
    if (base) ids.add(base);
  }
  return [...ids];
}

function ideaIdsMatch(wanted: string, rowId: string): boolean {
  if (wanted === rowId) return true;
  if (rowId.startsWith(`${wanted}_`)) return true;
  if (wanted.startsWith(`${rowId}_`)) return true;
  return false;
}

/** Idea-list signal packs can carry dozens of rows; generation only needs the planned idea. */
export function filterSignalPackIdeasForCandidate(
  ideasJson: unknown[],
  candidateData: Record<string, unknown> | null | undefined
): unknown[] {
  if (!ideasJson.length || !candidateData) return ideasJson;
  const wanted = resolveCandidateIdeaIds(candidateData);
  if (!wanted.length) return ideasJson.slice(0, 1);

  const matched = ideasJson.filter((row) => {
    const rec = asRecord(row);
    const id = String(rec?.id ?? "").trim();
    if (!id) return false;
    return wanted.some((w) => ideaIdsMatch(w, id));
  });
  return matched.length > 0 ? matched : ideasJson.slice(0, 1);
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

function shrinkArrayField(
  o: Record<string, unknown>,
  key: "ideas_json" | "overall_candidates_json",
  nextLen: number
): Record<string, unknown> {
  const rows = o[key];
  if (!Array.isArray(rows) || rows.length <= nextLen) return o;
  return { ...o, [key]: rows.slice(0, nextLen) };
}

export function budgetSignalPackContextForLlm(
  pack: Record<string, unknown>,
  limits: {
    maxTotalJsonChars: number;
    maxCandidateRows: number;
    maxStringFieldChars: number;
  },
  opts?: { candidateData?: Record<string, unknown> | null; mimicFlowOnly?: boolean }
): Record<string, unknown> {
  let o: Record<string, unknown> = normalizeOverallCandidatesJson({ ...pack });
  const mimicFlowOnly = opts?.mimicFlowOnly === true;

  if (mimicFlowOnly && Array.isArray(o.ideas_json)) {
    o = {
      ...o,
      ideas_json: filterSignalPackIdeasForCandidate(o.ideas_json as unknown[], opts?.candidateData ?? null),
    };
  }

  if (mimicFlowOnly) {
    const dg = asRecord(o.derived_globals_json);
    if (dg) {
      o = { ...o, derived_globals_json: slimDerivedGlobalsForLlm(dg) };
    }
  }

  const oc = o.overall_candidates_json;
  if (Array.isArray(oc)) {
    o = { ...o, overall_candidates_json: oc.slice(0, limits.maxCandidateRows) };
  }

  o = trimDeepStrings(o, limits.maxStringFieldChars) as Record<string, unknown>;
  let json = JSON.stringify(o);

  while (json.length > limits.maxTotalJsonChars) {
    let progressed = false;

    if (mimicFlowOnly && Array.isArray(o.ideas_json) && (o.ideas_json as unknown[]).length > 1) {
      const rows = o.ideas_json as unknown[];
      o = shrinkArrayField(o, "ideas_json", Math.max(1, rows.length - 1));
      progressed = true;
    } else if (Array.isArray(o.overall_candidates_json) && (o.overall_candidates_json as unknown[]).length > 1) {
      const rows = o.overall_candidates_json as unknown[];
      o = shrinkArrayField(o, "overall_candidates_json", Math.max(1, rows.length - 2));
      progressed = true;
    }

    if (progressed) {
      json = JSON.stringify(o);
      continue;
    }
    break;
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

  /** Mimic-only: strip visual guideline entries from derived_globals if still over budget. */
  if (mimicFlowOnly) {
    while (json.length > limits.maxTotalJsonChars) {
      const dg2 = asRecord(o.derived_globals_json);
      const vgp = dg2 ? asRecord(dg2.visual_guidelines_pack_v1) : null;
      const entries = vgp && Array.isArray(vgp.entries) ? (vgp.entries as unknown[]) : null;
      if (!entries?.length) break;
      o = {
        ...o,
        derived_globals_json: slimDerivedGlobalsForLlm(dg2, {
          maxVisualGuidelineEntries: Math.max(0, entries.length - 1),
          maxHashtagLeaderboardRows: 15,
        }),
      };
      json = JSON.stringify(o);
      if (entries.length <= 1) break;
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
