/**
 * Structured idea buckets: format × content lens × execution profile (+ optional product angle).
 * Used at idea-generation time (Build ideas) and carried on planner rows downstream.
 */
import { z } from "zod";
import {
  FLOW_PRODUCT_COMPARISON,
  FLOW_PRODUCT_FEATURE,
  FLOW_PRODUCT_OFFER,
  FLOW_PRODUCT_PROBLEM,
  FLOW_PRODUCT_SOCIAL_PROOF,
  FLOW_PRODUCT_USECASE,
} from "./product-flow-types.js";
import { CANONICAL_FLOW_TYPES } from "./canonical-flow-types.js";
import {
  defaultPlatformForTextIdeaFormat,
  flowTypeForTextIdeaFormat,
  isTextIdeaFormat,
} from "./text-content-flow-types.js";

export const CONTENT_LENS_VALUES = ["niche", "product"] as const;
export type ContentLens = (typeof CONTENT_LENS_VALUES)[number];

export const IDEA_FORMAT_VALUES = [
  "carousel",
  "video",
  "post",
  "thread",
  "linkedin_text",
  "linkedin_document",
  "reddit_post",
  "instagram_thread",
] as const;
export type IdeaFormat = (typeof IDEA_FORMAT_VALUES)[number];

export const CAROUSEL_EXECUTION_PROFILES = ["text_heavy", "visual_first", "mixed"] as const;
export type CarouselExecutionProfile = (typeof CAROUSEL_EXECUTION_PROFILES)[number];

export const VIDEO_EXECUTION_PROFILES = ["script_avatar", "prompt_avatar", "no_avatar", "hook_first", "ugc"] as const;
export type VideoExecutionProfile = (typeof VIDEO_EXECUTION_PROFILES)[number];

export const POST_EXECUTION_PROFILES = ["text", "image_led"] as const;
export type PostExecutionProfile = (typeof POST_EXECUTION_PROFILES)[number];

export const PRODUCT_ANGLE_VALUES = [
  "problem",
  "feature",
  "comparison",
  "usecase",
  "social_proof",
  "offer",
] as const;
export type ProductAngle = (typeof PRODUCT_ANGLE_VALUES)[number];

/** Virtual planning-cap keys (stored in max_jobs_per_flow_type JSON; not real flow_types). */
export const PLAN_LANE_NICHE_CAROUSEL = "PLAN_LANE__NICHE_CAROUSEL";
export const PLAN_LANE_PRODUCT_CAROUSEL = "PLAN_LANE__PRODUCT_CAROUSEL";

export const PRODUCT_ANGLE_TO_FLOW_TYPE: Record<ProductAngle, string> = {
  problem: FLOW_PRODUCT_PROBLEM,
  feature: FLOW_PRODUCT_FEATURE,
  comparison: FLOW_PRODUCT_COMPARISON,
  usecase: FLOW_PRODUCT_USECASE,
  social_proof: FLOW_PRODUCT_SOCIAL_PROOF,
  offer: FLOW_PRODUCT_OFFER,
};

export const PRODUCT_ANGLE_LABELS: Record<ProductAngle, string> = {
  problem: "Problem / Pain hook",
  feature: "Feature highlight",
  comparison: "Comparison / vs alternatives",
  usecase: "Use case / scenario",
  social_proof: "Social proof / testimonial",
  offer: "Offer / urgency / CTA",
};

export type IdeaGenerationBucketId =
  | "niche_carousel_text"
  | "niche_carousel_visual"
  | "niche_video_no_avatar"
  | "niche_video_prompt_avatar"
  | "niche_video_script_avatar"
  | "niche_video_hook_first"
  | "niche_video_ugc"
  | "niche_post"
  | "niche_thread"
  | "niche_linkedin_text"
  | "niche_linkedin_document"
  | "niche_reddit_post"
  | "niche_instagram_thread"
  | "product_carousel_text"
  | "product_carousel_visual"
  | "product_video"
  | "product_video_ugc"
  | "product_post"
  | "product_thread"
  | "product_linkedin_text"
  | "product_linkedin_document"
  | "product_reddit_post"
  | "product_instagram_thread"
  | `product_video_${ProductAngle}`;

export interface IdeaGenerationBucketDef {
  id: IdeaGenerationBucketId;
  label: string;
  format: IdeaFormat;
  content_lens: ContentLens;
  execution_profile: string;
  product_angle?: ProductAngle;
  /** When true, only shown when product_angle_quotas mode is enabled. */
  requires_product_angles?: boolean;
  section: "niche" | "product";
}

