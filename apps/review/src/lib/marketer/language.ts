/**
 * Internal CAF concept → marketer-facing label map.
 * Use consistently in UI copy, nav, and adapters.
 */

export const MARKETER_LABELS = {
  workspace: "Your workspace",
  brands: "Brands",
  brand: "Brand",
  allBrands: "All brands",
  brandProfile: "Brand profile",
  research: "Research",
  marketIntelligence: "Market intelligence",
  ideas: "Ideas",
  content: "Content",
  contentReview: "Content to review",
  publishing: "Publishing",
  performance: "Performance & learning",
  researchBrief: "Research brief",
  researchItems: "Research items",
  contentPiece: "Content piece",
  qualityCheck: "Quality check",
  brandSafety: "Brand safety",
  scheduledPost: "Scheduled post",
  generationStrategy: "Generation strategy",
  contentFormat: "Content format",
  contentCycle: "Content cycle",
} as const;

/** Operator-only labels — hidden from default marketer nav. */
export const OPERATOR_LABELS = {
  reviewConsole: "Review console",
  runs: "Runs",
  signalPacks: "Signal packs",
  flowEngine: "Flow engine",
  learningAdmin: "Learning admin",
  projectConfig: "Project config",
  renderer: "Renderer",
} as const;

const FLOW_TYPE_LABELS: Record<string, string> = {
  FLOW_CAROUSEL: "Carousel",
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL: "Visual mimic (carousel)",
  FLOW_TOP_PERFORMER_MIMIC_IMAGE: "Visual mimic (image)",
  FLOW_VISUAL_FIRST_CAROUSEL: "Brand-style carousel",
  FLOW_VIDEO: "Video",
  FLOW_PRODUCT_VIDEO: "Product video",
};

export function humanizeFlowType(flowType: string | null | undefined): string {
  const raw = String(flowType ?? "").trim();
  if (!raw) return "—";
  return FLOW_TYPE_LABELS[raw] ?? raw.replace(/^FLOW_/, "").replace(/_/g, " ").toLowerCase();
}

const CONTENT_STATUS_LABELS: Record<string, string> = {
  in_review: "Needs review",
  needs_edit: "Needs edits",
  approved: "Approved",
  rejected: "Rejected",
  PLANNED: "Draft",
  GENERATING: "Draft",
  RENDERING: "Draft",
};

export function humanizeContentStatus(status: string | null | undefined): string {
  const raw = String(status ?? "").trim();
  if (!raw) return "—";
  return CONTENT_STATUS_LABELS[raw] ?? raw.replace(/_/g, " ").toLowerCase();
}

const PUBLISH_STATUS_LABELS: Record<string, string> = {
  draft: "Ready to publish",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function humanizePublishStatus(status: string | null | undefined): string {
  const raw = String(status ?? "").trim();
  if (!raw) return "—";
  return PUBLISH_STATUS_LABELS[raw] ?? raw;
}
