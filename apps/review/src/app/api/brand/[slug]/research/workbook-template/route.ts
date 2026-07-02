import { NextResponse } from "next/server";
import { fetchInputsSourcesWorkbookTemplate } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const buffer = await fetchInputsSourcesWorkbookTemplate();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="caf-research-sources-template.xlsx"',
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "template_failed", message }, { status: 502 });
  }
}
