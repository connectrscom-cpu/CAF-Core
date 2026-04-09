import { NextRequest, NextResponse } from "next/server";
import { listProjects, updateProject, deleteProject } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await listProjects();
  if (!data) return NextResponse.json({ ok: false, error: "bad_gateway" }, { status: 502 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as { slug?: string; display_name?: string | null; active?: boolean; color?: string | null };
  if (!body?.slug) return NextResponse.json({ ok: false, error: "missing_slug" }, { status: 400 });
  const data = await updateProject(body.slug, {
    display_name: body.display_name,
    active: body.active,
    color: body.color,
  });
  if (!data) return NextResponse.json({ ok: false, error: "bad_gateway" }, { status: 502 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  const force = url.searchParams.get("force") === "true";
  if (!slug) return NextResponse.json({ ok: false, error: "missing_slug" }, { status: 400 });

  const data = await deleteProject(slug, force);
  if (!data) return NextResponse.json({ ok: false, error: "bad_gateway" }, { status: 502 });
  return NextResponse.json(data);
}