export const IDEA_GENERATION_BUCKET_DEFS: readonly IdeaGenerationBucketDef[] = [
  {
    id: "niche_carousel_text",
    label: "Niche carousel — text-heavy",
    format: "carousel",
    content_lens: "niche",
    execution_profile: "text_heavy",
    section: "niche",
  },
  {
    id: "niche_carousel_visual",
    label: "Niche carousel — visual-first",
    format: "carousel",
    content_lens: "niche",
    execution_profile: "visual_first",
    section: "niche",
  },
  {
    id: "niche_video_no_avatar",
    label: "Niche video — no avatar (b-roll / VO)",
    format: "video",
    content_lens: "niche",
    execution_profile: "no_avatar",
    section: "niche",
  },
  {
    id: "niche_video_prompt_avatar",
    label: "Niche video — prompt avatar",
    format: "video",
    content_lens: "niche",
    execution_profile: "prompt_avatar",
    section: "niche",
  },
  {
    id: "niche_video_script_avatar",
    label: "Niche video — script avatar",
    format: "video",
    content_lens: "niche",
    execution_profile: "script_avatar",
    section: "niche",
  },
  {
    id: "niche_video_hook_first",
    label: "Niche video — hook-first hybrid",
    format: "video",
    content_lens: "niche",
    execution_profile: "hook_first",
    section: "niche",
  },
  {
    id: "niche_video_ugc",
    label: "Niche video — UGC creator",
    format: "video",
    content_lens: "niche",
    execution_profile: "ugc",
    section: "niche",
  },
  {
    id: "niche_post",
    label: "Niche post",
    format: "post",
    content_lens: "niche",
    execution_profile: "text",
    section: "niche",
  },
  {
    id: "niche_thread",
    label: "Niche thread",
    format: "thread",
    content_lens: "niche",
    execution_profile: "text",
    section: "niche",
  },
  {
    id: "niche_linkedin_text",
    label: "LinkedIn text post",
    format: "linkedin_text",
    content_lens: "niche",
    execution_profile: "text",
    section: "niche",
  },
  {
    id: "niche_linkedin_document",
    label: "LinkedIn post with images",
    format: "linkedin_document",
    content_lens: "niche",
    execution_profile: "image_led",
    section: "niche",
  },
  {
    id: "niche_reddit_post",
    label: "Reddit post",
    format: "reddit_post",
    content_lens: "niche",
    execution_profile: "text",
    section: "niche",
  },
  {
    id: "niche_instagram_thread",
    label: "Instagram thread",
    format: "instagram_thread",
    content_lens: "niche",
    execution_profile: "text",
    section: "niche",
  },
  {
    id: "product_carousel_text",
    label: "Product carousel — text-heavy",
    format: "carousel",
    content_lens: "product",
    execution_profile: "text_heavy",
    section: "product",
  },
  {
    id: "product_carousel_visual",
    label: "Product carousel — visual-first",
    format: "carousel",
    content_lens: "product",
    execution_profile: "visual_first",
    section: "product",
  },
  {
    id: "product_video",
    label: "Product video (any angle)",
    format: "video",
    content_lens: "product",
    execution_profile: "prompt_avatar",
    section: "product",
  },
  {
    id: "product_video_ugc",
    label: "Product video — UGC creator",
    format: "video",
    content_lens: "product",
    execution_profile: "ugc",
    section: "product",
  },
  {
    id: "product_post",
    label: "Product post",
    format: "post",
    content_lens: "product",
    execution_profile: "text",
    section: "product",
  },
  {
    id: "product_thread",
    label: "Product thread",
    format: "thread",
    content_lens: "product",
    execution_profile: "text",
    section: "product",
  },
  {
    id: "product_linkedin_text",
    label: "LinkedIn text post",
    format: "linkedin_text",
    content_lens: "product",
    execution_profile: "text",
    section: "product",
  },
  {
    id: "product_linkedin_document",
    label: "LinkedIn post with images",
    format: "linkedin_document",
    content_lens: "product",
    execution_profile: "image_led",
    section: "product",
  },
  {
    id: "product_reddit_post",
    label: "Reddit post",
    format: "reddit_post",
    content_lens: "product",
    execution_profile: "text",
    section: "product",
  },
  {
    id: "product_instagram_thread",
    label: "Instagram thread",
    format: "instagram_thread",
    content_lens: "product",
    execution_profile: "text",
    section: "product",
  },
  ...PRODUCT_ANGLE_VALUES.map(
    (angle): IdeaGenerationBucketDef => ({
      id: `product_video_${angle}`,
      label: `Product video — ${PRODUCT_ANGLE_LABELS[angle]}`,
      format: "video",
      content_lens: "product",
      execution_profile: "prompt_avatar",
      product_angle: angle,
      requires_product_angles: true,
      section: "product",
    })
  ),
] as const;

