import { NextResponse } from "next/server";
import { coreAuthFetch, getSessionTokenFromCookies } from "@/lib/account-access";
import { CAF_SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export async function POST() {
  const token = await getSessionTokenFromCookies();
  if (token) {
    await coreAuthFetch("/v1/auth/logout", { method: "POST", sessionToken: token }).catch(() => null);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CAF_SESSION_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });
  return res;
}
