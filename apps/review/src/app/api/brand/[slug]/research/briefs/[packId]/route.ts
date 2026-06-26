import { NextRequest, NextResponse } from "next/server";
import { listProjects, listSignalPacksForProject, patchSignalPackNotes } from "@/lib/caf-core-client";
import { toResearchBrief } from "@/lib/marketer/idea-adapters";
import { serializePackNotes } from "@/lib/marketer/research-notes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; packId: string }> };

async function resolveDisplayName(slug: string): Promise<string> {
  const catalog = await listProjects().catch(() => null);
  const project = catalog?.projects?.find((p) => p.slug === slug);
  return (project?.display_name ?? "").trim() || slug;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { slug, packId } = await ctx.params;
  if (!slug || !packId) {
    return NextResponse.json({ error: "Missing brand or brief" }, { status: 400 });
  }

  const body = (await req.json()) as { title?: string };
  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ ok: false, error: "title_required" }, { status: 400 });
  }

  const list = await listSignalPacksForProject(slug, { limit: 50 }).catch(() => null);
  const pack = list?.signal_packs?.find((p) => p.id === packId);
  if (!pack) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const notes = serializePackNotes({ marketer_title: title }, pack.notes);
  const result = await patchSignalPackNotes(slug, packId, notes).catch(() => null);
  if (!result?.ok) {
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 502 });
  }

  const displayName = await resolveDisplayName(slug);
  const brief = toResearchBrief(
    {
      id: packId,
      created_at: pack.created_at,
      source_window: pack.source_window,
      notes,
      ideas_count: pack.ideas_count,
      upload_filename: pack.upload_filename,
    },
    displayName
  );

  return NextResponse.json({ ok: true, brief });
}
