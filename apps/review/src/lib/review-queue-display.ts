import { humanizeContentStatus, humanizeFlowType } from "@/lib/marketer/language";
import type { ReviewQueueRow } from "@/lib/types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function recordVal(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** True when text is a task_id, run id fragment, or other operator-only label. */
export function isInternalTaskLabel(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^(RUN|SNS)_[\w\d-]+__/i.test(t)) return true;
  if (/__FLOW_/i.test(t)) return true;
  if (/__row\d+__/i.test(t)) return true;
  if (/^from_idea_list:/i.test(t)) return true;
  if (t.length > 72 && /_{2,}/.test(t)) return true;
  return false;
}

export function pickHeadlineFromSlidesJson(slidesJson: string): string {
  if (!slidesJson.trim()) return "";
  try {
    const parsed = JSON.parse(slidesJson) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      const s0 = recordVal(parsed[0]);
      if (s0) {
        const headline =
          str(s0.headline) || str(s0.title) || str(s0.cover) || str(recordVal(s0.cover_slide)?.headline);
        if (headline) return headline;
      }
    }
    const deck = recordVal(parsed);
    if (deck) {
      const coverSlide = recordVal(deck.cover_slide);
      const cover = str(deck.cover) || str(coverSlide?.headline);
      if (cover) return cover;
    }
  } catch {
    /* ignore malformed slide JSON */
  }
  return "";
}

export function humanizePlatform(platform: string): string {
  const p = platform.trim();
  if (!p) return "";
  const key = p.toLowerCase();
  const map: Record<string, string> = {
    instagram: "Instagram",
    tiktok: "TikTok",
    facebook: "Facebook",
    youtube: "YouTube",
    linkedin: "LinkedIn",
    twitter: "X",
    x: "X",
    multi: "Multi-platform",
  };
  return map[key] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

export function marketerFormatLabel(row: ReviewQueueRow): string {
  const flowType = str(row.flow_type);
  if (flowType) return humanizeFlowType(flowType);

  const label = str(row.flow_label);
  if (!label) return "—";
  if (/carousel/i.test(label)) return "Carousel";
  if (/video/i.test(label)) return "Video";
  if (/image/i.test(label)) return "Image";
  const primary = label.split("·")[0]?.trim();
  return primary || label;
}

export function displayTaskTitle(row: ReviewQueueRow): string {
  const fromSlides = pickHeadlineFromSlidesJson(str(row.generated_slides_json));
  const captionLine = str(row.generated_caption).split(/\n/)[0]?.trim() ?? "";

  const candidates = [
    str(row.generated_title),
    str(row.generated_hook),
    str(row.hook),
    fromSlides,
    captionLine,
  ].filter((t) => !isInternalTaskLabel(t));

  if (candidates[0]) {
    const t = candidates[0];
    return t.length > 120 ? `${t.slice(0, 117)}…` : t;
  }

  const platform = humanizePlatform(str(row.platform));
  const format = marketerFormatLabel(row);
  if (platform && format !== "—") return `${format} · ${platform}`;
  if (format !== "—") return format;
  return "Untitled content";
}

export function displayReviewStatus(status: string, marketerMode: boolean): string {
  if (!status) return "—";
  return marketerMode ? humanizeContentStatus(status) : status;
}

export function displayDecision(decision: string, marketerMode: boolean): string {
  if (!decision) return "—";
  return marketerMode ? humanizeContentStatus(decision) : decision;
}

const ROUTE_LABELS: Record<string, string> = {
  HUMAN_REVIEW: "Your review",
  AUTO_PUBLISH: "Auto-publish",
  AUTO_APPROVE: "Auto-approve",
  SKIP: "Skip",
};

export function displayRecommendedRoute(route: string, marketerMode: boolean): string {
  if (!route) return "—";
  if (!marketerMode) return route;
  return ROUTE_LABELS[route.toUpperCase()] ?? route.replace(/_/g, " ").toLowerCase();
}
