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
import { loadConfig } from "../config.js";
import { budgetSignalPackContextForLlm } from "./llm-creation-pack-budget.js";
import { PUBLICATION_SYSTEM_ADDENDUM } from "./publish-metadata-enrich.js";

/** Full research context for prompts (`{{creation_pack_json}}` / `{{signal_pack}}`). */
function signalPackContextForLlm(sp: SignalPackRow): Record<string, unknown> {
  return {
    run_id: sp.run_id,
    source_window: sp.source_window,
    notes: sp.notes,
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

/**
 * Build small, model-friendly hints for captions/hashtags/descriptions from the SignalPack payload.
 * We keep this intentionally compact and heuristic, since `signal_pack` JSON can be large and heterogeneous.
 */
function signalPackPublicationHints(signalPack: Record<string, unknown>): Record<string, unknown> {
  const derived = asRecord(signalPack.derived_globals_json) ?? {};

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
  const hashtagCandidates: string[] = [];
  const keywordCandidates: string[] = [];
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

  return {
    derived_globals: uniqStrings(scalarStrings, 12),
    rising_keywords: uniqStrings(keywordCandidates, 20),
    hashtag_seeds: uniqStrings(hashtagCandidates, 20),
  };
}

/**
 * TikTok/Reddit/etc. often have no `platform_constraints` row; carousel prompts still ask for slide_min_chars.
 * Reuse Instagram (or first row with slide limits) so LENGTH RULES are not vacuous.
 */
function resolvePlatformConstraintsForPack(
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

  const slideLensMissing = (r: PlatformConstraintsRow | undefined) =>
    !r ||
    (r.slide_min_chars == null &&
      r.slide_max_chars == null &&
      r.slide_min == null &&
      r.slide_max == null);

  if (!slideLensMissing(matched)) {
    return { ...matched };
  }

  const donor =
    platforms.find((p) => String(p.platform ?? "").toLowerCase() === "instagram") ??
    platforms.find((p) => p.slide_min_chars != null || p.slide_max_chars != null);

  if (!donor) {
    return matched ? { ...matched } : {};
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
  };

  return out;
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
] as const;

export function slimContextForCreationPackJson(context: Record<string, unknown>): Record<string, unknown> {
  const out = { ...context };
  for (const k of LEARNING_KEYS_OMITTED_FROM_CREATION_PACK_JSON) {
    delete out[k];
  }
  return out;
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
  const signal_pack = signalPack
    ? budgetSignalPackContextForLlm(
        structuredClone(signalPackContextForLlm(signalPack)) as Record<string, unknown>,
        {
          maxTotalJsonChars: cfg.LLM_SIGNAL_PACK_JSON_MAX_CHARS,
          maxCandidateRows: cfg.LLM_SIGNAL_PACK_MAX_CANDIDATE_ROWS,
          maxStringFieldChars: cfg.LLM_SIGNAL_PACK_MAX_STRING_FIELD_CHARS,
        }
      )
    : {};

  const signal_pack_publication_hints =
    signal_pack && typeof signal_pack === "object" && !Array.isArray(signal_pack)
      ? signalPackPublicationHints(signal_pack as Record<string, unknown>)
      : {};

  return {
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
}

export function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  let result = template;
  const packJson = JSON.stringify(slimContextForCreationPackJson(context));
  result = result.replace(/\{\{creation_pack_json\}\}/g, packJson);
  result = result.replace(/\{\{creation_pack\}\}/g, packJson);

  for (const [key, value] of Object.entries(context)) {
    const placeholder = `{{${key}}}`;
    if (result.includes(placeholder)) {
      result = result.replace(
        new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        typeof value === "string" ? value : JSON.stringify(value)
      );
    }
  }
  return result;
}
