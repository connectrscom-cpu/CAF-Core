import { NextRequest, NextResponse } from "next/server";
import { listBrandAssets } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

function resolveProjectSlug(req: NextRequest): string {
  const q = req.nextUrl.searchParams.get("project")?.trim() ?? "";
  if (q) return q;
  if (!reviewUsesAllProjects()) return PROJECT_SLUG;
  return reviewQueueFallbackSlug();
}

export async function GET(req: NextRequest) {
  const slug = resolveProjectSlug(req);
  const id = req.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!slug || !id) {
    return NextResponse.json({ error: "project and id required" }, { status: 400 });
  }

  const data = await listBrandAssets(slug);
  if (!data?.brand_assets?.length) {
    return NextResponse.json({ error: "brand_assets_not_found" }, { status: 404 });
  }

  const asset = data.brand_assets.find((a) => a.id === id);
  if (!asset) {
    return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
  }

  const url = (asset.public_url ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "asset_has_no_public_url" }, { status: 404 });
  }

  try {
    const upstream = await fetch(url, { cache: "no-store" });
    if (!upstream.ok) {
      return NextResponse.json({ error: "upstream_fetch_failed", status: upstream.status }, { status: 502 });
    }
    const bytes = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("content-type") || "image/png";
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "proxy_failed" },
      { status: 502 }
    );
  }
}
