import { NextResponse } from "next/server";
import { getInputsEvidenceImportDetail } from "@/lib/caf-core-client";
import { reviewQueueFallbackSlug } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ importId: string }> }
) {
  try {
    const { importId } = await context.params;
    const url = new URL(request.url);
    const project = url.searchParams.get("project")?.trim() || reviewQueueFallbackSlug();
    const data = await getInputsEvidenceImportDetail(project, importId);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
