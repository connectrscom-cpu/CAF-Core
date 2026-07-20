import { NextRequest, NextResponse } from "next/server";
import { coreAuthFetch } from "@/lib/account-access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ ok: false, error: "token_required" }, { status: 400 });
  const { status, json } = await coreAuthFetch(`/v1/auth/invites/${encodeURIComponent(token)}`, {
    sessionToken: null,
  });
  return NextResponse.json(json, { status });
}
