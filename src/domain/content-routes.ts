/**
 * Marketer-facing content routes (lanes) ↔ allowed_flow_types ↔ idea-generation buckets.
 * Single source of truth for project setup checklists, Review UI, and idea filtering.
 */
import { CANONICAL_FLOW_TYPES } from "./canonical-flow-types.js";
import {
  defaultIdeaGenerationQuotas,
  type IdeaGenerationQuotas,
} from "./idea-structure.js";
import { FLOW_LINKEDIN_DOCUMENT_POST } from "./linkedin-document-post-flow-types.js";
import { PRODUCT_VIDEO_FLOW_TYPES } from "./product-flow-types.js";
import {
  FLOW_INSTAGRAM_THREAD,
  FLOW_LINKEDIN_TEXT_POST,
  FLOW_REDDIT_POST,
} from "./text-content-flow-types.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_VISUAL_FIRST_CAROUSEL,
  FLOW_WHY_MIMIC_CAROUSEL,
} from "./top-performer-mimic-flow-types.js";

export const CONTENT_ROUTE_GROUPS = ["carousel", "video", "text"] as const;
export type ContentRouteGroup = (typeof CONTENT_ROUTE_GROUPS)[number];

export interface ContentRouteLaneDef {
  id: string;
  label: string;
  description: string;
  group: ContentRouteGroup;
  /** Flow types toggled when this lane is enabled/disabled. */
  flow_types: readonly string[];
  /**
   * Idea-generation bucket ids that should receive quota when this lane is on.
   * Empty = planning-only lane (e.g. mimic from top performers), no dedicated bucket.
   */
  idea_buckets: readonly string[];
  /** When true, enable product_angles_enabled on idea quotas. */
  enables_product_angles?: boolean;
  /** Suggested on for new brands in MVP checklist. */
  default_enabled?: boolean;
  advanced?: boolean;
}

export const CONTENT_ROUTE_LANES: readonly ContentRouteLaneDef[] = [
  {
    id: "niche_carousels",
    label: "Niche carousels",
    description:
      "Tip and education slides for your audience — text-led carousels about the niche, not hard product pitches.",
    group: "carousel",
    flow_types: [CANONICAL_FLOW_TYPES.CAROUSEL],
    idea_buckets: ["niche_carousel_text"],
    default_enabled: true,
  },
  {
    id: "product_carousels",
    label: "Product carousels",
    description:
      "Slides that sell: features, benefits, comparisons, and offers for your product.",
    group: "carousel",
    flow_types: [CANONICAL_FLOW_TYPES.CAROUSEL],
    idea_buckets: ["product_carousel_text"],
  },
  {
    id: "visual_first_carousels",
    label: "Brand visual carousels",
    description:
      "On-brand designed carousels from your Brand Visual System (moodboard, plates, logos) — not copying a competitor layout.",
    group: "carousel",
    flow_types: [FLOW_VISUAL_FIRST_CAROUSEL],
    idea_buckets: ["niche_carousel_visual", "product_carousel_visual"],
    default_enabled: true,
  },
  {
    id: "top_performer_mimic_carousel",
    label: "Recreate top performers",
    description:
      "Take a high-performing competitor carousel and remake it in your brand’s look and voice.",
    group: "carousel",
    flow_types: [FLOW_TOP_PERFORMER_MIMIC_CAROUSEL],
    idea_buckets: [],
  },
  {
    id: "why_mimic_carousels",
    label: "Why Mimic carousels",
    description:
      "Advanced: strategic remakes guided by slide-by-slide “why this worked” analysis.",
    group: "carousel",
    flow_types: [FLOW_WHY_MIMIC_CAROUSEL],
    idea_buckets: [],
    advanced: true,
  },
  {
    id: "avatar_video_script",
    label: "Avatar video (script)",
    description:
      "Talking-head video: an AI avatar speaks a written script you can edit before render.",
    group: "video",
    flow_types: [CANONICAL_FLOW_TYPES.VID_SCRIPT],
    idea_buckets: ["niche_video_script_avatar"],
  },
  {
    id: "avatar_video_prompt",
    label: "Avatar video (prompt)",
    description:
      "Avatar video generated from a short creative brief/prompt rather than a full script.",
    group: "video",
    flow_types: [CANONICAL_FLOW_TYPES.VID_PROMPT],
    idea_buckets: ["niche_video_prompt_avatar"],
  },
  {
    id: "video_no_avatar",
    label: "Video without avatar",
    description:
      "Voiceover or on-screen text with motion graphics — no talking-head avatar.",
    group: "video",
    flow_types: [CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR],
    idea_buckets: ["niche_video_no_avatar"],
  },
  {
    id: "hook_first_video",
    label: "Hook-first video",
    description:
      "A short cinematic hook clip, then an avatar delivers the rest of the message.",
    group: "video",
    flow_types: [CANONICAL_FLOW_TYPES.VID_HOOK_FIRST],
    idea_buckets: ["niche_video_hook_first"],
  },
  {
    id: "ugc_video",
    label: "UGC creator video",
    description:
      "Peer-style talking-head ads: reaction hooks, casual settings, UGC hosts from brand/product bible.",
    group: "video",
    flow_types: [CANONICAL_FLOW_TYPES.VID_UGC],
    idea_buckets: ["niche_video_ugc", "product_video_ugc"],
    default_enabled: true,
  },
  {
    id: "product_marketing_videos",
    label: "Product marketing videos",
    description:
      "Product angles: problem, feature, comparison, use case, social proof, and offer.",
    group: "video",
    flow_types: [...PRODUCT_VIDEO_FLOW_TYPES],
    idea_buckets: [
      "product_video",
      "product_video_problem",
      "product_video_feature",
      "product_video_comparison",
      "product_video_usecase",
      "product_video_social_proof",
      "product_video_offer",
    ],
    enables_product_angles: true,
  },
  {
    id: "linkedin_posts",
    label: "LinkedIn posts",
    description:
      "LinkedIn text posts and optional document-style carousels for professional feeds.",
    group: "text",
    flow_types: [FLOW_LINKEDIN_TEXT_POST, FLOW_LINKEDIN_DOCUMENT_POST],
    idea_buckets: [
      "niche_linkedin_text",
      "niche_linkedin_document",
      "product_linkedin_text",
      "product_linkedin_document",
    ],
  },
  {
    id: "reddit_posts",
    label: "Reddit posts",
    description: "Title + body posts written for Reddit communities (not ads).",
    group: "text",
    flow_types: [FLOW_REDDIT_POST],
    idea_buckets: ["niche_reddit_post", "product_reddit_post"],
  },
  {
    id: "instagram_threads",
    label: "Instagram threads",
    description: "Multi-part text threads for Instagram (conversation-style posts).",
    group: "text",
    flow_types: [FLOW_INSTAGRAM_THREAD],
    idea_buckets: ["niche_instagram_thread", "product_instagram_thread"],
  },
] as const;

