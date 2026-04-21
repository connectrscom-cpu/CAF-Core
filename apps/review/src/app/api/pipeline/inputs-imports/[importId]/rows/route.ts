import { NextResponse } from "next/server";
import { listInputsEvidenceRowsPage } from "@/lib/caf-core-client";
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
    const sheet = url.searchParams.get("sheet") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const data = await listInputsEvidenceRowsPage(project, importId, { sheet, limit, offset });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
