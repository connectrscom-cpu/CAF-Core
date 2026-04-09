"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ContentReviewClient } from "@/components/ContentReviewClient";

function OpenContentInner() {
  const searchParams = useSearchParams();
  const taskIdParam = searchParams.get("task_id")?.trim() ?? "";
  const projectFromUrl = searchParams.get("project")?.trim() ?? "";
  return <ContentReviewClient taskIdParam={taskIdParam} projectFromUrl={projectFromUrl} />;
}

export default function OpenContentPage() {
  return (
    <Suspense fallback={<div style={{ padding: 28, color: "var(--muted)" }}>Loading…</div>}>
      <OpenContentInner />
    </Suspense>
  );
}