const LANE_BY_ID = new Map(CONTENT_ROUTE_LANES.map((l) => [l.id, l]));

export function getContentRouteLane(id: string): ContentRouteLaneDef | undefined {
  return LANE_BY_ID.get(id.trim());
}

export function defaultEnabledContentRouteIds(): string[] {
  return CONTENT_ROUTE_LANES.filter((l) => l.default_enabled).map((l) => l.id);
}

/**
 * Parse enabled content-route lane ids from onboarding-pack free text
 * (semicolon/comma/newline lists of labels or ids).
 */
export function parseContentRouteLaneIdsFromText(text: string): string[] {
  const raw = text.trim();
  if (!raw) return [];
  const tokens = raw
    .split(/[;\n,|]+/)
    .map((t) => t.replace(/^[-*•\d.]+\s*/, "").trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    // "Niche carousels: Yes" / "Niche carousels = Yes"
    const yesNo = lower.match(/^(.+?)\s*[:=]\s*(yes|no|true|false|y|n)\s*$/i);
    const labelPart = (yesNo ? yesNo[1] : token).trim();
    const enabledFlag = yesNo ? /^(yes|true|y)$/i.test(yesNo[2]) : true;
    if (!enabledFlag) continue;

    const byId = LANE_BY_ID.get(labelPart) ?? LANE_BY_ID.get(labelPart.toLowerCase().replace(/\s+/g, "_"));
    if (byId) {
      if (!seen.has(byId.id)) {
        seen.add(byId.id);
        out.push(byId.id);
      }
      continue;
    }
    const byLabel = CONTENT_ROUTE_LANES.find(
      (l) => l.label.toLowerCase() === labelPart.toLowerCase() || l.id === labelPart.toLowerCase().replace(/\s+/g, "_")
    );
    if (byLabel && !seen.has(byLabel.id)) {
      seen.add(byLabel.id);
      out.push(byLabel.id);
    }
  }
  return out;
}

/** All flow types managed by the content-routes catalog. */
export function allContentRouteFlowTypes(): string[] {
  const set = new Set<string>();
  for (const lane of CONTENT_ROUTE_LANES) {
    for (const ft of lane.flow_types) set.add(ft);
  }
  return [...set];
}

/**
 * Derive which lanes are enabled from current allowed_flow_types rows.
 * FLOW_CAROUSEL is shared by niche + product: both lanes on if carousel enabled and
 * we cannot distinguish — callers should prefer stored route preferences when available.
 */
export function enabledLaneIdsFromFlowTypes(
  enabledFlowTypes: Iterable<string>
): string[] {
  const enabled = new Set(
    [...enabledFlowTypes].map((f) => f.trim()).filter(Boolean)
  );
  const out: string[] = [];
  for (const lane of CONTENT_ROUTE_LANES) {
    const ok = lane.flow_types.every((ft) => enabled.has(ft));
    if (ok && lane.flow_types.length > 0) out.push(lane.id);
  }
  return out;
}

/**
 * For a set of enabled lane ids, which flow types should be on.
 * Shared flows (FLOW_CAROUSEL) stay on if any owning lane is enabled.
 */
