/**
 * Top-performer **carousel** pass: multimodal on **all slide images** (+ caption context).
 * **Instagram only** (`instagram_post`); other platforms are skipped.
 * Slide URLs come from `parseCarouselSlideUrls(payload)` (**Apify / ingest-first** ordered URLs from
 * `carousel_slide_urls_json`, `childPosts`, etc., then explicit list keys + top-level covers + **nested**
 * Graph/scraper JSON). When embed fetch is enabled, also re-fetches slide URLs from the post permalink
 * when stored CDN links are missing or stale (old imports — Instagram `oe=` expiry / ~7d TTL).
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { ensureProject } from "../repositories/core.js";
import {
  countEvidenceRowInsightsByImportTier,
  listEvidenceRowInsightIdsByImportTier,
  listEvidenceRowInsightMechanismByRowIds,
  upsertEvidenceRowInsight,
} from "../repositories/inputs-evidence-insights.js";
import {
  countRatedEvidenceRows,
  getInputsEvidenceImport,
  listEvidenceRowRatingFieldsByIds,
  listEvidenceRowRatingScoreMap,
  listEvidenceRowsForPreLlmScoring,
} from "../repositories/inputs-evidence.js";
import { ratingReviewSnapshotsByRowId } from "../domain/evidence-performance-review-snapshot.js";
import { getInputsProcessingProfile, upsertInputsProcessingProfile } from "../repositories/inputs-processing-profile.js";
import { normalizeCarouselInsightsLlmJson, finalizeCarouselInsightJson } from "./carousel-insights-llm-normalize.js";
import { runCarouselDeckVisionAnalysis } from "./carousel-insights-vision.js";
import { evaluatePreLlmRow } from "./inputs-pre-llm-rank.js";
import { finalizeHttpsImageUrlForOpenAiVision, isVideoLikeEvidence } from "./inputs-image-url-for-analysis.js";
import { summarizePayloadForLlm, extractEvidenceDisplayFields } from "./inputs-evidence-display.js";
import {
  MIN_CAROUSEL_SLIDES_FOR_DEEP,
  instagramCarouselStructuralHintPresent,
  instagramPostPermalinkFromPayload,
  parseCarouselCaptionContext,
  carouselSlideUrlsLookStale,
  parseCarouselSlideUrls,
} from "./inputs-carousel-evidence-bundle.js";
import {
  buildTopPerformerRatingGateRequestOverrides,
  resolveBroadInsightsSampleGate,
} from "./inputs-top-performer-rating-gate.js";
import {
  applyTopPerformerPercentileSelection,
  resolveTopPerformerPercentileConfig,
  scoreRowForTopPerformer,
  topPerformerFormatFamilyForRow,
  type ScoredTopPerformerRow,
  type TopPerformerPercentileGroupStat,
} from "./inputs-top-performer-percentile-pool.js";
import {
  archiveTopPerformerVisionMedia,
  resolveTopPerformerArchiveMedia,
} from "./inputs-top-performer-media-archive.js";
import { getSupabaseStorageClient } from "./supabase-storage.js";
import {
  capAndSortQualifierPreview,
  excerptForTopPerformerPreview,
  postUrlForTopPerformerPreview,
  type TopPerformerMediaQualifierPreviewRow,
} from "./inputs-top-performer-qualifying-preview.js";
import {
  assertVisionImageUrlsSafeForRemoteFetch,
  relayImageUrlsForOpenAiVision,
  shouldRelayImageUrlForOpenAi,
  VISION_CDN_PROXY_HINT,
} from "./inputs-top-performer-vision-relay.js";
import {
  extractInstagramPermalinkShortcode,
  fetchInstagramCarouselUrlsFromEmbedDetailed,
  resolveInstagramEmbedHttpProxy,
  tryCreateInstagramEmbedProxyAgent,
  type InstagramEmbedFetchOutcome,
} from "./inputs-instagram-embed-carousel-resolver.js";

const STEP = "inputs_top_performer_carousel_insight";

/** Carousel deck vision runs only on Instagram evidence rows. */
const CAROUSEL_VISION_EVIDENCE_KIND = "instagram_post";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function mergeUniqueSlideUrls(primary: string[], extra: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of [...primary, ...extra]) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

