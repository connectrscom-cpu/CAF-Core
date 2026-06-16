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

const VISUAL_GUIDELINE_BLOB_KEYS = [
  "inspection_media",
  "stored_inspection_media_json",
  /** Document AI slide geometry — render/mimic only; blows past 128k when embedded in copy prompts. */
  "aesthetic_analysis_json",
] as const;

const IDEA_ROW_VISUAL_BLOB_KEYS = [
  "inspection_media",
  "stored_inspection_media_json",
  "aesthetic_analysis_json",
] as const;

const PRODUCT_PROFILE_SLIM_KEYS = [
  "product_name",
  "product_category",
  "one_liner",
  "value_proposition",
  "primary_audience",
  "current_offer",
  "primary_cta",
  "secondary_cta",
  "do_say",
  "dont_say",
  "keywords",
  "taglines",
] as const;

const MIMIC_SIGNAL_PACK_DROP_KEYS = [
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

const MIMIC_IDEA_ROW_KEEP_KEYS = [
  "id",
  "idea_id",
  "title",
  "hook",
  "content_idea",
  "thesis",
  "three_liner",
  "platform",
  "format",
  "flow_type",
  "grounding_insight_ids",
  "source_insights_id",
  "candidate_id",
] as const;

/** Drop vision/OCR blobs from idea rows; keep editorial fields for carousel/video copy. */
export function slimSignalPackIdeaRowForLlm(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const k of IDEA_ROW_VISUAL_BLOB_KEYS) {
    delete out[k];
  }
  return out;
}

/** Idea rows from deep inspection can embed full aesthetic JSON — copy step uses `mimic_v1` on the job. */
export function slimSignalPackIdeaRowForMimicLlm(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of MIMIC_IDEA_ROW_KEEP_KEYS) {
    if (k in row) out[k] = row[k];
  }
  const id = String(row.id ?? row.idea_id ?? "").trim();
  if (id && out.id == null) out.id = id;
  return out;
}

