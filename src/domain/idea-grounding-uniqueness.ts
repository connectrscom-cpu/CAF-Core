import type { SignalPackIdeaV2 } from "./signal-pack-ideas-v2.js";

/**
 * Each grounding insight id may appear in at most one idea's `grounding_insight_ids`
 * (so one top-performer / evidence insight is not claimed by multiple ideas).
 */
export function assertGroundingInsightIdsUniqueAcrossIdeas(ideas: SignalPackIdeaV2[]): void {
  const owner = new Map<string, string>();
  for (const idea of ideas) {
    const iid = String(idea.id ?? "").trim() || "unknown";
    const g = Array.isArray(idea.grounding_insight_ids) ? idea.grounding_insight_ids : [];
    for (const ref of g.map((x) => String(x).trim()).filter(Boolean)) {
      const prev = owner.get(ref);
      if (prev && prev !== iid) {
        throw new Error(
          `grounding_insight_ids must be unique across ideas: "${ref}" is used by idea "${prev}" and "${iid}"`
        );
      }
      owner.set(ref, iid);
    }
  }
}