function truthyInsightCarouselEmbedFetch(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

/** Explicit tenant opt-out of embed fetch (overrides default-on env). */
function explicitInsightCarouselEmbedDisable(v: unknown): boolean {
  if (v === false) return true;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "0" || s === "false" || s === "no" || s === "off";
}

/** Where embed fetch was turned on (`none` = off — criteria `false`, or `CAF_INSTAGRAM_EMBED_CAROUSEL_FETCH=0`). */
export type InstagramEmbedCarouselFetchSource = "env" | "criteria" | "none";

function resolveInstagramEmbedCarouselFetch(
  config: AppConfig,
  criteria: Record<string, unknown>
): { enabled: boolean; source: InstagramEmbedCarouselFetchSource } {
  const ins = criteria.inputs_insights;
  const insObj = ins && typeof ins === "object" && !Array.isArray(ins) ? (ins as Record<string, unknown>) : null;
  const criteriaVal = insObj?.instagram_embed_carousel_fetch;

  if (insObj && explicitInsightCarouselEmbedDisable(criteriaVal)) {
    return { enabled: false, source: "none" };
  }
  if (insObj && truthyInsightCarouselEmbedFetch(criteriaVal)) {
    return { enabled: true, source: "criteria" };
  }
  if (!config.CAF_INSTAGRAM_EMBED_CAROUSEL_FETCH) {
    return { enabled: false, source: "none" };
  }
  return { enabled: true, source: "env" };
}

export const TOP_PERFORMER_CAROUSEL_SYSTEM_PROMPT = `You analyze a **multi-slide social carousel** (static images shown in order: the first image attachment after the text block = slide_index 1, then +1 for each following attachment).

Return ONLY valid JSON with **root fields for quick reads** plus **slide-level detail for reproduction**:

— Deck-wide (keep these strings succinct but informative) —
{
  "slide_arc": "how the narrative / list progresses across slides (short)",
  "cover_vs_body": "how slide 1 hooks vs middle/ending slides",
  "visual_consistency": "one paragraph: palette, repeated template, how unified the deck feels",
  "on_screen_text_summary": "recurring hook patterns / phrases across the deck (not full transcripts)",
  "cta_clarity": "how clear the ask / next step is",
  "format_pattern": "educational | listicle | story | before_after | promo | mixed | unknown",
  "risk_flags": ["meaningful risk strings only; use [] when none — never placeholders like \"none\" or \"n/a\""],
  "why_it_worked": "why this carousel may perform (short)",
  "primary_emotion": "dominant emotional vibe (short)",
  "secondary_emotion": "secondary vibe or empty string",
  "caption_style": "how the post caption pairs with the carousel (short)",

  "deck_as_whole_summary": "2–5 sentences: overall story, brand/persona vibe, pacing, what makes the deck cohesive + swipe-worthy",
  "deck_visual_system": {
    "overall_aesthetic": "e.g. soft editorial / bold meme grid / luxury minimal",
    "canvas_aspect": "portrait 4:5 guess | square | unknown",
    "safe_margins_gutters": "describe outer padding and column rhythm so a designer can match proportions",
    "repeated_template": "what template repeats on most slides (header strip, footer, card frame, etc.)",
    "motion_or_energy": "static vs kinetic feel (even though images are still)",
    "emoji_or_sticker_usage": "none | sparse | dense; where they cluster"
  },
  "replication_blueprint": {
    "steps_to_remake": ["ordered recipe steps a designer could follow without seeing the original"],
    "asset_sources": ["generic stock / meme archetype / illustration style — never name exact copyrighted photo or scrape target"],
    "tooling_notes": "e.g. Figma layers, Canva template class, Instagram text tool tiers if inferred",
    "legal_ethics": "One line: recreate the *pattern*, not copyrighted third-party imagery or logos verbatim."
  },

  "mimic_evaluation": {
    "recommended_mode": "full_bleed_visual | text_on_template | not_suitable",
    "mode_reason": "1-2 sentences: why this mode is the best fit for recreating this deck with an image-gen AI (full_bleed_visual = each slide is a standalone image that can be recreated as-is by an AI image model; text_on_template = slides share a repeating background/frame and differ only in overlaid text, so extract the template once and overlay new text; not_suitable = deck is too brand-specific, too complex, or mostly promotional to replicate meaningfully)",
    "background_replicability": "high | medium | low — can an AI image model convincingly recreate the background/frame of these slides?",
    "background_description": "short description of the shared background or visual frame (color, gradients, imagery) — empty string if each slide has a unique background",
    "template_consistency": "uniform | varied | mixed — do slides share one visual template or is each slide unique?",
    "content_slide_indices": [1, 2, 3],
    "skip_slide_indices": [],
    "skip_reason": "why skipped slides should be excluded (e.g. product mockup, branded guide cover, app download CTA) — empty string if none skipped",
    "replication_difficulty": "easy | moderate | hard",
    "template_storage_quality": "reusable | job_only | reject — should clean generic background plates from this deck be saved in the project template library for future carousels? reusable = uniform text-on-template frame, high background_replicability, low brand/promo tie-in, generic (non-themed) plate; job_only = fine for this mimic job but not a reusable library asset; reject = do not store plates (unsuitable frame or too brand-specific)",
    "template_storage_reason": "1-2 sentences: why this quality rating for library storage (independent of recommended_mode for the current job)"
  },

  "slides": [
    {
      "slide_index": 1,
      "on_screen_text_transcript": "Every readable word on the slide in visual reading order. Separate lines with JSON escape \\n (backslash then n). Include emojis and hashtags. If partially unreadable, mark [illegible] and continue.",
      "visual_description": "What is shown beyond text: subjects, framing, background, props, memes (describe meme archetype, not specific IP). Be concrete enough to brief a designer.",
      "layout_template": "e.g. center stack, split image top / text bottom, grid 2x2, quote card, listicle row — note alignment (left/center/right)",
      "typography": {
        "headline_guess": "e.g. heavy geometric sans, ALL CAPS, tight tracking",
        "body_guess": "e.g. humanist sans sentence case",
        "accent_guess": "script / serif quote / hand-drawn — or none",
        "relative_scale": "estimate headline vs body vs fine print as % of slide height OR xs|sm|md|lg|xl vs slide",
        "text_placement": "top third / center band / bottom caption / full-bleed overlay",
        "hierarchy": "what is largest → smallest on this slide"
      },
      "color_tokens": {
        "background": "#hex or name",
        "primary_text": "#hex or name",
        "accent": ["#hex or names"],
        "photo_grade": "warm / cool / desaturated / high-contrast / flat illustration — short"
      },
      "graphic_elements": "borders, shadows, gradients, stickers, icons, underline bars, swipe chevrons — anything layout-affecting",
      "image_or_photo_role": "full-bleed photo | inset card | collage | flat illustration | screenshot-like | none — and dominant subject",
      "text_density": "low | medium | high",
      "slide_purpose": "hook | content | listicle_item | storytelling | cta | self_promo | product_pitch | testimonial | filler",
      "brand_specificity": "none | low | high — how tied the slide is to the creator's own brand/product (high = names a specific guide, course, app, quiz, download, or branded offering that would not apply to another account)"
    }
  ]
}

**Rules**
- slides.length MUST equal the number of slide image attachments you received; slide_index runs 1..N in that order.
- Transcripts must be **faithful** to visible type; do not invent platform UI that is not visible.
- Fonts: you rarely know exact family names—give **closest recognizable class** (geometric sans, grotesk, serif editorial, rounded comic, etc.) plus weight/case/tracking notes so a human can pick an equivalent.
- Aim for **replication detail** (sizes/proportions as guesses, colors when visible); say "unknown" or null when not inferable — do not guess hex if unclear.
- Be conservative on sensitive claims; use risk_flags when needed.

Use every slide image; if order is ambiguous, assume the attachment order given above.`;

export const TOP_PERFORMER_CAROUSEL_USER_PROMPT_TEMPLATE = `Evidence kind: {{EVIDENCE_KIND}}
Pre-LLM score: {{PRE_LLM_SCORE}}
Slide count: {{SLIDE_COUNT}}
Caption / context:
{{CAPTION_CONTEXT}}

Structured row context:
{{TEXT_BUNDLE}}`;

export interface RunDeepCarouselInsightsOptions {
  max_rows?: number;
  min_pre_llm_score?: number;
  rescan?: boolean;
  max_slides?: number;
  /** Overrides `criteria_json.top_performer.rating_top_fraction` for this run only (e.g. 0.05 = top 5%). */
  rating_top_fraction?: number;
  /** When true, rating percentile gate is off for this run only (same as profile `disable_rating_percentile_gate`). */
  disable_rating_percentile_gate?: boolean;
}

export interface RunDeepCarouselInsightsResult {
  import_id: string;
  model: string;
  rows_scanned: number;
  carousel_deck_rows: number;
  candidates_with_slides: number;
  rows_analyzed: number;
  skipped_no_slides: number;
  carousel_insights_total: number;
  percentile_gate_active?: boolean;
  percentile_top_fraction?: number;
  percentile_scope?: string;
  percentile_universe_count?: number;
  percentile_cap?: number;
  percentile_score_basis?: string;
  percentile_format_groups?: TopPerformerPercentileGroupStat[];
  skipped_percentile_selection?: number;
  percentile_gate_disabled?: string;
  /** Top fraction of media-eligible rows that may receive vision; default 5%. */
  rating_gate_active?: boolean;
  rating_top_fraction?: number;
  rated_rows_in_import?: number;
  rating_gate_cap?: number;
  skipped_rating_gate?: number;
  rating_gate_disabled?: string;
  broad_insights_gate_active?: boolean;
  broad_llm_rows_in_import?: number;
  skipped_broad_insights_gate?: number;
  broad_insights_gate_disabled?: string;
  /** Rows skipped because `evidence_kind` is not Instagram (carousel vision is IG-only). */
  skipped_evidence_kind_filter?: number;
  /** Rows with `evidence_kind === instagram_post` in this scan (after non-IG filter). */
  instagram_post_rows?: number;
  /** IG rows excluded: `media_type` / payload says video or reel (`isVideoLikeEvidence`). */
  skipped_instagram_video_like?: number;
  /** IG still-image rows without ≥2 parsed slide URLs in `payload_json` (no sidecar / carousel columns Core reads). */
  skipped_instagram_few_slide_urls?: number;
  /**
   * Subset of `skipped_instagram_few_slide_urls`: structural carousel signal (`img_index≥2` on a
   * permalink, or `media_type` Sidecar/Carousel) but **no** ≥2 child slide URLs in `payload_json` —
   * enrich ingest so `carousel_slide_urls` / `images` / etc. are populated for vision.
   */
  instagram_carousel_url_hint_missing_slide_urls?: number;
  /** True when embed fetch is enabled (default env on; or criteria `instagram_embed_carousel_fetch`). */
  instagram_embed_carousel_fetch_enabled?: boolean;
  /** `env` = default-on / explicit env allow; `criteria` = profile forced on; `none` = off (env `0` or criteria off). */
  instagram_embed_carousel_fetch_source?: InstagramEmbedCarouselFetchSource;
  /** HTTP embed fetches attempted (only when hint present and slides were short). */
  instagram_embed_carousel_fetch_attempts?: number;
  /** Rows that reached ≥2 slide URLs after an embed fetch (fetch helped). */
  instagram_embed_carousel_rows_resolved_via_embed?: number;
  /** Rows that had a carousel hint + permalink but embed fetch was skipped (per-run HTTP cap). */
  instagram_embed_carousel_fetch_skipped_due_to_cap?: number;
  /** Max embed HTTP GETs attempted in this run (guardrail). */
  instagram_embed_carousel_fetch_cap?: number;
  /** Rows that reused a prior shortcode fetch (no extra HTTP). */
  instagram_embed_carousel_fetch_cache_hits?: number;
  /** Of **network** embed GETs with HTTP 200, how many bodies contained the literal `display_url`. */
  instagram_embed_carousel_fetch_network_html_has_display_url_hits?: number;
  /** Of **network** embed GETs with HTTP 200, how many bodies contained broader media-JSON / meta hints (see `instagramEmbedHtmlDiagnostics`). */
  instagram_embed_carousel_fetch_network_html_has_embed_media_signal_hits?: number;
  /** Of **network** embed GETs with HTTP 200, how many bodies mentioned slide-relevant CDN hosts (`scontent*.cdninstagram`, non-static `*.cdninstagram` image paths, `fbcdn` images — not `static.cdninstagram` bundles alone). */
  instagram_embed_carousel_fetch_network_html_has_cdn_host_hits?: number;
  /** Of **network** embed GETs with HTTP 200, how many bodies looked like a login / challenge wall. */
  instagram_embed_carousel_fetch_network_login_wall_likely_hits?: number;
  /** True when an HTTP CONNECT proxy dispatcher was used for embed GETs (`CAF_INSTAGRAM_EMBED_HTTP_PROXY` or criteria). */
  instagram_embed_http_proxy_active?: boolean;
  /** `env` / `criteria` when a proxy URL was configured for this run; `none` if direct egress only. */
  instagram_embed_http_proxy_source?: "env" | "criteria" | "none";
  /** Rows that qualify for carousel vision (≥2 slides, pre-LLM + gates); sorted by pre-LLM desc, capped for UI. */
  qualifying_carousel_rows?: TopPerformerMediaQualifierPreviewRow[];
  /** True when `CAF_TOP_PERFORMER_ARCHIVE_MEDIA` / auto+Supabase / criteria requests archiving slide images. */
  top_performer_media_archive_requested?: boolean;
  /** True when `SUPABASE_URL` + service role are set (archiving can run). */
  top_performer_media_supabase_configured?: boolean;
  /** Count of slide images successfully uploaded this run (carousel only). */
  top_performer_media_archive_files_saved?: number;
  /** Count of slide fetch/upload failures this run. */
  top_performer_media_archive_errors?: number;
  /** Echo of request option: when false, rows that already have `top_performer_carousel` are excluded from the vision pool. */
  rescan?: boolean;
  /**
   * Rows that had ≥2 slides and passed pre-LLM + gates, but were skipped because they already have
   * `top_performer_carousel` insights and `rescan` was false.
   */
  skipped_existing_carousel_insight?: number;
  /** Rows with ≥2 slides that failed `min_pre_llm_score` (request or profile). */
  skipped_pre_llm_below_cutoff?: number;
  min_pre_llm_score_applied?: number;
  /**
   * When `rows_analyzed === 0`, a short human explanation (admin / logs). Omitted when work ran.
   */
  deep_carousel_zero_work_summary?: string | null;
  /**
   * When `rating_gate_disabled === "no_rated_rows"`, explains that `rating_top_fraction` / profile gate
   * could not filter because no `inputs_evidence_rows.rating_score` values exist for this import.
   */
  rating_gate_note?: string | null;
}

function carouselModel(profile: { synth_model: string; criteria_json: Record<string, unknown> }): string {
  const raw = profile.criteria_json?.inputs_insights;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const m = String((raw as Record<string, unknown>).deep_carousel_model ?? "").trim();
    if (m) return m;
  }
  return profile.synth_model || "gpt-4o-mini";
}

