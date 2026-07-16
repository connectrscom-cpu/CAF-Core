/**
 * Canonical naming + lane/step separation for top-performer knowledge stored on signal packs.
 *
 * **Storage (legacy, still written for compatibility):**
 * - `derived_globals_json.visual_guidelines_pack_v1` — mixed bag; includes flat `visual_guideline_cues`
 * - `derived_globals_json.hashtag_leaderboard_v1` — publication step
 * - `derived_globals_json.top_performer_styling_cues_v1` — cross-format creative-intel cues
 * - `derived_globals_json.creative_design_intelligence_v1` — cross-format; carousel hints nested inside
 *
 * **Storage (preferred for step routing):**
 * - `derived_globals_json.top_performer_knowledge_v1` — media lanes + publication + cross_format
 *
 * Note: `visual_guideline_cues_by_format` inside `visual_guidelines_pack_v1` groups by **content**
 * format (listicle, talking_head, …), NOT by media lane (carousel vs video). Use media lanes here.
 */

import { looksLikePersonalLifeMilestone } from "./content-subject-guards.js";

/** Top-performer vision analysis tiers on `inputs_evidence_row_insights`. */
export const TOP_PERFORMER_ANALYSIS_TIERS = [
  "top_performer_carousel",
  "top_performer_video",
  "top_performer_deep",
] as const;

export type TopPerformerAnalysisTier = (typeof TOP_PERFORMER_ANALYSIS_TIERS)[number];

/** Media lane = which top-performer pass produced the insight. */
export type TopPerformerMediaLane = "carousel" | "video" | "image";

/**
 * Pipeline steps that consume top-performer knowledge (mimic flows use `top_performer_mimic_knowledge` in creation pack).
 * Each step maps to exactly one slice via {@link pickTopPerformerKnowledgeForStep}.
 */
export type TopPerformerKnowledgeStep =
  | "carousel_copy"
  | "carousel_render"
  | "video_script"
  | "video_prompt"
  | "video_render"
  | "image_post"
  | "publication";

export const TOP_PERFORMER_ANALYSIS_TIER_TO_MEDIA_LANE: Record<
  TopPerformerAnalysisTier,
  TopPerformerMediaLane
> = {
  top_performer_carousel: "carousel",
  top_performer_video: "video",
  top_performer_deep: "image",
};

/** Which media lane (or non-lane bucket) each pipeline step reads. */
export const TOP_PERFORMER_STEP_TARGET: Record<
  TopPerformerKnowledgeStep,
  TopPerformerMediaLane | "publication" | "cross_format"
> = {
  carousel_copy: "carousel",
  carousel_render: "carousel",
  video_script: "video",
  video_prompt: "video",
  video_render: "video",
  image_post: "image",
  publication: "publication",
};

/** Keys under `signal_packs.derived_globals_json`. */
export const SIGNAL_PACK_DERIVED_GLOBALS_KEYS = {
  /** Legacy aggregate visual pack (mixed lanes + flat cues). */
  visualGuidelinesPackV1: "visual_guidelines_pack_v1",
  /** Preferred step-oriented index (see {@link TopPerformerKnowledgeV1}). */
  topPerformerKnowledgeV1: "top_performer_knowledge_v1",
  /** Publication step — weighted hashtags from rated evidence. */
  hashtagLeaderboardV1: "hashtag_leaderboard_v1",
  hashtagLeaderboardRowsScanned: "hashtag_leaderboard_rows_scanned",
  /** Cross-format styling strings (Creative Intelligence merge). */
  topPerformerStylingCuesV1: "top_performer_styling_cues_v1",
  creativeDesignIntelligenceV1: "creative_design_intelligence_v1",
} as const;

/** Content/narrative format within a media lane (listicle, talking_head, …). Not the same as media lane. */
export interface TopPerformerContentFormatGroup {
  content_format_pattern: string;
  content_format_key: string;
  cues: string[];
  example_insights_ids: string[];
}

export interface TopPerformerMediaLaneSlice {
  media_lane: TopPerformerMediaLane;
  source_analysis_tiers: TopPerformerAnalysisTier[];
  /** Short strings for prompts / planners. */
  visual_guideline_cues: string[];
  /** Grouped by content format (listicle, ugc, …) within this media lane. */
  content_format_groups: TopPerformerContentFormatGroup[];
  /** Condensed entries (same shape as `visual_guidelines_pack_v1.entries`). */
  entries: Record<string, unknown>[];
  entry_count: number;
}

export interface TopPerformerPublicationSlice {
  hashtag_leaderboard_v1: unknown[];
  hashtag_leaderboard_rows_scanned: number | null;
}

