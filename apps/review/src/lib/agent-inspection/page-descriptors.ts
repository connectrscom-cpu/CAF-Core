import { MARKETER_LABELS } from "@/lib/marketer/language";
import type { BrandSummary } from "@/lib/marketer/types";
import { brandRoutes } from "./route-map";

export interface PageDescriptor {
  path: string;
  page_title: string;
  brand?: string;
  primary_user_goal?: string;
  visible_sections?: string[];
  visible_actions?: string[];
  visible_metrics?: string[];
  empty_states?: string[];
  technical_terms_visible?: string[];
  implementation_status?: "complete" | "partial" | "stubbed";
  notes?: string;
  page_agent_id?: string;
}

function parseBrandPath(path: string): { slug: string; suffix: string } | null {
  const normalized = path.replace(/\/+$/, "") || "/";
  const m = normalized.match(/^\/brand\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  return { slug: decodeURIComponent(m[1]!), suffix: m[2] ?? "" };
}

function statusLabel(s: string): string {
  if (s === "ready") return "Ready";
  if (s === "stale") return "May need refresh";
  if (s === "in_progress") return "In progress";
  return "Not started";
}

function pipelineStatusForBrand(brand: BrandSummary) {
  const base = `/brand/${encodeURIComponent(brand.slug)}`;
  return [
    {
      label: MARKETER_LABELS.brandProfile,
      status: brand.setupWarnings.some((w) => w.toLowerCase().includes("profile")) ? "Setup needed" : "Ready",
      href: `${base}/profile`,
    },
    { label: MARKETER_LABELS.research, status: statusLabel(brand.researchStatus), href: `${base}/research` },
    { label: MARKETER_LABELS.marketIntelligence, status: statusLabel(brand.intelligenceStatus), href: `${base}/intelligence` },
    {
      label: MARKETER_LABELS.ideas,
      status: brand.ideasReady > 0 ? `${brand.ideasReady} ready` : "Waiting",
      href: `${base}/ideas`,
    },
    {
      label: MARKETER_LABELS.content,
      status: brand.stats.activeContent > 0 ? "In progress" : "Empty",
      href: `${base}/content`,
    },
    {
      label: MARKETER_LABELS.publishing,
      status: brand.stats.scheduledPosts > 0 ? "Scheduled" : "—",
      href: `${base}/publishing`,
    },
  ];
}

function nextStepsForBrand(brand: BrandSummary) {
  const base = `/brand/${encodeURIComponent(brand.slug)}`;
  const steps: { label: string; description: string; href: string; agent_id: string }[] = [];

  if (brand.setupWarnings.some((w) => w.toLowerCase().includes("profile"))) {
    steps.push({
      label: "Complete brand profile",
      description: "Voice, audience, and visual style",
      href: `${base}/profile`,
      agent_id: "next-step-complete-profile",
    });
  }
  if (brand.researchStatus === "not_started") {
    steps.push({
      label: "Add research",
      description: "Competitors, inspiration, uploads",
      href: `${base}/research`,
      agent_id: "next-step-add-research",
    });
  }
  if (brand.stats.pendingReview > 0) {
    steps.push({
      label: `Review ${brand.stats.pendingReview} draft${brand.stats.pendingReview === 1 ? "" : "s"}`,
      description: "Approve, edit, or reject content",
      href: `${base}/content`,
      agent_id: "next-step-review-drafts",
    });
  }
  if (brand.ideasReady > 0) {
    steps.push({
      label: `Browse ${brand.ideasReady} ideas`,
      description: "Pick what to create next",
      href: `${base}/ideas`,
      agent_id: "next-step-browse-ideas",
    });
  }
  if (brand.stats.approved > 0) {
    steps.push({
      label: "Publish approved content",
      description: `${brand.stats.approved} ready to go`,
      href: `${base}/publishing`,
      agent_id: "next-step-publish-approved",
    });
  }
  if (steps.length === 0) {
    steps.push({
      label: "Explore market intelligence",
      description: "See what CAF learned from your research",
      href: `${base}/intelligence`,
      agent_id: "next-step-explore-intelligence",
    });
  }
  return steps;
}

export function buildDashboardExample(brand: BrandSummary) {
  return {
    brand: brand.displayName,
    headline: "What should you do next?",
    recommended_next_steps: nextStepsForBrand(brand).map(({ label, description, href }) => ({
      label,
      description,
      href,
    })),
    overview_metrics: [
      { label: "Needs review", value: brand.stats.pendingReview },
      { label: "Needs edits", value: brand.stats.needsEdits },
      { label: "Approved", value: brand.stats.approved },
      { label: "Scheduled", value: brand.stats.scheduledPosts },
      { label: "Ideas ready", value: brand.ideasReady },
    ],
    pipeline_status: pipelineStatusForBrand(brand),
  };
}

const STATIC_PAGE_DESCRIPTORS: Record<string, Omit<PageDescriptor, "path" | "brand">> = {
  "/workspace": {
    page_title: MARKETER_LABELS.workspace,
    primary_user_goal: "See all brands and pick one to work on",
    visible_sections: ["Workspace hero", "How it works", "Needs your attention", "All brands"],
    visible_actions: ["Open brand card", "Open operator review console"],
    visible_metrics: ["Brand count", "Pending review per brand"],
    empty_states: ["No brands yet"],
    implementation_status: "complete",
    page_agent_id: "workspace-page",
  },
};

function suffixDescriptor(suffix: string, brandName: string): Omit<PageDescriptor, "path" | "brand"> {
  switch (suffix) {
    case "":
      return {
        page_title: "Dashboard",
        primary_user_goal: "Understand what needs attention next for this brand",
        visible_sections: ["Brand header", "Onboarding checklist", "Recommended next steps", "Overview", "Pipeline status"],
        visible_actions: ["Review drafts", "Browse ideas", "Complete profile", "Add research", "Publish approved"],
        visible_metrics: ["Needs review", "Needs edits", "Approved", "Scheduled", "Ideas ready"],
        empty_states: ["Brand not found"],
        implementation_status: "complete",
        page_agent_id: "brand-dashboard",
      };
    case "/profile":
      return {
        page_title: MARKETER_LABELS.brandProfile,
        primary_user_goal: "Configure brand voice, audience, and visual rules",
        visible_sections: ["Brand header", "Profile editor"],
        visible_actions: ["Save profile fields"],
        implementation_status: "complete",
        page_agent_id: "brand-profile-page",
      };
    case "/research":
      return {
        page_title: MARKETER_LABELS.research,
        primary_user_goal: "Manage research sources and briefs",
        visible_sections: ["Brand header", "Research board"],
        visible_actions: ["Add sources", "View research briefs"],
        implementation_status: "partial",
        notes: "Page exists; some source types may be placeholders.",
      };
    case "/intelligence":
      return {
        page_title: MARKETER_LABELS.marketIntelligence,
        primary_user_goal: "Review patterns and trends from research",
        visible_sections: ["Brand header", "Intelligence board"],
        visible_actions: ["Browse insights", "Select signal pack"],
        implementation_status: "partial",
      };
    case "/ideas":
      return {
        page_title: MARKETER_LABELS.ideas,
        primary_user_goal: "Pick content ideas to generate",
        visible_sections: ["Brand header", "Ideas board"],
        visible_actions: ["Select idea", "Generate content"],
        implementation_status: "partial",
      };
    case "/content":
      return {
        page_title: MARKETER_LABELS.content,
        primary_user_goal: "Review, approve, edit, or reject drafts",
        visible_sections: ["Brand header", "Content workbench", "Task viewer"],
        visible_actions: ["Approve", "Reject", "Request edits", "Open task"],
        visible_metrics: ["Queue counts by status"],
        implementation_status: "complete",
        page_agent_id: "content-page",
      };
    case "/publishing":
      return {
        page_title: MARKETER_LABELS.publishing,
        primary_user_goal: "Schedule and track published content",
        visible_sections: ["Brand header", "Publishing queue"],
        visible_actions: ["Schedule post", "View placement status"],
        implementation_status: "partial",
        page_agent_id: "publishing-page",
      };
    case "/performance":
      return {
        page_title: MARKETER_LABELS.performance,
        primary_user_goal: "Learn what worked and improve future content",
        visible_sections: ["Brand header", "Performance stub"],
        visible_actions: ["Open operator learning admin (link)"],
        implementation_status: "stubbed",
        notes: "Page exists with placeholder content; full performance UI not yet built.",
        page_agent_id: "performance-learning-page",
      };
    default:
      return {
        page_title: "Unknown",
        implementation_status: "stubbed",
        notes: `No descriptor for brand path suffix: ${suffix}`,
      };
  }
}

export function describePage(path: string, brand?: BrandSummary | null): PageDescriptor | null {
  const normalized = path.replace(/\/+$/, "") || "/";

  if (STATIC_PAGE_DESCRIPTORS[normalized]) {
    return { path: normalized, ...STATIC_PAGE_DESCRIPTORS[normalized] };
  }

  const parsed = parseBrandPath(normalized);
  if (!parsed) return null;

  const routes = brandRoutes(parsed.slug);
  const match = routes.find((r) => r.path.replace(/\/+$/, "") === normalized);
  if (!match && parsed.suffix !== "") return null;

  const brandName = brand?.displayName ?? parsed.slug;
  const descriptor = suffixDescriptor(parsed.suffix, brandName);

  const result: PageDescriptor = {
    path: normalized,
    brand: brandName,
    ...descriptor,
  };

  if (parsed.suffix === "" && brand) {
    const steps = nextStepsForBrand(brand);
    result.visible_actions = steps.map((s) => s.label.replace(/\d+/g, "N"));
    result.visible_metrics = [
      "Needs review",
      "Needs edits",
      "Approved",
      "Scheduled",
      "Ideas ready",
    ];
  }

  return result;
}

export function listKnownPagePaths(slugs: string[]): string[] {
  const paths = ["/workspace"];
  for (const slug of slugs) {
    for (const r of brandRoutes(slug)) {
      paths.push(r.path);
    }
  }
  return paths;
}
