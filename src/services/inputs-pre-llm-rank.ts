/**
 * Deterministic pre-LLM ranking for inputs evidence rows.
 * Config lives under `criteria_json.pre_llm` on `inputs_processing_profiles`.
 */
import type { Pool } from "pg";
import {
  augmentPreLlmFeaturesWithRelative,
  buildRegistryFollowerLookup,
  enrichPayloadFollowerBaseline,
} from "../domain/evidence-relative-performance.js";
import {
  appliesSubjectRelevance,
  blendPerformanceAndSubject,
  computeSubjectRelevanceScore,
  hasSubjectRelevanceLists,
  parseSubjectRelevanceConfig,
  type SubjectRelevanceConfig,
} from "../domain/pre-llm-subject-relevance.js";
import {
  linkedInAuthorContextFromPayload,
  pickLinkedInTargetingFromCriteria,
  scoreLinkedInFit,
  type LinkedInTargetingProfile,
} from "../domain/linkedin-targeting-profile.js";
import { listEvidenceRowsForPreLlmScoring } from "../repositories/inputs-evidence.js";
import type { SelectionSnapshot } from "./inputs-selection.js";
import { DEFAULT_SELECTION_CAPS } from "./inputs-selection.js";

/** Stored in `selection_snapshot_json.rule_version` when pre-LLM ranking ran. */
export const PRE_LLM_RULE_VERSION = "pre_llm_v1";

export interface PreLlmKindProfile {
  /** Rows below this pre_llm score are excluded before OpenAI rating. */
  min_score: number;
  /** Feature name → weight. Weights need not sum to 1; we normalize by active weight sum. */
  weights: Record<string, number>;
}

