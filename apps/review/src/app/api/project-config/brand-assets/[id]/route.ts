import { NextRequest, NextResponse } from "next/server";
import { updateBrandAsset, deleteBrandAsset, type BrandAssetKind } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function resolveProjectSlug(req: NextRequest, bodyProject?: string): string {
  const fromBody = typeof bodyProject === "string" ? bodyProject.trim() : "";
  if (fromBody) return fromBody;
  const q = req.nextUrl.searchParams.get("project")?.trim() ?? "";
  if (q) return q;
  if (!reviewUsesAllProjects()) return PROJECT_SLUG;
  return reviewQueueFallbackSlug();
}

const KINDS: readonly BrandAssetKind[] = ["logo", "reference_image", "palette", "font", "other"];

function normalizeKind(value: unknown): BrandAssetKind | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  return (KINDS as readonly string[]).includes(s) ? (s as BrandAssetKind) : undefined;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json()) as Record<string, unknown>;
  const slug = resolveProjectSlug(req, typeof body.project_slug === "string" ? body.project_slug : undefined);
  if (!slug) return NextResponse.json({ error: "Set PROJECT_SLUG or pass ?project=" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  const kind = normalizeKind(body.kind);
  if (kind) patch.kind = kind;
  if (typeof body.label === "string") patch.label = body.label.trim() || null;
  else if (body.label === null) patch.label = null;
  if (typeof body.sort_order !== "undefined") {
    const n = typeof body.sort_order === "number" ? body.sort_order : Number(body.sort_order);
    if (Number.isFinite(n)) patch.sort_order = Math.floor(n);
  }
  if (typeof body.public_url === "string") patch.public_url = body.public_url.trim() || null;
  else if (body.public_url === null) patch.public_url = null;
  if (typeof body.storage_path === "string") patch.storage_path = body.storage_path.trim() || null;
  else if (body.storage_path === null) patch.storage_path = null;
  if (typeof body.heygen_asset_id === "string") patch.heygen_asset_id = body.heygen_asset_id.trim() || null;
  else if (body.heygen_asset_id === null) patch.heygen_asset_id = null;
  if (
    body.metadata_json &&
    typeof body.metadata_json === "object" &&
    !Array.isArray(body.metadata_json)
  ) {
    patch.metadata_json = body.metadata_json as Record<string, unknown>;
  }

  try {
    const data = await updateBrandAsset(slug, id, patch);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /HTTP 404/.test(msg) ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const slug = resolveProjectSlug(req);
  if (!slug) return NextResponse.json({ error: "Set PROJECT_SLUG or pass ?project=" }, { status: 400 });
  try {
    const data = await deleteBrandAsset(slug, id);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /HTTP 404/.test(msg) ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
