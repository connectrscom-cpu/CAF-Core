"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { ReviewProjectProvider } from "@/components/ReviewProjectContext";

function ShellInner({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const embeddedInAdmin = searchParams.get("embed") === "admin";

  return (
    <ReviewProjectProvider>
      <div className={embeddedInAdmin ? "app-shell app-shell--embedded" : "app-shell"}>
        {!embeddedInAdmin && <Sidebar />}
        <main className="main-content">{children}</main>
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
