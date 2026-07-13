/** Marketer-facing product types — adapters over Core API shapes. */

import type { ContentPreview } from "./preview-resolver";
import type { VideoPipelineIntent } from "./video-lane";

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
  evidenceUrls?: string[];
  actionable?: string | null;
  /** Insight ids backing this card (patterns + stat buckets). */
  sourceInsightIds?: string[];
  /** Client-side filter when posts are loaded separately. */
  evidenceFilter?: IntelEvidenceFilter;
}

export type IntelEvidenceFilter =
  | { kind: "theme"; key: string }
  | { kind: "emotion"; key: string }
  | { kind: "format"; key: string }
  | { kind: "hook_type"; key: string }
  | { kind: "hashtag"; key: string }
  | { kind: "custom_label"; slot: 1 | 2 | 3; key: string };

export interface IntelEvidencePost {
  insightsId: string;
  title: string;
  hookText: string | null;
  platform: string;
  format: string;
  postUrl: string | null;
  thumbnailUrl: string | null;
  customLabel1: string | null;
  customLabel2: string | null;
  customLabel3: string | null;
  primaryEmotion: string | null;
  hookType: string | null;
  hashtags: string | null;
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
  /** FLOW_VISUAL_FIRST_CAROUSEL lane — original concept with AI slide art + fresh copy. */
  isNewVisualCarousel?: boolean;
  /** Resolved from grounding insights / evidence thumbnails when available. */
  preview?: ContentPreview;
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
  preview?: ContentPreview;
  /** CAF-recommended HeyGen lane from format_pattern (video references only). */
  recommendedVideoIntent?: VideoPipelineIntent;
}

export type ContentCartItemKind = "idea" | "top_performer";

export interface ContentCartItem {
  id: string;
  kind: ContentCartItemKind;
  title: string;
  flowDestination: string;
  flowTypeRaw: string;
  /** Idea row format (carousel, video, …). */
  format?: string;
  platform?: string;
  /** Marketer generation strategy chosen on the Ideas board or in cart. */
  generationStrategy?: GenerationStrategy;
  /** Raw planner hint from the idea row (execution_profile / FLOW_*). */
  ideaTargetFlowType?: string;
  mimicMode?: "replica" | "why_carousel";
  renderMode?: "full_bleed" | "template";
  /** Top-performer video lane (HeyGen routing). */
  videoIntent?: VideoPipelineIntent;
  /** When true, stamp Brand Visual System (brand bible) onto this job at plan time. */
  useBrandVisualSystem?: boolean;
  /** LinkedIn document post lane (2–3 companion images). */
  linkedinAspectRatio?: "1:1" | "4:5";
  linkedinImageCount?: 2 | 3;
}

export type BrandBibleVisualMode =
  | "illustrated_cartoon"
  | "minimal_editorial"
  | "photography"
  | "mixed"
  | "custom";

export type BrandBibleAssetRole =
  | "style_reference"
  | "character"
  | "mascot"
  | "motif"
  | "slide_frame"
  | "background"
  | "texture"
  | "logo"
  | "anti_reference";

export interface BrandBibleHeygenPresenter {
  label: string;
  avatarId: string;
  voiceId: string;
  avatarName: string;
  voiceName: string;
  previewImageUrl: string;
}

export interface BrandBibleApplicationGuide {
  instructions: string;
  contentAims: string[];
  mimicPolicy: string;
  originalPolicy: string;
}

export interface BrandBibleAssetRef {
  assetId: string;
  role: BrandBibleAssetRole;
  label: string;
  usageNotes: string;
}

export interface BrandBible {
  slug: string;
  visualMode: BrandBibleVisualMode | "";
  visualModeCustom: string;
  palette: string[];
  allowedMotifs: string;
  forbiddenMotifs: string;
  applicationGuide: BrandBibleApplicationGuide;
  assetRefs: BrandBibleAssetRef[];
  heygenPresenters: BrandBibleHeygenPresenter[];
  /** Ordered ids (max 7) described per-line in Flux image prompts when BVS is on. */
  fluxPromptAssetIds: string[];
  hasActiveVersion: boolean;
  version: number | null;
}

export type ProductBibleAssetRole =
  | "screenshot"
  | "ui_screen"
  | "workflow_step"
  | "feature_demo"
  | "hero_shot"
  | "comparison";

export interface ProductBibleAssetRef {
  assetId: string;
  role: ProductBibleAssetRole;
  label: string;
  usageNotes: string;
  stepOrder: number | null;
}

export interface ProductBibleFeature {
  key: string;
  label: string;
  description: string;
  assetRefs: ProductBibleAssetRef[];
}

export interface ProductBibleModule {
  key: string;
  label: string;
  description: string;
  oneLiner: string;
  features: ProductBibleFeature[];
  assetRefs: ProductBibleAssetRef[];
}

export interface ProductBibleApplicationGuide {
  instructions: string;
  heygenPolicy: string;
  fluxPolicy: string;
}

export interface ProductBible {
  slug: string;
  applicationGuide: ProductBibleApplicationGuide;
  products: ProductBibleModule[];
  hasActiveVersion: boolean;
  version: number | null;
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
