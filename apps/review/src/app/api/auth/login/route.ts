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
    expires_at?: string;
    user?: unknown;
    accounts?: unknown;
    projects?: unknown;
  }>("/v1/auth/login", { method: "POST", body, sessionToken: null });

  if (status >= 400 || !json.ok || !json.session_token) {
    return NextResponse.json(
      { ok: false, error: json.error ?? "login_failed" },
      { status: status >= 400 ? status : 401 }
    );
  }

  const res = NextResponse.json({
    ok: true,
    user: json.user,
    accounts: json.accounts,
    projects: json.projects,
  });
  res.cookies.set(CAF_SESSION_COOKIE, json.session_token, sessionCookieOptions());
  return res;
}
