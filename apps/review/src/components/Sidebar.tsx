"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReviewProject } from "@/components/ReviewProjectContext";

const NAV_ITEMS = [
  {
    section: "Workbench",
    items: [
      { href: "/", label: "Review Console", icon: ReviewIcon },
      { href: "/runs", label: "Run Logs", icon: RunsIcon },
      { href: "/publish", label: "Publish", icon: PublishIcon },
      { href: "/playground", label: "Template Playground", icon: TemplateIcon },
    ],
  },
  {
    section: "CAF Engine",
    items: [
      { href: "/flow-engine", label: "Flow Engine", icon: FlowIcon },
      { href: "/learning", label: "Learning", icon: LearningIcon },
    ],
  },
  {
    section: "Admin",
    items: [],
  },
  {
    section: "Settings",
    items: [
      { href: "/settings/project", label: "Project Config", icon: ProjectIcon },
      { href: "/settings/renderer", label: "Renderer", icon: SettingsIcon },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { ready, multiProject, lockedSlug, activeProjectSlug, projectOptions, setActiveProjectSlug, navHref } =
    useReviewProject();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <h1>CAF Review</h1>
        <span>Output &amp; approval</span>
      </div>
      <div className="sidebar-project-panel" aria-label="Active project">
        <div className="sidebar-project-label">Project</div>
        {!ready ? (
          <div className="sidebar-project-muted">Loading…</div>
        ) : multiProject ? (
          <select
            className="sidebar-project-select"
            value={activeProjectSlug}
            onChange={(e) => setActiveProjectSlug(e.target.value)}
            title="Filter the workbench and links to this tenant"
          >
            <option value="">All projects</option>
            {activeProjectSlug && !projectOptions.includes(activeProjectSlug) ? (
              <option value={activeProjectSlug}>{activeProjectSlug}</option>
            ) : null}
            {projectOptions.map((slug) => (
              <option key={slug} value={slug}>
                {slug}
              </option>
            ))}
          </select>
        ) : (
          <div className="sidebar-project-pill" title="Set PROJECT_SLUG / REVIEW_ALL_PROJECTS on the server to switch tenants">
            <span className="sidebar-project-pill-value">{lockedSlug || "—"}</span>
          </div>
        )}
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((section) => (
          <div key={section.section}>
            <div className="sidebar-section-title">{section.section}</div>
            {section.items.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/" ||
                    pathname.startsWith("/t/") ||
                    pathname.startsWith("/approved") ||
                    pathname.startsWith("/content/")
                  : item.href === "/runs"
                    ? pathname.startsWith("/runs") || pathname.startsWith("/r/")
                    : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={navHref(item.href)}
                  className={`sidebar-link ${isActive ? "active" : ""}`}
                >
                  <item.icon />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function ReviewIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

function RunsIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v4H4z" />
      <path d="M4 10h16v4H4z" />
      <path d="M4 16h16v4H4z" />
    </svg>
  );
}

function PublishIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
      <path d="M19 21H5" />
    </svg>
  );
}

function ProjectIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </svg>
  );
}

function FlowIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function LearningIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
      <line x1="6" y1="8" x2="6" y2="8" />
      <line x1="18" y1="8" x2="18" y2="8" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}
