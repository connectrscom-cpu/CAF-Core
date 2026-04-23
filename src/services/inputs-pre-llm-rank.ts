/**
 * Deterministic pre-LLM ranking for inputs evidence rows.
 * Config lives under `criteria_json.pre_llm` on `inputs_processing_profiles`.
 */
import type { Pool } from "pg";
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
  /** For post-like rows: require at least this many chars in title/body/caption/main_text. */
  min_primary_text_chars?: number;
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

/** Normalized features in 0–1 used only for pre-LLM scoring. */
export function extractPreLlmFeatures(
  evidenceKind: string,
  payload: Record<string, unknown>
): Record<string, number> {
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

function defaultKindProfile(kind: string): PreLlmKindProfile {
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

export function mergePreLlmConfig(criteria: Record<string, unknown>): PreLlmConfig {
  const raw = criteria.pre_llm;
  const base: PreLlmConfig = {
    enabled: false,
    min_primary_text_chars: 12,
    default_kind: { min_score: 0, weights: { text_signal: 1 } },
    kinds: {},
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const p = raw as Record<string, unknown>;
  const kindsIn = p.kinds && typeof p.kinds === "object" && !Array.isArray(p.kinds) ? (p.kinds as Record<string, unknown>) : {};
  const mergedKinds: Record<string, PreLlmKindProfile> = {};
  for (const [k, v] of Object.entries(kindsIn)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const def = defaultKindProfile(k);
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
    "scraped_page",
    "source_registry",
  ];
  for (const k of knownKinds) {
    if (!mergedKinds[k]) mergedKinds[k] = defaultKindProfile(k);
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
    min_primary_text_chars:
      typeof p.min_primary_text_chars === "number" && p.min_primary_text_chars >= 0
        ? Math.floor(p.min_primary_text_chars)
        : base.min_primary_text_chars,
    kinds: mergedKinds,
    default_kind: defaultKind,
  };
}

function profileForKind(cfg: PreLlmConfig, kind: string): PreLlmKindProfile {
  return cfg.kinds?.[kind] ?? cfg.default_kind ?? { min_score: 0, weights: { text_signal: 1 } };
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
]);

/**
 * Evaluate one row the same way as `rankImportRowsForLlm` (for Admin preview + APIs).
 */
export function evaluatePreLlmRow(
  evidenceKind: string,
  payload: Record<string, unknown>,
  criteria: Record<string, unknown>
): {
  pre_llm_score: number;
  pre_llm_breakdown: Record<string, number>;
  profile_min_score: number;
  passes_text_gate: boolean;
  dropped_reason: "sparse_primary_text" | "below_min_pre_llm_score" | null;
} {
  const cfg = mergePreLlmConfig(criteria);
  const minText = cfg.min_primary_text_chars ?? 12;
  const prof = profileForKind(cfg, evidenceKind);
  const features = extractPreLlmFeatures(evidenceKind, payload);
  if (POST_KINDS_TEXT_GATE.has(evidenceKind) && textLen(payload) < minText) {
    return {
      pre_llm_score: 0,
      pre_llm_breakdown: features,
      profile_min_score: prof.min_score,
      passes_text_gate: false,
      dropped_reason: "sparse_primary_text",
    };
  }
  const score = weightedFeatureScore(features, prof.weights);
  const rounded = Math.round(score * 10000) / 10000;
  if (score < prof.min_score) {
    return {
      pre_llm_score: rounded,
      pre_llm_breakdown: features,
      profile_min_score: prof.min_score,
      passes_text_gate: true,
      dropped_reason: "below_min_pre_llm_score",
    };
  }
  return {
    pre_llm_score: rounded,
    pre_llm_breakdown: features,
    profile_min_score: prof.min_score,
    passes_text_gate: true,
    dropped_reason: null,
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

  const ranked: PreLlmRankedRow[] = [];
  let droppedSparse = 0;
  let droppedScore = 0;

  for (const r of dbRows) {
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    const kind = r.evidence_kind || "unknown";
    const prof = profileForKind(cfg, kind);
    const features = extractPreLlmFeatures(kind, payload);
    if (POST_KINDS_TEXT_GATE.has(kind) && textLen(payload) < minText) {
      droppedSparse++;
      ranked.push({
        id: r.id,
        evidence_kind: kind,
        pre_llm_score: 0,
        pre_llm_breakdown: features,
        dropped_reason: "sparse_primary_text",
      });
      continue;
    }
    const score = weightedFeatureScore(features, prof.weights);
    if (score < prof.min_score) {
      droppedScore++;
      ranked.push({
        id: r.id,
        evidence_kind: kind,
        pre_llm_score: Math.round(score * 10000) / 10000,
        pre_llm_breakdown: features,
        dropped_reason: "below_min_pre_llm_score",
      });
      continue;
    }
    ranked.push({
      id: r.id,
      evidence_kind: kind,
      pre_llm_score: Math.round(score * 10000) / 10000,
      pre_llm_breakdown: features,
      dropped_reason: null,
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
    const pr = profileForKind(cfg, k);
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
      min_primary_text_chars: minText,
      total_rows_scored: dbRows.length,
      rows_after_filter: kept.length,
      rows_sent_to_llm: selected_row_ids.length,
      dropped_below_min_score: droppedScore,
      dropped_sparse_text: droppedSparse,
      by_kind_sent,
      profiles_used,
    },
  };

  return { selected_row_ids, ranked_rows: ranked, snapshot };
}
