import type { Pool } from "pg";
import {
  getStrategyDefaults,
  getBrandConstraints,
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

export async function buildCreationPack(
  db: Pool,
  projectId: string,
  signalPackId: string | null,
  candidateData: Record<string, unknown>,
  platform: string | null,
  flowType?: string | null
): Promise<Record<string, unknown>> {
  const [strategy, brand, platforms, signalPack] = await Promise.all([
    getStrategyDefaults(db, projectId),
    getBrandConstraints(db, projectId),
    listPlatformConstraints(db, projectId),
    signalPackId ? getSignalPackById(db, signalPackId) : null,
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

  return {
    strategy: strategy ?? {},
    brand_constraints: brand ?? {},
    platform_constraints,
    /** Same text appended to system prompts in llm-generator; included here for templates using {{publication_output_contract}}. */
    publication_output_contract: PUBLICATION_SYSTEM_ADDENDUM,
    signal_pack,
    candidate: candidateData,
  };
}

export function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  let result = template;
  result = result.replace(/\{\{creation_pack_json\}\}/g, JSON.stringify(context));
  result = result.replace(/\{\{creation_pack\}\}/g, JSON.stringify(context));

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
