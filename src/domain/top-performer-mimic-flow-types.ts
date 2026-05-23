/**
 * Top-performer mimic flow_type keys (image + carousel wired when MIMIC_IMAGE_ENABLED).
 * Video mimic remains a placeholder. Read knowledge via `pickTopPerformerKnowledgeForStep`.
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

export function isTopPerformerMimicImageFlow(flowType: string): boolean {
  return (flowType ?? "").trim() === FLOW_TOP_PERFORMER_MIMIC_IMAGE;
}

export function isTopPerformerMimicCarouselFlow(flowType: string): boolean {
  return (flowType ?? "").trim() === FLOW_TOP_PERFORMER_MIMIC_CAROUSEL;
}

/** Image + carousel mimic flows wired to MIMIC_IMAGE_PROVIDER (DashScope, NVIDIA, or OpenAI). */
export function isTopPerformerMimicRenderableFlow(flowType: string): boolean {
  return isTopPerformerMimicImageFlow(flowType) || isTopPerformerMimicCarouselFlow(flowType);
}

export const TOP_PERFORMER_MIMIC_FLOW_NOT_READY_MESSAGE =
  "Top-performer mimic copy generation requires OPENAI_API_KEY.";

export const TOP_PERFORMER_MIMIC_RENDER_NOT_READY_MESSAGE =
  "Top-performer mimic render requires MIMIC_IMAGE_ENABLED=1, a configured MIMIC_IMAGE_PROVIDER (DASHSCOPE_API_KEY, NVIDIA_NIM_API_KEY, or OPENAI_API_KEY), and archived top-performer inspection media on the signal pack.";
