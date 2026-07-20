import { NextRequest, NextResponse } from "next/server";
import { coreAuthFetch } from "@/lib/account-access";
import { CAF_SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { status, json } = await coreAuthFetch<{
    ok?: boolean;
    error?: string;
    session_token?: string;
    user?: unknown;
    account?: unknown;
    created_user?: boolean;
  }>("/v1/auth/accept-invite", { method: "POST", body });

  if (status >= 400 || !json.ok || !json.session_token) {
    return NextResponse.json(
      { ok: false, error: json.error ?? "accept_failed" },
      { status: status >= 400 ? status : 400 }
    );
  }

  const res = NextResponse.json({
    ok: true,
    user: json.user,
    account: json.account,
    created_user: json.created_user,
  });
  res.cookies.set(CAF_SESSION_COOKIE, json.session_token, sessionCookieOptions());
  return res;
}