export const ideaGenerationQuotasSchema = z.object({
  /** Per-bucket counts; omitted buckets = 0. */
  buckets: z.record(z.string(), z.number().int().min(0).max(200)).default({}),
  /** When true, use per-angle product video buckets instead of generic product_video. */
  product_angles_enabled: z.boolean().default(false),
});

export type IdeaGenerationQuotas = z.infer<typeof ideaGenerationQuotasSchema>;

export const contentLensSchema = z.enum(CONTENT_LENS_VALUES);
export const carouselExecutionProfileSchema = z.enum(CAROUSEL_EXECUTION_PROFILES);
export const videoExecutionProfileSchema = z.enum(VIDEO_EXECUTION_PROFILES);
export const productAngleSchema = z.enum(PRODUCT_ANGLE_VALUES);

export const ideaStructureFieldsSchema = z.object({
  content_lens: contentLensSchema.optional(),
  execution_profile: z.string().min(1).max(40).optional(),
  carousel_style: carouselExecutionProfileSchema.optional(),
  video_style: videoExecutionProfileSchema.optional(),
  product_angle: productAngleSchema.optional(),
  cta_class: z.enum(["engage", "educate", "product_awareness", "soft_convert"]).optional(),
});

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Legacy format split used when deriving default bucket quotas (carousel/video/post/thread only). */
export type LegacyIdeaFormat = "carousel" | "video" | "post" | "thread";

/** Legacy 40/30/10/10 split when no bucket quotas are configured. */
export function legacyFormatQuotas(target: number): Record<LegacyIdeaFormat, number> {
  const n = clamp(target, 1, 200);
  let carousel = Math.floor(n * 0.4);
  let video = Math.floor(n * 0.3);
  let post = Math.floor(n * 0.1);
  let thread = Math.floor(n * 0.1);
  let used = carousel + video + post + thread;
  const order: LegacyIdeaFormat[] = ["carousel", "video", "post", "thread"];
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
  while (used > n) {
    if (thread > 0) thread--;
    else if (post > 0) post--;
    else if (video > 0) video--;
    else if (carousel > 1) carousel--;
    used--;
  }
  return { carousel, video, post, thread };
}

/**
 * Default bucket quotas from a target count: ~70% niche / ~30% product,
 * format split aligned with legacy ratios, product video angles evenly when enabled.
 */
export function defaultIdeaGenerationQuotas(target: number, productAnglesEnabled = false): IdeaGenerationQuotas {
  const n = clamp(target, 1, 200);
  const fmt = legacyFormatQuotas(n);
  const productShare = Math.max(1, Math.round(n * 0.3));
  const nicheShare = Math.max(0, n - productShare);

  const buckets: Record<string, number> = {};

  const nicheCarousel = Math.max(0, Math.round(fmt.carousel * 0.7));
  buckets.niche_carousel_text = Math.floor(nicheCarousel * 0.45);
  buckets.niche_carousel_visual = nicheCarousel - buckets.niche_carousel_text;

  const nicheVideo = Math.max(0, Math.round(fmt.video * 0.7));
  buckets.niche_video_no_avatar = Math.floor(nicheVideo * 0.25);
  buckets.niche_video_prompt_avatar = Math.floor(nicheVideo * 0.3);
  buckets.niche_video_hook_first = Math.max(0, Math.floor(nicheVideo * 0.12));
  buckets.niche_video_ugc = Math.max(0, Math.floor(nicheVideo * 0.15));
  buckets.niche_video_script_avatar =
    nicheVideo -
    buckets.niche_video_no_avatar -
    buckets.niche_video_prompt_avatar -
    buckets.niche_video_hook_first -
    buckets.niche_video_ugc;

  buckets.niche_post = Math.max(0, Math.round(fmt.post * 0.85));
  buckets.niche_thread = Math.max(0, Math.round(fmt.thread * 0.85));

  buckets.niche_linkedin_text = 0;
  buckets.niche_linkedin_document = 0;
  buckets.niche_reddit_post = 0;
  buckets.niche_instagram_thread = 0;

  const productCarousel = Math.max(0, fmt.carousel - nicheCarousel);
  buckets.product_carousel_text = Math.floor(productCarousel * 0.4);
  buckets.product_carousel_visual = productCarousel - buckets.product_carousel_text;

  const productVideo = Math.max(0, fmt.video - nicheVideo);
  if (productAnglesEnabled && productVideo > 0) {
    const per = Math.floor(productVideo / PRODUCT_ANGLE_VALUES.length);
    let rem = productVideo - per * PRODUCT_ANGLE_VALUES.length;
    for (const angle of PRODUCT_ANGLE_VALUES) {
      buckets[`product_video_${angle}`] = per + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
    }
  } else {
    buckets.product_video_ugc = Math.max(0, Math.floor(productVideo * 0.25));
    buckets.product_video = Math.max(0, productVideo - buckets.product_video_ugc);
  }

  buckets.product_post = Math.max(0, fmt.post - (buckets.niche_post ?? 0));
  buckets.product_thread = Math.max(0, fmt.thread - (buckets.niche_thread ?? 0));

  buckets.product_linkedin_text = 0;
  buckets.product_linkedin_document = 0;
  buckets.product_reddit_post = 0;
  buckets.product_instagram_thread = 0;

  // Normalize total to target
  let sum = Object.values(buckets).reduce((a, b) => a + b, 0);
  while (sum < n) {
    buckets.niche_carousel_visual = (buckets.niche_carousel_visual ?? 0) + 1;
    sum++;
  }
  while (sum > n && (buckets.niche_carousel_visual ?? 0) > 0) {
    buckets.niche_carousel_visual! -= 1;
    sum--;
  }

  return { buckets, product_angles_enabled: productAnglesEnabled };
}

