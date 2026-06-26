/** Marketer-facing product types — adapters over Core API shapes. */

export type ResearchPipelineStatus = "not_started" | "in_progress" | "ready" | "stale";

export type IdeaStatus = "new" | "selected" | "saved" | "rejected" | "generated";

export type ContentStatus =
  | "draft"
  | "needs_review"
  | "needs_edits"
  | "approved"
  | "rejected"
  | "ready_to_publish";

export type PublishStatus = "ready" | "scheduled" | "publishing" | "published" | "failed";

export type GenerationStrategy =
  | "original"
  | "winning_format"
  | "visual_mimic"
  | "brand_style"
  | "caf_recommended";

export interface BrandStats {
  pendingReview: number;
  needsEdits: number;
  approved: number;
  scheduledPosts: number;
  activeContent: number;
}

export interface BrandSummary {
  slug: string;
  displayName: string;
  accentColor: string | null;
  isActive: boolean;
  stats: BrandStats;
  researchStatus: ResearchPipelineStatus;
  intelligenceStatus: ResearchPipelineStatus;
  ideasReady: number;
  lastActivityAt: string | null;
  setupWarnings: string[];
  onboardingProgress: number;
  onboardingStepsComplete: number;
  onboardingStepsTotal: number;
}

export interface BrandOnboardingStep {
  id: string;
  title: string;
  description: string;
  href: string;
  complete: boolean;
  optional?: boolean;
}

export interface GenerationStrategyOption {
  id: GenerationStrategy;
  label: string;
  description: string;
  resolvedFlowType?: string;
}

export interface BrandProfile {
  slug: string;
  displayName: string;
  description: string;
  voice: string;
  audience: string;
  contentGoals: string;
  positioning: string;
  competitors: string;
  productName: string;
  productUrl: string;
  instagramHandle: string;
  visualStyle: string;
  colors: string;
  domainMetaphors: string;
  allowedMotifs: string;
  forbiddenMotifs: string;
  bannedWords: string[];
  platforms: string[];
  platformFocus: string[];
  hasBrandProfileVersion: boolean;
}

export type MarketInsightCategory =
  | "winning_pattern"
  | "winning_format"
  | "strong_hook"
  | "visual_pattern"
  | "emerging_trend"
  | "opportunity"
  | "saturated_angle"
  | "recommended_direction";

export interface MarketInsight {
  id: string;
  category: MarketInsightCategory;
  title: string;
  summary: string;
  evidenceCount: number;
  confidence: number | null;
}

export interface ContentIdea {
  id: string;
  title: string;
  concept: string;
  rationale: string;
  suggestedFormat: string;
  format: string;
  flowType: string;
  targetFlowType: string;
  contentLens: "product" | "niche" | null;
  emotion: string | null;
  platform: string;
  evidenceBasis: string[];
  keyPoints: string[];
  confidence: number | null;
  priority: "high" | "medium" | "low";
  status: IdeaStatus;
}

export interface TopPerformerRef {
  id: string;
  insightsId: string;
  title: string;
  platform: string;
  format: string;
  mimicKind: "replica" | "why_carousel" | "video" | "image";
  renderLabel: string;
  detail: string;
  postUrl: string | null;
  thumbnailUrl: string | null;
}

export type ContentCartItemKind = "idea" | "top_performer";

export interface ContentCartItem {
  id: string;
  kind: ContentCartItemKind;
  title: string;
  flowDestination: string;
  flowTypeRaw: string;
  mimicMode?: "replica" | "why_carousel";
  renderMode?: "full_bleed" | "template";
}

export interface ResearchBrief {
  id: string;
  createdAt: string;
  label: string;
  ideasCount: number;
  sourceWindow: string | null;
  notes: string | null;
  importId: string | null;
  userTitle: string | null;
  platforms: string[];
  postMaxAgeDays: number | null;
}

export interface ResearchSourceGroup {
  id: string;
  label: string;
  tab: string;
  placeholder: string;
  handles: string[];
}

export interface HashtagInsight {
  hashtag: string;
  count: number;
  avgScore: number | null;
  /** Share of tagged posts in brief (0–100), when ratings unavailable. */
  sharePct: number | null;
}

export interface FormatIntelligence {
  formatKey: string;
  label: string;
  cues: string[];
  platform: string | null;
}

export interface ScheduledPost {
  id: string;
  taskId: string;
  contentTitle: string;
  platform: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  postUrl: string | null;
  status: PublishStatus;
  format: string;
  error: string | null;
}
