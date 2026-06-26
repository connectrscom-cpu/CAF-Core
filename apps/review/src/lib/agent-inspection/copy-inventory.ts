import { MARKETER_LABELS } from "@/lib/marketer/language";

export const SIDEBAR_LABELS = [
  MARKETER_LABELS.brands,
  "Dashboard",
  MARKETER_LABELS.brandProfile,
  MARKETER_LABELS.research,
  MARKETER_LABELS.marketIntelligence,
  MARKETER_LABELS.ideas,
  MARKETER_LABELS.content,
  MARKETER_LABELS.publishing,
  MARKETER_LABELS.performance,
] as const;

export const DASHBOARD_LABELS = [
  "What should you do next?",
  "Recommended next steps",
  "Overview",
  "Needs review",
  "Needs edits",
  "Approved",
  "Scheduled",
  "Ideas ready",
  "Pipeline status",
] as const;

export const STATUS_LABELS = [
  "Ready",
  "In progress",
  "Not started",
  "May need refresh",
  "Setup needed",
  "Waiting",
  "Empty",
  "Scheduled",
  "—",
] as const;

export function buildCopyInventory() {
  return {
    sidebar_labels: [...SIDEBAR_LABELS],
    dashboard_labels: [...DASHBOARD_LABELS],
    status_labels: [...STATUS_LABELS],
    workspace_labels: [MARKETER_LABELS.workspace, MARKETER_LABELS.brands, "How it works", "Needs your attention"],
  };
}
