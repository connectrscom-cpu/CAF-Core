"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { useLearningProject } from "@/components/learning/LearningProjectProvider";

const TABS = [
  { href: "/learning", label: "Overview", exact: true },
  { href: "/learning/inbox", label: "Inbox", badge: "pending" as const },
  { href: "/learning/analyzers", label: "Analyzers" },
  { href: "/learning/reviews", label: "Reviews" },
  { href: "/learning/observatory", label: "Observatory" },
  { href: "/learning/context", label: "Context" },
];

function LearningShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    project,
    setProject,
    pending,
    active,
    snapshotEntries,
    copyHint,
    transparency,
  } = useLearningProject();

  const qs = searchParams.get("project") ? `?project=${encodeURIComponent(searchParams.get("project")!)}` : "";

  return (
    <div className="learning-root">
      <header className="learning-hero">
        <div className="learning-hero-title">
          <h1>Learning</h1>
          <p>
            Project rules change the next run after you <strong>Apply</strong> them.{" "}
            <strong>Drop</strong> dismisses suggestions without deleting history. Global observatory lives under{" "}
            <Link href="/learning/global">CAF-wide</Link>.
          </p>
          <div className="learning-hero-stats">
            <div className="learning-stat-chip">
              <span className="k">pending</span>
              <span className="v">{pending.length}</span>
            </div>
            <div className="learning-stat-chip">
              <span className="k">active</span>
              <span className="v">{active.length}</span>
            </div>
            {snapshotEntries.map(([k, v]) => (
              <div key={k} className="learning-stat-chip">
                <span className="k">{k.replace(/_/g, " ")}</span>
                <span className="v">
                  {v === -1 && k === "observations_last_30d" ? "n/a" : String(v)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="learning-hero-project">
          <label htmlFor="learning-project-slug">Project slug</label>
          <input
            id="learning-project-slug"
            value={project}
            onChange={(e) => setProject(e.target.value.trim())}
          />
        </div>
      </header>

      <nav className="learning-subnav" aria-label="Learning sections">
        {TABS.map((tab) => {
          const activeTab = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          const href = `${tab.href}${qs}`;
          return (
            <Link
              key={tab.href}
              href={href}
              className={`learning-subnav-link${activeTab ? " is-active" : ""}`}
            >
              {tab.label}
              {tab.badge === "pending" && pending.length > 0 ? (
                <span className="learning-subnav-badge">{pending.length}</span>
              ) : null}
            </Link>
          );
        })}
        <Link href="/learning/global" className="learning-subnav-link learning-subnav-link--global">
          Global observatory
        </Link>
      </nav>

      {copyHint ? <p className="learning-copy-hint">{copyHint}</p> : null}

      {children}

      {transparency ? (
        <details className="learning-accordion" style={{ marginTop: 20 }}>
          <summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span>How automation works</span>
              <p>{String(transparency.summary ?? "")}</p>
            </div>
            <span className="chev">▸</span>
          </summary>
          <div className="acc-body">
            <ul className="learning-loop-list">
              {(Array.isArray(transparency.loops) ? transparency.loops : []).map((loop: unknown) => {
                const L = loop as Record<string, unknown>;
                const llm = Boolean(L.llm_involved);
                return (
                  <li key={String(L.id)} className="learning-loop">
                    <div className="learning-loop-head">
                      <span>{String(L.name ?? L.id)}</span>
                      <span className={`tag ${llm ? "tag-llm" : "tag-det"}`}>
                        {llm ? "LLM" : "Deterministic"}
                      </span>
                    </div>
                    <div className="learning-loop-row">{String(L.requires_human ?? "")}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function LearningShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="learning-root" style={{ padding: 24 }}>Loading…</div>}>
      <LearningShellInner>{children}</LearningShellInner>
    </Suspense>
  );
}
