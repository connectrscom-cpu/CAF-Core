/**
 * Strict format-first planning: ideas with `format` only compete in matching flow families.
 *
 * Pass 1 (primary): carousel ideas × carousel flows, video ideas × video flows, etc.
 * Pass 2 (fallback): ideas **without** `format`, or post/thread/other buckets only — never
 * cross-format fallback for declared carousel or video ideas.
 */
import { CANONICAL_FLOW_TYPES, resolveCanonicalFlowType } from "../domain/canonical-flow-types.js";
import { isCarouselFlow, isVideoFlow, isImageFlow } from "./flow-kind.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
  isTopPerformerMimicCarouselFlow,
  isTopPerformerMimicImageFlow,
} from "../domain/top-performer-mimic-flow-types.js";
import type { ScoredCandidate } from "./types.js";

/** Standard renderer carousel (not top-performer mimic). */
export function isStandardTemplatedCarouselFlow(flowType: string): boolean {
  if (isTopPerformerMimicCarouselFlow(flowType) || isTopPerformerMimicImageFlow(flowType)) {
    return false;
  }
  return resolveCanonicalFlowType(flowType) === CANONICAL_FLOW_TYPES.CAROUSEL;
}

/** Run-level max_carousel_jobs_per_run applies to templated carousels only (mimic is separate). */
export function countsTowardCarouselRunCap(flowType: string): boolean {
  return isStandardTemplatedCarouselFlow(flowType);
}

export type IdeaFormatBucket = "carousel" | "video" | "post" | "thread" | "other";

/** Planner / signal-pack row `format` field (same buckets as idea payloads). */
export function bucketForRowFormat(row: Record<string, unknown>): IdeaFormatBucket | null {
  return bucketForIdeaFormat(row.format);
}

export function bucketForIdeaFormat(raw: unknown): IdeaFormatBucket | null {
  const f = String(raw ?? "")
    .toLowerCase()
    .trim();
  if (!f) return null;
  if (f === "carousel") return "carousel";
  if (f === "video") return "video";
  if (f === "post") return "post";
  if (f === "thread") return "thread";
  return "other";
}

export function bucketForFlowType(flowType: string): IdeaFormatBucket {
  if (flowType === FLOW_TOP_PERFORMER_MIMIC_IMAGE) return "post";
  if (isCarouselFlow(flowType)) return "carousel";
  if (isVideoFlow(flowType)) return "video";
  if (isImageFlow(flowType)) return "post";
  return "other";
}

export function ideaIdFromCandidate(c: ScoredCandidate): string {
  const p = (c.payload ?? {}) as Record<string, unknown>;
  const fromPayload = String(p.idea_id ?? p.candidate_id ?? p.id ?? "").trim();
  if (fromPayload) return fromPayload;
  const cid = String(c.candidate_id).trim();
  const lastUnderscore = cid.lastIndexOf("_");
  if (lastUnderscore > 0) return cid.slice(0, lastUnderscore);
  return cid;
}

/** Idea declares a format and the flow family matches (carousel↔carousel, video↔video, post/thread/other↔other). */
export function isPrimaryFormatMatch(c: ScoredCandidate): boolean {
  const ideaBucket = bucketForIdeaFormat((c.payload ?? {}).format);
  if (!ideaBucket) return false;
  if (isTopPerformerMimicImageFlow(c.flow_type) && ideaBucket === "carousel") return true;
  const flowBucket = bucketForFlowType(c.flow_type);
  if (ideaBucket === "post" || ideaBucket === "thread" || ideaBucket === "other") {
    return flowBucket === "other";
  }
  return ideaBucket === flowBucket;
}

