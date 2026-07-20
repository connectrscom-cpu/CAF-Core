import { NextResponse } from "next/server";
import { assertProjectAccess, fetchAuthStatus } from "@/lib/account-access";

/** Returns a 401/403 NextResponse when account auth is enforced and the user cannot access the brand. */
export async function brandAccessDeniedResponse(projectSlug: string): Promise<NextResponse | null> {
  const status = await fetchAuthStatus().catch(() => ({ auth_enforced: false, signup_enabled: true }));
  if (!status.auth_enforced) return null;
  const access = await assertProjectAccess(projectSlug);
  if (access.allowed) return null;
  return NextResponse.json(
    { ok: false, error: access.status === 401 ? "unauthorized" : "forbidden" },
    { status: access.status === 401 ? 401 : 403 }
  );
}