function carouselMaxRows(criteria: Record<string, unknown>, override?: number): number {
  if (override != null && Number.isFinite(override)) return clamp(override, 1, 40);
  const ins = criteria.inputs_insights;
  if (ins && typeof ins === "object" && !Array.isArray(ins)) {
    const n = parseInt(String((ins as Record<string, unknown>).deep_carousel_max ?? ""), 10);
    if (!Number.isNaN(n)) return clamp(n, 1, 40);
  }
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const n = parseInt(String((tp as Record<string, unknown>).max_carousel_rows ?? ""), 10);
    if (!Number.isNaN(n)) return clamp(n, 1, 40);
  }
  return 10;
}

function carouselMinPreLlm(criteria: Record<string, unknown>, override?: number): number {
  if (override != null && Number.isFinite(override)) return clamp(override, 0, 1);
  const tp = criteria.top_performer;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const n = parseFloat(String((tp as Record<string, unknown>).pre_llm_min_score_carousel ?? ""));
    if (!Number.isNaN(n)) return clamp(n, 0, 1);
    const n2 = parseFloat(String((tp as Record<string, unknown>).pre_llm_min_score ?? ""));
    if (!Number.isNaN(n2)) return clamp(n2, 0, 1);
  }
  return 0.35;
}

function makeCarouselInsightsId(importId: string, rowId: string): string {
  return `ins_${importId.replace(/-/g, "").slice(0, 10)}_${rowId}_cdeep`;
}

