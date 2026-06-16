/**
 * Second-stage LLM: turn row-level insights (broad + optional top-performer enrichments)
 * into a smaller set of actionable content ideas for `signal_packs.ideas_json`.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type {
  BroadInsightWithRating,
  EvidenceRowInsightEnrichedRow,
} from "../repositories/inputs-evidence-insights.js";
import {
  listBroadInsightsWithEvidenceRating,
  listTopPerformerInsightsEnriched,
} from "../repositories/inputs-evidence-insights.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { openaiChat } from "./openai-chat.js";
import { platformFromEvidenceKind } from "./signal-pack-compile-ideas.js";
import type { SignalPackIdeaV2 } from "../domain/signal-pack-ideas-v2.js";
import { ideaFormatSchema, signalPackIdeaSchema } from "../domain/signal-pack-ideas-v2.js";
import {
  IDEA_GENERATION_BUCKET_DEFS,
  type IdeaGenerationBucketDef,
  type IdeaGenerationQuotas,
  buildIdeaGenerationBrandContextBlock,
  defaultIdeaGenerationQuotas,
  resolveBucketCounts,
  totalBucketCount,
} from "../domain/idea-structure.js";
import { getBrandConstraints, getProductProfile, getStrategyDefaults } from "../repositories/project-config.js";
import { pickBrandSliceForSnapshot, pickStrategySliceForSnapshot } from "./run-context-snapshot.js";
import { z } from "zod";

export const STEP_IDEAS_FROM_INSIGHTS = "inputs_ideas_from_insights_llm";

export const IDEAS_FROM_INSIGHTS_PROMPT_GROUP = "ideas_from_insights";

export const IDEAS_FROM_INSIGHTS_IDEA_FIELD_CONTRACT = `Each idea object MUST include:
- title: string (<=200)
- three_liner: string (<=1200)
- thesis: string (<=800)
- who_for: string (<=200)
- format: "carousel" | "video" | "post" | "thread"
- platform: string (e.g. Instagram, TikTok, Reddit, Facebook, Multi)
- content_lens: "niche" | "product"
- execution_profile: string (see bucket/group constraints)
- carousel_style: "text_heavy" | "visual_first" | "mixed" (when format=carousel)
- video_style: "script_avatar" | "prompt_avatar" | "no_avatar" (when format=video)
- product_angle: problem|feature|comparison|usecase|social_proof|offer (required when content_lens=product and format=video)
- why_now: string (<=800)
- key_points: string[] (3–10 items)
- novelty_angle: string (<=800)
- cta: string (<=200)
- cta_class: engage|educate|product_awareness|soft_convert
- grounding_insight_ids: string[] (min 1; MUST be from context rows)
- expected_outcome: string (<=400)
- risk_flags: string[] (optional)
- status: "proposed"
- confidence_score: number 0–1 (optional)`;

/** Shared user message for every ideas-from-insights LLM call (grouped + fallback). */
export const IDEAS_FROM_INSIGHTS_USER_PROMPT_TEMPLATE = `Project notes: {{EXTRA_INSTRUCTIONS}}

{{BRAND_CONTEXT_BLOCK}}

Insight context ({{CONTEXT_ROW_COUNT}} rows; {{TOP_PERFORMER_IN_CONTEXT}} include top-performer enrichment):
{{INSIGHT_CONTEXT_JSON}}`;

export const IDEAS_FROM_INSIGHTS_OVERVIEW_SYSTEM_PROMPT = `You are generating IDEAS for an automated content pipeline.

IDEAS vs MIMIC:
- IDEAS = new, original concepts grounded in insights (this step).
- MIMIC = replicate proven top performers (separate pipeline — do not copy competitor posts here).

Runtime path (cost-optimized):
- One OpenAI call per content_lens + format group (e.g. niche carousel, product video).
- Each group system prompt specifies execution_profile sub-quotas inside that call.
- If a grouped call fails validation, Core falls back to per-bucket prompts (see bucket entries in Prompt Labs).

Insight context shape (user message):
- "broad": mechanism fields (why_it_worked, emotions, hook_type, hook_text, cta_type, caption_style)
- optional "top_performer_styles": hook/emotion/why + nemotron_analysis (no Document AI OCR or mimic blueprints)
- optional "evidence_performance_review" inside top_performer_styles
- "grounding_insight_ids": allowed insight IDs — use ONLY these

${IDEAS_FROM_INSIGHTS_IDEA_FIELD_CONTRACT}

Global rules:
- Every idea MUST include grounding_insight_ids (no orphan ideas).
- Be specific — no generic "post about the niche" ideas.
- Never propose app downloads, quizzes, giveaways, or unsupported CTAs.
- Use risk_flags for medical_claim, financial_claim, adult_content, policy_risk, brand_risk, unsupported_cta.`;

/** @deprecated Legacy single-call template — use grouped prompts in Prompt Labs. */
export const IDEAS_FROM_INSIGHTS_SYSTEM_PROMPT_TEMPLATE = IDEAS_FROM_INSIGHTS_OVERVIEW_SYSTEM_PROMPT;

export type IdeaGenerationBucketKey = `${"niche" | "product"}|${"carousel" | "video" | "post" | "thread"}`;

export function bucketKeyOf(bucket: Pick<IdeaGenerationBucketDef, "content_lens" | "format">): IdeaGenerationBucketKey {
  return `${bucket.content_lens}|${bucket.format}` as IdeaGenerationBucketKey;
}

export function ideaGroupTitle(key: IdeaGenerationBucketKey): string {
  const [lens, format] = key.split("|") as ["niche" | "product", string];
  const lensLabel = lens === "product" ? "Product" : "Niche";
  const fmtLabel = format.charAt(0).toUpperCase() + format.slice(1);
  return `${lensLabel} · ${fmtLabel}`;
}

export function bucketConstraintLines(bucket: IdeaGenerationBucketDef & { count: number }): string {
  const lines = [
    `Generate EXACTLY ${bucket.count} ideas.`,
    `format MUST be "${bucket.format}"`,
    `content_lens MUST be "${bucket.content_lens}"`,
    `execution_profile MUST be "${bucket.execution_profile}"`,
  ];
  if (bucket.format === "carousel") lines.push(`carousel_style MUST be "${bucket.execution_profile}"`);
  if (bucket.format === "video") lines.push(`video_style MUST be "${bucket.execution_profile}"`);
  if (bucket.product_angle) lines.push(`product_angle MUST be "${bucket.product_angle}"`);
  else if (bucket.content_lens === "product" && bucket.format === "video") {
    lines.push(`product_angle MUST be one of: problem, feature, comparison, usecase, social_proof, offer`);
  }
  if (bucket.content_lens === "product") {
    lines.push("Ground product ideas in the PRODUCT PROFILE — real benefits, audience, and positioning only.");
  } else {
    lines.push("Niche/editorial ideas — do not hard-sell the product.");
  }
  return lines.join("\n");
}

const IDEAS_SYSTEM_PREAMBLE = `You are generating IDEAS for a content pipeline.
IDEAS vs MIMIC: propose NEW original concepts — not replicas of top performers.
Return ONLY valid JSON: {"ideas":[...]} — no markdown.`;

