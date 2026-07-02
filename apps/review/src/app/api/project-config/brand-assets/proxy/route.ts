import { NextRequest, NextResponse } from "next/server";
import { CAF_CORE_TOKEN, CAF_CORE_URL, PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

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

  const base = CAF_CORE_URL.replace(/\/$/, "");
  const fileUrl = `${base}/v1/projects/${encodeURIComponent(slug)}/brand-assets/${encodeURIComponent(id)}/file`;
  const headers: HeadersInit = { cache: "no-store" };
  if (CAF_CORE_TOKEN) headers.Authorization = `Bearer ${CAF_CORE_TOKEN}`;

  try {
    const upstream = await fetch(fileUrl, { headers, cache: "no-store" });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: "upstream_fetch_failed", status: upstream.status },
        { status: upstream.status === 404 ? 404 : 502 }
      );
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