export function slimDerivedGlobalsForMimicCopyLlm(
  derivedGlobals: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!derivedGlobals) return null;
  const slim = slimDerivedGlobalsForLlm(derivedGlobals, {
    maxVisualGuidelineEntries: 0,
    maxHashtagLeaderboardRows: 20,
  });
  const vgp = asRecord(slim?.visual_guidelines_pack_v1);
  if (vgp) {
    return {
      ...slim,
      visual_guidelines_pack_v1: {
        version: vgp.version ?? null,
        visual_guideline_cues: Array.isArray(vgp.visual_guideline_cues)
          ? (vgp.visual_guideline_cues as unknown[]).slice(0, 24)
          : [],
        entries: [],
      },
    };
  }
  return slim;
}

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

  if (Array.isArray(o.ideas_json) && opts?.candidateData) {
    const ideas = o.ideas_json as unknown[];
    const filtered =
      ideas.length > 1
        ? filterSignalPackIdeasForCandidate(ideas, opts.candidateData)
        : ideas;
    o = {
      ...o,
      ideas_json: filtered
        .map((row) =>
          mimicFlowOnly
            ? slimSignalPackIdeaRowForMimicLlm(asRecord(row) ?? {})
            : slimSignalPackIdeaRowForLlm(asRecord(row) ?? {})
        )
        .filter((row) => Object.keys(row).length > 0),
    };
  }

  if (mimicFlowOnly) {
    o = { ...o, overall_candidates_json: [] };
    for (const k of MIMIC_SIGNAL_PACK_DROP_KEYS) {
      if (k in o) o = { ...o, [k]: null };
    }
    const dg = asRecord(o.derived_globals_json);
    if (dg) {
      o = { ...o, derived_globals_json: slimDerivedGlobalsForMimicCopyLlm(dg) };
    }
  } else {
    const dg = asRecord(o.derived_globals_json);
    if (dg) {
      o = { ...o, derived_globals_json: slimDerivedGlobalsForLlm(dg) };
    }
  }

  const oc = o.overall_candidates_json;
  if (Array.isArray(oc) && !mimicFlowOnly) {
    o = { ...o, overall_candidates_json: oc.slice(0, limits.maxCandidateRows) };
  }

  o = trimDeepStrings(o, limits.maxStringFieldChars) as Record<string, unknown>;
  let json = JSON.stringify(o);

  while (json.length > limits.maxTotalJsonChars) {
    let progressed = false;

    if (Array.isArray(o.ideas_json) && (o.ideas_json as unknown[]).length > 1) {
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

  while (json.length > limits.maxTotalJsonChars) {
    const dg2 = asRecord(o.derived_globals_json);
    const vgp = dg2 ? asRecord(dg2.visual_guidelines_pack_v1) : null;
    const vgEntries = vgp && Array.isArray(vgp.entries) ? (vgp.entries as unknown[]) : null;
    if (vgEntries && vgEntries.length > 0) {
      const nextCount = mimicFlowOnly ? 0 : Math.max(0, vgEntries.length - 1);
      o = {
        ...o,
        derived_globals_json: slimDerivedGlobalsForLlm(
          { ...dg2, visual_guidelines_pack_v1: { ...vgp, entries: vgEntries.slice(0, nextCount) } },
          mimicFlowOnly ? { maxVisualGuidelineEntries: 0, maxHashtagLeaderboardRows: 20 } : { maxVisualGuidelineEntries: nextCount }
        ),
      };
      json = JSON.stringify(o);
      continue;
    }

    const tags = dg2 && Array.isArray(dg2.hashtag_leaderboard_v1) ? (dg2.hashtag_leaderboard_v1 as unknown[]) : null;
    if (tags && tags.length > (mimicFlowOnly ? 5 : 10)) {
      const floor = mimicFlowOnly ? 5 : 10;
      o = {
        ...o,
        derived_globals_json: mimicFlowOnly
          ? slimDerivedGlobalsForMimicCopyLlm({
              ...dg2,
              hashtag_leaderboard_v1: tags.slice(0, Math.max(floor, tags.length - 5)),
            })
          : slimDerivedGlobalsForLlm({
              ...dg2,
              hashtag_leaderboard_v1: tags.slice(0, Math.max(floor, tags.length - 5)),
            }),
      };
      json = JSON.stringify(o);
      continue;
    }

    if (mimicFlowOnly && Array.isArray(o.ideas_json) && (o.ideas_json as unknown[]).length > 0) {
      o = { ...o, ideas_json: [] };
      json = JSON.stringify(o);
      continue;
    }
    break;
  }

  if (json.length > limits.maxTotalJsonChars) {
    o = trimDeepStrings(o, Math.min(limits.maxStringFieldChars, mimicFlowOnly ? 1_200 : 2_400), 0) as Record<string, unknown>;
    json = JSON.stringify(o);
  }

  return o;
}

function slimProductProfileForLlm(profile: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!profile) return {};
  const out: Record<string, unknown> = {};
  for (const k of PRODUCT_PROFILE_SLIM_KEYS) {
    if (k in profile) out[k] = profile[k];
  }
  return out;
}

