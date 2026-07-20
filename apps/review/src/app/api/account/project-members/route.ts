import { NextRequest, NextResponse } from "next/server";
import { coreAuthFetch, getSessionTokenFromCookies } from "@/lib/account-access";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    account?: string;
    project?: string;
    user_id?: string;
    role?: string;
  };
  if (!body.account || !body.project || !body.user_id) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const token = await getSessionTokenFromCookies();
  if (!token) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { status, json } = await coreAuthFetch(
    `/v1/accounts/${encodeURIComponent(body.account)}/projects/${encodeURIComponent(body.project)}/members`,
    {
      method: "PUT",
      sessionToken: token,
      body: { user_id: body.user_id, role: body.role ?? "editor" },
    }
  );
  return NextResponse.json(json, { status });
}

export async function DELETE(req: NextRequest) {
  const account = req.nextUrl.searchParams.get("account");
  const project = req.nextUrl.searchParams.get("project");
  const userId = req.nextUrl.searchParams.get("user_id");
  if (!account || !project || !userId) {
    return NextResponse.json({ ok: false, error: "invalid_query" }, { status: 400 });
  }
  const token = await getSessionTokenFromCookies();
  if (!token) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { status, json } = await coreAuthFetch(
    `/v1/accounts/${encodeURIComponent(account)}/projects/${encodeURIComponent(project)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE", sessionToken: token }
  );
  return NextResponse.json(json, { status });
}