export interface PreLlmConfig {
  enabled?: boolean;
  /**
   * When true, IG/FB/TT/LI rows with follower counts score on engagement relative to page size.
   * Rows without follower data fall back to raw volume features for that row only.
   */
  relative_page_performance?: boolean;
  /** For post-like rows: require at least this many chars in title/body/caption/main_text. */
  min_primary_text_chars?: number;
  /** Optional subject-relevance blend (keywords, weights, apply_to_kinds). */
  subject_relevance?: SubjectRelevanceConfig | null;
  /** Optional LinkedIn person/company/geo targeting for soft entity-fit blend. */
  linkedin_targeting?: LinkedInTargetingProfile | null;
  kinds?: Record<string, PreLlmKindProfile>;
  /** Used when `evidence_kind` has no dedicated profile. */
  default_kind?: PreLlmKindProfile;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function numFromPayload(payload: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = payload[k];
    if (v == null || v === "") continue;
    const n = parseFloat(String(v).replace(/,/g, ""));
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return 0;
}

function textLen(payload: Record<string, unknown>): number {
  const parts = [
    payload.title,
    payload.Title,
    payload.body_text,
    payload.content,
    payload.caption,
    payload.Caption,
    payload.main_text,
    payload.caption_1,
    payload.caption_2,
  ]
    .map((x) => (x != null ? String(x) : ""))
    .join(" ")
    .trim();
  return parts.length;
}

function normLog1p(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return clamp(Math.log1p(value) / Math.log1p(max), 0, 1);
}

function normLinear(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return clamp(value / max, 0, 1);
}

function extractRawPreLlmFeatures(evidenceKind: string, payload: Record<string, unknown>): Record<string, number> {
  const tl = textLen(payload);
  const text_signal = normLinear(tl, 2000);

  switch (evidenceKind) {
    case "reddit_post": {
      const score = numFromPayload(payload, ["score", "Score"]);
      const comments = numFromPayload(payload, ["comment_count", "commentCount"]);
      const ratio = numFromPayload(payload, ["upvote_ratio", "upvoteRatio"]);
      return {
        reddit_score: normLog1p(score, 8000),
        reddit_comments: normLog1p(comments, 2000),
        reddit_upvote_ratio: clamp(ratio > 1 ? ratio / 100 : ratio, 0, 1),
        text_signal,
      };
    }
    case "tiktok_video": {
      const plays = numFromPayload(payload, ["plays", "Plays"]);
      const likes = numFromPayload(payload, ["likes", "Likes"]);
      const comments = numFromPayload(payload, ["comments", "Comments"]);
      const followers = numFromPayload(payload, ["authorFollowers", "author_followers"]);
      return {
        tt_plays: normLog1p(plays, 50_000_000),
        tt_likes: normLog1p(likes, 5_000_000),
        tt_comments: normLog1p(comments, 500_000),
        tt_author_followers: normLog1p(followers, 50_000_000),
        text_signal,
      };
    }
    case "instagram_post": {
      const likes = numFromPayload(payload, ["like_count", "likes"]);
      const comments = numFromPayload(payload, ["comment_count", "comments"]);
      return {
        ig_likes: normLog1p(likes, 10_000_000),
        ig_comments: normLog1p(comments, 2_000_000),
        text_signal,
      };
    }
    case "facebook_post": {
      const likes = numFromPayload(payload, ["likes", "Likes"]);
      const comments = numFromPayload(payload, ["comments", "Comments"]);
      const shares = numFromPayload(payload, ["shares", "Shares"]);
      return {
        fb_likes: normLog1p(likes, 5_000_000),
        fb_comments: normLog1p(comments, 2_000_000),
        fb_shares: normLog1p(shares, 1_000_000),
        text_signal,
      };
    }
    case "linkedin_post": {
      const likes = numFromPayload(payload, ["likes", "like_count", "Likes"]);
      const comments = numFromPayload(payload, ["comments", "comment_count", "Comments"]);
      const shares = numFromPayload(payload, ["shares", "share_count", "Shares"]);
      const followers = numFromPayload(payload, ["author_followers", "authorFollowers", "followers_count"]);
      return {
        li_likes: normLog1p(likes, 500_000),
        li_comments: normLog1p(comments, 50_000),
        li_shares: normLog1p(shares, 25_000),
        li_author_followers: normLog1p(followers, 1_000_000),
        text_signal,
      };
    }
    case "scraped_page": {
      const mainLen = String(payload.main_text ?? "").trim().length;
      const titleLen = String(payload.title ?? payload.Title ?? "").trim().length;
      return {
        scraped_main: normLinear(mainLen, 12_000),
        scraped_title: normLinear(titleLen, 200),
        text_signal: normLinear(Math.max(mainLen, titleLen), 2000),
      };
    }
    case "source_registry": {
      const link =
        String(payload.Link ?? payload.link ?? payload.URL ?? payload.url ?? payload["Facebook URL"] ?? "").trim();
      const topic = String(payload.Topic ?? payload.topic ?? "").trim();
      const followersRaw = String(payload.Followers ?? payload.followers ?? "").trim();
      let followerSignal = 0;
      const m = followersRaw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*k\b/i);
      if (m) followerSignal = normLog1p(parseFloat(m[1]) * 1000, 10_000_000);
      else {
        const digits = followersRaw.replace(/[^\d]/g, "");
        if (digits.length >= 2) followerSignal = normLog1p(parseInt(digits.slice(0, 12), 10) || 0, 10_000_000);
      }
      return {
        registry_has_link: link.length > 8 ? 1 : 0,
        registry_topic: normLinear(topic.length, 400),
        registry_followers: followerSignal,
      };
    }
    default:
      return { text_signal };
  }
}

export type PreLlmFeatureOptions = {
  registryFollowerLookup?: ReadonlyMap<string, number>;
};

/** Build handle → followers map from `source_registry` rows in the same import. */
export function buildRegistryFollowerLookupFromEvidenceRows(
  rows: Array<{ evidence_kind: string; payload_json?: Record<string, unknown> }>
): Map<string, number> {
  return buildRegistryFollowerLookup(
    rows
      .filter((r) => r.evidence_kind === "source_registry")
      .map((r) => (r.payload_json ?? {}) as Record<string, unknown>)
  );
}

/** Normalized features in 0–1 used only for pre-LLM scoring (includes relative signals when follower data exists). */
export function extractPreLlmFeatures(
  evidenceKind: string,
  payload: Record<string, unknown>,
  options?: PreLlmFeatureOptions
): Record<string, number> {
  const enriched = enrichPayloadFollowerBaseline(evidenceKind, payload, options?.registryFollowerLookup);
  const base = extractRawPreLlmFeatures(evidenceKind, enriched);
  return augmentPreLlmFeaturesWithRelative(evidenceKind, enriched, base);
}

