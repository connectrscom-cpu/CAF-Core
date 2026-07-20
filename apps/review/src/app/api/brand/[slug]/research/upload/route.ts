import { brandAccessDeniedResponse } from "@/lib/brand-access-guard";
import { NextRequest, NextResponse } from "next/server";
import {
  createProject,
  listProjects,
  syncInputsSourcesFromWorkbookBase64,
} from "@/lib/caf-core-client";
import { RESEARCH_SOURCE_GROUPS } from "@/lib/marketer/research-adapters";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

async function resolveDisplayName(slug: string): Promise<string> {
  const catalog = await listProjects().catch(() => null);
  const project = catalog?.projects?.find((p) => p.slug === slug);
  return (project?.display_name ?? "").trim() || slug;
}

function tabLabel(sourceTab: string): string {
  return RESEARCH_SOURCE_GROUPS.find((g) => g.tab === sourceTab)?.label ?? sourceTab;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  {
    const denied = await brandAccessDeniedResponse(slug);
    if (denied) return denied;
  }

  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const displayName = await resolveDisplayName(slug);
  const created = await createProject(slug, displayName).catch(() => null);
  if (!created?.ok) {
    return NextResponse.json({ ok: false, error: "project_unavailable" }, { status: 502 });
  }

  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  let filename = "research-sources.xlsx";
  let dataBase64: string | null = null;

  if (contentType.includes("application/json")) {
    const body = (await req.json()) as { data_base64?: string; filename?: string };
    dataBase64 = typeof body.data_base64 === "string" ? body.data_base64.trim() : null;
    if (body.filename?.trim()) filename = body.filename.trim();
  } else if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file");
    if (file instanceof File) {
      filename = file.name || filename;
      const buf = Buffer.from(await file.arrayBuffer());
      dataBase64 = buf.toString("base64");
    }
  }

  if (!dataBase64) {
    return NextResponse.json({ ok: false, error: "file_required", message: "No workbook file received." }, { status: 400 });
  }

  if (!filename.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json(
      { ok: false, error: "invalid_file_type", message: "Upload an .xlsx workbook." },
      { status: 400 }
    );
  }

  try {
    const result = await syncInputsSourcesFromWorkbookBase64(slug, dataBase64, filename);
    const tabs = (result.tabs ?? []).map((t) => ({
      ...t,
      label: tabLabel(t.source_tab),
    }));
    return NextResponse.json({
      ok: true,
      filename,
      total_rows: result.total_rows ?? 0,
      tabs,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "upload_failed", message }, { status: 502 });
  }
}