export interface TopPerformerCrossFormatSlice {
  top_performer_styling_cues_v1: string[];
  creative_design_intelligence_v1: Record<string, unknown> | null;
  /** Carousel-only hints extracted from creative_design_intelligence_v1 when present. */
  carousel_structure_hints: Record<string, unknown> | null;
}

export interface TopPerformerKnowledgeV1 {
  schema_version: 1;
  generated_at: string;
  media_lanes: Record<TopPerformerMediaLane, TopPerformerMediaLaneSlice>;
  publication: TopPerformerPublicationSlice;
  cross_format: TopPerformerCrossFormatSlice;
}

export type TopPerformerKnowledgeStepSlice =
  | TopPerformerMediaLaneSlice
  | TopPerformerPublicationSlice
  | TopPerformerCrossFormatSlice;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function stringList(v: unknown, max: number): string[] {
  const out: string[] = [];
  for (const x of asArray(v)) {
    const s = String(x ?? "").trim();
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function contentFormatKey(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "unknown";
  const first = s.split("|")[0]?.trim();
  return first || "unknown";
}

function analysisTierToLane(tier: unknown): TopPerformerMediaLane | null {
  const t = String(tier ?? "").trim() as TopPerformerAnalysisTier;
  return TOP_PERFORMER_ANALYSIS_TIER_TO_MEDIA_LANE[t] ?? null;
}

function emptyLaneSlice(lane: TopPerformerMediaLane): TopPerformerMediaLaneSlice {
  const tiers = (Object.entries(TOP_PERFORMER_ANALYSIS_TIER_TO_MEDIA_LANE) as [TopPerformerAnalysisTier, TopPerformerMediaLane][])
    .filter(([, l]) => l === lane)
    .map(([t]) => t);
  return {
    media_lane: lane,
    source_analysis_tiers: tiers,
    visual_guideline_cues: [],
    content_format_groups: [],
    entries: [],
    entry_count: 0,
  };
}

function entryLooksOffTopicForExamples(entry: Record<string, unknown>): boolean {
  const blob = [
    entry.hook_snippet,
    entry.title,
    entry.why_it_worked,
    entry.visual_consistency,
    entry.deck_as_whole_summary,
    entry.video_as_whole_summary,
    entry.caption,
    entry.hook_text,
  ]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .join("\n");
  return looksLikePersonalLifeMilestone(blob);
}

function buildContentFormatGroups(entries: Record<string, unknown>[]): TopPerformerContentFormatGroup[] {
  const byKey = new Map<string, TopPerformerContentFormatGroup>();
  for (const entry of entries) {
    const pattern = String(entry.format_pattern ?? "unknown").trim() || "unknown";
    const key = contentFormatKey(pattern);
    const insId = String(entry.insights_id ?? "").trim();
    const offTopic = entryLooksOffTopicForExamples(entry);
    let g = byKey.get(key);
    if (!g) {
      g = {
        content_format_pattern: pattern,
        content_format_key: key,
        cues: [],
        example_insights_ids: [],
      };
      byKey.set(key, g);
    }
    // Personal-life milestones can stay in the corpus as noise, but must not become
    // "examples from research" or drive format takeaways.
    if (!offTopic) {
      if (insId && g.example_insights_ids.length < 12 && !g.example_insights_ids.includes(insId)) {
        g.example_insights_ids.push(insId);
      }
      for (const field of ["why_it_worked", "visual_consistency", "deck_as_whole_summary", "video_as_whole_summary"]) {
        const s = String(entry[field] ?? "").trim();
        if (s.length >= 4 && !g.cues.includes(s)) g.cues.push(s.length > 220 ? `${s.slice(0, 220)}…` : s);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.cues.length - a.cues.length);
}

function flatCuesFromGroups(groups: TopPerformerContentFormatGroup[], cap = 32): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const c of g.cues) {
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

function splitVisualGuidelineEntriesByMediaLane(
  entries: Record<string, unknown>[]
): Record<TopPerformerMediaLane, Record<string, unknown>[]> {
  const lanes: Record<TopPerformerMediaLane, Record<string, unknown>[]> = {
    carousel: [],
    video: [],
    image: [],
  };
  for (const entry of entries) {
    const lane = analysisTierToLane(entry.analysis_tier);
    if (lane) lanes[lane].push(entry);
  }
  return lanes;
}

function buildMediaLaneSlice(
  lane: TopPerformerMediaLane,
  entries: Record<string, unknown>[]
): TopPerformerMediaLaneSlice {
  const content_format_groups = buildContentFormatGroups(entries);
  return {
    media_lane: lane,
    source_analysis_tiers: (Object.entries(TOP_PERFORMER_ANALYSIS_TIER_TO_MEDIA_LANE) as [
      TopPerformerAnalysisTier,
      TopPerformerMediaLane,
    ][])
      .filter(([, l]) => l === lane)
      .map(([t]) => t),
    visual_guideline_cues: flatCuesFromGroups(content_format_groups),
    content_format_groups,
    entries,
    entry_count: entries.length,
  };
}

/**
 * Build the step-oriented index from legacy blobs already stored on the pack.
 * Safe to call on partial derived_globals (missing keys → empty slices).
 */
export function buildTopPerformerKnowledgeV1(
  derivedGlobals: Record<string, unknown> | null | undefined
): TopPerformerKnowledgeV1 {
  const dg = derivedGlobals ?? {};
  const vgp = asRecord(dg[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]);
  const entries = asArray(vgp?.entries)
    .map((e) => asRecord(e))
    .filter((e): e is Record<string, unknown> => e != null);

  const byLane = splitVisualGuidelineEntriesByMediaLane(entries);
  const creative = asRecord(dg[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.creativeDesignIntelligenceV1]);
  const carouselHints = asRecord(creative?.carousel_structure_hints);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    media_lanes: {
      carousel: buildMediaLaneSlice("carousel", byLane.carousel),
      video: buildMediaLaneSlice("video", byLane.video),
      image: buildMediaLaneSlice("image", byLane.image),
    },
    publication: {
      hashtag_leaderboard_v1: asArray(dg[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.hashtagLeaderboardV1]),
      hashtag_leaderboard_rows_scanned:
        typeof dg[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.hashtagLeaderboardRowsScanned] === "number"
          ? (dg[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.hashtagLeaderboardRowsScanned] as number)
          : null,
    },
    cross_format: {
      top_performer_styling_cues_v1: stringList(
        dg[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.topPerformerStylingCuesV1],
        16
      ),
      creative_design_intelligence_v1: creative,
      carousel_structure_hints: carouselHints,
    },
  };
}

/** Merge `top_performer_knowledge_v1` into derived_globals (non-destructive). */
export function mergeTopPerformerKnowledgeIntoDerivedGlobals(
  derivedGlobals: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...derivedGlobals,
    [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.topPerformerKnowledgeV1]: buildTopPerformerKnowledgeV1(derivedGlobals),
  };
}

export function pickTopPerformerKnowledgeFromDerivedGlobals(
  derivedGlobals: Record<string, unknown> | null | undefined
): TopPerformerKnowledgeV1 | null {
  const dg = derivedGlobals ?? {};
  const raw = dg[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.topPerformerKnowledgeV1];
  const rec = asRecord(raw);
  if (rec && rec.schema_version === 1 && rec.media_lanes) {
    return raw as TopPerformerKnowledgeV1;
  }
  return buildTopPerformerKnowledgeV1(dg);
}

/**
 * Return the slice a pipeline step should consume. Rebuilds from legacy fields when v1 is absent.
 */
export function pickTopPerformerKnowledgeForStep(
  derivedGlobals: Record<string, unknown> | null | undefined,
  step: TopPerformerKnowledgeStep
): TopPerformerKnowledgeStepSlice {
  const knowledge = pickTopPerformerKnowledgeFromDerivedGlobals(derivedGlobals);
  if (!knowledge) {
    const target = TOP_PERFORMER_STEP_TARGET[step];
    if (target === "publication") {
      return { hashtag_leaderboard_v1: [], hashtag_leaderboard_rows_scanned: null };
    }
    if (target === "cross_format") {
      return {
        top_performer_styling_cues_v1: [],
        creative_design_intelligence_v1: null,
        carousel_structure_hints: null,
      };
    }
    return emptyLaneSlice(target);
  }

  const target = TOP_PERFORMER_STEP_TARGET[step];
  if (target === "publication") return knowledge.publication;
  if (target === "cross_format") return knowledge.cross_format;
  return knowledge.media_lanes[target];
}

/** Resolve a content job flow_type to the knowledge step (mimic + standard flows). */
export function topPerformerKnowledgeStepForFlowType(flowType: string): TopPerformerKnowledgeStep | null {
  const ft = (flowType ?? "").trim();
  if (/TOP_PERFORMER_MIMIC_CAROUSEL|CAROUSEL/i.test(ft) && !/VIDEO/i.test(ft)) return "carousel_copy";
  if (/TOP_PERFORMER_MIMIC_VIDEO|VIDEO_SCRIPT|Video_Script|video_script/i.test(ft)) return "video_script";
  if (/Video_Prompt|video_prompt|PROMPT|HeyGen/i.test(ft)) return "video_prompt";
  if (/TOP_PERFORMER_MIMIC_IMAGE|IMAGE/i.test(ft)) return "image_post";
  if (/CAROUSEL/i.test(ft)) return "carousel_copy";
  if (/VIDEO|SCENE/i.test(ft)) return "video_script";
  return null;
}
