"use client";

import { Suspense, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LearningProjectProvider } from "@/components/learning/LearningProjectProvider";
import { LearningShell } from "@/components/learning/LearningShell";

function LearningLayoutBody({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/learning/global") {
    return <>{children}</>;
  }
  return (
    <LearningProjectProvider>
      <LearningShell>{children}</LearningShell>
    </LearningProjectProvider>
  );
}

export default function LearningLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: "var(--muted)" }}>Loading learning…</div>}>
      <LearningLayoutBody>{children}</LearningLayoutBody>
    </Suspense>
  );
}
