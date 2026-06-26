import { MARKETER_LABELS } from "@/lib/marketer/language";

export interface AgentRouteDescriptor {
  path: string;
  title: string;
  description: string;
  pageAgentId?: string;
}

export const WORKSPACE_ROUTES: AgentRouteDescriptor[] = [
  {
    path: "/workspace",
    title: MARKETER_LABELS.brands,
    description: "Shows all brands in the workspace.",
  },
  {
    path: "/review",
    title: "Review console",
    description: "Operator review workbench (debug=1).",
  },
];

export function brandRoutes(slug: string): AgentRouteDescriptor[] {
  const base = `/brand/${encodeURIComponent(slug)}`;
  return [
    {
      path: base,
      title: "Dashboard",
      description: "Brand dashboard with next steps, metrics, and pipeline status.",
      pageAgentId: "brand-dashboard",
    },
    {
      path: `${base}/profile`,
      title: MARKETER_LABELS.brandProfile,
      description: "Voice, audience, visual style, and brand rules.",
      pageAgentId: "brand-profile-page",
    },
    {
      path: `${base}/research`,
      title: MARKETER_LABELS.research,
      description: "Research sources, briefs, and competitor feeds.",
      pageAgentId: "research-page",
    },
    {
      path: `${base}/intelligence`,
      title: MARKETER_LABELS.marketIntelligence,
      description: "Winning patterns, trends, and recommended directions.",
      pageAgentId: "market-intelligence-page",
    },
    {
      path: `${base}/ideas`,
      title: MARKETER_LABELS.ideas,
      description: "Curated content concepts ready to generate.",
      pageAgentId: "ideas-page",
    },
    {
      path: `${base}/content`,
      title: MARKETER_LABELS.content,
      description: "Drafts and content review workbench.",
      pageAgentId: "content-page",
    },
    {
      path: `${base}/publishing`,
      title: MARKETER_LABELS.publishing,
      description: "Publishing queue and scheduled posts.",
      pageAgentId: "publishing-page",
    },
    {
      path: `${base}/performance`,
      title: MARKETER_LABELS.performance,
      description: "Performance metrics and learning insights.",
      pageAgentId: "performance-learning-page",
    },
  ];
}

export const MAIN_ROUTE_DESCRIPTIONS: { path: string; description: string }[] = [
  { path: "/workspace", description: "Shows all brands." },
  { path: "/brand/[slug]", description: "Brand dashboard." },
  { path: "/brand/[slug]/profile", description: "Brand profile." },
  { path: "/brand/[slug]/research", description: "Research sources/feed." },
  { path: "/brand/[slug]/intelligence", description: "Market intelligence." },
  { path: "/brand/[slug]/ideas", description: "Ideas ready to generate." },
  { path: "/brand/[slug]/content", description: "Drafts/content review." },
  { path: "/brand/[slug]/publishing", description: "Publishing queue." },
  { path: "/brand/[slug]/performance", description: "Performance & learning." },
];

/** Screenshot capture targets (default brand slug SNS). */
export const AGENT_SCREENSHOT_ROUTES: { path: string; file: string; title: string }[] = [
  { path: "/workspace", file: "workspace.png", title: "Workspace — all brands" },
  { path: "/brand/SNS", file: "brand-SNS-dashboard.png", title: "Sign And Sound dashboard" },
  { path: "/brand/SNS/profile", file: "brand-SNS-profile.png", title: "Sign And Sound — brand profile" },
  { path: "/brand/SNS/research", file: "brand-SNS-research.png", title: "Sign And Sound — research" },
  { path: "/brand/SNS/intelligence", file: "brand-SNS-intelligence.png", title: "Sign And Sound — market intelligence" },
  { path: "/brand/SNS/ideas", file: "brand-SNS-ideas.png", title: "Sign And Sound — ideas" },
  { path: "/brand/SNS/content", file: "brand-SNS-content.png", title: "Sign And Sound — content" },
  { path: "/brand/SNS/publishing", file: "brand-SNS-publishing.png", title: "Sign And Sound — publishing" },
  { path: "/brand/SNS/performance", file: "brand-SNS-performance.png", title: "Sign And Sound — performance" },
];