function buildDeepCarouselZeroWorkSummary(args: {
  analyzed: number;
  carouselDeckRows: number;
  poolLen: number;
  rescan: boolean;
  skippedExisting: number;
  skippedPercentileSelection: number;
  percentileActive: boolean;
  percentileFraction: number;
  percentileUniverse: number;
  carouselInsightsTotal: number;
  embedAttempts: number;
  displayUrlHits: number;
  cdnHostHits: number;
  mediaSignalHits: number;
  embedHttpProxyActive: boolean;
  embedHttpProxySource: "criteria" | "env" | "none";
}): string | null {
  if (args.analyzed > 0) return null;
  if (args.carouselDeckRows === 0) {
    let msg =
      `No Instagram evidence rows reached ≥2 slide image URLs after payload parse + embed merge ` +
      `(${args.embedAttempts} embed GET(s); ${args.displayUrlHits} with literal "display_url"; ${args.cdnHostHits} with slide-relevant CDN (not only \`static.cdninstagram\` bundles); ${args.mediaSignalHits} with broader media/meta JSON hints — often all low when Instagram serves a login wall or minimal HTML to server IPs). ` +
      `There are still ${args.carouselInsightsTotal} top_performer_carousel insight row(s) in the DB from earlier runs; they are not proof of current slide URLs. ` +
      `Enrich ingest with per-slide CDN URLs, or improve embed access.`;
    if (args.embedAttempts > 0 && !args.embedHttpProxyActive) {
      msg +=
        ` **CAF_INSTAGRAM_EMBED_HTTP_PROXY** (Fly secret) or \`criteria_json.inputs_insights.instagram_embed_http_proxy\` enables an HTTP CONNECT proxy for **embed** and **slide archive** fetches so Core is not stuck on datacenter egress.`;
    }
    return msg;
  }
  if (args.poolLen === 0 && args.skippedExisting > 0 && !args.rescan) {
    return (
      `${args.skippedExisting} row(s) had ≥2 slides and passed gates but already have top_performer_carousel insights while rescan was false. ` +
      `Enable rescan to re-run vision (API body rescan:true, or admin "Rescan" on top performers).`
    );
  }
  if (args.poolLen === 0) {
    if (args.percentileActive && args.skippedPercentileSelection > 0 && args.percentileUniverse > 0) {
      const pct = Math.round(args.percentileFraction * 10000) / 100;
      return (
        `${args.carouselDeckRows} carousel deck row(s) were media-eligible; top ${pct}% selection kept ${args.poolLen} for vision ` +
        `(${args.skippedPercentileSelection} below the top fraction in universe of ${args.percentileUniverse}). ` +
        `Raise the Top % control or disable broad-insights align if the universe is too small.`
      );
    }
    return (
      `At least one row had ≥2 slide URLs, but none entered the vision pool: check top-% selection, broad-insights gate, and rescan. ` +
      `(${args.carouselInsightsTotal} total carousel insight rows in DB for this import.)`
    );
  }
  return null;
}

/** LLMs sometimes emit placeholder "risks"; strip those before persisting `risk_flags_json`. */
const CAROUSEL_RISK_FLAG_NOISE = new Set([
  "none",
  "n/a",
  "na",
  "-",
  "no risk",
  "no risks",
  "unknown",
]);

function parseRiskFlags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x).trim())
    .filter((s) => {
      if (!s) return false;
      return !CAROUSEL_RISK_FLAG_NOISE.has(s.toLowerCase());
    })
    .slice(0, 40);
}

function buildCarouselAestheticAnalysisJson(parsed: Record<string, unknown> | null): Record<string, unknown> {
  if (!parsed) return {};
  const out: Record<string, unknown> = {
    slide_arc: parsed.slide_arc,
    cover_vs_body: parsed.cover_vs_body,
    visual_consistency: parsed.visual_consistency,
    on_screen_text_summary: parsed.on_screen_text_summary,
    cta_clarity: parsed.cta_clarity,
    format_pattern: parsed.format_pattern,
    primary_emotion: parsed.primary_emotion,
    secondary_emotion: parsed.secondary_emotion,
    caption_style: parsed.caption_style,
  };
  if (Array.isArray(parsed.slides)) out.slides = parsed.slides;
  if (parsed.deck_as_whole_summary != null) out.deck_as_whole_summary = parsed.deck_as_whole_summary;
  if (parsed.deck_visual_system != null) out.deck_visual_system = parsed.deck_visual_system;
  if (parsed.replication_blueprint != null) out.replication_blueprint = parsed.replication_blueprint;
  if (parsed._slide_coverage != null) out._slide_coverage = parsed._slide_coverage;
  return out;
}

