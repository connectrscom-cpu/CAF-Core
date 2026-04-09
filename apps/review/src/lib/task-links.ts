/**
 * Very long `task_id` values (common for some n8n / HeyGen flows) break URL path segments on Vercel
 * and other proxies. Use `/t/open?task_id=…` above this length.
 */
export const LONG_TASK_ID_PATH_THRESHOLD = 72;

export function taskReviewHref(
  contentSlug: "t" | "content",
  taskId: string,
  project?: string
): string {
  const proj = project?.trim();
  const useOpen = taskId.length >= LONG_TASK_ID_PATH_THRESHOLD;
  const projQs = proj ? `&project=${encodeURIComponent(proj)}` : "";
  if (useOpen) {
    return `/${contentSlug}/open?task_id=${encodeURIComponent(taskId)}${projQs}`;
  }
  const base = `/${contentSlug}/${encodeURIComponent(taskId)}`;
  return proj ? `${base}?project=${encodeURIComponent(proj)}` : base;
}

/** Build query string for GET /api/task and /api/task/assets (avoids long path segments). */
export function taskApiQuery(taskId: string, project?: string): string {
  const q = new URLSearchParams({ task_id: taskId });
  const p = project?.trim();
  if (p) q.set("project", p);
  return q.toString();
}
