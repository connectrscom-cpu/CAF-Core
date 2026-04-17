import type { ReactNode } from "react";

/** Avoid long-lived CDN/browser caches serving an old shell for this interactive page. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PublishLayout({ children }: { children: ReactNode }) {
  return children;
}
