/**
 * Format-first planning: ideas with `format` are matched to flow families in two passes.
 *
 * Pass 1 (primary): carousel ideas × carousel flows, video ideas × video flows, etc.
 * Pass 2 (fallback): same ideas may compete for other flow families (e.g. carousel idea → video)
 * after the primary pass, using per-(idea, flow-bucket) dedupe so one idea can still get both
 * a carousel job and a video job when caps allow.
 */
import { isCarouselFlow, isVideoFlow } from "./flow-kind.js";
import type { ScoredCandidate } from "./types.js";

export type IdeaFormatBucket = "carousel" | "video" | "post" | "thread" | "other";

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
  if (isCarouselFlow(flowType)) return "carousel";
  if (isVideoFlow(flowType)) return "video";
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
  const flowBucket = bucketForFlowType(c.flow_type);
  if (ideaBucket === "post" || ideaBucket === "thread" || ideaBucket === "other") {
    return flowBucket === "other";
  }
  return ideaBucket === flowBucket;
}

/** Pass 1: at most one planned job per idea within its declared format family. */
export function ideaKeyPrimaryPass(c: ScoredCandidate): string {
  const ideaId = ideaIdFromCandidate(c);
  const ideaBucket = bucketForIdeaFormat((c.payload ?? {}).format) ?? "other";
  return `${ideaId}|primary:${ideaBucket}`;
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

export function partitionCandidatesForPlanningPhases(sorted: ScoredCandidate[]): {
  primary: ScoredCandidate[];
  fallback: ScoredCandidate[];
} {
  const primary: ScoredCandidate[] = [];
  const fallback: ScoredCandidate[] = [];
  for (const c of sorted) {
    if (isPrimaryFormatMatch(c)) primary.push(c);
    else fallback.push(c);
  }
  return { primary, fallback };
}