export function parseIdeaGenerationQuotas(raw: unknown): IdeaGenerationQuotas | null {
  const p = ideaGenerationQuotasSchema.safeParse(raw);
  return p.success ? p.data : null;
}

export function readIdeaGenerationQuotasFromCriteria(
  criteriaJson: Record<string, unknown> | null | undefined,
  targetFallback: number
): IdeaGenerationQuotas {
  const block = criteriaJson?.idea_generation;
  const parsed = parseIdeaGenerationQuotas(block);
  if (parsed && Object.keys(parsed.buckets).length > 0) return parsed;
  return defaultIdeaGenerationQuotas(targetFallback, false);
}

export function activeBucketDefs(quotas: IdeaGenerationQuotas): IdeaGenerationBucketDef[] {
  return IDEA_GENERATION_BUCKET_DEFS.filter((d) => {
    if (d.requires_product_angles && !quotas.product_angles_enabled) return false;
    if (d.id === "product_video" && quotas.product_angles_enabled) return false;
    return true;
  });
}

export function resolveBucketCounts(quotas: IdeaGenerationQuotas): Array<IdeaGenerationBucketDef & { count: number }> {
  const defs = activeBucketDefs(quotas);
  return defs
    .map((d) => ({ ...d, count: Math.max(0, quotas.buckets[d.id] ?? 0) }))
    .filter((d) => d.count > 0);
}

export function totalBucketCount(quotas: IdeaGenerationQuotas): number {
  return resolveBucketCounts(quotas).reduce((s, b) => s + b.count, 0);
}

export function normalizeContentLens(raw: unknown): ContentLens {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim();
  return s === "product" ? "product" : "niche";
}

export function carouselLaneCapKey(contentLens: ContentLens): string {
  return contentLens === "product" ? PLAN_LANE_PRODUCT_CAROUSEL : PLAN_LANE_NICHE_CAROUSEL;
}

export function resolveTargetFlowTypeFromIdea(row: Record<string, unknown>): string | null {
  const lens = normalizeContentLens(row.content_lens);
  const format = String(row.format ?? "")
    .toLowerCase()
    .trim();
  if (lens !== "product" || format !== "video") return null;

  const angleRaw = String(row.product_angle ?? "").trim().toLowerCase();
  if (angleRaw && PRODUCT_ANGLE_VALUES.includes(angleRaw as ProductAngle)) {
    return PRODUCT_ANGLE_TO_FLOW_TYPE[angleRaw as ProductAngle];
  }

  const explicit = String(row.target_flow_type ?? "").trim();
  if (explicit && /^FLOW_PRODUCT_/i.test(explicit)) return explicit;

  return null;
}

