import { NextRequest, NextResponse } from "next/server";
import {
  CAF_CORE_URL,
  CAF_CORE_TOKEN,
  PROJECT_SLUG,
  reviewQueueFallbackSlug,
  reviewUsesAllProjects,
} from "@/lib/env";

export const dynamic = "force-dynamic";

function resolveProjectSlug(req: NextRequest): string {
  const q = req.nextUrl.searchParams.get("project")?.trim() ?? "";
  if (q) return q;
  if (!reviewUsesAllProjects()) return PROJECT_SLUG;
  return reviewQueueFallbackSlug();
}

export async function POST(req: NextRequest) {
  const slug = resolveProjectSlug(req);
  if (!slug) {
    return NextResponse.json({ error: "Set PROJECT_SLUG or pass ?project=" }, { status: 400 });
  }
  const incoming = await req.formData();
  const file = incoming.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const fd = new FormData();
  fd.append("file", file, typeof (file as File).name === "string" ? (file as File).name : "upload.bin");

  const headers: Record<string, string> = {};
  if (CAF_CORE_TOKEN) headers["x-caf-core-token"] = CAF_CORE_TOKEN;

  const base = CAF_CORE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/v1/projects/${encodeURIComponent(slug)}/brand-assets/upload`, {
    method: "POST",
    headers,
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: text.slice(0, 800) || `HTTP ${res.status}` },
      { status: res.status >= 500 ? 502 : res.status }
    );
  }
  try {
    return NextResponse.json(JSON.parse(text) as Record<string, unknown>);
  } catch {
    return NextResponse.json({ error: "Invalid response from Core" }, { status: 502 });
  }
}
