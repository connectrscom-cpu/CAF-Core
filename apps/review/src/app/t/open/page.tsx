"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TaskReviewClient } from "@/components/TaskReviewClient";

function OpenTaskInner() {
  const searchParams = useSearchParams();
  const taskIdParam = searchParams.get("task_id")?.trim() ?? "";
  const projectFromUrl = searchParams.get("project")?.trim() ?? "";
  return <TaskReviewClient taskIdParam={taskIdParam} projectFromUrl={projectFromUrl} />;
}

export default function OpenTaskPage() {
  return (
    <Suspense fallback={<div style={{ padding: 28, color: "var(--muted)" }}>Loading…</div>}>
      <OpenTaskInner />
    </Suspense>
  );
}
