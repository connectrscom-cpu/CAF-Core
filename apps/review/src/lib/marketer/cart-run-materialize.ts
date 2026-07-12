import { normalizeCartItemFlow } from "./cart-flow-resolve";
import type { ContentCartItem } from "./types";
import type { VideoPipelineIntent } from "./video-lane";
import { isVideoTopPerformerItem } from "./video-lane";

export type CartMimicPick = {
  insights_id: string;
  mimic_kind: "carousel" | "why_carousel" | "video" | "image";
  video_intent?: VideoPipelineIntent;
};

export type CartMaterializeBody = {
  idea_ids: string[];
  mimic_picks: CartMimicPick[];
  bvs_overrides: Array<{ key: string; enabled: boolean }>;
};

export type CartMimicRenderOverride = {
  insights_id: string;
  mode_override: "template_bg" | "carousel_visual";
};

function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

export function cartTopPerformerToMimicPick(item: ContentCartItem): CartMimicPick | null {
  const insightsId = stripPrefix(item.id, "tp_").trim();
  if (!insightsId) return null;

  if (isVideoTopPerformerItem(item)) {
    return {
      insights_id: insightsId,
      mimic_kind: "video",
      video_intent: item.videoIntent,
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
  const mimic_picks: CartMimicPick[] = [];
  const seenIdeas = new Set<string>();
  const seenMimic = new Set<string>();

  for (const item of normalized) {
    if (item.kind === "idea") {
      const ideaId = stripPrefix(item.id, "idea_").trim();
      if (!ideaId || seenIdeas.has(ideaId)) continue;
      seenIdeas.add(ideaId);
      idea_ids.push(ideaId);
      continue;
    }
    const pick = cartTopPerformerToMimicPick(item);
    if (!pick) continue;
    const key = `${pick.mimic_kind}:${pick.insights_id}`;
    if (seenMimic.has(key)) continue;
    seenMimic.add(key);
    mimic_picks.push(pick);
  }

  return { idea_ids, mimic_picks, bvs_overrides: cartBvsOverrides(normalized) };
}

export function cartBvsKeyForItem(item: ContentCartItem): string | null {
  if (item.kind === "idea") {
    const ideaId = stripPrefix(item.id, "idea_").trim();
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
