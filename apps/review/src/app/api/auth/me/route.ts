import { NextResponse } from "next/server";
import { fetchAuthMe, fetchAuthStatus } from "@/lib/account-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await fetchAuthStatus().catch(() => ({
    auth_enforced: false,
    signup_enabled: true,
  }));
  const me = await fetchAuthMe().catch(() => null);
  return NextResponse.json({
    ok: true,
    authenticated: !!me?.user,
    auth_enforced: status.auth_enforced,
    signup_enabled: status.signup_enabled,
    user: me?.user ?? null,
    accounts: me?.accounts ?? [],
    projects: me?.projects ?? [],
    project_slugs: me?.project_slugs ?? [],
  });
}