export function applyIdeaStructureToPlannerRow(row: Record<string, unknown>): Record<string, unknown> {
  const lens = row.content_lens != null ? normalizeContentLens(row.content_lens) : undefined;
  const format = String(row.format ?? "")
    .toLowerCase()
    .trim();
  const exec = String(row.execution_profile ?? "").trim();
  const out: Record<string, unknown> = { ...row };

  if (lens) out.content_lens = lens;

  if (format === "carousel") {
    const style =
      row.carousel_style ??
      (CAROUSEL_EXECUTION_PROFILES.includes(exec as CarouselExecutionProfile) ? exec : undefined);
    if (style) {
      out.carousel_style = style;
      out.execution_profile = style;
    }
  }

  if (format === "video") {
    const vs =
      row.video_style ??
      (VIDEO_EXECUTION_PROFILES.includes(exec as VideoExecutionProfile) ? exec : undefined);
    if (vs) {
      out.video_style = vs;
      out.execution_profile = vs;
    }
    if (vs === "hook_first") {
      out.target_flow_type = CANONICAL_FLOW_TYPES.VID_HOOK_FIRST;
    }
    if (vs === "ugc") {
      out.target_flow_type = CANONICAL_FLOW_TYPES.VID_UGC;
    }
    const targetFt = resolveTargetFlowTypeFromIdea(out);
    if (targetFt) out.target_flow_type = targetFt;
  }

  if (isTextIdeaFormat(format)) {
    const flow = flowTypeForTextIdeaFormat(format);
    if (flow) out.target_flow_type = flow;
    const platform = defaultPlatformForTextIdeaFormat(format);
    if (platform && !String(out.platform ?? "").trim()) {
      out.platform = platform;
      out.target_platform = platform;
    }
    if (format === "linkedin_document") {
      out.execution_profile = "image_led";
    } else if (!out.execution_profile) {
      out.execution_profile = "text";
    }
  }

  if ((format === "post" || format === "thread") && !out.target_flow_type) {
    out.target_flow_type = CANONICAL_FLOW_TYPES.TEXT;
    if (!out.execution_profile) out.execution_profile = "text";
  }

  if (row.product_angle) out.product_angle = String(row.product_angle).trim().toLowerCase();

  if (out.visual_first_carousel_lane === true && out.use_brand_visual_system !== false) {
    out.use_brand_visual_system = true;
  }

  if (lens === "product" && out.use_product_bible !== false) {
    out.use_product_bible = true;
  }

  return out;
}

export interface IdeaBrandContext {
  brand_constraints?: Record<string, unknown> | null;
  product_profile?: Record<string, unknown> | null;
  strategy_defaults?: Record<string, unknown> | null;
  allowed_ctas?: string[];
  disallowed_cta_patterns?: string[];
}

export const DEFAULT_DISALLOWED_CTA_PATTERNS = [
  "download the app",
  "install the app",
  "take our quiz",
  "free quiz",
  "link in bio for a free",
  "dm for free reading",
  "giveaway",
  "affiliate code",
  "promo code",
  "limited spots left",
] as const;

export function buildIdeaGenerationBrandContextBlock(ctx: IdeaBrandContext): string {
  const parts: string[] = [];
  if (ctx.product_profile && Object.keys(ctx.product_profile).length > 0) {
    parts.push(`PRODUCT PROFILE (use for content_lens=product ideas):\n${JSON.stringify(ctx.product_profile, null, 0)}`);
  }
  if (ctx.brand_constraints && Object.keys(ctx.brand_constraints).length > 0) {
    parts.push(`BRAND CONSTRAINTS:\n${JSON.stringify(ctx.brand_constraints, null, 0)}`);
  }
  if (ctx.strategy_defaults && Object.keys(ctx.strategy_defaults).length > 0) {
    parts.push(`STRATEGY DEFAULTS:\n${JSON.stringify(ctx.strategy_defaults, null, 0)}`);
  }
  const allowed = ctx.allowed_ctas?.filter(Boolean) ?? [];
  if (allowed.length) {
    parts.push(`ALLOWED CTA EXAMPLES: ${allowed.join("; ")}`);
  }
  const disallowed = [...DEFAULT_DISALLOWED_CTA_PATTERNS, ...(ctx.disallowed_cta_patterns ?? [])];
  parts.push(
    `DISALLOWED CTAs / mechanics (never propose; use risk_flags unsupported_cta if tempted): ${disallowed.join("; ")}`
  );
  parts.push(
    "CAPABILITY RULE: Do not propose quizzes, app downloads, giveaways, or funnels the project does not offer. CTAs must be achievable with the product profile and brand constraints above."
  );
  return parts.join("\n\n");
}
