import { NextResponse } from "next/server";
import { listInputsEvidenceImports } from "@/lib/caf-core-client";
import { reviewQueueFallbackSlug } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const project = url.searchParams.get("project")?.trim() || reviewQueueFallbackSlug();
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const data = await listInputsEvidenceImports(project, { limit, offset });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
