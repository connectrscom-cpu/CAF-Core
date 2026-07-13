import { normalizeCartItemFlow } from "./cart-flow-resolve";
import type { ContentCartItem } from "./types";
import type { VideoPipelineIntent } from "./video-lane";
import { isVideoTopPerformerItem, videoIntentFromFlowType } from "./video-lane";

export type CartMimicPick = {
  insights_id: string;
  mimic_kind: "carousel" | "why_carousel" | "video" | "image";
  video_intent?: VideoPipelineIntent;
};

export type CartIdeaPick = {
  idea_id: string;
  target_flow_type: string;
  platform?: string;
  use_brand_visual_system?: boolean;
};

export type CartMaterializeBody = {
  idea_ids: string[];
  idea_picks: CartIdeaPick[];
  mimic_picks: CartMimicPick[];
  bvs_overrides: Array<{ key: string; enabled: boolean }>;
  cart_manifest: CartManifestLine[];
};

export type CartManifestLine = {
  cart_item_id: string;
  kind: "idea" | "top_performer";
  title?: string;
  target_flow_type: string;
  platform?: string;
  format?: string;
  use_brand_visual_system?: boolean;
  linkedin_aspect_ratio?: "1:1" | "4:5";
  linkedin_image_count?: 2 | 3;
  insights_id?: string;
  mimic_kind?: CartMimicPick["mimic_kind"];
  video_intent?: VideoPipelineIntent;
};

export type CartMimicRenderOverride = {
  insights_id: string;
  mode_override: "template_bg" | "carousel_visual";
};

function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/** Normalize cart idea ids (`idea_idea_712_…` → `idea_712_…`). */
export function normalizeCartIdeaId(raw: string): string {
  const core = String(raw ?? "")
    .trim()
    .replace(/^(idea_)+/i, "");
  return core ? `idea_${core}` : "";
}

export function cartTopPerformerToMimicPick(item: ContentCartItem): CartMimicPick | null {
  const insightsId = stripPrefix(item.id, "tp_").trim();
  if (!insightsId) return null;

  if (isVideoTopPerformerItem(item)) {
    const video_intent = item.videoIntent ?? videoIntentFromFlowType(item.flowTypeRaw);
    return {
      insights_id: insightsId,
      mimic_kind: "video",
      ...(video_intent ? { video_intent } : {}),
    };
  }

  if (item.mimicMode === "why_carousel" || item.flowTypeRaw === "FLOW_WHY_MIMIC_CAROUSEL") {
    return { insights_id: insightsId, mimic_kind: "why_carousel" };
  }

  const fmt = String(item.format ?? "").toLowerCase();
  const flow = String(item.flowTypeRaw ?? "").toUpperCase();
  if (fmt.includes("image") || flow.includes("MIMIC_IMAGE")) {
    return { insights_id: insightsId, mimic_kind: "image" };
  }
  return { insights_id: insightsId, mimic_kind: "carousel" };
}

export function cartItemsToMaterializeBody(items: ContentCartItem[]): CartMaterializeBody {
  const normalized = items.map(normalizeCartItemFlow);
  const idea_ids: string[] = [];
  const idea_picks: CartIdeaPick[] = [];
  const mimic_picks: CartMimicPick[] = [];
  const seenIdeas = new Set<string>();
  const seenMimic = new Set<string>();

  for (const item of normalized) {
    if (item.kind === "idea") {
      const ideaId = normalizeCartIdeaId(item.id);
      if (!ideaId || seenIdeas.has(ideaId)) continue;
      seenIdeas.add(ideaId);
      idea_ids.push(ideaId);
      const flowType = String(item.flowTypeRaw ?? "").trim();
      if (flowType.startsWith("FLOW_")) {
        idea_picks.push({
          idea_id: ideaId,
          target_flow_type: flowType,
          ...(item.platform ? { platform: item.platform } : {}),
          use_brand_visual_system: item.useBrandVisualSystem !== false,
        });
      }
      continue;
    }
    const pick = cartTopPerformerToMimicPick(item);
    if (!pick) continue;
    const key = `${pick.mimic_kind}:${pick.insights_id}`;
    if (seenMimic.has(key)) continue;
    seenMimic.add(key);
    mimic_picks.push(pick);
  }

  return { idea_ids, idea_picks, mimic_picks, bvs_overrides: cartBvsOverrides(normalized), cart_manifest: buildCartManifest(normalized) };
}

export function buildCartManifest(items: ContentCartItem[]): CartManifestLine[] {
  return items.map((item) => {
    if (item.kind === "idea") {
      return {
        cart_item_id: item.id,
        kind: "idea" as const,
        title: item.title,
        target_flow_type: item.flowTypeRaw,
        platform: item.platform,
        format: item.format,
        use_brand_visual_system: item.useBrandVisualSystem !== false,
        ...(item.linkedinAspectRatio ? { linkedin_aspect_ratio: item.linkedinAspectRatio } : {}),
        ...(item.linkedinImageCount != null ? { linkedin_image_count: item.linkedinImageCount } : {}),
      };
    }
    const pick = cartTopPerformerToMimicPick(item);
    return {
      cart_item_id: item.id,
      kind: "top_performer" as const,
      title: item.title,
      target_flow_type: item.flowTypeRaw,
      platform: item.platform,
      format: item.format,
      use_brand_visual_system: item.useBrandVisualSystem !== false,
      insights_id: pick?.insights_id,
      mimic_kind: pick?.mimic_kind,
      ...(pick?.video_intent ? { video_intent: pick.video_intent } : {}),
    };
  });
}

export function cartBvsKeyForItem(item: ContentCartItem): string | null {
  if (item.kind === "idea") {
    const ideaId = normalizeCartIdeaId(item.id);
    return ideaId || null;
  }
  const pick = cartTopPerformerToMimicPick(item);
  if (!pick) return null;
  return `mimic:${pick.mimic_kind}:${pick.insights_id}`;
}

export function cartBvsOverrides(items: ContentCartItem[]): Array<{ key: string; enabled: boolean }> {
  const out: Array<{ key: string; enabled: boolean }> = [];
  for (const item of items) {
    const key = cartBvsKeyForItem(item);
    if (!key) continue;
    out.push({ key, enabled: item.useBrandVisualSystem !== false });
  }
  return out;
}

export function cartMimicRenderOverrides(items: ContentCartItem[]): CartMimicRenderOverride[] {
  const out: CartMimicRenderOverride[] = [];
  for (const item of items) {
    if (item.kind !== "top_performer") continue;
    const insightsId = stripPrefix(item.id, "tp_").trim();
    if (!insightsId) continue;
    const mode =
      item.renderMode === "template"
        ? "template_bg"
        : item.renderMode === "full_bleed"
          ? "carousel_visual"
          : null;
    if (mode) out.push({ insights_id: insightsId, mode_override: mode });
  }
  return out;
}
