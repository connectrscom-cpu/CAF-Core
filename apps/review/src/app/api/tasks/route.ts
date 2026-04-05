import { NextResponse } from "next/server";
import { PROJECT_SLUG } from "@/lib/env";
import { getQueueTab, type ReviewTab } from "@/lib/caf-core-client";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tab = (url.searchParams.get("tab") ?? "in_review") as ReviewTab;
  try {
    const jobs = await getQueueTab(PROJECT_SLUG, tab);
    return NextResponse.json({ ok: true, jobs });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
