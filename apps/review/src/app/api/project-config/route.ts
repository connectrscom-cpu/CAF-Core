import { NextResponse } from "next/server";
import { getProjectProfile } from "@/lib/caf-core-client";
import { PROJECT_SLUG } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getProjectProfile(PROJECT_SLUG);
  if (!data) return NextResponse.json({ error: "Failed to fetch profile" }, { status: 502 });
  return NextResponse.json(data);
}
