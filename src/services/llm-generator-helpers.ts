import type { Pool } from "pg";
import {
  getStrategyDefaults,
  getBrandConstraints,
  getProductProfile,
  listPlatformConstraints,
  type PlatformConstraintsRow,
} from "../repositories/project-config.js";
import { getSignalPackById, type SignalPackRow } from "../repositories/signal-packs.js";
import { isCarouselFlow } from "../decision_engine/flow-kind.js";
import { isProductVideoFlow } from "../domain/product-flow-types.js";
import {
  isTopPerformerMimicCarouselFlow,
  isTopPerformerMimicRenderableFlow,
} from "../domain/top-performer-mimic-flow-types.js";
import {
  pickTopPerformerKnowledgeForStep,
  topPerformerKnowledgeStepForFlowType,
  type TopPerformerKnowledgeStepSlice,
  type TopPerformerMediaLaneSlice,
} from "../domain/signal-pack-top-performer-knowledge.js";
import { filterSignalPackHashtagCandidates } from "../domain/signal-hashtag-sanitize.js";
import { loadConfig } from "../config.js";
import {
  budgetCreationPackForMimicFlow,
  budgetSignalPackContextForLlm,
  slimCandidateForMimicLlm,
  slimVisualGuidelineEntryForLlm,
} from "./llm-creation-pack-budget.js";
import { buildMimicCopyJobBriefForLlm } from "../domain/mimic-render-context.js";
import { PUBLICATION_SYSTEM_ADDENDUM } from "./publish-metadata-enrich.js";