export function buildIdeasBucketSystemPrompt(bucket: IdeaGenerationBucketDef & { count: number }): string {
  return `${IDEAS_SYSTEM_PREAMBLE}

${bucketConstraintLines(bucket)}

Every idea needs title, three_liner, thesis, who_for, platform, content_lens, execution_profile, why_now, key_points, novelty_angle, cta, cta_class, grounding_insight_ids, expected_outcome. Never propose app downloads, quizzes, or unsupported CTAs.`;
}

export const CAROUSEL_VISUAL_FIRST_IDEAS_ADDENDUM = `Carousel visual-first ideas (separate lane from manual mimic picks):
- When insight context includes top_performer_carousel rows, each visual_first idea MUST ground to at least one top_performer_carousel insights_id.
- Propose NEW original concepts inspired by deck mechanics (slide arc, visual consistency, hook structure) — do NOT copy competitor slide text verbatim.
- Set carousel_style to visual_first (or mixed when appropriate).
- Downstream execution uses FLOW_VISUAL_FIRST_CAROUSEL (not FLOW_TOP_PERFORMER_MIMIC_CAROUSEL).`;

export function buildIdeasGroupSystemPrompt(group: {
  total: number;
  format: string;
  content_lens: string;
  buckets: Array<{ execution_profile: string; count: number; label?: string; product_angle?: string }>;
}): string {
  const profileLines = group.buckets
    .map((b) => {
      const angle = b.product_angle ? `, product_angle=${b.product_angle}` : "";
      const label = b.label ? ` (${b.label})` : "";
      return `- execution_profile="${b.execution_profile}"${angle} → ${b.count} ideas${label}`;
    })
    .join("\n");

  const hasVisualFirstCarousel =
    group.format === "carousel" &&
    group.buckets.some((b) => b.execution_profile === "visual_first" || b.execution_profile === "mixed");

  const visualFirstBlock = hasVisualFirstCarousel ? `\n\n${CAROUSEL_VISUAL_FIRST_IDEAS_ADDENDUM}` : "";

  return `${IDEAS_SYSTEM_PREAMBLE}

Generate EXACTLY ${group.total} ideas.
format MUST be "${group.format}"
content_lens MUST be "${group.content_lens}"

Execution profiles allowed in this batch:
${profileLines}

Rules:
- Respect the per-execution_profile counts above.
- Every idea must include execution_profile and the required fields.
- If content_lens=product and format=video, include product_angle (problem|feature|comparison|usecase|social_proof|offer).
- Never propose app downloads, quizzes, giveaways, or unsupported CTAs.${visualFirstBlock}`;
}

