"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MarketerSidebar } from "@/components/marketer/MarketerSidebar";
import { Sidebar } from "@/components/Sidebar";
import { ReviewBackgroundJobToasts } from "@/components/ReviewBackgroundJobToasts";
import { WelcomeOnboarding } from "@/components/marketer/WelcomeOnboarding";
import { ReviewProjectProvider } from "@/components/ReviewProjectContext";
import { isOperatorMode } from "@/lib/marketer/debug";

function ShellInner({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const embeddedInAdmin = searchParams.get("embed") === "admin";
  const operator = isOperatorMode(searchParams);

  const shellClass = embeddedInAdmin
    ? "app-shell app-shell--embedded"
    : operator
      ? "app-shell"
      : "app-shell app-shell--marketer";
  const mainClass = operator || embeddedInAdmin ? "main-content" : "main-content main-content--marketer";

  return (
    <ReviewProjectProvider>
      <div className={shellClass} data-agent-id="app-shell">
        {!embeddedInAdmin && (operator ? <Sidebar /> : <MarketerSidebar />)}
        <main className={mainClass} data-agent-id="main-content">
          {children}
        </main>
        <ReviewBackgroundJobToasts />
        {!embeddedInAdmin && !operator && <WelcomeOnboarding />}
      </div>
    </ReviewProjectProvider>
  );
}

export function ReviewAppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="app-shell app-shell--embedded">
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
