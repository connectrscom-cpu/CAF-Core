import type { BrandOnboardingStep } from "./types";

export const ONBOARDING_STORAGE_KEY = "caf-review-onboarding-v1";
export const WORKSPACE_TOUR_KEY = "caf-review-workspace-tour-v1";

export interface OnboardingState {
  welcomeDismissed: boolean;
  workspaceTourComplete: boolean;
  /** Per-brand: slug → dismissed checklist */
  brandChecklistDismissed: Record<string, boolean>;
}

export function readOnboardingState(): OnboardingState {
  if (typeof window === "undefined") {
    return { welcomeDismissed: false, workspaceTourComplete: false, brandChecklistDismissed: {} };
  }
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return { welcomeDismissed: false, workspaceTourComplete: false, brandChecklistDismissed: {} };
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      welcomeDismissed: !!parsed.welcomeDismissed,
      workspaceTourComplete: !!parsed.workspaceTourComplete,
      brandChecklistDismissed:
        parsed.brandChecklistDismissed && typeof parsed.brandChecklistDismissed === "object"
          ? parsed.brandChecklistDismissed
          : {},
    };
  } catch {
    return { welcomeDismissed: false, workspaceTourComplete: false, brandChecklistDismissed: {} };
  }
}

export function writeOnboardingState(patch: Partial<OnboardingState>): OnboardingState {
  const next = { ...readOnboardingState(), ...patch };
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function dismissWelcome(): void {
  writeOnboardingState({ welcomeDismissed: true });
}

export function completeWorkspaceTour(): void {
  writeOnboardingState({ workspaceTourComplete: true });
}

export function dismissBrandChecklist(slug: string): void {
  const state = readOnboardingState();
  writeOnboardingState({
    brandChecklistDismissed: { ...state.brandChecklistDismissed, [slug]: true },
  });
}

export function buildBrandOnboardingSteps(input: {
  slug: string;
  hasProfile: boolean;
  hasResearch: boolean;
  hasIntelligence: boolean;
  hasIdeas: boolean;
  hasContentReview: boolean;
  hasPublishing: boolean;
}): BrandOnboardingStep[] {
  const base = `/brand/${encodeURIComponent(input.slug)}`;
  return [
    {
      id: "profile",
      title: "Set up your brand profile",
      description: "Tell CAF your voice, audience, visual style, and upload logos, colors, and fonts.",
      href: `${base}/profile`,
      complete: input.hasProfile,
    },
    {
      id: "research",
      title: "Add research sources",
      description: "Import competitors, inspiration accounts, or uploads so CAF knows your market.",
      href: `${base}/research`,
      complete: input.hasResearch,
    },
    {
      id: "intelligence",
      title: "Review market intelligence",
      description: "See winning patterns and trends CAF found before creating content.",
      href: `${base}/intelligence`,
      complete: input.hasIntelligence,
    },
    {
      id: "ideas",
      title: "Pick content ideas",
      description: "Choose from curated ideas — not random posts. Select what you want to create.",
      href: `${base}/ideas`,
      complete: input.hasIdeas,
    },
    {
      id: "content",
      title: "Review your drafts",
      description: "Preview copy, visuals, and captions. Approve, request edits, or reject.",
      href: `${base}/content`,
      complete: input.hasContentReview,
    },
    {
      id: "publishing",
      title: "Publish or schedule",
      description: "Send approved content to your channels when you're ready.",
      href: `${base}/publishing`,
      complete: input.hasPublishing,
      optional: true,
    },
  ];
}

export function onboardingProgress(steps: BrandOnboardingStep[]): {
  complete: number;
  total: number;
  percent: number;
} {
  const required = steps.filter((s) => !s.optional);
  const complete = required.filter((s) => s.complete).length;
  const total = required.length;
  return {
    complete,
    total,
    percent: total > 0 ? Math.round((complete / total) * 100) : 0,
  };
}

/** Workspace-level funnel explanation for welcome modal. */
export const WORKSPACE_FUNNEL_STEPS = [
  {
    step: 1,
    title: "Choose a brand",
    body: "Each brand is a separate client or product line. Switch anytime from the sidebar.",
  },
  {
    step: 2,
    title: "Research & intelligence",
    body: "CAF studies your market and surfaces patterns before suggesting content.",
  },
  {
    step: 3,
    title: "Pick ideas",
    body: "Review recommended concepts with clear rationale — then choose a generation style.",
  },
  {
    step: 4,
    title: "Review & publish",
    body: "Approve drafts, schedule posts, and learn what works over time.",
  },
] as const;
