import { brandAccessDeniedResponse } from "@/lib/brand-access-guard";
import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects, uploadInputsEvidenceWorkbook } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ slug: string }> };

async function resolveDisplayName(slug: string): Promise<string> {
  const catalog = await listProjects().catch(() => null);
  const project = catalog?.projects?.find((p) => p.slug === slug);
  return (project?.display_name ?? "").trim() || slug;
}

/**
 * Marketer evidence workbook upload (raw posts XLSX) — distinct from
 * `/research/upload` which syncs scraper watchlist sources.
 */
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

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { ok: false, message: "Upload an .xlsx evidence workbook." },
      { status: 400 }
    );
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json(
      { ok: false, message: "Evidence upload must be an .xlsx file." },
      { status: 400 }
    );
  }

  try {
    const forward = new FormData();
    forward.append("file", file);
    forward.append("project_slug", slug);
    const notes = formData.get("notes");
    if (typeof notes === "string" && notes.trim()) forward.append("notes", notes.trim());

    const out = await uploadInputsEvidenceWorkbook(forward);
    return NextResponse.json({
      ok: true,
      importId: out.inputs_evidence_import_id,
      totalRows: out.total_rows,
      filename: file.name,
      message: `Imported ${out.total_rows} evidence rows. Open Research analysis to set cutoffs and build a brief.`,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        message: e instanceof Error ? e.message : "Evidence upload failed",
      },
      { status: 502 }
    );
  }
}