/** Standard LLM copy: cap whole creation_pack JSON (idea-list packs + product profile can exceed signal_pack cap alone). */
export function budgetCreationPackForCarouselFlow(
  pack: Record<string, unknown>,
  maxTotalJsonChars: number,
  opts?: { candidateData?: Record<string, unknown> | null; signalPackJsonMaxChars?: number }
): Record<string, unknown> {
  let o: Record<string, unknown> = { ...pack };
  let json = JSON.stringify(o);
  const signalCap = opts?.signalPackJsonMaxChars ?? Math.max(12_000, Math.floor(maxTotalJsonChars * 0.55));

  const shrinkSteps: Array<() => boolean> = [
    () => {
      const sp = asRecord(o.signal_pack);
      if (!sp) return false;
      o = {
        ...o,
        signal_pack: budgetSignalPackContextForLlm(
          sp,
          {
            maxTotalJsonChars: signalCap,
            maxCandidateRows: 1,
            maxStringFieldChars: 2_400,
          },
          { candidateData: opts?.candidateData ?? asRecord(o.candidate), mimicFlowOnly: false }
        ),
      };
      return true;
    },
    () => {
      const pp = asRecord(o.product_profile);
      if (!pp || Object.keys(pp).length <= PRODUCT_PROFILE_SLIM_KEYS.length) return false;
      o = { ...o, product_profile: slimProductProfileForLlm(pp) };
      return true;
    },
    () => {
      if (!("product_profile" in o)) return false;
      o = { ...o, product_profile: {} };
      return true;
    },
    () => {
      if (!("strategy" in o)) return false;
      o = { ...o, strategy: {} };
      return true;
    },
  ];

  let stepCursor = 0;
  while (json.length > maxTotalJsonChars && stepCursor < shrinkSteps.length * 3) {
    const before = json.length;
    const step = shrinkSteps[stepCursor % shrinkSteps.length];
    stepCursor += 1;
    if (!step()) continue;
    json = JSON.stringify(o);
    if (json.length < before) stepCursor = 0;
  }

  if (json.length > maxTotalJsonChars) {
    o = trimDeepStrings(o, 1_800, 0) as Record<string, unknown>;
  }

  return o;
}

/** Alias — same pack budget for carousel, product video, and other non-mimic LLM flows. */
export const budgetCreationPackForLlm = budgetCreationPackForCarouselFlow;

export function slimCandidateForMimicLlm(candidate: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of [
    "idea_id",
    "candidate_id",
    "title",
    "content_idea",
    "hook",
    "platform",
    "format",
    "flow_type",
    "variation",
  ] as const) {
    if (k in candidate) out[k] = candidate[k];
  }
  return out;
}

/** Whole creation pack (not just signal_pack) — mimic copy reads job `mimic_v1` for visual structure. */
export function budgetCreationPackForMimicFlow(
  pack: Record<string, unknown>,
  maxTotalJsonChars: number
): Record<string, unknown> {
  let o: Record<string, unknown> = { ...pack };
  let json = JSON.stringify(o);

  let signalPackRebudgeted = false;
  const shrinkSteps: Array<() => boolean> = [
    () => {
      if (signalPackRebudgeted) return false;
      const sp = asRecord(o.signal_pack);
      if (!sp) return false;
      signalPackRebudgeted = true;
      const next = Math.max(8_000, Math.floor(maxTotalJsonChars * 0.55));
      o = {
        ...o,
        signal_pack: budgetSignalPackContextForLlm(
          sp,
          {
            maxTotalJsonChars: next,
            maxCandidateRows: 1,
            maxStringFieldChars: 2_000,
          },
          { candidateData: asRecord(o.candidate), mimicFlowOnly: true }
        ),
      };
      return true;
    },
    () => {
      if (!("top_performer_mimic_knowledge" in o)) return false;
      o = { ...o, top_performer_mimic_knowledge: null };
      return true;
    },
    () => {
      const c = asRecord(o.candidate);
      if (!c) return false;
      o = { ...o, candidate: slimCandidateForMimicLlm(c) };
      return true;
    },
    () => {
      if (!("product_profile" in o)) return false;
      o = { ...o, product_profile: {} };
      return true;
    },
    () => {
      if (!("strategy" in o)) return false;
      o = { ...o, strategy: {} };
      return true;
    },
    () => {
      if (!("brand_constraints" in o)) return false;
      o = { ...o, brand_constraints: {} };
      return true;
    },
  ];

  let stepCursor = 0;
  while (json.length > maxTotalJsonChars && stepCursor < shrinkSteps.length) {
    const before = json.length;
    const step = shrinkSteps[stepCursor];
    stepCursor += 1;
    if (!step()) continue;
    json = JSON.stringify(o);
    if (json.length < before) stepCursor = 0;
  }

  if (json.length > maxTotalJsonChars) {
    o = {
      ...o,
      strategy: {},
      brand_constraints: {},
      product_profile: {},
      top_performer_mimic_knowledge: null,
    };
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
