import { NextResponse } from "next/server";
import { PROJECT_SLUG, reviewUsesAllProjects } from "@/lib/env";
import { getFacets, getFacetsAll } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (reviewUsesAllProjects()) {
      const facets = await getFacetsAll();
      return NextResponse.json({
        project: facets.projects ?? [],
        run_id: facets.runs,
        run_display_names: facets.run_display_names ?? {},
        platform: facets.platforms,
        flow_type: facets.flow_types,
        recommended_route: facets.routes,
      });
    }
    const facets = await getFacets(PROJECT_SLUG);
    return NextResponse.json({
      project: [],
      run_id: facets.runs,
      run_display_names: facets.run_display_names ?? {},
      platform: facets.platforms,
      flow_type: facets.flow_types,
      recommended_route: facets.routes,
    });
  } catch (err) {
    console.error("GET /api/facets", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load facets" }, { status: 500 });
  }
}