function defaultRawKindProfile(kind: string): PreLlmKindProfile {
  switch (kind) {
    case "reddit_post":
      return {
        min_score: 0.08,
        weights: { reddit_score: 0.35, reddit_comments: 0.25, reddit_upvote_ratio: 0.2, text_signal: 0.2 },
      };
    case "tiktok_video":
      return {
        min_score: 0.1,
        weights: {
          tt_plays: 0.35,
          tt_likes: 0.2,
          tt_comments: 0.15,
          tt_author_followers: 0.15,
          text_signal: 0.15,
        },
      };
    case "instagram_post":
      return {
        min_score: 0.08,
        weights: { ig_likes: 0.45, ig_comments: 0.25, text_signal: 0.3 },
      };
    case "facebook_post":
      return {
        min_score: 0.06,
        weights: { fb_likes: 0.35, fb_comments: 0.25, fb_shares: 0.2, text_signal: 0.2 },
      };
    case "linkedin_post":
      return {
        min_score: 0.06,
        // Person-first: engagement matters, but less than Meta; author reach is a soft signal.
        weights: {
          li_likes: 0.22,
          li_comments: 0.18,
          li_shares: 0.1,
          li_author_followers: 0.2,
          text_signal: 0.3,
        },
      };
    case "scraped_page":
      return {
        min_score: 0.05,
        weights: { scraped_main: 0.55, scraped_title: 0.15, text_signal: 0.3 },
      };
    case "source_registry":
      return {
        min_score: 0.02,
        weights: { registry_has_link: 0.35, registry_topic: 0.35, registry_followers: 0.3 },
      };
    default:
      return { min_score: 0, weights: { text_signal: 1 } };
  }
}

function defaultRelativeKindProfile(kind: string): PreLlmKindProfile {
  switch (kind) {
    case "instagram_post":
      return {
        min_score: 0.08,
        weights: { page_relative_engagement: 0.55, page_relative_comments: 0.2, text_signal: 0.25 },
      };
    case "tiktok_video":
      return {
        min_score: 0.1,
        weights: { page_relative_engagement: 0.35, page_relative_reach: 0.35, text_signal: 0.3 },
      };
    case "facebook_post":
      return {
        min_score: 0.06,
        weights: { page_relative_engagement: 0.45, page_relative_shares: 0.2, text_signal: 0.35 },
      };
    case "linkedin_post":
      return {
        min_score: 0.06,
        weights: { page_relative_engagement: 0.45, page_relative_comments: 0.2, text_signal: 0.35 },
      };
    default:
      return defaultRawKindProfile(kind);
  }
}

function defaultKindProfile(kind: string, relativePagePerformance: boolean): PreLlmKindProfile {
  return relativePagePerformance ? defaultRelativeKindProfile(kind) : defaultRawKindProfile(kind);
}

function rowHasFollowerBaseline(features: Record<string, number>): boolean {
  return (features.has_follower_baseline ?? 0) >= 0.5;
}

