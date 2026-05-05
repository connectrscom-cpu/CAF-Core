import { NextRequest, NextResponse } from "next/server";
import { savePromptTemplate } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const data = await savePromptTemplate((body ?? {}) as Record<string, unknown>);
  if (!data) return NextResponse.json({ error: "Failed to save prompt template" }, { status: 502 });
  return NextResponse.json(data);
}