function pickInsightString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function resolveHashtagsFromEvidence(
  evidenceKind: string,
  payload: Record<string, unknown>,
  caption: string
): string | null {
  const disp = extractEvidenceDisplayFields(evidenceKind, payload);
  if (disp.hashtags?.trim()) return disp.hashtags.trim().slice(0, 800);
  const fromCap = caption.match(/#[\p{L}\p{N}_]+/gu);
  if (fromCap?.length) {
    return [...new Set(fromCap.map((h) => h.replace(/^#/, "").toLowerCase()))].join(", ").slice(0, 800);
  }
  return null;
}

function inferCaptionStyleFromCaption(caption: string): string | null {
  const t = caption.trim();
  if (!t) return null;
  if (t.length > 600) return "long_form_caption";
  if (t.length < 80) return "micro_caption";
  const firstLine = t.split("\n")[0]?.trim() ?? "";
  if (/^(save|comment|link in bio|tap|swipe)/i.test(firstLine)) return "cta_forward";
  return "standard_caption";
}

function resolveCarouselMechanismFields(args: {
  parsed: Record<string, unknown> | null;
  broad: {
    primary_emotion: string | null;
    secondary_emotion: string | null;
    caption_style: string | null;
    custom_label_1: string | null;
    custom_label_2: string | null;
    custom_label_3: string | null;
    hashtags: string | null;
  } | null;
  evidenceKind: string;
  payload: Record<string, unknown>;
  caption: string;
}) {
  const { parsed, broad, evidenceKind, payload, caption } = args;
  return {
    primary_emotion: pickInsightString(parsed?.primary_emotion) ?? broad?.primary_emotion ?? null,
    secondary_emotion: pickInsightString(parsed?.secondary_emotion) ?? broad?.secondary_emotion ?? null,
    caption_style:
      pickInsightString(parsed?.caption_style) ??
      broad?.caption_style ??
      inferCaptionStyleFromCaption(caption),
    hashtags: broad?.hashtags ?? resolveHashtagsFromEvidence(evidenceKind, payload, caption),
    custom_label_1: broad?.custom_label_1 ?? null,
    custom_label_2: broad?.custom_label_2 ?? null,
    custom_label_3: broad?.custom_label_3 ?? null,
  };
}

export async function runDeepCarouselInsightsForImport(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  importId: string,
  opts: RunDeepCarouselInsightsOptions = {}
): Promise<RunDeepCarouselInsightsResult> {
  if (config.PROCESSING_VISION_PROVIDER === "openai" && !config.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required for carousel insights");
  }
  if (config.PROCESSING_VISION_PROVIDER === "nvidia" && !config.NVIDIA_NIM_API_KEY?.trim()) {
    throw new Error("NVIDIA_NIM_API_KEY is required when PROCESSING_VISION_PROVIDER=nvidia");
  }

  const project = await ensureProject(db, projectSlug);
  const imp = await getInputsEvidenceImport(db, project.id, importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);

  let profile = await getInputsProcessingProfile(db, project.id);
  if (!profile) {
    profile = await upsertInputsProcessingProfile(db, project.id, {});
  }
  const criteria = (profile.criteria_json ?? {}) as Record<string, unknown>;
  const model = carouselModel(profile);
  const maxRows = carouselMaxRows(criteria, opts.max_rows);
  const percentileConfig = resolveTopPerformerPercentileConfig(
    criteria,
    buildTopPerformerRatingGateRequestOverrides(opts),
    opts.min_pre_llm_score
  );
  const maxSlides = clamp(opts.max_slides ?? 12, MIN_CAROUSEL_SLIDES_FOR_DEEP, 12);
  const embedFetch = resolveInstagramEmbedCarouselFetch(config, criteria);
  const embedCarouselFetchEnabled = embedFetch.enabled;

  const mediaArchiveRequested = resolveTopPerformerArchiveMedia(config, criteria);
  const mediaSupabaseConfigured = !!getSupabaseStorageClient(config);
  let mediaArchiveFilesSaved = 0;
  let mediaArchiveErrors = 0;

  const broadGate = await resolveBroadInsightsSampleGate(db, importId, criteria);
  const ratingScores = await listEvidenceRowRatingScoreMap(db, project.id, importId);
  const ratedRowsInImport = await countRatedEvidenceRows(db, project.id, importId);

  const existing = opts.rescan ? new Set<string>() : await listEvidenceRowInsightIdsByImportTier(db, importId, "top_performer_carousel");

  const dbRows = await listEvidenceRowsForPreLlmScoring(db, project.id, importId, 12_000);

  const maxEmbedNetworkFetches = clamp(config.CAF_INSTAGRAM_EMBED_MAX_FETCHES_PER_IMPORT, 0, 2000);
  const embedThrottleMs = clamp(config.CAF_INSTAGRAM_EMBED_THROTTLE_MS, 0, 5000);

  /** Row ids where prefetch embed merge reached ≥2 slide URLs. */
  const embedSlideOverrideByRowId = new Map<string, string[]>();
  let instagramEmbedFetchAttempts = 0;
  let instagramEmbedFetchCacheHits = 0;
  let instagramEmbedFetchSkippedCap = 0;
  let instagramEmbedNetworkDisplayUrlLiteralHits = 0;
  let instagramEmbedNetworkCdnHostHits = 0;
  let instagramEmbedNetworkMediaSignalHits = 0;
  let instagramEmbedNetworkLoginWallLikelyHits = 0;

  const embedHttpProxyCfg = resolveInstagramEmbedHttpProxy(config, criteria);
  let instagramEmbedHttpProxyActive = false;

  if (embedCarouselFetchEnabled && maxEmbedNetworkFetches > 0) {
    const embedProxyAgent = tryCreateInstagramEmbedProxyAgent(embedHttpProxyCfg.url);
    instagramEmbedHttpProxyActive = Boolean(embedProxyAgent);
    try {
      type EmbedPre = {
        id: string;
        postUrl: string;
        shortcode: string;
        baseSlides: string[];
        pre: number;
      };
      const pres: EmbedPre[] = [];
      for (const r of dbRows) {
        if (r.evidence_kind !== CAROUSEL_VISION_EVIDENCE_KIND) continue;
        const payload = (r.payload_json ?? {}) as Record<string, unknown>;
        if (isVideoLikeEvidence(r.evidence_kind, payload)) continue;
        const baseSlides = parseCarouselSlideUrls(payload, maxSlides);
        if (!instagramCarouselStructuralHintPresent(payload)) continue;
        const postUrl = instagramPostPermalinkFromPayload(payload);
        const shortcode = postUrl ? extractInstagramPermalinkShortcode(postUrl) : null;
        if (!postUrl || !shortcode) continue;
        const ev = evaluatePreLlmRow(r.evidence_kind, payload, criteria);
        if (ev.dropped_reason != null) continue;
        pres.push({ id: r.id, postUrl, shortcode, baseSlides, pre: ev.pre_llm_score });
      }
      pres.sort((a, b) => b.pre - a.pre);

      const shortcodeToOutcome = new Map<string, InstagramEmbedFetchOutcome>();
      for (const p of pres) {
        let outcome = shortcodeToOutcome.get(p.shortcode);
        if (!outcome) {
          if (instagramEmbedFetchAttempts >= maxEmbedNetworkFetches) {
            instagramEmbedFetchSkippedCap++;
            continue;
          }
          instagramEmbedFetchAttempts++;
          outcome = await fetchInstagramCarouselUrlsFromEmbedDetailed(p.postUrl, {
            maxSlides,
            timeoutMs: config.CAF_INSTAGRAM_EMBED_FETCH_TIMEOUT_MS,
            maxBytes: config.CAF_INSTAGRAM_EMBED_MAX_BYTES,
            ...(embedProxyAgent ? { dispatcher: embedProxyAgent } : {}),
          });
          shortcodeToOutcome.set(p.shortcode, outcome);
          if (outcome.http_ok) {
            if (outcome.html_contains_display_url) instagramEmbedNetworkDisplayUrlLiteralHits++;
            if (outcome.html_has_cdninstagram_host) instagramEmbedNetworkCdnHostHits++;
            if (outcome.html_has_embed_media_signals) instagramEmbedNetworkMediaSignalHits++;
            if (outcome.login_wall_likely) instagramEmbedNetworkLoginWallLikelyHits++;
          }
          if (embedThrottleMs > 0) {
            await new Promise((res) => setTimeout(res, embedThrottleMs));
          }
        } else {
          instagramEmbedFetchCacheHits++;
        }
        const merged =
          outcome.http_ok && outcome.urls.length >= MIN_CAROUSEL_SLIDES_FOR_DEEP
            ? mergeUniqueSlideUrls([], outcome.urls, maxSlides)
            : mergeUniqueSlideUrls(p.baseSlides, outcome.urls, maxSlides);
        if (merged.length >= MIN_CAROUSEL_SLIDES_FOR_DEEP) {
          embedSlideOverrideByRowId.set(p.id, merged);
        }
      }
    } finally {
      try {
        await embedProxyAgent?.close();
      } catch {
        /* ignore */
      }
    }
  }

  type Cand = ScoredTopPerformerRow & {
    pre_llm_score: number;
    evidence_kind: string;
    payload: Record<string, unknown>;
    slide_urls: string[];
    caption: string;
  };
  const eligible: Cand[] = [];
  let skippedExistingCarouselInsight = 0;
  let skippedBroadInsightsGate = 0;
  let skippedEvidenceKindFilter = 0;
  let instagramPostRows = 0;
  let skippedInstagramVideoLike = 0;
  let skippedInstagramFewSlides = 0;
  let instagramCarouselHintMissingSlideUrls = 0;
  let instagramEmbedRowsResolvedViaEmbed = 0;
  let carouselDeckRows = 0;
  const qualifyingCarouselScratch: TopPerformerMediaQualifierPreviewRow[] = [];

  for (const r of dbRows) {
    if (r.evidence_kind !== CAROUSEL_VISION_EVIDENCE_KIND) {
      skippedEvidenceKindFilter++;
      continue;
    }
    instagramPostRows++;
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    if (isVideoLikeEvidence(r.evidence_kind, payload)) {
      skippedInstagramVideoLike++;
      continue;
    }
    let slideUrls = parseCarouselSlideUrls(payload, maxSlides);
    const preEmbedCount = slideUrls.length;
    const structuralHint = instagramCarouselStructuralHintPresent(payload);
    let usedEmbedFetch = false;
    if (embedSlideOverrideByRowId.has(r.id)) {
      slideUrls = embedSlideOverrideByRowId.get(r.id)!;
      usedEmbedFetch =
        preEmbedCount < MIN_CAROUSEL_SLIDES_FOR_DEEP ||
        carouselSlideUrlsLookStale(parseCarouselSlideUrls(payload, maxSlides));
    }
    if (slideUrls.length < MIN_CAROUSEL_SLIDES_FOR_DEEP) {
      skippedInstagramFewSlides++;
      if (structuralHint) {
        instagramCarouselHintMissingSlideUrls++;
      }
      continue;
    }
    if (usedEmbedFetch && preEmbedCount < MIN_CAROUSEL_SLIDES_FOR_DEEP) {
      instagramEmbedRowsResolvedViaEmbed++;
    }
    carouselDeckRows++;
    const ev = evaluatePreLlmRow(r.evidence_kind, payload, criteria);
    if (ev.dropped_reason != null) continue;
    const scored = scoreRowForTopPerformer(r.id, ev.pre_llm_score, ratingScores);
    eligible.push({
      ...scored,
      pre_llm_score: ev.pre_llm_score,
      evidence_kind: r.evidence_kind,
      payload,
      slide_urls: slideUrls,
      caption: parseCarouselCaptionContext(payload),
    });
  }

  skippedBroadInsightsGate = broadGate.active ? eligible.filter((e) => !broadGate.idSet.has(e.id)).length : 0;

  const { selected: percentileSelected, stats: percentileStats } = applyTopPerformerPercentileSelection(
    eligible,
    percentileConfig,
    {
      broadIdSet: broadGate.active ? broadGate.idSet : null,
      maxRows,
      ratedRowsInImport,
      groupByFormatFamily: (r) => topPerformerFormatFamilyForRow(r.evidence_kind, r.payload),
    }
  );

  const skippedPercentileSelection = Math.max(
    0,
    percentileStats.universe_count - percentileStats.selected_by_percentile
  );
  const selectedIdSet = new Set(percentileSelected.map((c) => c.id));
  for (const e of eligible) {
    if (broadGate.active && !broadGate.idSet.has(e.id)) continue;
    if (!selectedIdSet.has(e.id)) continue;
    qualifyingCarouselScratch.push({
      row_id: e.id,
      evidence_kind: e.evidence_kind,
      pre_llm_score: e.score,
      media_count: e.slide_urls.length,
      caption_excerpt: excerptForTopPerformerPreview(e.payload),
      post_url: postUrlForTopPerformerPreview(e.evidence_kind, e.payload),
      already_has_tier_insight: existing.has(e.id),
    });
  }

  const top = percentileSelected.filter((c) => !existing.has(c.id));
  skippedExistingCarouselInsight = percentileSelected.filter((c) => existing.has(c.id)).length;
  const broadMechanismByRow = await listEvidenceRowInsightMechanismByRowIds(
    db,
    importId,
    "broad_llm",
    top.map((c) => c.id)
  );
  const ratingRows = await listEvidenceRowRatingFieldsByIds(db, project.id, importId, top.map((c) => c.id));
  const ratingSnapByRow = ratingReviewSnapshotsByRowId(
    ratingRows.map((row) => ({
      id: row.id,
      rating_score: row.rating_score,
      rating_components_json: row.rating_components_json,
      rating_rationale: row.rating_rationale,
      rated_at: row.rated_at,
    }))
  );

  const auditBase = {
    db,
    projectId: project.id,
    runId: null,
    taskId: null,
    signalPackId: null,
  };

  let analyzed = 0;
  for (const c of top) {
    const textBundle = summarizePayloadForLlm(c.evidence_kind, c.payload, 2200);
    const system = TOP_PERFORMER_CAROUSEL_SYSTEM_PROMPT;

    const userText = `Evidence kind: ${c.evidence_kind}
Pre-LLM score: ${c.pre_llm_score}
Slide count: ${c.slide_urls.length}
Caption / context:
${c.caption || "(none)"}

Structured row context:
${textBundle}`;

    let storedInspection: Record<string, unknown> | undefined;
    let visionSlideUrls = [...c.slide_urls];

    const postUrlForRefresh = instagramPostPermalinkFromPayload(c.payload);
    const needsFreshSlides =
      visionSlideUrls.some((u) => shouldRelayImageUrlForOpenAi(u)) ||
      carouselSlideUrlsLookStale(visionSlideUrls);
    if (embedCarouselFetchEnabled && postUrlForRefresh && needsFreshSlides) {
      const rowEmbedAgent = tryCreateInstagramEmbedProxyAgent(embedHttpProxyCfg.url);
      try {
        const fresh = await fetchInstagramCarouselUrlsFromEmbedDetailed(postUrlForRefresh, {
          maxSlides,
          timeoutMs: config.CAF_INSTAGRAM_EMBED_FETCH_TIMEOUT_MS,
          maxBytes: config.CAF_INSTAGRAM_EMBED_MAX_BYTES,
          ...(rowEmbedAgent ? { dispatcher: rowEmbedAgent } : {}),
        });
        if (fresh.http_ok && fresh.urls.length >= MIN_CAROUSEL_SLIDES_FOR_DEEP) {
          visionSlideUrls = mergeUniqueSlideUrls([], fresh.urls, maxSlides);
        }
      } finally {
        try {
          await rowEmbedAgent?.close();
        } catch {
          /* ignore */
        }
      }
    }

    if (mediaArchiveRequested && mediaSupabaseConfigured) {
      const arch = await archiveTopPerformerVisionMedia(config, {
        projectSlug,
        inputsImportId: importId,
        sourceEvidenceRowId: c.id,
        tier: "top_performer_carousel",
        role: "carousel_slide",
        urls: visionSlideUrls,
        ...(embedHttpProxyCfg.url ? { http_proxy_url: embedHttpProxyCfg.url } : {}),
      });
      for (const it of arch.items) {
        if (it.ok) mediaArchiveFilesSaved++;
        else if (it.error) mediaArchiveErrors++;
      }
      storedInspection = JSON.parse(JSON.stringify(arch)) as Record<string, unknown>;
      const archivedUrls: string[] = [];
      for (let i = 0; i < visionSlideUrls.length; i++) {
        const it = arch.items[i];
        const signed = it?.ok ? it.vision_fetch_url || it.public_url : null;
        if (!signed) {
          const src = visionSlideUrls[i] ?? "";
          const err = it?.error ?? "unknown";
          const postUrl = instagramPostPermalinkFromPayload(c.payload);
          throw new Error(
            `Could not archive carousel slide ${i + 1} to Supabase (${err}). ` +
              (carouselSlideUrlsLookStale([src])
                ? "Stored Instagram CDN URL looks expired — carousel pass should refresh from embed when post_url is present. "
                : "") +
              (postUrl ? `Post: ${postUrl}. ` : "") +
              VISION_CDN_PROXY_HINT
          );
        }
        archivedUrls.push(signed);
      }
      visionSlideUrls = archivedUrls;
    }

    const slideRelay = await relayImageUrlsForOpenAiVision(config, visionSlideUrls, {
      http_proxy_url: embedHttpProxyCfg.url,
    });
    visionSlideUrls = slideRelay.urls;
    if (slideRelay.errors.length > 0) {
      mediaArchiveErrors += slideRelay.errors.length;
    }
    assertVisionImageUrlsSafeForRemoteFetch(visionSlideUrls);

    const visionOut = await runCarouselDeckVisionAnalysis({
      config,
      profileModel: model,
      systemPrompt: system,
      userText,
      visionSlideUrls,
      deckSlideCount: c.slide_urls.length,
      finalizeImageUrl: finalizeHttpsImageUrlForOpenAiVision,
      audit: auditBase,
      auditStep: STEP,
    });

    const parsed = finalizeCarouselInsightJson(visionOut.parsed, c.slide_urls.length);
    const aesthetic: Record<string, unknown> = buildCarouselAestheticAnalysisJson(parsed);
    const mechanism = resolveCarouselMechanismFields({
      parsed,
      broad: broadMechanismByRow.get(c.id) ?? null,
      evidenceKind: c.evidence_kind,
      payload: c.payload,
      caption: c.caption,
    });

    const risks = parseRiskFlags(parsed?.risk_flags);

    if (mediaArchiveRequested && !mediaSupabaseConfigured) {
      storedInspection = {
        archived_at: new Date().toISOString(),
        tier: "top_performer_carousel",
        project_slug: projectSlug,
        inputs_import_id: importId,
        source_evidence_row_id: c.id,
        skipped_reason: "supabase_not_configured",
        items: [],
      };
    }

    await upsertEvidenceRowInsight(db, {
      project_id: project.id,
      inputs_import_id: importId,
      source_evidence_row_id: c.id,
      insights_id: makeCarouselInsightsId(importId, c.id),
      analysis_tier: "top_performer_carousel",
      pre_llm_score: c.pre_llm_score,
      llm_model: visionOut.model || model,
      why_it_worked: typeof parsed?.why_it_worked === "string" ? parsed.why_it_worked : null,
      primary_emotion: mechanism.primary_emotion,
      secondary_emotion: mechanism.secondary_emotion,
      hook_type: typeof parsed?.format_pattern === "string" ? parsed.format_pattern : null,
      custom_label_1: mechanism.custom_label_1,
      custom_label_2: mechanism.custom_label_2,
      custom_label_3: mechanism.custom_label_3,
      cta_type: typeof parsed?.cta_clarity === "string" ? parsed.cta_clarity : null,
      hashtags: mechanism.hashtags,
      caption_style: mechanism.caption_style,
      hook_text: typeof parsed?.slide_arc === "string" ? parsed.slide_arc : null,
      risk_flags_json: risks,
      aesthetic_analysis_json: aesthetic,
      raw_llm_json: parsed,
      evidence_performance_review_json: ratingSnapByRow.get(c.id) ?? null,
      ...(storedInspection !== undefined ? { stored_inspection_media_json: storedInspection } : {}),
    });
    analyzed++;
  }

  const carouselTotal = await countEvidenceRowInsightsByImportTier(db, importId, "top_performer_carousel");
  const qualifying_carousel_rows = capAndSortQualifierPreview(qualifyingCarouselScratch);
  const zeroWorkSummary = buildDeepCarouselZeroWorkSummary({
    analyzed,
    carouselDeckRows,
    poolLen: top.length,
    rescan: !!opts.rescan,
    skippedExisting: skippedExistingCarouselInsight,
    skippedPercentileSelection,
    percentileActive: percentileConfig.active,
    percentileFraction: percentileConfig.fraction,
    percentileUniverse: percentileStats.universe_count,
    carouselInsightsTotal: carouselTotal,
    embedAttempts: instagramEmbedFetchAttempts,
    displayUrlHits: instagramEmbedNetworkDisplayUrlLiteralHits,
    cdnHostHits: instagramEmbedNetworkCdnHostHits,
    mediaSignalHits: instagramEmbedNetworkMediaSignalHits,
    embedHttpProxyActive: instagramEmbedHttpProxyActive,
    embedHttpProxySource: embedHttpProxyCfg.source,
  });

  const ratingGateNote =
    percentileStats.score_basis === "pre_llm_score" && ratedRowsInImport === 0
      ? "No rating_score on this import; top-% uses pre_llm_score. Run Rate import to rank by performance metrics instead."
      : null;

  return {
    import_id: importId,
    model,
    rows_scanned: dbRows.length,
    carousel_deck_rows: carouselDeckRows,
    candidates_with_slides: top.length,
    rows_analyzed: analyzed,
    /** Same count as `skipped_instagram_few_slide_urls` (IG rows with fewer than two slide URLs after embed). */
    skipped_no_slides: skippedInstagramFewSlides,
    carousel_insights_total: carouselTotal,
    percentile_gate_active: percentileConfig.active,
    percentile_top_fraction: percentileConfig.fraction,
    percentile_scope: "top_performer_carousel",
    percentile_universe_count: percentileStats.universe_count,
    percentile_cap: percentileStats.percentile_cap,
    percentile_score_basis: percentileStats.score_basis,
    percentile_format_groups: percentileStats.format_groups,
    skipped_percentile_selection: skippedPercentileSelection,
    percentile_gate_disabled: percentileConfig.disabled,
    rating_gate_active: percentileConfig.active,
    rating_top_fraction: percentileConfig.fraction,
    rated_rows_in_import: ratedRowsInImport,
    rating_gate_cap: percentileStats.percentile_cap,
    skipped_rating_gate: skippedPercentileSelection,
    rating_gate_disabled: percentileConfig.disabled,
    broad_insights_gate_active: broadGate.active,
    broad_llm_rows_in_import: broadGate.broad_llm_row_count,
    skipped_broad_insights_gate: skippedBroadInsightsGate,
    broad_insights_gate_disabled: broadGate.disabled,
    skipped_evidence_kind_filter: skippedEvidenceKindFilter,
    instagram_post_rows: instagramPostRows,
    skipped_instagram_video_like: skippedInstagramVideoLike,
    skipped_instagram_few_slide_urls: skippedInstagramFewSlides,
    instagram_carousel_url_hint_missing_slide_urls: instagramCarouselHintMissingSlideUrls,
    instagram_embed_carousel_fetch_enabled: embedCarouselFetchEnabled,
    instagram_embed_carousel_fetch_source: embedFetch.source,
    instagram_embed_carousel_fetch_attempts: instagramEmbedFetchAttempts,
    instagram_embed_carousel_rows_resolved_via_embed: instagramEmbedRowsResolvedViaEmbed,
    instagram_embed_carousel_fetch_skipped_due_to_cap: instagramEmbedFetchSkippedCap,
    instagram_embed_carousel_fetch_cap: maxEmbedNetworkFetches,
    instagram_embed_carousel_fetch_cache_hits: instagramEmbedFetchCacheHits,
    instagram_embed_carousel_fetch_network_html_has_display_url_hits: instagramEmbedNetworkDisplayUrlLiteralHits,
    instagram_embed_carousel_fetch_network_html_has_embed_media_signal_hits: instagramEmbedNetworkMediaSignalHits,
    instagram_embed_carousel_fetch_network_html_has_cdn_host_hits: instagramEmbedNetworkCdnHostHits,
    instagram_embed_carousel_fetch_network_login_wall_likely_hits: instagramEmbedNetworkLoginWallLikelyHits,
    instagram_embed_http_proxy_active: instagramEmbedHttpProxyActive,
    instagram_embed_http_proxy_source: embedHttpProxyCfg.source,
    qualifying_carousel_rows,
    top_performer_media_archive_requested: mediaArchiveRequested,
    top_performer_media_supabase_configured: mediaSupabaseConfigured,
    top_performer_media_archive_files_saved: mediaArchiveFilesSaved,
    top_performer_media_archive_errors: mediaArchiveErrors,
    rescan: !!opts.rescan,
    skipped_existing_carousel_insight: skippedExistingCarouselInsight,
    deep_carousel_zero_work_summary: zeroWorkSummary,
    ...(ratingGateNote != null ? { rating_gate_note: ratingGateNote } : {}),
  };
}
