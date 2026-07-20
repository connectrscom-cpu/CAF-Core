import { NextRequest, NextResponse } from "next/server";
import { coreAuthFetch, getSessionTokenFromCookies } from "@/lib/account-access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const accountSlug = req.nextUrl.searchParams.get("account");
  if (!accountSlug) {
    return NextResponse.json({ ok: false, error: "account_required" }, { status: 400 });
  }
  const token = await getSessionTokenFromCookies();
  if (!token) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { status, json } = await coreAuthFetch<{ ok?: boolean; error?: string }>(
    `/v1/accounts/${encodeURIComponent(accountSlug)}`,
    { sessionToken: token }
  );
  return NextResponse.json(json, { status });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    account?: string;
    email?: string;
    role?: string;
  };
  if (!body.account || !body.email) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const token = await getSessionTokenFromCookies();
  if (!token) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { status, json } = await coreAuthFetch(
    `/v1/accounts/${encodeURIComponent(body.account)}/invites`,
    {
      method: "POST",
      sessionToken: token,
      body: { email: body.email, role: body.role ?? "member" },
    }
  );
  return NextResponse.json(json, { status });
}
