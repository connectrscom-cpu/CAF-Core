/**
 * Top-performer **carousel** pass: multimodal on **all slide images** (+ caption context).
 * **Instagram only** (`instagram_post`); other platforms are skipped.
 * Slide URLs come from `parseCarouselSlideUrls(payload)` (explicit list keys + top-level covers + **nested**
 * Graph/scraper JSON such as `edge_sidecar_to_children` / stringified blobs), merged with embed fetch when enabled.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { ensureProject } from "../repositories/core.js";
import {
  countEvidenceRowInsightsByImportTier,
  listEvidenceRowInsightIdsByImportTier,
  upsertEvidenceRowInsight,
} from "../repositories/inputs-evidence-insights.js";
import { getInputsEvidenceImport, listEvidenceRowsForPreLlmScoring } from "../repositories/inputs-evidence.js";
import { getInputsProcessingProfile, upsertInputsProcessingProfile } from "../repositories/inputs-processing-profile.js";
import { openaiChatMultimodal } from "./openai-chat-multimodal.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { evaluatePreLlmRow } from "./inputs-pre-llm-rank.js";
import { finalizeHttpsImageUrlForOpenAiVision, isVideoLikeEvidence } from "./inputs-image-url-for-analysis.js";
import { summarizePayloadForLlm } from "./inputs-evidence-display.js";
import {
  MIN_CAROUSEL_SLIDES_FOR_DEEP,
  instagramCarouselStructuralHintPresent,
  instagramPostPermalinkFromPayload,
  parseCarouselCaptionContext,
  parseCarouselSlideUrls,
} from "./inputs-carousel-evidence-bundle.js";
import { resolveBroadInsightsSampleGate, resolveTopPerformerRatingGate } from "./inputs-top-performer-rating-gate.js";
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

export const TOP_PERFORMER_CAROUSEL_SYSTEM_PROMPT = `You analyze a **multi-slide social carousel** (static images shown in order, left-to-right / slide 1 → N).
Return ONLY valid JSON:
{
  "slide_arc": "how the story progresses across slides (short)",
  "cover_vs_body": "how slide 1 hooks vs middle/ending slides",
  "visual_consistency": "palette, fonts, templates across slides",
  "on_screen_text_summary": "recurring text patterns / hooks on slides",
  "cta_clarity": "how clear the ask / next step is",
  "format_pattern": "educational | listicle | story | before_after | promo | mixed | unknown",
  "risk_flags": ["string"],
  "why_it_worked": "why this carousel may perform (short)"
}
Use every slide image; if order is ambiguous, assume given order. Be conservative when unreadable.`;

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
  /** Top fraction of rated rows (`rating_score`) that may receive vision; default 5%. */
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
  /**
   * When `rows_analyzed === 0`, a short human explanation (admin / logs). Omitted when work ran.
   */
  deep_carousel_zero_work_summary?: string | null;
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
  carouselInsightsTotal: number;
  embedAttempts: number;
  displayUrlHits: number;
  embedHttpProxyActive: boolean;
  embedHttpProxySource: "criteria" | "env" | "none";
}): string | null {
  if (args.analyzed > 0) return null;
  if (args.carouselDeckRows === 0) {
    let msg =
      `No Instagram evidence rows reached ≥2 slide image URLs after payload parse + embed merge ` +
      `(${args.embedAttempts} embed GET(s); ${args.displayUrlHits} response(s) contained the literal "display_url" — often 0 when Instagram serves a login wall to server IPs). ` +
      `There are still ${args.carouselInsightsTotal} top_performer_carousel insight row(s) in the DB from earlier runs; they are not proof of current slide URLs. ` +
      `Enrich ingest with per-slide CDN URLs, or improve embed access.`;
    if (args.embedAttempts > 0 && args.displayUrlHits === 0 && !args.embedHttpProxyActive) {
      msg +=
        ` For embed HTML, set Fly secret **CAF_INSTAGRAM_EMBED_HTTP_PROXY** to an HTTP CONNECT proxy URL ` +
        `(or \`criteria_json.inputs_insights.instagram_embed_http_proxy\` per project) so Core can fetch embeds off the default egress IP.`;
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
    return (
      `At least one row had ≥2 slide URLs, but none entered the vision pool: check min_pre_llm_score, broad-insights gate, and rating gate. ` +
      `(${args.carouselInsightsTotal} total carousel insight rows in DB for this import.)`
    );
  }
  return null;
}

function parseRiskFlags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
}

