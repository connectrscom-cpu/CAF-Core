import type { SignalPackIdeaV2 } from "./signal-pack-ideas-v2.js";

export type ManualIdeaInput = {
  title: string;
  /** Short concept / three-liner. */
  concept?: string;
  /** Destination generation route (`FLOW_*`). */
  target_flow_type: string;
  platform?: string;
  content_lens?: "niche" | "product";
};

const MIMIC_FLOW_PREFIXES = ["FLOW_TOP_PERFORMER_MIMIC", "FLOW_WHY_MIMIC"] as const;

/** Mimic destinations need a top-performer reference — not valid for free-text manual ideas. */
export function isManualIdeaDestinationAllowed(flowType: string): boolean {
  const ft = String(flowType ?? "").trim().toUpperCase();
  if (!ft.startsWith("FLOW_")) return false;
  return !MIMIC_FLOW_PREFIXES.some((p) => ft.startsWith(p));
}

export function formatAndProfileForFlow(flowType: string): {
  format: string;
  execution_profile?: string;
  carousel_style?: "text_heavy" | "visual_first" | "mixed";
  video_style?: "script_avatar" | "prompt_avatar" | "no_avatar" | "hook_first" | "ugc";
  defaultPlatform: string;
} {
  const ft = String(flowType ?? "").trim().toUpperCase();
  if (ft.includes("VISUAL_FIRST") || ft === "FLOW_VISUAL_FIRST_CAROUSEL") {
    return {
      format: "carousel",
      execution_profile: "visual_first",
      carousel_style: "visual_first",
      defaultPlatform: "Instagram",
    };
  }
  if (ft.includes("CAROUSEL")) {
    return {
      format: "carousel",
      execution_profile: "text_heavy",
      carousel_style: "text_heavy",
      defaultPlatform: "Instagram",
    };
  }
  if (ft.includes("LINKEDIN_DOCUMENT") || ft.includes("LINKEDIN_IMAGE")) {
    return { format: "linkedin_document", defaultPlatform: "LinkedIn" };
  }
  if (ft.includes("LINKEDIN")) {
    return { format: "linkedin_text", defaultPlatform: "LinkedIn" };
  }
  if (ft.includes("REDDIT")) {
    return { format: "reddit_post", defaultPlatform: "Reddit" };
  }
  if (ft.includes("INSTAGRAM_THREAD") || ft.includes("THREAD")) {
    return { format: "instagram_thread", defaultPlatform: "Instagram" };
  }
  if (ft.includes("HOOK_FIRST")) {
    return {
      format: "video",
      execution_profile: "hook_first",
      video_style: "hook_first",
      defaultPlatform: "Instagram",
    };
  }
  if (ft.includes("UGC")) {
    return {
      format: "video",
      execution_profile: "ugc",
      video_style: "ugc",
      defaultPlatform: "Instagram",
    };
  }
  if (ft.includes("NO_AVATAR")) {
    return {
      format: "video",
      execution_profile: "no_avatar",
      video_style: "no_avatar",
      defaultPlatform: "Instagram",
    };
  }
  if (ft.includes("SCRIPT")) {
    return {
      format: "video",
      execution_profile: "script_avatar",
      video_style: "script_avatar",
      defaultPlatform: "Instagram",
    };
  }
  if (ft.includes("VID") || ft.includes("VIDEO") || ft.includes("SCENE")) {
    return {
      format: "video",
      execution_profile: "prompt_avatar",
      video_style: "prompt_avatar",
      defaultPlatform: "Instagram",
    };
  }
  return { format: "post", defaultPlatform: "Multi" };
}

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function slugIdFragment(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
}

/**
 * Build a pack idea row from marketer free-text input.
 * Fills required SignalPackIdeaV2 fields with sensible defaults so Core validation accepts it.
 */
export function buildManualSignalPackIdea(input: ManualIdeaInput): SignalPackIdeaV2 & {
  target_flow_type: string;
  source: "manual";
} {
  const title = clip(String(input.title ?? "").trim(), 200);
  if (!title) throw new Error("title_required");

  const targetFlow = String(input.target_flow_type ?? "").trim();
  if (!isManualIdeaDestinationAllowed(targetFlow)) {
    throw new Error("invalid_destination");
  }

  const conceptRaw = String(input.concept ?? "").trim() || title;
  const threeLiner = clip(conceptRaw, 1200);
  const thesis = clip(conceptRaw, 800);
  const shaped = formatAndProfileForFlow(targetFlow);
  const platform = clip(String(input.platform ?? "").trim() || shaped.defaultPlatform, 80);
  const lens = input.content_lens === "product" ? "product" : "niche";
  const now = new Date().toISOString();
  const id = `manual_${Date.now().toString(36)}_${slugIdFragment(title) || "idea"}`;

  return {
    id,
    created_at: now,
    title,
    three_liner: threeLiner,
    thesis,
    who_for: lens === "product" ? "Product audience" : "Niche audience",
    format: shaped.format,
    platform,
    why_now: "Marketer-entered idea",
    key_points: [
      clip(threeLiner, 280) || title,
      "Manual idea from Ideas board",
      `Destination: ${targetFlow}`,
    ],
    novelty_angle: "Operator-authored concept",
    cta: "Engage",
    grounding_insight_ids: [`manual_${id}`],
    expected_outcome: "Generate content from a marketer-authored idea",
    risk_flags: [],
    status: "proposed",
    content_lens: lens,
    ...(shaped.execution_profile ? { execution_profile: shaped.execution_profile } : {}),
    ...(shaped.carousel_style ? { carousel_style: shaped.carousel_style } : {}),
    ...(shaped.video_style ? { video_style: shaped.video_style } : {}),
    target_flow_type: targetFlow,
    source: "manual",
  };
}
