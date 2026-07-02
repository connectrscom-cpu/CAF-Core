import { getGenerationStrategyOption } from "./generation-strategy";
import { humanizeFlowType } from "./language";
import type { ContentCartItem, ContentIdea, GenerationStrategy } from "./types";

const CAROUSEL_PROFILE_TO_FLOW: Record<string, string> = {
  text_heavy: "FLOW_CAROUSEL",
  visual_first: "FLOW_VISUAL_FIRST_CAROUSEL",
  mixed: "FLOW_CAROUSEL",
};

const VIDEO_PROFILE_TO_FLOW: Record<string, string> = {
  script_avatar: "FLOW_VID_SCRIPT",
  prompt_avatar: "FLOW_VID_PROMPT",
  no_avatar: "FLOW_VID_PROMPT_NO_AVATAR",
};

export function resolveCartFlowForIdea(
  idea: Pick<ContentIdea, "format" | "targetFlowType" | "platform">,
  strategy: GenerationStrategy = "caf_recommended"
): { flowTypeRaw: string; flowDestination: string; generationStrategy: GenerationStrategy } {
  const opt = getGenerationStrategyOption(strategy);
  if (opt?.resolvedFlowType) {
    return {
      flowTypeRaw: opt.resolvedFlowType,
      flowDestination: humanizeFlowType(opt.resolvedFlowType),
      generationStrategy: strategy,
    };
  }

  const raw = String(idea.targetFlowType ?? "").trim();
  if (raw.startsWith("FLOW_")) {
    return {
      flowTypeRaw: raw,
      flowDestination: humanizeFlowType(raw),
      generationStrategy: "caf_recommended",
    };
  }

  const profile = raw.toLowerCase();
  const format = String(idea.format ?? "").toLowerCase();
  let flowTypeRaw = "FLOW_CAROUSEL";

  if (format === "video") {
    flowTypeRaw = VIDEO_PROFILE_TO_FLOW[profile] ?? "FLOW_VID_PROMPT";
  } else if (format === "carousel") {
    flowTypeRaw = CAROUSEL_PROFILE_TO_FLOW[profile] ?? "FLOW_CAROUSEL";
  } else if (format === "post" || format === "thread") {
    flowTypeRaw = "FLOW_TEXT";
  }

  return {
    flowTypeRaw,
    flowDestination: humanizeFlowType(flowTypeRaw),
    generationStrategy: "caf_recommended",
  };
}

export function ideaShapeFromCartItem(item: ContentCartItem): Pick<ContentIdea, "format" | "targetFlowType" | "platform"> {
  return {
    format: item.format ?? "carousel",
    targetFlowType: item.ideaTargetFlowType ?? item.flowTypeRaw,
    platform: item.platform ?? "",
  };
}

export function normalizeCartItemFlow(item: ContentCartItem): ContentCartItem {
  if (item.kind === "top_performer") {
    return item.flowTypeRaw.startsWith("FLOW_")
      ? item
      : {
          ...item,
          flowTypeRaw: "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
          flowDestination: humanizeFlowType("FLOW_TOP_PERFORMER_MIMIC_CAROUSEL"),
        };
  }

  const strategy = item.generationStrategy ?? "caf_recommended";
  const resolved = resolveCartFlowForIdea(ideaShapeFromCartItem(item), strategy);
  return {
    ...item,
    generationStrategy: resolved.generationStrategy,
    flowTypeRaw: resolved.flowTypeRaw,
    flowDestination: resolved.flowDestination,
  };
}

export interface CartCreationLine {
  cart_item_id: string;
  kind: ContentCartItem["kind"];
  title: string;
  flow_type: string;
  flow_label: string;
  generation_strategy?: GenerationStrategy;
  format?: string;
  platform?: string;
  mimic_mode?: ContentCartItem["mimicMode"];
  render_mode?: ContentCartItem["renderMode"];
  use_brand_visual_system?: boolean;
}

export function buildCartCreationPayload(slug: string, items: ContentCartItem[]): {
  project_slug: string;
  prepared_at: string;
  item_count: number;
  items: CartCreationLine[];
} {
  const normalized = items.map(normalizeCartItemFlow);
  return {
    project_slug: slug,
    prepared_at: new Date().toISOString(),
    item_count: normalized.length,
    items: normalized.map((item) => ({
      cart_item_id: item.id,
      kind: item.kind,
      title: item.title,
      flow_type: item.flowTypeRaw,
      flow_label: item.flowDestination,
      generation_strategy: item.kind === "idea" ? item.generationStrategy : undefined,
      format: item.format,
      platform: item.platform,
      mimic_mode: item.mimicMode,
      render_mode: item.renderMode,
      use_brand_visual_system: item.useBrandVisualSystem !== false,
    })),
  };
}