export async function runDeepCarouselInsightsForImport(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  importId: string,
  opts: RunDeepCarouselInsightsOptions = {}
): Promise<RunDeepCarouselInsightsResult> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for carousel insights");

  const project = await ensureProject(db, projectSlug);
  const imp = await getInputsEvidenceImport(db, project.id, importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);

  let profile = await getInputsProcessingProfile(db, project.id);
  if (!profile) {
    profile = await upsertInputsProcessingProfile(db, project.id, {});
  }
  const criteria = (profile.criteria_json ?? {}) as Record<string, unknown>;
  const model = carouselModel(profile);
  const minPre = carouselMinPreLlm(criteria, opts.min_pre_llm_score);
  const maxRows = carouselMaxRows(criteria, opts.max_rows);
  const maxSlides = clamp(opts.max_slides ?? 12, MIN_CAROUSEL_SLIDES_FOR_DEEP, 12);
  const embedFetch = resolveInstagramEmbedCarouselFetch(config, criteria);
  const embedCarouselFetchEnabled = embedFetch.enabled;

  const mediaArchiveRequested = resolveTopPerformerArchiveMedia(config, criteria);
  const mediaSupabaseConfigured = !!getSupabaseStorageClient(config);
  let mediaArchiveFilesSaved = 0;
  let mediaArchiveErrors = 0;

  const ratingGate = await resolveTopPerformerRatingGate(db, project.id, importId, criteria);
  const broadGate = await resolveBroadInsightsSampleGate(db, importId, criteria);

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
        if (baseSlides.length >= MIN_CAROUSEL_SLIDES_FOR_DEEP) continue;
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
            if (outcome.login_wall_likely) instagramEmbedNetworkLoginWallLikelyHits++;
          }
          if (embedThrottleMs > 0) {
            await new Promise((res) => setTimeout(res, embedThrottleMs));
          }
        } else {
          instagramEmbedFetchCacheHits++;
        }
        const merged = mergeUniqueSlideUrls(p.baseSlides, outcome.urls, maxSlides);
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

  type Cand = {
    id: string;
    evidence_kind: string;
    payload: Record<string, unknown>;
    pre_llm_score: number;
    slide_urls: string[];
    caption: string;
  };
  const pool: Cand[] = [];
  let skippedExistingCarouselInsight = 0;
  let skippedRatingGate = 0;
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
      usedEmbedFetch = preEmbedCount < MIN_CAROUSEL_SLIDES_FOR_DEEP;
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
    if (ev.pre_llm_score < minPre) continue;
    if (broadGate.active && !broadGate.idSet.has(r.id)) {
      skippedBroadInsightsGate++;
      continue;
    }
    if (ratingGate.active && !ratingGate.idSet.has(r.id)) {
      skippedRatingGate++;
      continue;
    }
    qualifyingCarouselScratch.push({
      row_id: r.id,
      evidence_kind: r.evidence_kind,
      pre_llm_score: ev.pre_llm_score,
      media_count: slideUrls.length,
      caption_excerpt: excerptForTopPerformerPreview(payload),
      post_url: postUrlForTopPerformerPreview(r.evidence_kind, payload),
      already_has_tier_insight: existing.has(r.id),
    });
    if (existing.has(r.id)) {
      skippedExistingCarouselInsight++;
      continue;
    }
    pool.push({
      id: r.id,
      evidence_kind: r.evidence_kind,
      payload,
      pre_llm_score: ev.pre_llm_score,
      slide_urls: slideUrls,
      caption: parseCarouselCaptionContext(payload),
    });
  }

  pool.sort((a, b) => b.pre_llm_score - a.pre_llm_score);
  const top = pool.slice(0, maxRows);

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

    const user_content: Array<
      { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
    > = [{ type: "text", text: userText }];
    for (let i = 0; i < c.slide_urls.length; i++) {
      user_content.push({
        type: "image_url",
        image_url: { url: finalizeHttpsImageUrlForOpenAiVision(c.slide_urls[i]), detail: "low" },
      });
    }

    const out = await openaiChatMultimodal(
      apiKey,
      {
        model,
        system_prompt: system,
        user_content,
        max_tokens: 4096,
        response_format: "json_object",
      },
      { ...auditBase, step: STEP }
    );

    const parsed = parseJsonObjectFromLlmText(out.content) as Record<string, unknown> | null;
    const aesthetic: Record<string, unknown> = parsed
      ? {
          slide_arc: parsed.slide_arc,
          cover_vs_body: parsed.cover_vs_body,
          visual_consistency: parsed.visual_consistency,
          on_screen_text_summary: parsed.on_screen_text_summary,
          cta_clarity: parsed.cta_clarity,
          format_pattern: parsed.format_pattern,
        }
      : {};

    const risks = parseRiskFlags(parsed?.risk_flags);

    let storedInspection: Record<string, unknown> | undefined;
    if (mediaArchiveRequested) {
      if (mediaSupabaseConfigured) {
        const arch = await archiveTopPerformerVisionMedia(config, {
          projectSlug,
          inputsImportId: importId,
          sourceEvidenceRowId: c.id,
          tier: "top_performer_carousel",
          role: "carousel_slide",
          urls: c.slide_urls,
          ...(embedHttpProxyCfg.url ? { http_proxy_url: embedHttpProxyCfg.url } : {}),
        });
        for (const it of arch.items) {
          if (it.ok) mediaArchiveFilesSaved++;
          else if (it.error) mediaArchiveErrors++;
        }
        storedInspection = JSON.parse(JSON.stringify(arch)) as Record<string, unknown>;
      } else {
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
    }

    await upsertEvidenceRowInsight(db, {
      project_id: project.id,
      inputs_import_id: importId,
      source_evidence_row_id: c.id,
      insights_id: makeCarouselInsightsId(importId, c.id),
      analysis_tier: "top_performer_carousel",
      pre_llm_score: c.pre_llm_score,
      llm_model: out.model || model,
      why_it_worked: typeof parsed?.why_it_worked === "string" ? parsed.why_it_worked : null,
      primary_emotion: null,
      secondary_emotion: null,
      hook_type: typeof parsed?.format_pattern === "string" ? parsed.format_pattern : null,
      custom_label_1: null,
      custom_label_2: null,
      custom_label_3: null,
      cta_type: typeof parsed?.cta_clarity === "string" ? parsed.cta_clarity : null,
      hashtags: null,
      caption_style: null,
      hook_text: typeof parsed?.slide_arc === "string" ? parsed.slide_arc : null,
      risk_flags_json: risks,
      aesthetic_analysis_json: aesthetic,
      raw_llm_json: parsed,
      ...(storedInspection !== undefined ? { stored_inspection_media_json: storedInspection } : {}),
    });
    analyzed++;
  }

  const carouselTotal = await countEvidenceRowInsightsByImportTier(db, importId, "top_performer_carousel");
  const qualifying_carousel_rows = capAndSortQualifierPreview(qualifyingCarouselScratch);
  const zeroWorkSummary = buildDeepCarouselZeroWorkSummary({
    analyzed,
    carouselDeckRows,
    poolLen: pool.length,
    rescan: !!opts.rescan,
    skippedExisting: skippedExistingCarouselInsight,
    carouselInsightsTotal: carouselTotal,
    embedAttempts: instagramEmbedFetchAttempts,
    displayUrlHits: instagramEmbedNetworkDisplayUrlLiteralHits,
    embedHttpProxyActive: instagramEmbedHttpProxyActive,
    embedHttpProxySource: embedHttpProxyCfg.source,
  });

  return {
    import_id: importId,
    model,
    rows_scanned: dbRows.length,
    carousel_deck_rows: carouselDeckRows,
    candidates_with_slides: pool.length,
    rows_analyzed: analyzed,
    /** Same count as `skipped_instagram_few_slide_urls` (IG rows with fewer than two slide URLs after embed). */
    skipped_no_slides: skippedInstagramFewSlides,
    carousel_insights_total: carouselTotal,
    rating_gate_active: ratingGate.active,
    rating_top_fraction: ratingGate.fraction,
    rated_rows_in_import: ratingGate.rated_row_count,
    rating_gate_cap: ratingGate.gate_row_cap,
    skipped_rating_gate: skippedRatingGate,
    rating_gate_disabled: ratingGate.disabled,
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
  };
}
