/**
 * Placeholder flow_type keys for content that mimics signal-pack top performers
 * (`derived_globals_json.visual_guidelines_pack_v1`, hashtag leaderboard, etc.).
 * Generation / planning wiring is not implemented yet — caps are reserved in admin UI.
 */
export const FLOW_TOP_PERFORMER_MIMIC_VIDEO = "FLOW_TOP_PERFORMER_MIMIC_VIDEO";
export const FLOW_TOP_PERFORMER_MIMIC_CAROUSEL = "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL";
export const FLOW_TOP_PERFORMER_MIMIC_IMAGE = "FLOW_TOP_PERFORMER_MIMIC_IMAGE";

export const TOP_PERFORMER_MIMIC_FLOW_TYPES = [
  FLOW_TOP_PERFORMER_MIMIC_VIDEO,
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
] as const;

export type TopPerformerMimicFlowType = (typeof TOP_PERFORMER_MIMIC_FLOW_TYPES)[number];

export function isTopPerformerMimicFlow(flowType: string): boolean {
  const ft = (flowType ?? "").trim();
  return (TOP_PERFORMER_MIMIC_FLOW_TYPES as readonly string[]).includes(ft);
}
