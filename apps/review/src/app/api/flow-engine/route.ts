import { NextResponse } from "next/server";
import { getFlowEngine } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getFlowEngine();
  if (!data) return NextResponse.json({ error: "Failed to fetch flow engine" }, { status: 502 });
  return NextResponse.json(data);
}