export function flowTypesEnabledForLanes(enabledLaneIds: Iterable<string>): Set<string> {
  const lanes = new Set([...enabledLaneIds].map((id) => id.trim()).filter(Boolean));
  const flows = new Set<string>();
  for (const lane of CONTENT_ROUTE_LANES) {
    if (!lanes.has(lane.id)) continue;
    for (const ft of lane.flow_types) flows.add(ft);
  }
  return flows;
}

/**
 * Build idea-generation quotas from enabled lanes.
 * Starts from defaults for the target count, then zeros buckets not owned by an enabled lane.
 * Buckets owned by enabled lanes keep (or receive) default shares; planning-only lanes
 * do not change buckets.
 */
export function ideaQuotasForEnabledLanes(
  enabledLaneIds: Iterable<string>,
  targetIdeaCount: number
): IdeaGenerationQuotas {
  const lanes = new Set([...enabledLaneIds].map((id) => id.trim()).filter(Boolean));
  const productAngles = CONTENT_ROUTE_LANES.some(
    (l) => lanes.has(l.id) && l.enables_product_angles
  );
  const base = defaultIdeaGenerationQuotas(targetIdeaCount, productAngles);

  const allowedBuckets = new Set<string>();
  let anyBucketLane = false;
  for (const lane of CONTENT_ROUTE_LANES) {
    if (!lanes.has(lane.id)) continue;
    if (lane.idea_buckets.length === 0) continue;
    anyBucketLane = true;
    for (const b of lane.idea_buckets) allowedBuckets.add(b);
  }

  if (!anyBucketLane) {
    return { buckets: {}, product_angles_enabled: productAngles };
  }

  const buckets: Record<string, number> = {};
  for (const [id, count] of Object.entries(base.buckets)) {
    buckets[id] = allowedBuckets.has(id) ? count : 0;
  }
  for (const b of allowedBuckets) {
    if (buckets[b] == null) buckets[b] = 0;
  }

  // If filtering zeroed everything but lanes are on, redistribute a minimal share.
  const sum = Object.values(buckets).reduce((a, n) => a + (n > 0 ? n : 0), 0);
  if (sum === 0 && allowedBuckets.size > 0) {
    const per = Math.max(1, Math.floor(targetIdeaCount / allowedBuckets.size));
    let left = targetIdeaCount;
    const ids = [...allowedBuckets];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const n = i === ids.length - 1 ? left : Math.min(per, left);
      buckets[id] = n;
      left -= n;
    }
  }

  return { buckets, product_angles_enabled: productAngles };
}

/** Zero out buckets that belong only to disabled lanes (safety filter over existing quotas). */
export function filterIdeaQuotasByEnabledLanes(
  quotas: IdeaGenerationQuotas,
  enabledLaneIds: Iterable<string>
): IdeaGenerationQuotas {
  const lanes = new Set([...enabledLaneIds].map((id) => id.trim()).filter(Boolean));
  const allowedBuckets = new Set<string>();
  for (const lane of CONTENT_ROUTE_LANES) {
    if (!lanes.has(lane.id)) continue;
    for (const b of lane.idea_buckets) allowedBuckets.add(b);
  }
  const productAngles = CONTENT_ROUTE_LANES.some(
    (l) => lanes.has(l.id) && l.enables_product_angles
  );
  const buckets: Record<string, number> = {};
  for (const [id, count] of Object.entries(quotas.buckets ?? {})) {
    buckets[id] = allowedBuckets.has(id) ? count : 0;
  }
  return {
    buckets,
    product_angles_enabled: productAngles || quotas.product_angles_enabled,
  };
}

/** Whether a flow type is allowed given enabled lanes (unknown flows pass through). */
export function isFlowTypeAllowedForContentRoutes(
  flowType: string,
  enabledLaneIds: Iterable<string>
): boolean {
  const ft = flowType.trim();
  const managed = allContentRouteFlowTypes();
  if (!managed.includes(ft)) return true;
  return flowTypesEnabledForLanes(enabledLaneIds).has(ft);
}

/** Merge route prefs into processing profile criteria_json.idea_generation + content_routes. */
export function patchCriteriaWithContentRoutes(
  criteriaJson: Record<string, unknown> | null | undefined,
  enabledLaneIds: string[],
  targetIdeaCount: number
): Record<string, unknown> {
  const base =
    criteriaJson && typeof criteriaJson === "object" && !Array.isArray(criteriaJson)
      ? { ...criteriaJson }
      : {};
  const quotas = ideaQuotasForEnabledLanes(enabledLaneIds, targetIdeaCount);
  base.content_routes = {
    enabled_lane_ids: enabledLaneIds,
    updated_at: new Date().toISOString(),
  };
  base.idea_generation = {
    buckets: quotas.buckets,
    product_angles_enabled: quotas.product_angles_enabled,
  };
  return base;
}

export function readEnabledContentRouteIdsFromCriteria(
  criteriaJson: Record<string, unknown> | null | undefined
): string[] | null {
  const block = criteriaJson?.content_routes;
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  const ids = (block as { enabled_lane_ids?: unknown }).enabled_lane_ids;
  if (!Array.isArray(ids)) return null;
  return ids.map((x) => String(x).trim()).filter(Boolean);
}
