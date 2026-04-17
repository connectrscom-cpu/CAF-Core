"use client";

import { Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { ReviewProjectProvider } from "@/components/ReviewProjectContext";

function ShellInner({ children }: { children: React.ReactNode }) {
  return (
    <ReviewProjectProvider>
      <div className="app-shell">
        <Sidebar />
        <main className="main-content">{children}</main>
      </div>
    </ReviewProjectProvider>
  );
}

export function ReviewAppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="app-shell">
          <aside className="sidebar">
            <div className="sidebar-brand">
              <h1>CAF Review</h1>
              <span>Output &amp; approval</span>
            </div>
          </aside>
          <main className="main-content" style={{ padding: 28, color: "var(--muted)" }}>
            Loading…
          </main>
        </div>
      }
    >
      <ShellInner>{children}</ShellInner>
    </Suspense>
  );
}