/** Whether an enabled flow may be expanded for a planner row with a declared `format`. */
export function flowTypeMatchesRowFormat(
  flowType: string,
  ideaBucket: IdeaFormatBucket | null
): boolean {
  if (!ideaBucket) return true;
  if (isTopPerformerMimicImageFlow(flowType) && ideaBucket === "carousel") return true;
  const flowBucket = bucketForFlowType(flowType);
  if (ideaBucket === "post" || ideaBucket === "thread" || ideaBucket === "other") {
    return flowBucket === "other";
  }
  return ideaBucket === flowBucket;
}

const STRICT_FORMAT_BUCKETS = new Set<IdeaFormatBucket>(["carousel", "video"]);

/**
 * Planning dedupe lane within a format bucket. Standard carousel/video flows share a lane
 * (one job per idea); mimic flows use separate lanes so they can run parallel to FLOW_CAROUSEL.
 */
export function planningLaneForFlowType(flowType: string): string {
  if (isTopPerformerMimicCarouselFlow(flowType)) return "mimic_carousel";
  if (isTopPerformerMimicImageFlow(flowType)) return "mimic_image";
  if (isCarouselFlow(flowType)) return "carousel";
  if (isVideoFlow(flowType)) return "video";
  return bucketForFlowType(flowType);
}

/** Pass 1: at most one planned job per idea per lane within its declared format family. */
export function ideaKeyPrimaryPass(c: ScoredCandidate): string {
  const ideaId = ideaIdFromCandidate(c);
  const ideaBucket = bucketForIdeaFormat((c.payload ?? {}).format) ?? "other";
  const lane = planningLaneForFlowType(c.flow_type);
  return `${ideaId}|primary:${ideaBucket}:${lane}`;
}

/** Pass 2 / legacy: one job per idea per output flow family. */
export function ideaKeyFallbackPass(c: ScoredCandidate): string {
  return `${ideaIdFromCandidate(c)}|${bucketForFlowType(c.flow_type)}`;
}

/** Legacy single-pass dedupe (idea format bucket, else flow bucket). */
export function ideaKeyLegacyDedupe(c: ScoredCandidate): string {
  const ideaBucket = bucketForIdeaFormat((c.payload ?? {}).format);
  if (ideaBucket) return `${ideaIdFromCandidate(c)}|${ideaBucket}`;
  return ideaKeyFallbackPass(c);
}

/** One best-scored templated carousel candidate per idea, highest ideas first. */
export function orderTemplatedCarouselCandidatesByIdea(
  candidates: ScoredCandidate[]
): ScoredCandidate[] {
  const byIdea = new Map<string, ScoredCandidate>();
  for (const c of candidates) {
    if (!isStandardTemplatedCarouselFlow(c.flow_type)) continue;
    const id = ideaIdFromCandidate(c);
    const prev = byIdea.get(id);
    if (!prev || c.pre_gen_score > prev.pre_gen_score) byIdea.set(id, c);
  }
  return [...byIdea.values()].sort((a, b) => b.pre_gen_score - a.pre_gen_score);
}

export function partitionPrimaryForCarouselSpread(primary: ScoredCandidate[]): {
  templatedCarousel: ScoredCandidate[];
  other: ScoredCandidate[];
} {
  const templatedCarousel = orderTemplatedCarouselCandidatesByIdea(primary);
  const other = primary.filter((c) => !isStandardTemplatedCarouselFlow(c.flow_type));
  return { templatedCarousel, other };
}

export function partitionCandidatesForPlanningPhases(sorted: ScoredCandidate[]): {
  primary: ScoredCandidate[];
  fallback: ScoredCandidate[];
} {
  const primary: ScoredCandidate[] = [];
  const fallback: ScoredCandidate[] = [];
  for (const c of sorted) {
    if (isPrimaryFormatMatch(c)) {
      primary.push(c);
      continue;
    }
    const ideaBucket = bucketForIdeaFormat((c.payload ?? {}).format);
    if (ideaBucket && STRICT_FORMAT_BUCKETS.has(ideaBucket)) {
      continue;
    }
    fallback.push(c);
  }
  return { primary, fallback };
}