export function mergePreLlmConfig(criteria: Record<string, unknown>): PreLlmConfig {
  const raw = criteria.pre_llm;
  const targeting = pickLinkedInTargetingFromCriteria(criteria);
  const base: PreLlmConfig = {
    enabled: false,
    min_primary_text_chars: 12,
    default_kind: { min_score: 0, weights: { text_signal: 1 } },
    kinds: {},
    linkedin_targeting: targeting,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const p = raw as Record<string, unknown>;
  const relativePagePerformance = Boolean(p.relative_page_performance);
  const kindsIn = p.kinds && typeof p.kinds === "object" && !Array.isArray(p.kinds) ? (p.kinds as Record<string, unknown>) : {};
  const mergedKinds: Record<string, PreLlmKindProfile> = {};
  for (const [k, v] of Object.entries(kindsIn)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const def = defaultKindProfile(k, relativePagePerformance);
    const w = o.weights && typeof o.weights === "object" && !Array.isArray(o.weights) ? (o.weights as Record<string, unknown>) : {};
    const weights: Record<string, number> = { ...def.weights };
    for (const [wk, wv] of Object.entries(w)) {
      const n = parseFloat(String(wv));
      if (!Number.isNaN(n) && n >= 0) weights[wk] = n;
    }
    const min_score =
      typeof o.min_score === "number" && Number.isFinite(o.min_score)
        ? clamp(o.min_score, 0, 1)
        : def.min_score;
    mergedKinds[k] = { min_score, weights };
  }
  const knownKinds = [
    "reddit_post",
    "tiktok_video",
    "instagram_post",
    "facebook_post",
    "linkedin_post",
    "scraped_page",
    "source_registry",
  ];
  for (const k of knownKinds) {
    if (!mergedKinds[k]) mergedKinds[k] = defaultKindProfile(k, relativePagePerformance);
  }
  let defaultKind = base.default_kind!;
  if (p.default_kind && typeof p.default_kind === "object" && !Array.isArray(p.default_kind)) {
    const d = p.default_kind as Record<string, unknown>;
    const w = d.weights && typeof d.weights === "object" ? (d.weights as Record<string, unknown>) : {};
    const weights: Record<string, number> = {};
    for (const [wk, wv] of Object.entries(w)) {
      const n = parseFloat(String(wv));
      if (!Number.isNaN(n) && n >= 0) weights[wk] = n;
    }
    defaultKind = {
      min_score:
        typeof d.min_score === "number" && Number.isFinite(d.min_score) ? clamp(d.min_score, 0, 1) : defaultKind.min_score,
      weights: Object.keys(weights).length ? weights : defaultKind.weights,
    };
  }
  return {
    enabled: Boolean(p.enabled),
    relative_page_performance: relativePagePerformance,
    min_primary_text_chars:
      typeof p.min_primary_text_chars === "number" && p.min_primary_text_chars >= 0
        ? Math.floor(p.min_primary_text_chars)
        : base.min_primary_text_chars,
    subject_relevance: parseSubjectRelevanceConfig(p.subject_relevance),
    linkedin_targeting: pickLinkedInTargetingFromCriteria(criteria),
    kinds: mergedKinds,
    default_kind: defaultKind,
  };
}

function profileForKind(cfg: PreLlmConfig, kind: string, useRelativeWeights?: boolean): PreLlmKindProfile {
  const custom = cfg.kinds?.[kind] ?? cfg.default_kind;
  if (custom) return custom;
  const relative = useRelativeWeights ?? Boolean(cfg.relative_page_performance);
  return defaultKindProfile(kind, relative);
}

/** Pick weights for one row — relative mode uses raw fallback when follower count is missing. */
export function resolvePreLlmProfileForRow(
  cfg: PreLlmConfig,
  kind: string,
  features: Record<string, number>
): PreLlmKindProfile {
  if (!cfg.relative_page_performance) return profileForKind(cfg, kind, false);
  if (rowHasFollowerBaseline(features)) return profileForKind(cfg, kind, true);
  const custom = cfg.kinds?.[kind];
  const raw = defaultRawKindProfile(kind);
  if (custom?.weights && Object.keys(custom.weights).length > 0) {
    const hasRelativeKeys = Object.keys(custom.weights).some((k) => k.startsWith("page_relative_"));
    if (!hasRelativeKeys) {
      return { min_score: custom.min_score, weights: { ...custom.weights } };
    }
  }
  return { min_score: custom?.min_score ?? raw.min_score, weights: { ...raw.weights } };
}

function weightedFeatureScore(features: Record<string, number>, weights: Record<string, number>): number {
  let sum = 0;
  let wsum = 0;
  for (const [k, wt] of Object.entries(weights)) {
    if (wt <= 0) continue;
    const f = features[k] ?? 0;
    sum += clamp(f, 0, 1) * wt;
    wsum += wt;
  }
  if (wsum <= 0) return 0;
  return clamp(sum / wsum, 0, 1);
}

const POST_KINDS_TEXT_GATE = new Set([
  "reddit_post",
  "tiktok_video",
  "instagram_post",
  "facebook_post",
  "linkedin_post",
]);

export type PreLlmDroppedReason = "sparse_primary_text" | "off_topic_subject" | "below_min_pre_llm_score";

function scorePreLlmRow(
  evidenceKind: string,
  payload: Record<string, unknown>,
  cfg: PreLlmConfig,
  options?: PreLlmFeatureOptions
): {
  pre_llm_score: number;
  pre_llm_breakdown: Record<string, number>;
  profile_min_score: number;
  passes_text_gate: boolean;
  dropped_reason: PreLlmDroppedReason | null;
  performance_score: number;
  subject_score: number | null;
} {
  const minText = cfg.min_primary_text_chars ?? 12;
  const features = extractPreLlmFeatures(evidenceKind, payload, options);
  const prof = resolvePreLlmProfileForRow(cfg, evidenceKind, features);
  if (POST_KINDS_TEXT_GATE.has(evidenceKind) && textLen(payload) < minText) {
    return {
      pre_llm_score: 0,
      pre_llm_breakdown: features,
      profile_min_score: prof.min_score,
      passes_text_gate: false,
      dropped_reason: "sparse_primary_text",
      performance_score: 0,
      subject_score: null,
    };
  }

  const performanceScore = weightedFeatureScore(features, prof.weights);
  const subjectCfg = cfg.subject_relevance;
  let subjectScore: number | null = null;
  let finalScore = performanceScore;
  let entityPriority: number | null = null;

  if (subjectCfg && appliesSubjectRelevance(evidenceKind, subjectCfg)) {
    const subject = computeSubjectRelevanceScore(payload, subjectCfg);
    subjectScore = subject.score;
    if (subject.matched_excludes.length > 0) {
      return {
        pre_llm_score: 0,
        pre_llm_breakdown: { ...features, performance_score: performanceScore, subject_relevance: 0 },
        profile_min_score: prof.min_score,
        passes_text_gate: true,
        dropped_reason: "off_topic_subject",
        performance_score: performanceScore,
        subject_score: 0,
      };
    }
    if (hasSubjectRelevanceLists(subjectCfg) && subjectScore < (subjectCfg.min_score ?? 0)) {
      return {
        pre_llm_score: Math.round(subjectScore * 10000) / 10000,
        pre_llm_breakdown: { ...features, performance_score: performanceScore, subject_relevance: subjectScore },
        profile_min_score: prof.min_score,
        passes_text_gate: true,
        dropped_reason: "off_topic_subject",
        performance_score: performanceScore,
        subject_score: subjectScore,
      };
    }
    finalScore = blendPerformanceAndSubject(performanceScore, subjectScore, subjectCfg);
  }

  // LinkedIn: soft-blend person/company/geo/topic fit (never hard-drops on miss).
  if (evidenceKind === "linkedin_post" && cfg.linkedin_targeting) {
    const author = linkedInAuthorContextFromPayload(payload);
    const postText = String(payload.content ?? payload.caption ?? payload.text ?? "");
    const fit = scoreLinkedInFit(cfg.linkedin_targeting, author, postText);
    entityPriority = fit.priority;
    finalScore = clamp(finalScore * 0.45 + fit.priority * 0.55, 0, 1);
  }

  const rounded = Math.round(finalScore * 10000) / 10000;
  const breakdown: Record<string, number> = { ...features };
  if (subjectScore != null) {
    breakdown.performance_score = Math.round(performanceScore * 10000) / 10000;
    breakdown.subject_relevance = Math.round(subjectScore * 10000) / 10000;
  }
  if (entityPriority != null) {
    breakdown.linkedin_entity_priority = Math.round(entityPriority * 10000) / 10000;
  }

  if (finalScore < prof.min_score) {
    return {
      pre_llm_score: rounded,
      pre_llm_breakdown: breakdown,
      profile_min_score: prof.min_score,
      passes_text_gate: true,
      dropped_reason: "below_min_pre_llm_score",
      performance_score: performanceScore,
      subject_score: subjectScore,
    };
  }

  return {
    pre_llm_score: rounded,
    pre_llm_breakdown: breakdown,
    profile_min_score: prof.min_score,
    passes_text_gate: true,
    dropped_reason: null,
    performance_score: performanceScore,
    subject_score: subjectScore,
  };
}

/**
 * Evaluate one row the same way as `rankImportRowsForLlm` (for Admin preview + APIs).
 */
export function evaluatePreLlmRow(
  evidenceKind: string,
  payload: Record<string, unknown>,
  criteria: Record<string, unknown>,
  options?: PreLlmFeatureOptions
): {
  pre_llm_score: number;
  pre_llm_breakdown: Record<string, number>;
  profile_min_score: number;
  passes_text_gate: boolean;
  dropped_reason: PreLlmDroppedReason | null;
  performance_score?: number;
  subject_score?: number | null;
} {
  const cfg = mergePreLlmConfig(criteria);
  const scored = scorePreLlmRow(evidenceKind, payload, cfg, options);
  return {
    pre_llm_score: scored.pre_llm_score,
    pre_llm_breakdown: scored.pre_llm_breakdown,
    profile_min_score: scored.profile_min_score,
    passes_text_gate: scored.passes_text_gate,
    dropped_reason: scored.dropped_reason,
    performance_score: scored.performance_score,
    subject_score: scored.subject_score,
  };
}

export interface PreLlmRankedRow {
  id: string;
  evidence_kind: string;
  pre_llm_score: number;
  pre_llm_breakdown: Record<string, number>;
  dropped_reason: string | null;
}

export interface RankImportRowsForLlmResult {
  selected_row_ids: string[];
  ranked_rows: PreLlmRankedRow[];
  snapshot: SelectionSnapshot;
}

export async function rankImportRowsForLlm(
  db: Pool,
  projectId: string,
  importId: string,
  criteria: Record<string, unknown>,
  maxRowsForLlm: number
): Promise<RankImportRowsForLlmResult> {
  const cfg = mergePreLlmConfig(criteria);
  const minText = cfg.min_primary_text_chars ?? 12;
  const cap = Math.min(20_000, Math.max(maxRowsForLlm * 50, 5000));
  const dbRows = await listEvidenceRowsForPreLlmScoring(db, projectId, importId, cap);
  const registryFollowerLookup = buildRegistryFollowerLookupFromEvidenceRows(dbRows);
  const featureOpts: PreLlmFeatureOptions = { registryFollowerLookup };

  const ranked: PreLlmRankedRow[] = [];
  let droppedSparse = 0;
  let droppedScore = 0;
  let droppedOffTopic = 0;

  for (const r of dbRows) {
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    const kind = r.evidence_kind || "unknown";
    const scored = scorePreLlmRow(kind, payload, cfg, featureOpts);
    if (scored.dropped_reason === "sparse_primary_text") droppedSparse++;
    else if (scored.dropped_reason === "off_topic_subject") droppedOffTopic++;
    else if (scored.dropped_reason === "below_min_pre_llm_score") droppedScore++;
    ranked.push({
      id: r.id,
      evidence_kind: kind,
      pre_llm_score: scored.pre_llm_score,
      pre_llm_breakdown: scored.pre_llm_breakdown,
      dropped_reason: scored.dropped_reason,
    });
  }

  const kept = ranked
    .filter((x) => x.dropped_reason == null)
    .sort((a, b) => {
      if (b.pre_llm_score !== a.pre_llm_score) return b.pre_llm_score - a.pre_llm_score;
      return a.id.localeCompare(b.id);
    });
  const selected_row_ids = kept.slice(0, maxRowsForLlm).map((x) => x.id);

  const by_kind_sent: Record<string, number> = {};
  for (const id of selected_row_ids) {
    const row = kept.find((x) => x.id === id);
    if (row) by_kind_sent[row.evidence_kind] = (by_kind_sent[row.evidence_kind] ?? 0) + 1;
  }

  const profiles_used: Record<string, { min_score: number; weights: Record<string, number> }> = {};
  for (const k of new Set(dbRows.map((r) => r.evidence_kind))) {
    const pr = profileForKind(cfg, k, Boolean(cfg.relative_page_performance));
    profiles_used[k] = { min_score: pr.min_score, weights: { ...pr.weights } };
  }

  const snapshot: SelectionSnapshot = {
    rule_version: PRE_LLM_RULE_VERSION,
    caps: DEFAULT_SELECTION_CAPS,
    selected_row_ids,
    stats: {
      total_in_import: dbRows.length,
      selected: selected_row_ids.length,
      by_kind: by_kind_sent,
    },
    pre_llm: {
      enabled: true,
      relative_page_performance: Boolean(cfg.relative_page_performance),
      min_primary_text_chars: minText,
      total_rows_scored: dbRows.length,
      rows_after_filter: kept.length,
      rows_sent_to_llm: selected_row_ids.length,
      dropped_below_min_score: droppedScore,
      dropped_sparse_text: droppedSparse,
      dropped_off_topic_subject: droppedOffTopic,
      by_kind_sent,
      profiles_used,
    },
  };

  return { selected_row_ids, ranked_rows: ranked, snapshot };
}
