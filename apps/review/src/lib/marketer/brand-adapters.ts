import type { ProjectAdminRow, ReviewQueueCounts } from "@/lib/caf-core-client";
import type { BrandSummary, ResearchPipelineStatus } from "./types";
import { buildBrandOnboardingSteps, onboardingProgress } from "./onboarding";

export interface BrandSummaryInput {
  project: ProjectAdminRow;
  counts: ReviewQueueCounts;
  scheduledPosts: number;
  evidenceImportCount: number;
  signalPackCount: number;
  latestPackIdeasCount: number;
  hasBrandProfile: boolean;
  hasBrandBible?: boolean;
}

function pipelineStatus(hasData: boolean, hasRecent: boolean): ResearchPipelineStatus {
  if (!hasData) return "not_started";
  if (hasRecent) return "ready";
  return "stale";
}

/** Header/switcher-only brand row — no Core fan-out (stats are zeros). */
export function toLiteBrandSummary(project: ProjectAdminRow): BrandSummary {
  const displayName = (project.display_name ?? "").trim() || project.slug;
  return {
    slug: project.slug,
    displayName,
    accentColor: project.color ?? null,
    isActive: project.active,
    stats: {
      pendingReview: 0,
      needsEdits: 0,
      approved: 0,
      scheduledPosts: 0,
      activeContent: 0,
    },
    researchStatus: "not_started",
    intelligenceStatus: "not_started",
    ideasReady: 0,
    lastActivityAt: project.updated_at ?? project.created_at ?? null,
    setupWarnings: [],
    onboardingProgress: 0,
    onboardingStepsComplete: 0,
    onboardingStepsTotal: 0,
  };
}

export function toBrandSummary(input: BrandSummaryInput): BrandSummary {
  const { project, counts } = input;
  const displayName = (project.display_name ?? "").trim() || project.slug;
  const hasResearch = input.evidenceImportCount > 0;
  const hasIntelligence = input.signalPackCount > 0;
  const hasIdeas = input.latestPackIdeasCount > 0;
  const hasContent =
    counts.in_review > 0 || counts.needs_edit > 0 || counts.approved > 0 || counts.rejected > 0;
  const hasPublishing = input.scheduledPosts > 0;

  const steps = buildBrandOnboardingSteps({
    slug: project.slug,
    hasProfile: input.hasBrandProfile,
    hasBrandBible: input.hasBrandBible === true,
    hasResearch,
    hasIntelligence,
    hasIdeas,
    hasContentReview: hasContent,
    hasPublishing,
  });
  const progress = onboardingProgress(steps);

  const setupWarnings: string[] = [];
  if (!input.hasBrandProfile) setupWarnings.push("Brand profile not configured");
  if (!hasResearch) setupWarnings.push("No research imported yet");
  if (!hasIntelligence) setupWarnings.push("Market intelligence not ready");
  if (counts.in_review > 0) setupWarnings.push(`${counts.in_review} item(s) waiting for your review`);

  const activeContent = counts.in_review + counts.needs_edit + counts.approved;

  return {
    slug: project.slug,
    displayName,
    accentColor: project.color ?? null,
    isActive: project.active,
    stats: {
      pendingReview: counts.in_review,
      needsEdits: counts.needs_edit,
      approved: counts.approved,
      scheduledPosts: input.scheduledPosts,
      activeContent,
    },
    researchStatus: pipelineStatus(hasResearch, hasResearch),
    intelligenceStatus: pipelineStatus(hasIntelligence, hasIntelligence && hasIdeas),
    ideasReady: input.latestPackIdeasCount,
    lastActivityAt: project.updated_at ?? project.created_at ?? null,
    setupWarnings,
    onboardingProgress: progress.percent,
    onboardingStepsComplete: progress.complete,
    onboardingStepsTotal: progress.total,
  };
}

export function brandInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return displayName.slice(0, 2).toUpperCase() || "??";
}

export function brandAvatarStylePlain(accentColor: string | null): { background: string; color: string } {
  if (accentColor && /^#[0-9a-fA-F]{3,8}$/.test(accentColor)) {
    return { background: accentColor, color: "#fff" };
  }
  return { background: "rgba(59,130,246,0.15)", color: "#3b82f6" };
}
