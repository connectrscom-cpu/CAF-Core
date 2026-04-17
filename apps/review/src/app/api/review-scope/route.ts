import { NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { getFacetsAll } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const multiProject = reviewUsesAllProjects();
  const lockedSlug = (PROJECT_SLUG || reviewQueueFallbackSlug()).trim();
  let projects: string[] = [];
  if (multiProject) {
    try {
      const facets = await getFacetsAll();
      projects = facets.projects ?? [];
    } catch (e) {
      console.warn("GET /api/review-scope: facets failed", e);
    }
  }
  return NextResponse.json({
    multiProject,
    /** Server tenant when `multiProject` is false; informational when true. */
    lockedSlug,
    projects,
  });
}
