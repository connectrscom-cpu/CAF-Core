import type { GenerationStrategy, GenerationStrategyOption } from "./types";

export const GENERATION_STRATEGY_OPTIONS: GenerationStrategyOption[] = [
  {
    id: "original",
    label: "Original content",
    description: "Create fresh content using your brand profile and research context.",
    resolvedFlowType: "FLOW_CAROUSEL",
  },
  {
    id: "winning_format",
    label: "Use winning format",
    description: "Follow the structure of a top-performing post with new copy.",
    resolvedFlowType: "FLOW_VISUAL_FIRST_CAROUSEL",
  },
  {
    id: "visual_mimic",
    label: "Visual mimic",
    description: "Recreate a top performer's visual pattern safely with your brand voice.",
    resolvedFlowType: "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
  },
  {
    id: "brand_style",
    label: "Brand style",
    description: "Use your established visual and content style.",
    resolvedFlowType: "FLOW_VISUAL_FIRST_CAROUSEL",
  },
  {
    id: "caf_recommended",
    label: "CAF recommended",
    description: "Let CAF pick the best strategy for this idea.",
  },
];

export function getGenerationStrategyOption(id: GenerationStrategy): GenerationStrategyOption | undefined {
  return GENERATION_STRATEGY_OPTIONS.find((o) => o.id === id);
}

/** Keep strategies whose resolved flow is enabled (or caf_recommended with no fixed flow). */
export function filterGenerationStrategiesByEnabledFlows(
  enabledFlowTypes: Iterable<string>
): GenerationStrategyOption[] {
  const enabled = new Set([...enabledFlowTypes].map((f) => f.trim()).filter(Boolean));
  if (enabled.size === 0) return GENERATION_STRATEGY_OPTIONS;
  return GENERATION_STRATEGY_OPTIONS.filter((opt) => {
    if (!opt.resolvedFlowType) return true;
    return enabled.has(opt.resolvedFlowType);
  });
}