export function groupIdeaGenerationBuckets(
  buckets: Array<IdeaGenerationBucketDef & { count: number }>
): Array<{
  key: IdeaGenerationBucketKey;
  content_lens: "niche" | "product";
  format: "carousel" | "video" | "post" | "thread";
  total: number;
  buckets: Array<IdeaGenerationBucketDef & { count: number }>;
}> {
  const by = new Map<
    IdeaGenerationBucketKey,
    {
      key: IdeaGenerationBucketKey;
      content_lens: "niche" | "product";
      format: "carousel" | "video" | "post" | "thread";
      total: number;
      buckets: Array<IdeaGenerationBucketDef & { count: number }>;
    }
  >();

  for (const b of buckets) {
    const key = bucketKeyOf(b);
    const entry =
      by.get(key) ??
      ({
        key,
        content_lens: b.content_lens,
        format: b.format,
        total: 0,
        buckets: [],
      } as {
        key: IdeaGenerationBucketKey;
        content_lens: "niche" | "product";
        format: "carousel" | "video" | "post" | "thread";
        total: number;
        buckets: Array<IdeaGenerationBucketDef & { count: number }>;
      });
    entry.total += b.count;
    entry.buckets.push(b);
    by.set(key, entry);
  }

  return [...by.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export type IdeasFromInsightsPromptLabsEntry = {
  prompt_name: string;
  flow_type: string;
  prompt_role: string;
  active: boolean;
  labs_readonly: boolean;
  labs_short_description: string;
  labs_flow_description: string;
  system_prompt: string;
  user_prompt_template: string;
  labs_prompt_group: typeof IDEAS_FROM_INSIGHTS_PROMPT_GROUP;
  labs_prompt_group_label: string;
  labs_prompt_subgroup: "overview" | "group" | "bucket";
  labs_prompt_group_key?: IdeaGenerationBucketKey;
  labs_prompt_group_title?: string;
};

function bucketPromptName(bucket: IdeaGenerationBucketDef): string {
  const slug = bucket.id.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `IDEAS__Bucket__${slug}_v1`;
}

function groupPromptName(key: IdeaGenerationBucketKey): string {
  const slug = key.replace("|", "_");
  return `IDEAS__Group__${slug}_v1`;
}

/** Prompt Labs registry: overview + one grouped call per lens|format + per-bucket fallbacks. */
export function buildIdeasFromInsightsPromptLabsEntries(): IdeasFromInsightsPromptLabsEntry[] {
  const exampleQuotas = defaultIdeaGenerationQuotas(24, true);
  const examplePlan = resolveBucketCounts(exampleQuotas);
  const grouped = groupIdeaGenerationBuckets(examplePlan);
  const bucketsByKey = new Map<IdeaGenerationBucketKey, Array<IdeaGenerationBucketDef & { count: number }>>();
  for (const g of grouped) bucketsByKey.set(g.key, g.buckets);

  const entries: IdeasFromInsightsPromptLabsEntry[] = [
    {
      prompt_name: "IDEAS__From_Insights__Overview_v1",
      flow_type: "PROCESSING_IDEAS",
      prompt_role: "processing",
      active: true,
      labs_readonly: true,
      labs_short_description:
        "Shared field contract, runtime call strategy, and user-message template for Build ideas (insights → ideas_json).",
      labs_flow_description: "Processing: Insights → curated ideas (ideas_json).",
      system_prompt: IDEAS_FROM_INSIGHTS_OVERVIEW_SYSTEM_PROMPT,
      user_prompt_template: IDEAS_FROM_INSIGHTS_USER_PROMPT_TEMPLATE,
      labs_prompt_group: IDEAS_FROM_INSIGHTS_PROMPT_GROUP,
      labs_prompt_group_label: "Ideas from insights",
      labs_prompt_subgroup: "overview",
    },
  ];

  for (const g of grouped) {
    entries.push({
      prompt_name: groupPromptName(g.key),
      flow_type: "PROCESSING_IDEAS",
      prompt_role: "processing",
      active: true,
      labs_readonly: true,
      labs_short_description: `Primary runtime call — merged ${g.buckets.length} bucket(s) into one LLM request (example quotas: ${g.total} ideas).`,
      labs_flow_description: `Processing: Build ideas — grouped ${g.content_lens} ${g.format}.`,
      system_prompt: buildIdeasGroupSystemPrompt({
        total: g.total,
        format: g.format,
        content_lens: g.content_lens,
        buckets: g.buckets.map((b) => ({
          execution_profile: b.execution_profile,
          count: b.count,
          label: b.label,
          product_angle: b.product_angle,
        })),
      }),
      user_prompt_template: IDEAS_FROM_INSIGHTS_USER_PROMPT_TEMPLATE,
      labs_prompt_group: IDEAS_FROM_INSIGHTS_PROMPT_GROUP,
      labs_prompt_group_label: "Ideas from insights",
      labs_prompt_subgroup: "group",
      labs_prompt_group_key: g.key,
      labs_prompt_group_title: ideaGroupTitle(g.key),
    });
  }

  for (const def of IDEA_GENERATION_BUCKET_DEFS) {
    if (def.requires_product_angles && !exampleQuotas.product_angles_enabled) continue;
    if (def.id === "product_video" && exampleQuotas.product_angles_enabled) continue;
    const key = bucketKeyOf(def);
    const siblings = bucketsByKey.get(key) ?? [];
    const exampleCount = Math.max(1, exampleQuotas.buckets[def.id] ?? 1);
    entries.push({
      prompt_name: bucketPromptName(def),
      flow_type: "PROCESSING_IDEAS",
      prompt_role: "processing",
      active: true,
      labs_readonly: true,
      labs_short_description: `Fallback per-bucket prompt when grouped ${ideaGroupTitle(key)} call fails (${def.label}).`,
      labs_flow_description: `Processing: Build ideas — fallback bucket ${def.id}.`,
      system_prompt: buildIdeasBucketSystemPrompt({ ...def, count: exampleCount }),
      user_prompt_template: IDEAS_FROM_INSIGHTS_USER_PROMPT_TEMPLATE,
      labs_prompt_group: IDEAS_FROM_INSIGHTS_PROMPT_GROUP,
      labs_prompt_group_label: "Ideas from insights",
      labs_prompt_subgroup: "bucket",
      labs_prompt_group_key: key,
      labs_prompt_group_title: def.label,
    });
  }

  return entries;
}

const TP_TIER_RANK: Record<string, number> = {
  top_performer_deep: 1,
  top_performer_carousel: 2,
  top_performer_video: 3,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function ratingNum(s: string | null | undefined): number {
  const n = parseFloat(String(s ?? ""));
  return Number.isNaN(n) ? 0 : n;
}

function normFormat(fmt: unknown): "carousel" | "video" | "post" | "thread" | "other" {
  const f = String(fmt ?? "")
    .toLowerCase()
    .trim();
  if (f === "carousel") return "carousel";
  if (f === "video") return "video";
  if (f === "post") return "post";
  if (f === "thread") return "thread";
  return "other";
}

function formatQuotas(target: number): { carousel: number; video: number; post: number; thread: number } {
  const n = clamp(target, 1, 200);
  let carousel = Math.floor(n * 0.4);
  let video = Math.floor(n * 0.3);
  let post = Math.floor(n * 0.1);
  let thread = Math.floor(n * 0.1);
  // allocate remainder deterministically: carousel → video → post → thread
  let used = carousel + video + post + thread;
  const order: Array<keyof ReturnType<typeof formatQuotas>> = ["carousel", "video", "post", "thread"];
  let idx = 0;
  while (used < n) {
    const k = order[idx % order.length]!;
    if (k === "carousel") carousel++;
    else if (k === "video") video++;
    else if (k === "post") post++;
    else thread++;
    used++;
    idx++;
  }
  // if rounding overshoots (shouldn't), trim from thread → post → video → carousel
  while (used > n) {
    if (thread > 0) thread--;
    else if (post > 0) post--;
    else if (video > 0) video--;
    else if (carousel > 1) carousel--;
    used--;
  }
  // Ensure we don't end up with zero buckets for reasonable N (avoid pathological rounding at small N).
  if (n >= 10) {
    if (post === 0) post = 1;
    if (thread === 0) thread = 1;
    used = carousel + video + post + thread;
    while (used > n && carousel > 1) {
      carousel--;
      used--;
    }
    while (used > n && video > 1) {
      video--;
      used--;
    }
  }
  return { carousel, video, post, thread };
}

function meetsQuota(ideas: Array<{ format: unknown }>, q: { carousel: number; video: number; post: number; thread: number }): boolean {
  const c = { carousel: 0, video: 0, post: 0, thread: 0, other: 0 };
  for (const i of ideas) c[normFormat(i.format)]++;
  return c.carousel >= q.carousel && c.video >= q.video && c.post >= q.post && c.thread >= q.thread;
}

function quotaCounts(ideas: Array<{ format: unknown }>): { carousel: number; video: number; post: number; thread: number; other: number } {
  const c = { carousel: 0, video: 0, post: 0, thread: 0, other: 0 };
  for (const i of ideas) c[normFormat(i.format)]++;
  return c;
}

function pickWithQuota<T extends { format: unknown; confidence_score?: number }>(
  ideas: T[],
  q: { carousel: number; video: number; post: number; thread: number }
): T[] {
  const by: Record<"carousel" | "video" | "post" | "thread" | "other", T[]> = {
    carousel: [],
    video: [],
    post: [],
    thread: [],
    other: [],
  };
  for (const it of ideas) by[normFormat(it.format)].push(it);
  const byConf = (a: T, b: T) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
  for (const k of Object.keys(by) as Array<keyof typeof by>) by[k].sort(byConf);

  const out: T[] = [];
  out.push(...by.carousel.slice(0, q.carousel));
  out.push(...by.video.slice(0, q.video));
  out.push(...by.post.slice(0, q.post));
  out.push(...by.thread.slice(0, q.thread));

  // Fill any leftover slots (if LLM over-produced in some buckets) by best remaining confidence across all.
  const need = Math.max(0, (q.carousel + q.video + q.post + q.thread) - out.length);
  if (need > 0) {
    const used = new Set(out);
    const rest = ([] as T[]).concat(by.carousel, by.video, by.post, by.thread, by.other).filter((x) => !used.has(x));
    rest.sort(byConf);
    out.push(...rest.slice(0, need));
  }
  return out;
}

function dedupeIdeas<T extends { title: string; thesis: string; key_points: string[] }>(ideas: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const it of ideas) {
    const key = `${String(it.title ?? "").trim().toLowerCase()}::${String(it.thesis ?? "")
      .trim()
      .toLowerCase()}::${(Array.isArray(it.key_points) ? it.key_points : []).join("|").toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** ~60k tokens of insight JSON leaves headroom for system prompt + model output on 128k models. */
export const IDEAS_LLM_MAX_CONTEXT_JSON_CHARS = 240_000;
export const IDEAS_LLM_MIN_CONTEXT_ROWS = 20;
const IDEAS_LLM_MAX_STRING_FIELD_CHARS = 800;

export type IdeasLlmInsightContextRow = {
  source_evidence_row_id: string;
  evidence_kind: string;
  evidence_rating: number | null;
  grounding_insight_ids: string[];
  broad: Record<string, unknown> | null;
  top_performer_styles: Record<string, unknown> | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function stringCap(v: unknown, maxLen: number): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
}

function trimDeepStrings(v: unknown, maxLen: number, depth = 0): unknown {
  if (depth > 10) return v;
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

/** Non-Nemotron blobs merged into aesthetic JSON after the VL pass — omit from idea synthesis. */
const NEMOTRON_AESTHETIC_DROP_KEYS = new Set([
  "document_ai_deck_v1",
  "deck_visual_system",
  "deck_composition_system",
  "replication_blueprint",
  "mimic_evaluation",
  "_slide_coverage",
  "_inference_limits",
  "video_visual_system",
  "video_composition_system",
  "insight_quality",
]);

function parseRiskFlags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 12);
}

function compactNemotronSlideForIdeas(slide: unknown): Record<string, unknown> | null {
  const s = asRecord(slide);
  if (!s) return null;
  const out: Record<string, unknown> = {};
  if (s.slide_index != null) out.slide_index = s.slide_index;
  const purpose = stringCap(s.slide_purpose, 40);
  if (purpose) out.slide_purpose = purpose;
  const transcript = stringCap(s.on_screen_text_transcript ?? s.on_screen_text, 280);
  if (transcript) out.on_screen_text = transcript;
  const vis = stringCap(s.visual_description, 280);
  if (vis) out.visual_description = vis;
  const layout = stringCap(s.layout_template, 120);
  if (layout) out.layout_template = layout;
  return Object.keys(out).length > 0 ? out : null;
}

function compactNemotronFrameForIdeas(frame: unknown): Record<string, unknown> | null {
  const f = asRecord(frame);
  if (!f) return null;
  const out: Record<string, unknown> = {};
  if (f.frame_index != null) out.frame_index = f.frame_index;
  const purpose = stringCap(f.frame_purpose ?? f.slide_purpose, 40);
  if (purpose) out.frame_purpose = purpose;
  const vis = stringCap(f.visual_description, 280);
  if (vis) out.visual_description = vis;
  const spoken = stringCap(f.spoken_text ?? f.on_screen_text, 280);
  if (spoken) out.spoken_text = spoken;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Nemotron VL analysis only — fields useful for content ideation.
 * Strips Document AI OCR, mimic evaluation, and render/replication blueprints.
 */
export function extractNemotronAnalysisForIdeasLlm(
  aes: Record<string, unknown>,
  analysisTier?: string
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const tier = String(analysisTier ?? "").trim();

  for (const k of [
    "format_pattern",
    "slide_arc",
    "cover_vs_body",
    "visual_consistency",
    "on_screen_text_summary",
    "cta_clarity",
    "deck_as_whole_summary",
    "video_arc",
    "opening_vs_body",
    "hook_visual",
    "message_clarity",
    "pacing_notes",
    "spoken_hook",
    "video_as_whole_summary",
    "style_summary",
    "primary_emotion",
    "secondary_emotion",
    "caption_style",
  ] as const) {
    if (NEMOTRON_AESTHETIC_DROP_KEYS.has(k)) continue;
    const s = stringCap(aes[k], tier === "top_performer_video" ? 600 : 500);
    if (s) out[k] = s;
  }

  const whisper = stringCap(aes.spoken_transcript_whisper, 800);
  if (whisper) out.spoken_transcript_whisper = whisper;

  for (const k of ["palette", "layout", "on_screen_text"] as const) {
    const v = aes[k];
    if (typeof v === "string") {
      const s = stringCap(v, 400);
      if (s) out[k] = s;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = trimDeepStrings(v, 200);
    }
  }

  const typo = asRecord(aes.typography);
  if (typo) {
    const slim: Record<string, unknown> = {};
    for (const tk of ["headline_guess", "body_guess", "hierarchy", "relative_scale"] as const) {
      const s = stringCap(typo[tk], 120);
      if (s) slim[tk] = s;
    }
    if (Object.keys(slim).length > 0) out.typography = slim;
  }

  const risks = parseRiskFlags(aes.risk_flags);
  if (risks.length > 0) out.risk_flags = risks;

  const slidesRaw = Array.isArray(aes.slides) ? aes.slides : [];
  if (slidesRaw.length > 0) {
    const slides = slidesRaw
      .slice(0, 16)
      .map(compactNemotronSlideForIdeas)
      .filter((x): x is Record<string, unknown> => x != null);
    if (slides.length > 0) out.slides = slides;
  }

  const framesRaw = Array.isArray(aes.frames) ? aes.frames : [];
  if (framesRaw.length > 0) {
    const frames = framesRaw
      .slice(0, 12)
      .map(compactNemotronFrameForIdeas)
      .filter((x): x is Record<string, unknown> => x != null);
    if (frames.length > 0) out.frames = frames;
  }

  // Belt-and-suspenders: never leak Document AI or mimic keys if nested oddly.
  for (const drop of NEMOTRON_AESTHETIC_DROP_KEYS) {
    delete out[drop];
  }
  delete out.document_ai_deck_v1;

  return out;
}

export function compactEvidencePerformanceReviewForIdeasLlm(
  perf: unknown
): Record<string, unknown> | null {
  const rec = asRecord(perf);
  if (!rec) return null;
  const scoreRaw = rec.rating_score;
  const score = typeof scoreRaw === "number" ? scoreRaw : parseFloat(String(scoreRaw ?? ""));
  if (Number.isNaN(score)) return null;
  const components = asRecord(rec.rating_components_json) ?? {};
  const slimComponents: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(components).slice(0, 12)) {
    slimComponents[k] = typeof v === "number" ? v : stringCap(v, 120);
  }
  return {
    rating_score: score,
    rating_components_json: slimComponents,
    rating_rationale: stringCap(rec.rating_rationale, 400),
  };
}

export function compactTopPerformerStylesForIdeasLlm(
  tops: EvidenceRowInsightEnrichedRow[]
): Record<string, unknown> | null {
  if (!tops.length) return null;
  let best = tops[0]!;
  for (const t of tops) {
    const tr = TP_TIER_RANK[t.analysis_tier] ?? 0;
    const br = TP_TIER_RANK[best.analysis_tier] ?? 0;
    if (tr >= br) best = t;
  }
  let perf = best.evidence_performance_review_json;
  if (perf == null) {
    for (const t of tops) {
      if (t.evidence_performance_review_json != null) {
        perf = t.evidence_performance_review_json;
        break;
      }
    }
  }
  const aes = asRecord(best.aesthetic_analysis_json);
  const nemotronAnalysis = aes ? extractNemotronAnalysisForIdeasLlm(aes, best.analysis_tier) : null;
  const rowRisks = parseRiskFlags(best.risk_flags_json);
  return {
    insights_id: best.insights_id,
    analysis_tier: best.analysis_tier,
    why_it_worked: stringCap(best.why_it_worked, 600),
    hook_type: stringCap(best.hook_type, 80),
    hook_text: stringCap(best.hook_text, 400),
    primary_emotion: stringCap(best.primary_emotion, 80),
    secondary_emotion: stringCap(best.secondary_emotion, 80),
    cta_type: stringCap(best.cta_type, 80),
    caption_style: stringCap(best.caption_style, 200),
    hashtags: stringCap(best.hashtags, 300),
    custom_label_1: stringCap(best.custom_label_1, 120),
    custom_label_2: stringCap(best.custom_label_2, 120),
    custom_label_3: stringCap(best.custom_label_3, 120),
    ...(rowRisks.length > 0 ? { risk_flags: rowRisks } : {}),
    ...(nemotronAnalysis && Object.keys(nemotronAnalysis).length > 0
      ? { nemotron_analysis: nemotronAnalysis }
      : {}),
    evidence_performance_review: compactEvidencePerformanceReviewForIdeasLlm(perf),
  };
}

/**
 * Shrink insight context to fit model limits: trim long strings, then drop lowest-priority rows
 * (context is already ordered: top-performer first, then highest-rated broad rows).
 */
export function budgetInsightContextForIdeasLlm(
  context: IdeasLlmInsightContextRow[],
  opts?: { maxJsonChars?: number; minRows?: number; maxStringFieldChars?: number }
): IdeasLlmInsightContextRow[] {
  const maxJsonChars = opts?.maxJsonChars ?? IDEAS_LLM_MAX_CONTEXT_JSON_CHARS;
  const minRows = Math.max(1, opts?.minRows ?? IDEAS_LLM_MIN_CONTEXT_ROWS);
  const maxStringFieldChars = opts?.maxStringFieldChars ?? IDEAS_LLM_MAX_STRING_FIELD_CHARS;

  let rows = trimDeepStrings(context, maxStringFieldChars) as IdeasLlmInsightContextRow[];
  let json = JSON.stringify(rows);
  while (json.length > maxJsonChars && rows.length > minRows) {
    rows = rows.slice(0, rows.length - 1);
    json = JSON.stringify(rows);
  }
  return rows;
}

function compactBroad(b: BroadInsightWithRating): Record<string, unknown> {
  return {
    why_it_worked: stringCap(b.why_it_worked, 600),
    hook_text: stringCap(b.hook_text, 400),
    hook_type: stringCap(b.hook_type, 80),
    primary_emotion: stringCap(b.primary_emotion, 80),
    secondary_emotion: stringCap(b.secondary_emotion, 80),
    cta_type: stringCap(b.cta_type, 80),
    caption_style: stringCap(b.caption_style, 200),
    custom_label_1: stringCap(b.custom_label_1, 120),
    custom_label_2: stringCap(b.custom_label_2, 120),
    custom_label_3: stringCap(b.custom_label_3, 120),
    pre_llm_score: b.pre_llm_score,
  };
}

export interface IdeasFromInsightsLlmOpts {
  importId: string;
  packRunId: string;
  targetIdeaCount: number;
  ideaQuotas?: IdeaGenerationQuotas;
  contextInsightCap: number;
  minTopPerformerInContext: number;
  model: string;
  extraInstructions: string;
}

export interface IdeasFromInsightsLlmResult {
  ideas: SignalPackIdeaV2[];
  context_insights_used: number;
  top_performer_rows_in_context: number;
}

/**
 * Pick broad rows + attach merged top-performer fields; prioritize rated top-performer evidence
 * then fill with highest-rated broad-only rows.
 */
export function selectInsightContextForIdeasLlm(
  broad: BroadInsightWithRating[],
  topRows: EvidenceRowInsightEnrichedRow[],
  contextCap: number,
  minTopInContext: number,
  opts?: { preferCarouselTier?: boolean }
): Array<{
  source_evidence_row_id: string;
  evidence_kind: string;
  evidence_rating: number | null;
  grounding_insight_ids: string[];
  broad: Record<string, unknown> | null;
  top_performer_styles: Record<string, unknown> | null;
}> {
  const cap = clamp(contextCap, 20, 2000);
  const wantTop = clamp(minTopInContext, 0, cap);

  const tpByEvidence = new Map<string, EvidenceRowInsightEnrichedRow[]>();
  for (const r of topRows) {
    const id = r.source_evidence_row_id;
    if (!id) continue;
    const arr = tpByEvidence.get(id) ?? [];
    arr.push(r);
    tpByEvidence.set(id, arr);
  }

  const broadByEvidence = new Map<string, BroadInsightWithRating>();
  for (const b of broad) {
    const id = b.source_evidence_row_id;
    if (!id) continue;
    if (!broadByEvidence.has(id)) broadByEvidence.set(id, b);
  }

  const tpIdsSorted = [...tpByEvidence.keys()].sort((a, b) => {
    if (opts?.preferCarouselTier) {
      const aCarousel = (tpByEvidence.get(a) ?? []).some((r) => r.analysis_tier === "top_performer_carousel");
      const bCarousel = (tpByEvidence.get(b) ?? []).some((r) => r.analysis_tier === "top_performer_carousel");
      if (aCarousel !== bCarousel) return aCarousel ? -1 : 1;
    }
    const ba = broadByEvidence.get(a);
    const bb = broadByEvidence.get(b);
    return ratingNum(bb?.evidence_rating_score) - ratingNum(ba?.evidence_rating_score);
  });

  const chosen: string[] = [];
  const used = new Set<string>();

  const takeTop = Math.min(wantTop, tpIdsSorted.length);
  for (let i = 0; i < takeTop; i++) {
    const id = tpIdsSorted[i]!;
    chosen.push(id);
    used.add(id);
  }

  const broadSorted = [...broad].sort(
    (a, b) => ratingNum(b.evidence_rating_score) - ratingNum(a.evidence_rating_score)
  );

  for (const b of broadSorted) {
    if (chosen.length >= cap) break;
    const id = b.source_evidence_row_id;
    if (!id || used.has(id)) continue;
    chosen.push(id);
    used.add(id);
  }

  const out: Array<{
    source_evidence_row_id: string;
    evidence_kind: string;
    evidence_rating: number | null;
    grounding_insight_ids: string[];
    broad: Record<string, unknown> | null;
    top_performer_styles: Record<string, unknown> | null;
  }> = [];

  for (const id of chosen) {
    const br = broadByEvidence.get(id) ?? null;
    const tops = tpByEvidence.get(id) ?? [];
    const kind = br?.evidence_kind ?? tops[0]?.evidence_kind ?? "instagram_post";
    const ratingRaw = br?.evidence_rating_score ?? null;
    const rating = ratingRaw == null || ratingRaw === "" ? null : ratingNum(ratingRaw);
    const grounding_insight_ids = [
      ...(br?.insights_id ? [String(br.insights_id).trim()] : []),
      ...tops.map((t) => String(t.insights_id ?? "").trim()).filter(Boolean),
    ];
    out.push({
      source_evidence_row_id: id,
      evidence_kind: kind,
      evidence_rating: rating,
      grounding_insight_ids,
      broad: br ? compactBroad(br) : null,
      top_performer_styles: compactTopPerformerStylesForIdeasLlm(tops),
    });
  }

  return out;
}

export function buildLlmIdeaSchema() {
  return signalPackIdeaSchema
    .omit({ id: true, created_at: true, run_id: true, status: true })
    .extend({
      format: ideaFormatSchema.optional(),
      three_liner: z.string().min(1).max(1200).optional(),
      who_for: z.string().min(1).max(200).optional(),
      why_now: z.string().min(1).max(800).optional(),
      expected_outcome: z.string().min(1).max(400).optional(),
      grounding_insight_ids: z.array(z.string().min(1)).optional(),
      content_lens: z.enum(["niche", "product"]).optional(),
      execution_profile: z.string().min(1).max(40).optional(),
      carousel_style: z.enum(["text_heavy", "visual_first", "mixed"]).optional(),
      video_style: z.enum(["script_avatar", "prompt_avatar", "no_avatar"]).optional(),
      product_angle: z
        .enum(["problem", "feature", "comparison", "usecase", "social_proof", "offer"])
        .optional(),
      cta_class: z.enum(["engage", "educate", "product_awareness", "soft_convert"]).optional(),
      risk_flags: z.array(z.string().min(1).max(60)).optional(),
      confidence_score: z.number().min(0).max(1).optional(),
    });
}

const CTA_CLASS_ALIASES: Record<string, "engage" | "educate" | "product_awareness" | "soft_convert"> = {
  engage: "engage",
  educate: "educate",
  education: "educate",
  product_awareness: "product_awareness",
  "product awareness": "product_awareness",
  awareness: "product_awareness",
  soft_convert: "soft_convert",
  "soft convert": "soft_convert",
  convert: "soft_convert",
  conversion: "soft_convert",
};

function normalizeCarouselStyle(raw: unknown, fallback: string): "text_heavy" | "visual_first" | "mixed" {
  const s = String(raw ?? fallback)
    .toLowerCase()
    .replace(/-/g, "_");
  if (s.includes("visual")) return "visual_first";
  if (s.includes("text")) return "text_heavy";
  if (s === "mixed") return "mixed";
  if (fallback === "visual_first" || fallback === "text_heavy" || fallback === "mixed") return fallback;
  return "mixed";
}

function normalizeVideoStyle(raw: unknown, fallback: string): "script_avatar" | "prompt_avatar" | "no_avatar" {
  const s = String(raw ?? fallback)
    .toLowerCase()
    .replace(/-/g, "_");
  if (s.includes("script")) return "script_avatar";
  if (s.includes("prompt")) return "prompt_avatar";
  if (s.includes("no_avatar") || s.includes("broll") || s.includes("b_roll")) return "no_avatar";
  if (fallback === "script_avatar" || fallback === "prompt_avatar" || fallback === "no_avatar") return fallback;
  return "no_avatar";
}

function normalizeProductAngle(raw: unknown): string | undefined {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  const allowed = new Set(["problem", "feature", "comparison", "usecase", "social_proof", "offer"]);
  if (allowed.has(s)) return s;
  if (s.includes("social")) return "social_proof";
  if (s.includes("pain")) return "problem";
  return undefined;
}

function normalizeCtaClass(raw: unknown): "engage" | "educate" | "product_awareness" | "soft_convert" | undefined {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (!key) return undefined;
  return CTA_CLASS_ALIASES[key] ?? CTA_CLASS_ALIASES[key.replace(/_/g, " ")];
}

function coerceConfidenceScore(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.min(1, raw));
  const n = parseFloat(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(1, n > 1 && n <= 100 ? n / 100 : n));
}

function coerceKeyPoints(raw: unknown, title: string, thesis: string): string[] {
  let pts: string[] = [];
  if (Array.isArray(raw)) pts = raw.map((x) => String(x).trim()).filter(Boolean);
  else if (typeof raw === "string") pts = raw.split(/\n|;|\|/).map((s) => s.trim()).filter(Boolean);
  const fillers = [title, thesis, "Expand on the core hook", "Add a concrete example", "Close with a clear next step"];
  for (const filler of fillers) {
    if (pts.length >= 3) break;
    const s = String(filler ?? "").trim();
    if (!s) continue;
    if (!pts.some((p) => p.toLowerCase() === s.toLowerCase())) pts.push(s.slice(0, 280));
  }
  return pts.slice(0, 10);
}

function resolveGroundingInsightIds(
  raw: unknown,
  context: IdeasLlmInsightContextRow[]
): string[] {
  const requested = Array.isArray(raw) ? raw.map((x) => String(x).trim()).filter(Boolean) : [];
  const allowed = new Set<string>();
  const byEvidence = new Map<string, string[]>();
  for (const row of context) {
    for (const id of row.grounding_insight_ids ?? []) allowed.add(id);
    if (row.source_evidence_row_id) {
      byEvidence.set(String(row.source_evidence_row_id), row.grounding_insight_ids ?? []);
    }
  }
  const out: string[] = [];
  for (const id of requested) {
    if (allowed.has(id)) {
      out.push(id);
      continue;
    }
    const fromEvidence = byEvidence.get(id);
    if (fromEvidence?.length) {
      out.push(fromEvidence[0]!);
      continue;
    }
    const prefixed = id.startsWith("ins_") ? id : `ins_${id}`;
    if (allowed.has(prefixed)) out.push(prefixed);
  }
  if (out.length) return [...new Set(out)];
  const first = context.find((c) => (c.grounding_insight_ids ?? []).length > 0)?.grounding_insight_ids?.[0];
  return first ? [String(first).trim()] : [];
}

function coerceLlmIdeaRecord(
  raw: unknown,
  context: IdeasLlmInsightContextRow[],
  bucket?: IdeaGenerationBucketDef
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const title = String(rec.title ?? "").trim();
  const thesis = String(rec.thesis ?? "").trim();
  if (!title || !thesis) return null;

  const three_liner = String(rec.three_liner ?? rec.hook ?? thesis).trim().slice(0, 1200);
  const who_for = String(rec.who_for ?? rec.audience ?? "Target audience").trim().slice(0, 200);
  const why_now = String(rec.why_now ?? rec.timing ?? "Timely for current audience interests").trim().slice(0, 800);
  const novelty_angle = String(rec.novelty_angle ?? rec.angle ?? thesis).trim().slice(0, 800);
  const cta = String(rec.cta ?? rec.call_to_action ?? "Comment your take").trim().slice(0, 200);
  const expected_outcome = String(rec.expected_outcome ?? rec.outcome ?? "Higher saves and shares").trim().slice(0, 400);
  const platform =
    typeof rec.platform === "string" && rec.platform.trim()
      ? rec.platform.trim()
      : platformFromEvidenceKind(context[0]?.evidence_kind ?? "instagram_post");

  const format = String(rec.format ?? bucket?.format ?? "").trim().toLowerCase() || bucket?.format || "carousel";
  const content_lens = String(rec.content_lens ?? bucket?.content_lens ?? "niche").trim().toLowerCase() === "product" ? "product" : "niche";
  const execution_profile = String(rec.execution_profile ?? bucket?.execution_profile ?? "").trim() || bucket?.execution_profile;

  const coerced: Record<string, unknown> = {
    title: title.slice(0, 200),
    three_liner: three_liner || thesis.slice(0, 1200),
    thesis: thesis.slice(0, 800),
    who_for,
    format,
    platform,
    content_lens,
    why_now,
    key_points: coerceKeyPoints(rec.key_points, title, thesis),
    novelty_angle,
    cta,
    expected_outcome,
    grounding_insight_ids: resolveGroundingInsightIds(rec.grounding_insight_ids, context),
    risk_flags: Array.isArray(rec.risk_flags) ? rec.risk_flags.map((x) => String(x).trim()).filter(Boolean) : [],
  };

  if (execution_profile) coerced.execution_profile = execution_profile.slice(0, 40);
  if (bucket?.format === "carousel" || format === "carousel") {
    coerced.carousel_style = normalizeCarouselStyle(
      rec.carousel_style ?? execution_profile,
      bucket?.execution_profile ?? "mixed"
    );
  }
  if (bucket?.format === "video" || format === "video") {
    coerced.video_style = normalizeVideoStyle(rec.video_style ?? execution_profile, bucket?.execution_profile ?? "no_avatar");
  }
  const productAngle = normalizeProductAngle(rec.product_angle ?? bucket?.product_angle);
  if (productAngle) coerced.product_angle = productAngle;
  const ctaClass = normalizeCtaClass(rec.cta_class);
  if (ctaClass) coerced.cta_class = ctaClass;
  const conf = coerceConfidenceScore(rec.confidence_score);
  if (conf != null) coerced.confidence_score = conf;

  return coerced;
}

export function parseLlmIdeasFromResponse(
  rawIdeas: unknown,
  context: IdeasLlmInsightContextRow[],
  llmIdeaSchema: ReturnType<typeof buildLlmIdeaSchema>,
  bucket?: IdeaGenerationBucketDef
): { ideas: z.infer<ReturnType<typeof buildLlmIdeaSchema>>[]; errors: string[] } {
  const rows = Array.isArray(rawIdeas) ? rawIdeas : [];
  const ideas: z.infer<ReturnType<typeof buildLlmIdeaSchema>>[] = [];
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const coerced = coerceLlmIdeaRecord(rows[i], context, bucket);
    if (!coerced) {
      errors.push(`idea[${i}]: missing title/thesis`);
      continue;
    }
    const parsed = llmIdeaSchema.safeParse(coerced);
    if (parsed.success) ideas.push(parsed.data);
    else errors.push(`idea[${i}]: ${parsed.error.issues.map((x) => x.path.join(".") || x.message).join("; ")}`);
  }
  return { ideas, errors };
}

function summarizeParseErrors(errors: string[], max = 3): string {
  if (!errors.length) return "no ideas parsed";
  return errors.slice(0, max).join(" | ");
}

function normalizeExecutionProfile(raw: unknown): string {
  return String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/-/g, "_");
}

function stableIdeaKeyForAllocation(i: Record<string, unknown>): string {
  const title = String(i.title ?? "")
    .trim()
    .toLowerCase();
  const thesis = String(i.thesis ?? "")
    .trim()
    .toLowerCase();
  const points = Array.isArray(i.key_points) ? i.key_points.map((x) => String(x).trim().toLowerCase()).join("|") : "";
  return `${title}::${thesis}::${points}`;
}

function allocateGroupIdeasToBuckets<T extends Record<string, unknown>>(
  group: { buckets: Array<IdeaGenerationBucketDef & { count: number }>; total: number },
  ideas: T[]
): T[] {
  const remain = [...ideas];

  // deterministic: keep original order, but avoid allocating near-identical ideas to two sub-buckets
  const seen = new Set<string>();
  const out: T[] = [];

  for (const b of group.buckets) {
    const picked: T[] = [];
    for (let i = 0; i < remain.length && picked.length < b.count; i++) {
      const idea = remain[i]!;
      const exec = normalizeExecutionProfile((idea as Record<string, unknown>).execution_profile);
      if (exec !== String(b.execution_profile).toLowerCase().trim()) continue;
      const key = stableIdeaKeyForAllocation(idea as Record<string, unknown>);
      if (key && seen.has(key)) continue;
      seen.add(key);
      picked.push(applyBucketDefaults(idea, b));
      remain.splice(i, 1);
      i--;
    }
    out.push(...picked);
  }

  // If any buckets missed due to model drift, fill from remaining (still apply bucket defaults).
  // This keeps cost down (no extra LLM calls) and makes the miss visible to humans in the table.
  for (const b of group.buckets) {
    const have = out.filter((x) => String((x as Record<string, unknown>).execution_profile) === b.execution_profile).length;
    const need = Math.max(0, b.count - have);
    if (need <= 0) continue;
    const picked = remain.splice(0, need).map((x) => applyBucketDefaults(x, b));
    out.push(...picked);
  }

  return out.slice(0, group.total);
}

function applyBucketDefaults<T extends Record<string, unknown>>(
  idea: T,
  bucket: IdeaGenerationBucketDef
): T {
  return {
    ...idea,
    format: bucket.format,
    content_lens: bucket.content_lens,
    execution_profile: bucket.execution_profile,
    ...(bucket.format === "carousel" ? { carousel_style: bucket.execution_profile } : {}),
    ...(bucket.format === "video" ? { video_style: bucket.execution_profile } : {}),
    ...(bucket.product_angle ? { product_angle: bucket.product_angle } : {}),
  } as T;
}

async function loadBrandContextForIdeas(db: Pool, projectId: string): Promise<string> {
  const [brand, product, strategy] = await Promise.all([
    getBrandConstraints(db, projectId),
    getProductProfile(db, projectId),
    getStrategyDefaults(db, projectId),
  ]);
  const productSlice = product
    ? (() => {
        const o: Record<string, unknown> = {};
        for (const k of [
          "product_name",
          "product_category",
          "one_liner",
          "value_proposition",
          "primary_audience",
          "key_benefits",
          "differentiators",
          "allowed_ctas",
        ] as const) {
          const v = (product as unknown as Record<string, unknown>)[k];
          if (v !== undefined && v !== null && v !== "") o[k] = v;
        }
        return Object.keys(o).length ? o : null;
      })()
    : null;
  return buildIdeaGenerationBrandContextBlock({
    brand_constraints: pickBrandSliceForSnapshot(brand as unknown as Record<string, unknown>),
    product_profile: productSlice,
    strategy_defaults: pickStrategySliceForSnapshot(strategy as unknown as Record<string, unknown>),
    allowed_ctas: Array.isArray((product as unknown as { allowed_ctas?: unknown })?.allowed_ctas)
      ? ((product as unknown as { allowed_ctas: unknown[] }).allowed_ctas.map((x) => String(x).trim()).filter(Boolean))
      : undefined,
  });
}

export async function synthesizeIdeasJsonFromInsightsLlm(
  db: Pool,
  config: AppConfig,
  projectId: string,
  opts: IdeasFromInsightsLlmOpts
): Promise<IdeasFromInsightsLlmResult> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for ideas-from-insights LLM");
  }

  const fetchCap = clamp(opts.contextInsightCap * 3, 100, 3000);
  const broad = await listBroadInsightsWithEvidenceRating(db, projectId, opts.importId, fetchCap);
  const topRows = await listTopPerformerInsightsEnriched(db, projectId, opts.importId, fetchCap);

  if (broad.length === 0 && topRows.length === 0) {
    return { ideas: [], context_insights_used: 0, top_performer_rows_in_context: 0 };
  }

  const target = clamp(opts.targetIdeaCount, 1, 200);
  const ideaQuotas = opts.ideaQuotas ?? defaultIdeaGenerationQuotas(target, false);
  const bucketPlan = resolveBucketCounts(ideaQuotas);
  if (totalBucketCount(ideaQuotas) === 0) {
    throw new Error("Ideas-from-insights: idea bucket quotas sum to zero — set at least one bucket count");
  }

  const wantsCarouselVisual = bucketPlan.some(
    (b) => b.format === "carousel" && (b.execution_profile === "visual_first" || b.execution_profile === "mixed")
  );

  const rawContext = selectInsightContextForIdeasLlm(
    broad,
    topRows,
    opts.contextInsightCap,
    Math.max(opts.minTopPerformerInContext, wantsCarouselVisual ? 2 : 0),
    { preferCarouselTier: wantsCarouselVisual }
  );
  const context = budgetInsightContextForIdeasLlm(rawContext);

  const topInCtx = context.filter((c) => c.top_performer_styles != null).length;

  const brandBlock = await loadBrandContextForIdeas(db, projectId);
  const llmIdeaSchema = buildLlmIdeaSchema();
  type LlmIdea = z.infer<typeof llmIdeaSchema>;
  const insightUserBlock = `Insight context (${context.length} rows; ${topInCtx} include top-performer enrichment):\n${JSON.stringify(context, null, 0)}`;

  async function generateBucketBatch(bucket: IdeaGenerationBucketDef & { count: number }): Promise<LlmIdea[]> {
    const n = bucket.count;
    if (n <= 0) return [];
    const bucketSystem = buildIdeasBucketSystemPrompt(bucket);
    const bucketUser = `Project notes: ${opts.extraInstructions || "(none)"}\n\n${brandBlock}\n\n${insightUserBlock}`;
    let lastErrors = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = await openaiChat(apiKey!, {
        model: opts.model,
        system_prompt:
          attempt === 1
            ? bucketSystem
            : `${bucketSystem}\n\nReturn EXACTLY ${n} valid ideas. Prior parse issues: ${lastErrors || "schema mismatch"}.`,
        user_prompt: bucketUser,
        max_tokens: 8192,
        response_format: "json_object",
      }, { db, projectId, runId: null, taskId: null, signalPackId: null, step: STEP_IDEAS_FROM_INSIGHTS });
      const p = parseJsonObjectFromLlmText(out.content);
      const ri = p && typeof p === "object" && !Array.isArray(p) ? (p as { ideas?: unknown }).ideas : [];
      const parsed = parseLlmIdeasFromResponse(ri, context, llmIdeaSchema, bucket);
      lastErrors = summarizeParseErrors(parsed.errors);
      if (parsed.ideas.length > 0) {
        return parsed.ideas.slice(0, n + 2).map((x) => applyBucketDefaults({ ...x, format: bucket.format }, bucket)) as LlmIdea[];
      }
    }
    throw new Error(`Ideas-from-insights: failed generating bucket ${bucket.id}${lastErrors ? ` (${lastErrors})` : ""}`);
  }

  const grouped = groupIdeaGenerationBuckets(bucketPlan);
  let baseIdeas: LlmIdea[] = [];

  for (const group of grouped) {
    const groupBucket: IdeaGenerationBucketDef & { count: number } = {
      id: group.buckets[0]!.id,
      label: `Group: ${group.content_lens} ${group.format}`,
      format: group.format,
      content_lens: group.content_lens,
      execution_profile: "mixed",
      section: group.content_lens,
      count: group.total,
    };

    const system = buildIdeasGroupSystemPrompt({
      total: group.total,
      format: group.format,
      content_lens: group.content_lens,
      buckets: group.buckets.map((b) => ({
        execution_profile: b.execution_profile,
        count: b.count,
        label: b.label,
        product_angle: b.product_angle,
      })),
    });

    const user = `Project notes: ${opts.extraInstructions || "(none)"}\n\n${brandBlock}\n\n${insightUserBlock}`;

    let groupIdeas: LlmIdea[] = [];
    let lastErrors = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = await openaiChat(
        apiKey!,
        {
          model: opts.model,
          system_prompt:
            attempt === 1
              ? system
              : `${system}\n\nYou missed the split previously. Try again and hit the exact counts. Prior parse issues: ${lastErrors || "schema mismatch"}.`,
          user_prompt: user,
          max_tokens: 8192,
          response_format: "json_object",
        },
        { db, projectId, runId: null, taskId: null, signalPackId: null, step: STEP_IDEAS_FROM_INSIGHTS }
      );
      const p = parseJsonObjectFromLlmText(out.content);
      const ri = p && typeof p === "object" && !Array.isArray(p) ? (p as { ideas?: unknown }).ideas : [];
      const parsed = parseLlmIdeasFromResponse(ri, context, llmIdeaSchema, groupBucket);
      lastErrors = summarizeParseErrors(parsed.errors);
      if (parsed.ideas.length > 0) {
        groupIdeas = parsed.ideas.slice(0, group.total + 4);
        break;
      }
    }
    if (groupIdeas.length === 0) {
      // Fallback to prior behavior for this group only (still fewer calls than per-bucket in common cases).
      for (const bucket of group.buckets) {
        let collected: LlmIdea[] = [];
        for (let round = 1; round <= 2; round++) {
          collected = dedupeIdeas(collected);
          if (collected.length >= bucket.count) break;
          const batch = await generateBucketBatch({ ...bucket, count: bucket.count - collected.length + 1 });
          collected = dedupeIdeas([...collected, ...batch.map((x) => applyBucketDefaults(x, bucket))]);
        }
        baseIdeas.push(...collected.slice(0, bucket.count));
      }
      continue;
    }

    const allocated = allocateGroupIdeasToBuckets(group, groupIdeas);
    baseIdeas.push(...allocated);
  }

  if (baseIdeas.length === 0) {
    throw new Error("Ideas-from-insights LLM returned invalid ideas contract (expected canonical signal pack idea schema)");
  }
  const slug = opts.packRunId.replace(/[^a-zA-Z0-9_]/g, "").slice(-12) || "pack";

  const ideas: SignalPackIdeaV2[] = baseIdeas.map((r, i) => {
    // Enforce deterministic IDs and minimal metadata while keeping the canonical contract.
    const ideaId = `idea_${slug}_${i + 1}`;
    const grounding = Array.isArray(r.grounding_insight_ids) ? r.grounding_insight_ids.map((x) => String(x).trim()).filter(Boolean) : [];
    const safeGrounding = grounding.length
      ? grounding
      : (() => {
          // Hard fallback to first available grounding id from context (breaking change: we still require grounding).
          const first = context.find((c) => (c.grounding_insight_ids ?? []).length > 0)?.grounding_insight_ids?.[0];
          return first ? [String(first).trim()] : [];
        })();
    if (safeGrounding.length === 0) {
      throw new Error("Ideas-from-insights: could not resolve grounding_insight_ids (no insight ids in context)");
    }

    // If platform is missing/blank, infer from evidence kinds present in context.
    const inferredPlatform =
      typeof r.platform === "string" && r.platform.trim()
        ? r.platform.trim()
        : platformFromEvidenceKind(context[0]?.evidence_kind ?? "instagram_post");

    return {
      ...r,
      id: ideaId,
      run_id: opts.packRunId,
      created_at: new Date().toISOString(),
      title: String(r.title ?? "").trim(),
      three_liner: String(r.three_liner ?? r.thesis ?? "").trim(),
      thesis: String(r.thesis ?? "").trim(),
      who_for: String(r.who_for ?? "Target audience").trim(),
      format: String(r.format ?? "carousel"),
      platform: inferredPlatform,
      why_now: String(r.why_now ?? "Timely for current audience interests").trim(),
      key_points: Array.isArray(r.key_points) && r.key_points.length >= 3 ? r.key_points : coerceKeyPoints(r.key_points, String(r.title ?? ""), String(r.thesis ?? "")),
      novelty_angle: String(r.novelty_angle ?? r.thesis ?? "").trim(),
      cta: String(r.cta ?? "Comment your take").trim(),
      expected_outcome: String(r.expected_outcome ?? "Higher saves and shares").trim(),
      status: "proposed",
      grounding_insight_ids: safeGrounding,
      risk_flags: Array.isArray(r.risk_flags) ? r.risk_flags : [],
      content_lens: r.content_lens,
      execution_profile: r.execution_profile,
      carousel_style: r.carousel_style,
      video_style: r.video_style,
      product_angle: r.product_angle,
      cta_class: r.cta_class,
    };
  });

  return {
    ideas,
    context_insights_used: context.length,
    top_performer_rows_in_context: topInCtx,
  };
}
