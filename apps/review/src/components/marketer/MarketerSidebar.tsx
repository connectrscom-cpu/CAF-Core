"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BrandSwitcher } from "@/components/marketer/BrandSwitcher";
import { ContentCartBadge } from "@/components/marketer/ContentCartDrawer";
import { useReviewProject } from "@/components/ReviewProjectContext";
import { isOperatorMode } from "@/lib/marketer/debug";
import { MARKETER_LABELS, OPERATOR_LABELS } from "@/lib/marketer/language";

function brandNavItems(slug: string) {
  const base = `/brand/${encodeURIComponent(slug)}`;
  return [
    { href: base, label: "Dashboard", icon: HomeIcon, exact: true, agentId: "nav-dashboard" },
    { href: `${base}/profile`, label: MARKETER_LABELS.brandProfile, icon: ProfileIcon, agentId: "nav-brand-profile" },
    { href: `${base}/research`, label: MARKETER_LABELS.research, icon: ResearchIcon, agentId: "nav-research" },
    { href: `${base}/intelligence`, label: MARKETER_LABELS.marketIntelligence, icon: IntelIcon, agentId: "nav-market-intelligence" },
    { href: `${base}/ideas`, label: MARKETER_LABELS.ideas, icon: IdeasIcon, agentId: "nav-ideas" },
    { href: `${base}/content`, label: MARKETER_LABELS.content, icon: ContentIcon, agentId: "nav-content" },
    { href: `${base}/publishing`, label: MARKETER_LABELS.publishing, icon: PublishIcon, agentId: "nav-publishing" },
    { href: `${base}/performance`, label: MARKETER_LABELS.performance, icon: PerfIcon, agentId: "nav-performance-learning" },
  ];
}

const OPERATOR_NAV = [
  { href: "/review", label: OPERATOR_LABELS.reviewConsole, icon: ReviewIcon },
  { href: "/runs", label: OPERATOR_LABELS.runs, icon: RunsIcon },
  { href: "/pipeline?tab=packs", label: OPERATOR_LABELS.signalPacks, icon: PipelineIcon },
  { href: "/flow-engine", label: OPERATOR_LABELS.flowEngine, icon: FlowIcon },
  { href: "/learning", label: OPERATOR_LABELS.learningAdmin, icon: LearningIcon },
  { href: "/settings/project", label: OPERATOR_LABELS.projectConfig, icon: ProjectIcon },
  { href: "/settings/renderer", label: OPERATOR_LABELS.renderer, icon: SettingsIcon },
];

export function MarketerSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { ready, activeBrandSlug, inBrandContext, navHref } = useReviewProject();
  const operator = isOperatorMode(searchParams);
  const operatorHref = (() => {
    const q = new URLSearchParams(searchParams.toString());
    q.set("debug", "1");
    const qs = q.toString();
    return qs ? `${pathname}?${qs}` : `${pathname}?debug=1`;
  })();

  const brandItems = activeBrandSlug ? brandNavItems(activeBrandSlug) : [];

  return (
    <aside className="sidebar sidebar--marketer" data-agent-id="sidebar">
      <div className="sidebar-brand">
        <Link href="/workspace" className="sidebar-brand-link">
          <h1>CAF</h1>
          <span>Content workspace</span>
        </Link>
      </div>

      <div className="sidebar-project-panel sidebar-brand-panel">
        {ready ? <BrandSwitcher /> : <div className="sidebar-project-muted">Loading brands…</div>}
      </div>

      <nav className="sidebar-nav" data-agent-id="sidebar-nav">
        <div data-agent-id="workspace-nav">
          <div className="sidebar-section-title">Workspace</div>
          <Link
            href={navHref("/workspace")}
            className={`sidebar-link ${pathname === "/workspace" || pathname === "/" ? "active" : ""}`}
            data-agent-id="nav-brands"
          >
            <HomeIcon />
            {MARKETER_LABELS.brands}
          </Link>
        </div>

        {inBrandContext && brandItems.length > 0 && (
          <div data-agent-id="brand-nav">
            <div className="sidebar-section-title sidebar-section-title--row">
              <span>{MARKETER_LABELS.brand}</span>
              <ContentCartBadge />
            </div>
            {brandItems.map((item) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={navHref(item.href)}
                  className={`sidebar-link ${isActive ? "active" : ""}`}
                  data-agent-id={item.agentId}
                >
                  <item.icon />
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}

        {operator && (
          <div>
            <div className="sidebar-section-title">Operator tools</div>
            {OPERATOR_NAV.map((item) => {
              const isActive = pathname.startsWith(item.href.split("?")[0]!);
              return (
                <Link key={item.href} href={navHref(item.href)} className={`sidebar-link sidebar-link--operator ${isActive ? "active" : ""}`}>
                  <item.icon />
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}
      </nav>

      {!operator && (
        <div className="sidebar-footer">
          <Link href={operatorHref} className="sidebar-footer-link" title="Show operator tools and technical details">
            Operator mode
          </Link>
        </div>
      )}
    </aside>
  );
}

function HomeIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1V9.5z" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

function ResearchIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M16 16l5 5" />
    </svg>
  );
}

function IntelIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function IdeasIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12v1h8v-1a7 7 0 00-4-12z" />
    </svg>
  );
}

function ContentIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  );
}

function PublishIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function PerfIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  );
}

function ReviewIcon() {
  return <ContentIcon />;
}

function PipelineIcon() {
  return <ResearchIcon />;
}

function RunsIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z" />
    </svg>
  );
}

function FlowIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function LearningIcon() {
  return <PerfIcon />;
}

function ProjectIcon() {
  return <ProfileIcon />;
}

function SettingsIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}