/** Full research context for prompts (`{{creation_pack_json}}` / `{{signal_pack}}`). */
function signalPackContextForLlm(sp: SignalPackRow): Record<string, unknown> {
  return {
    run_id: sp.run_id,
    source_window: sp.source_window,
    notes: sp.notes,
    ideas_json: Array.isArray(sp.ideas_json) ? sp.ideas_json : [],
    overall_candidates_json: sp.overall_candidates_json,
    derived_globals_json: sp.derived_globals_json,
    ig_summary: sp.ig_summary_json,
    tiktok_summary: sp.tiktok_summary_json,
    reddit_summary: sp.reddit_summary_json,
    fb_summary: sp.fb_summary_json,
    html_summary: sp.html_summary_json,
    ig_archetypes: sp.ig_archetypes_json,
    ig_7day_plan: sp.ig_7day_plan_json,
    ig_top_examples: sp.ig_top_examples_json,
    tiktok_archetypes: sp.tiktok_archetypes_json,
    tiktok_7day_plan: sp.tiktok_7day_plan_json,
    tiktok_top_examples: sp.tiktok_top_examples_json,
    reddit_archetypes: sp.reddit_archetypes_json,
    reddit_top_examples: sp.reddit_top_examples_json,
    html_findings_raw: sp.html_findings_raw_json,
    reddit_subreddit_insights: sp.reddit_subreddit_insights_json,
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function uniqStrings(xs: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of xs) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function slimTopPerformerKnowledgeForLlm(slice: TopPerformerKnowledgeStepSlice): TopPerformerKnowledgeStepSlice {
  if ("media_lane" in slice) {
    const lane = slice as TopPerformerMediaLaneSlice;
    const entries = lane.entries.slice(0, 4).map((e) => slimVisualGuidelineEntryForLlm(e));
    return {
      ...lane,
      entries,
      entry_count: entries.length,
    };
  }
  if ("hashtag_leaderboard_v1" in slice && Array.isArray(slice.hashtag_leaderboard_v1)) {
    return {
      ...slice,
      hashtag_leaderboard_v1: slice.hashtag_leaderboard_v1.slice(0, 30),
    };
  }
  return slice;
}

/**
 * Build small, model-friendly hints for captions/hashtags/descriptions from the SignalPack payload.
 * We keep this intentionally compact and heuristic, since `signal_pack` JSON can be large and heterogeneous.
 */
function signalPackPublicationHints(signalPack: Record<string, unknown>): Record<string, unknown> {
  const derived = asRecord(signalPack.derived_globals_json) ?? {};
  const leaderboardRaw = asArray(derived.hashtag_leaderboard_v1) ?? [];

  const scalarStrings: string[] = [];
  for (const k of [
    "platform_alignment_summary",
    "cross_platform_themes",
    "global_rising_keywords",
    "global_winning_formats",
    "global_engagement_triggers",
  ] as const) {
    const v = derived[k];
    if (typeof v === "string" && v.trim()) scalarStrings.push(v.trim());
  }

  const candidates = asArray(signalPack.overall_candidates_json) ?? [];
  const ideaRows = asArray(signalPack.ideas_json) ?? [];
  const hashtagCandidates: string[] = [];
  const keywordCandidates: string[] = [];

  // Highest-signal: ranked tags computed from evidence weighting, if present.
  for (let i = 0; i < Math.min(60, leaderboardRaw.length); i++) {
    const row = asRecord(leaderboardRaw[i]);
    const ht = row ? String(row.hashtag ?? "").trim() : "";
    if (ht) hashtagCandidates.push(ht);
  }

  for (let i = 0; i < Math.min(24, ideaRows.length); i++) {
    const row = asRecord(ideaRows[i]);
    if (!row) continue;
    const ci = row.content_idea;
    if (typeof ci === "string") {
      const tags = ci.match(/#[\w\u00c0-\u024f]+/gu) ?? [];
      for (const t of tags) hashtagCandidates.push(t);
    }
  }
  for (let i = 0; i < Math.min(40, candidates.length); i++) {
    const row = asRecord(candidates[i]);
    if (!row) continue;

    const tagFields = [
      row.hashtags,
      row.hashtag,
      row.tags,
      row.keywords,
      row.rising_keywords,
      row.primary_keyword,
      row.secondary_keywords,
    ];
    for (const blob of tagFields) {
      if (typeof blob === "string") {
        const s = blob.trim();
        if (!s) continue;
        const tags = s.match(/#[\w\u00c0-\u024f]+/gu) ?? [];
        for (const t of tags) hashtagCandidates.push(t);
        // Also capture non-# keywords (comma/pipe separated)
        for (const part of s.split(/[|,;]/g)) {
          const p = part.trim();
          if (p && !p.startsWith("#") && p.length <= 40) keywordCandidates.push(p);
        }
      } else if (Array.isArray(blob)) {
        for (const x of blob) {
          const s = String(x ?? "").trim();
          if (!s) continue;
          if (s.startsWith("#")) hashtagCandidates.push(s);
          else keywordCandidates.push(s);
        }
      }
    }
  }

  const filteredHashtags = filterSignalPackHashtagCandidates(hashtagCandidates, { max: 48 });

  const stylingCues = asArray(derived.top_performer_styling_cues_v1) ?? [];
  const cueStrings = stylingCues
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, 16);

  const vgp = asRecord(derived.visual_guidelines_pack_v1);
  const vgpCueRaw = asArray(vgp?.visual_guideline_cues) ?? [];
  const visualGuidelineCues = vgpCueRaw
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, 24);
  const visualGuidelinesPackSlim =
    vgp != null
      ? {
          version: vgp.version ?? null,
          generated_at: typeof vgp.generated_at === "string" ? vgp.generated_at : null,
          insights_scanned: vgp.insights_scanned ?? null,
          visual_guideline_cues: visualGuidelineCues,
          entries_sample: Array.isArray(vgp.entries) ? (vgp.entries as unknown[]).slice(0, 8) : [],
        }
      : null;

  return {
    derived_globals: uniqStrings(scalarStrings, 12),
    rising_keywords: uniqStrings(keywordCandidates, 20),
    /** Sanitized bare tokens (no #); junk like https/jpeg/preview removed. */
    hashtag_seeds: filteredHashtags.slice(0, 20),
    /** Full filtered list for product-video allowlists (same sanitizer as hashtag_seeds). */
    signal_pack_filtered_hashtags: filteredHashtags,
    /** Short strings from `derived_globals_json.top_performer_styling_cues_v1` (creative intelligence). */
    top_performer_styling_cues: cueStrings,
    /** Short aesthetic / replication cues from `derived_globals_json.visual_guidelines_pack_v1` (top-performer vision tiers). */
    visual_guideline_cues: visualGuidelineCues,
    /** Compact pack for templates that want structured entries without loading full signal_pack JSON. */
    visual_guidelines_pack: visualGuidelinesPackSlim,
  };
}

/**
 * TikTok/Reddit/etc. often have no `platform_constraints` row; carousel prompts still ask for slide_min_chars.
 * Reuse Instagram (or first row with slide limits) so LENGTH RULES are not vacuous.
 */
export function resolvePlatformConstraintsForPack(
  platforms: PlatformConstraintsRow[],
  jobPlatform: string | null,
  flowType: string | null | undefined
): Record<string, unknown> {
  const matched = platforms.find(
    (p) => p.platform?.toLowerCase() === (jobPlatform ?? "").toLowerCase()
  );

  if (!isCarouselFlow(flowType ?? "")) {
    return matched ? { ...matched } : {};
  }

  const carouselTypoDonor =
    platforms.find((p) => String(p.platform ?? "").toLowerCase() === "instagram") ??
    platforms.find(
      (p) =>
        p.carousel_headline_font_px != null ||
        p.carousel_body_font_px != null ||
        p.carousel_kicker_font_px != null ||
        p.carousel_cta_font_px != null ||
        p.carousel_handle_font_px != null ||
        (p.carousel_font_scale != null && String(p.carousel_font_scale).trim() !== "")
    );

  const augmentCarouselTypography = (
    base: Record<string, unknown>,
    m: PlatformConstraintsRow | undefined
  ): Record<string, unknown> => {
    if (!m || !carouselTypoDonor || carouselTypoDonor === m) return base;
    return {
      ...base,
      carousel_headline_font_px: m.carousel_headline_font_px ?? carouselTypoDonor.carousel_headline_font_px,
      carousel_body_font_px: m.carousel_body_font_px ?? carouselTypoDonor.carousel_body_font_px,
      carousel_kicker_font_px: m.carousel_kicker_font_px ?? carouselTypoDonor.carousel_kicker_font_px,
      carousel_cta_font_px: m.carousel_cta_font_px ?? carouselTypoDonor.carousel_cta_font_px,
      carousel_handle_font_px: m.carousel_handle_font_px ?? carouselTypoDonor.carousel_handle_font_px,
      carousel_font_scale: m.carousel_font_scale ?? carouselTypoDonor.carousel_font_scale,
    };
  };

  const slideLensMissing = (r: PlatformConstraintsRow | undefined) =>
    !r ||
    (r.slide_min_chars == null &&
      r.slide_max_chars == null &&
      r.slide_min == null &&
      r.slide_max == null);

  if (!slideLensMissing(matched)) {
    return augmentCarouselTypography({ ...matched }, matched);
  }

  const donor =
    platforms.find((p) => String(p.platform ?? "").toLowerCase() === "instagram") ??
    platforms.find((p) => p.slide_min_chars != null || p.slide_max_chars != null);

  if (!donor) {
    return matched ? augmentCarouselTypography({ ...matched }, matched) : {};
  }

  const out: Record<string, unknown> = {
    ...donor,
    ...(matched ? { ...matched } : {}),
    platform: jobPlatform ?? matched?.platform ?? donor.platform,
    slide_min_chars: matched?.slide_min_chars ?? donor.slide_min_chars,
    slide_max_chars: matched?.slide_max_chars ?? donor.slide_max_chars,
    slide_min: matched?.slide_min ?? donor.slide_min,
    slide_max: matched?.slide_max ?? donor.slide_max,
    caption_max_chars: matched?.caption_max_chars ?? donor.caption_max_chars,
    hook_max_chars: matched?.hook_max_chars ?? donor.hook_max_chars,
    hook_must_fit_first_lines: matched?.hook_must_fit_first_lines ?? donor.hook_must_fit_first_lines,
    max_hashtags: matched?.max_hashtags ?? donor.max_hashtags,
    hashtag_format_rule: matched?.hashtag_format_rule ?? donor.hashtag_format_rule,
    line_break_policy: matched?.line_break_policy ?? donor.line_break_policy,
    formatting_rules: matched?.formatting_rules ?? donor.formatting_rules,
    emoji_allowed: matched?.emoji_allowed ?? donor.emoji_allowed,
    link_allowed: matched?.link_allowed ?? donor.link_allowed,
    tag_allowed: matched?.tag_allowed ?? donor.tag_allowed,
    carousel_headline_font_px:
      matched?.carousel_headline_font_px ?? donor.carousel_headline_font_px ?? carouselTypoDonor?.carousel_headline_font_px,
    carousel_body_font_px:
      matched?.carousel_body_font_px ?? donor.carousel_body_font_px ?? carouselTypoDonor?.carousel_body_font_px,
    carousel_kicker_font_px:
      matched?.carousel_kicker_font_px ?? donor.carousel_kicker_font_px ?? carouselTypoDonor?.carousel_kicker_font_px,
    carousel_cta_font_px:
      matched?.carousel_cta_font_px ?? donor.carousel_cta_font_px ?? carouselTypoDonor?.carousel_cta_font_px,
    carousel_handle_font_px:
      matched?.carousel_handle_font_px ?? donor.carousel_handle_font_px ?? carouselTypoDonor?.carousel_handle_font_px,
    carousel_font_scale:
      matched?.carousel_font_scale ?? donor.carousel_font_scale ?? carouselTypoDonor?.carousel_font_scale,
  };

  return augmentCarouselTypography(out, matched);
}

/**
 * Learning fields are also injected as separate `{{...}}` placeholders and appended to the system prompt.
 * Excluding them from `{{creation_pack_json}}` avoids sending the same text twice (or thrice), which can
 * exceed 128k-token model limits when the signal pack is large.
 */
export const LEARNING_KEYS_OMITTED_FROM_CREATION_PACK_JSON = [
  "global_learning_context",
  "project_learning_context",
  "learning_guidance",
  "creative_style_guidance",
] as const;

/**
 * Mimic carousel user templates also expand `{{top_performer_mimic_knowledge}}` and job payload
 * carries `mimic_v1` — omit from `{{creation_pack_json}}` to avoid sending the same text twice.
 */
export const MIMIC_CAROUSEL_KEYS_OMITTED_FROM_CREATION_PACK_JSON = [
  "top_performer_mimic_knowledge",
  "publication_output_contract",
  "mimic_visual_guideline_for_copy",
  "mimic_render_context",
  /** Appended separately in slim form via `appendMimicGroundedReferenceToUserPrompt` — full row has OCR geometry. */
  "mimic_job_grounding",
] as const;

function isMimicCarouselCopyContext(context: Record<string, unknown>): boolean {
  return (
    "mimic_visual_guideline_for_copy" in context ||
    "mimic_render_context" in context ||
    "mimic_job_grounding" in context
  );
}

export function slimContextForCreationPackJson(context: Record<string, unknown>): Record<string, unknown> {
  const out = { ...context };
  for (const k of LEARNING_KEYS_OMITTED_FROM_CREATION_PACK_JSON) {
    delete out[k];
  }
  if (isMimicCarouselCopyContext(context)) {
    for (const k of MIMIC_CAROUSEL_KEYS_OMITTED_FROM_CREATION_PACK_JSON) {
      delete out[k];
    }
  }
  return out;
}

/**
 * Mimic carousel copy generation: only brand/platform/candidate/hints needed to write slides.
 * Full signal pack, product profile, and per-slide OCR geometry live on the job for render.
 */
export function slimContextForMimicCopyGeneration(context: Record<string, unknown>): Record<string, unknown> {
  const renderCtx = context.mimic_render_context;
  const twistBrief = context.mimic_twist_brief;
  const slimmed = slimContextForCreationPackJson(context);
  const brand = asRecord(slimmed.brand_constraints) ?? {};
  const strategy = asRecord(slimmed.strategy) ?? {};
  const slimBrand: Record<string, unknown> = {};
  for (const k of ["banned_words", "tone", "voice", "voice_tone", "cta_style", "handle"] as const) {
    if (k in brand) slimBrand[k] = brand[k];
  }
  const slimStrategy: Record<string, unknown> = {};
  for (const k of ["thesis", "content_pillars", "positioning", "hook_style", "instagram_handle"] as const) {
    if (k in strategy) slimStrategy[k] = strategy[k];
  }
  const out: Record<string, unknown> = {
    brand_constraints: slimBrand,
    platform_constraints: slimmed.platform_constraints ?? {},
    strategy: slimStrategy,
    candidate: slimCandidateForMimicLlm(asRecord(slimmed.candidate) ?? {}),
    signal_pack_publication_hints: slimmed.signal_pack_publication_hints ?? {},
  };
  const rawTpm = asRecord(slimmed.top_performer_mimic_knowledge);
  if (rawTpm) {
    out.top_performer_mimic_knowledge = {
      visual_guideline_cues: Array.isArray(rawTpm.visual_guideline_cues)
        ? (rawTpm.visual_guideline_cues as unknown[]).slice(0, 10)
        : [],
      content_format_groups: Array.isArray(rawTpm.content_format_groups)
        ? (rawTpm.content_format_groups as unknown[]).slice(0, 3)
        : [],
    };
  }
  const brief = buildMimicCopyJobBriefForLlm(asRecord(renderCtx));
  if (brief) out.mimic_copy_job_brief = brief;
  if (twistBrief && typeof twistBrief === "object") out.mimic_twist_brief = twistBrief;
  return out;
}

function creationPackJsonForTemplate(context: Record<string, unknown>): string {
  const slim = isMimicCarouselCopyContext(context)
    ? slimContextForMimicCopyGeneration(context)
    : slimContextForCreationPackJson(context);
  return JSON.stringify(slim);
}

export async function buildCreationPack(
  db: Pool,
  projectId: string,
  signalPackId: string | null,
  candidateData: Record<string, unknown>,
  platform: string | null,
  flowType?: string | null
): Promise<Record<string, unknown>> {
  const [strategy, brand, platforms, signalPack, product] = await Promise.all([
    getStrategyDefaults(db, projectId),
    getBrandConstraints(db, projectId),
    listPlatformConstraints(db, projectId),
    signalPackId ? getSignalPackById(db, signalPackId) : null,
    getProductProfile(db, projectId),
  ]);

  const platform_constraints = resolvePlatformConstraintsForPack(platforms, platform, flowType);

  const cfg = loadConfig();
  const mimicFlowOnly = !!(flowType && isTopPerformerMimicRenderableFlow(flowType));
  const signalPackJsonMaxChars = mimicFlowOnly
    ? Math.min(cfg.LLM_SIGNAL_PACK_JSON_MAX_CHARS, cfg.LLM_MIMIC_SIGNAL_PACK_JSON_MAX_CHARS)
    : cfg.LLM_SIGNAL_PACK_JSON_MAX_CHARS;
  const signal_pack = signalPack
    ? budgetSignalPackContextForLlm(
        structuredClone(signalPackContextForLlm(signalPack)) as Record<string, unknown>,
        {
          maxTotalJsonChars: signalPackJsonMaxChars,
          maxCandidateRows: mimicFlowOnly ? 1 : cfg.LLM_SIGNAL_PACK_MAX_CANDIDATE_ROWS,
          maxStringFieldChars: mimicFlowOnly
            ? Math.min(cfg.LLM_SIGNAL_PACK_MAX_STRING_FIELD_CHARS, 2_000)
            : cfg.LLM_SIGNAL_PACK_MAX_STRING_FIELD_CHARS,
        },
        { candidateData, mimicFlowOnly }
      )
    : {};

  const signal_pack_publication_hints =
    signal_pack && typeof signal_pack === "object" && !Array.isArray(signal_pack)
      ? signalPackPublicationHints(signal_pack as Record<string, unknown>)
      : {};

  const hintsRec =
    signal_pack_publication_hints && typeof signal_pack_publication_hints === "object" && !Array.isArray(signal_pack_publication_hints)
      ? (signal_pack_publication_hints as Record<string, unknown>)
      : null;
  const filteredForProduct = hintsRec && Array.isArray(hintsRec.signal_pack_filtered_hashtags)
    ? (hintsRec.signal_pack_filtered_hashtags as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];

  const pack: Record<string, unknown> = {
    strategy: strategy ?? {},
    brand_constraints: brand ?? {},
    product_profile: product ?? {},
    platform_constraints,
    /** Same text appended to system prompts in llm-generator; included here for templates using {{publication_output_contract}}. */
    publication_output_contract: PUBLICATION_SYSTEM_ADDENDUM,
    signal_pack,
    /** Compact hints derived from SignalPack for captions/descriptions/hashtags across all flows. */
    signal_pack_publication_hints,
    candidate: candidateData,
  };

  if (isProductVideoFlow(flowType)) {
    pack.product_video_hashtag_allowlist = filteredForProduct;
  }

  if (flowType && isTopPerformerMimicRenderableFlow(flowType)) {
    const derivedGlobals =
      signalPack?.derived_globals_json &&
      typeof signalPack.derived_globals_json === "object" &&
      !Array.isArray(signalPack.derived_globals_json)
        ? (signalPack.derived_globals_json as Record<string, unknown>)
        : null;
    const step = topPerformerKnowledgeStepForFlowType(flowType);
    if (step) {
      const slice = pickTopPerformerKnowledgeForStep(derivedGlobals, step);
      if (isTopPerformerMimicCarouselFlow(flowType) && "media_lane" in slice) {
        const lane = slice as TopPerformerMediaLaneSlice;
        pack.top_performer_mimic_knowledge = {
          media_lane: lane.media_lane,
          visual_guideline_cues: lane.visual_guideline_cues.slice(0, 24),
          content_format_groups: lane.content_format_groups.slice(0, 6),
          entry_count: 0,
          entries: [],
        };
      } else {
        pack.top_performer_mimic_knowledge = slimTopPerformerKnowledgeForLlm(slice);
      }
    }
  }

  if (mimicFlowOnly) {
    return budgetCreationPackForMimicFlow(pack, cfg.LLM_MIMIC_CREATION_PACK_JSON_MAX_CHARS);
  }

  return pack;
}

export { appendMimicGroundedReferenceToUserPrompt } from "../domain/mimic-job-grounding.js";

export function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  let result = template;
  const mimicCopy = isMimicCarouselCopyContext(context);
  const packJson = creationPackJsonForTemplate(context);
  result = result.replace(/\{\{creation_pack_json\}\}/g, packJson);
  result = result.replace(/\{\{creation_pack\}\}/g, packJson);

  for (const [key, value] of Object.entries(context)) {
    const placeholder = `{{${key}}}`;
    if (!result.includes(placeholder)) continue;
    if (mimicCopy && key === "top_performer_mimic_knowledge") {
      const tpm = asRecord(slimContextForMimicCopyGeneration(context).top_performer_mimic_knowledge);
      result = result.replace(
        new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        tpm ? JSON.stringify(tpm) : "{}"
      );
      continue;
    }
    if (mimicCopy && (MIMIC_CAROUSEL_KEYS_OMITTED_FROM_CREATION_PACK_JSON as readonly string[]).includes(key)) {
      continue;
    }
    result = result.replace(
      new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      typeof value === "string" ? value : JSON.stringify(value)
    );
  }
  return result;
}
