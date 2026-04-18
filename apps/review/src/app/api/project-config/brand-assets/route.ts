import { NextRequest, NextResponse } from "next/server";
import { listBrandAssets, createBrandAsset, type BrandAssetKind } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

function resolveProjectSlug(req: NextRequest, bodyProject?: string): string {
  const fromBody = typeof bodyProject === "string" ? bodyProject.trim() : "";
  if (fromBody) return fromBody;
  const q = req.nextUrl.searchParams.get("project")?.trim() ?? "";
  if (q) return q;
  if (!reviewUsesAllProjects()) return PROJECT_SLUG;
  return reviewQueueFallbackSlug();
}

const KINDS: readonly BrandAssetKind[] = ["logo", "reference_image", "palette", "font", "other"];

function normalizeKind(value: unknown): BrandAssetKind {
  const s = typeof value === "string" ? value.trim() : "";
  return (KINDS as readonly string[]).includes(s) ? (s as BrandAssetKind) : "other";
}

export async function GET(req: NextRequest) {
  const slug = resolveProjectSlug(req);
  if (!slug) return NextResponse.json({ error: "Set PROJECT_SLUG or pass ?project=" }, { status: 400 });
  const data = await listBrandAssets(slug);
  if (!data) return NextResponse.json({ error: "Failed to fetch brand assets" }, { status: 502 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;
  const slug = resolveProjectSlug(req, typeof body.project_slug === "string" ? body.project_slug : undefined);
  if (!slug) return NextResponse.json({ error: "Set PROJECT_SLUG or pass ?project=" }, { status: 400 });

  const trim = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t ? t : null;
  };

  const sortOrder = typeof body.sort_order === "number" ? body.sort_order : Number(body.sort_order);
  const data = await createBrandAsset(slug, {
    kind: normalizeKind(body.kind),
    label: trim(body.label),
    sort_order: Number.isFinite(sortOrder) ? Math.floor(sortOrder as number) : undefined,
    public_url: trim(body.public_url),
    storage_path: trim(body.storage_path),
    heygen_asset_id: trim(body.heygen_asset_id),
    metadata_json:
      body.metadata_json && typeof body.metadata_json === "object" && !Array.isArray(body.metadata_json)
        ? (body.metadata_json as Record<string, unknown>)
        : undefined,
  });
  if (!data) return NextResponse.json({ error: "Failed to create brand asset" }, { status: 502 });
  return NextResponse.json(data);
}
