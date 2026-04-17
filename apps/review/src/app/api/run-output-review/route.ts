import { NextRequest, NextResponse } from "next/server";
import { CAF_CORE_TOKEN, CAF_CORE_URL, PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

function coreHeadersJson(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (CAF_CORE_TOKEN) h["x-caf-core-token"] = CAF_CORE_TOKEN;
  return h;
}

function coreHeadersGet(): HeadersInit {
  const h: Record<string, string> = { Accept: "application/json" };
  if (CAF_CORE_TOKEN) h["x-caf-core-token"] = CAF_CORE_TOKEN;
  return h;
}

function resolveProjectSlug(explicit?: string | null): string {
  const t = (explicit ?? "").trim();
  if (t) return t;
  if (!reviewUsesAllProjects() && PROJECT_SLUG) return PROJECT_SLUG;
  return reviewQueueFallbackSlug();
}

export async function GET(request: NextRequest) {
  try {
    const runId = request.nextUrl.searchParams.get("run_id")?.trim();
    if (!runId) return NextResponse.json({ error: "run_id required" }, { status: 400 });
    const project = resolveProjectSlug(request.nextUrl.searchParams.get("project_slug"));
    const base = CAF_CORE_URL.replace(/\/$/, "");
    const path = `/v1/runs/${encodeURIComponent(project)}/${encodeURIComponent(runId)}/output-review`;
    const res = await fetch(`${base}${path}`, { headers: coreHeadersGet(), cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: text.slice(0, 400) || `Core HTTP ${res.status}` }, { status: res.status === 404 ? 404 : 502 });
    }
    return NextResponse.json(JSON.parse(text) as Record<string, unknown>);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      run_id?: string;
      project_slug?: string;
      body?: string;
      validator?: string;
    };
    const runId = (body.run_id ?? "").trim();
    if (!runId) return NextResponse.json({ error: "run_id required" }, { status: 400 });
    const project = resolveProjectSlug(body.project_slug);
    const base = CAF_CORE_URL.replace(/\/$/, "");
    const path = `/v1/runs/${encodeURIComponent(project)}/${encodeURIComponent(runId)}/output-review`;
    const res = await fetch(`${base}${path}`, {
      method: "PUT",
      headers: coreHeadersJson(),
      body: JSON.stringify({ body: body.body ?? "", validator: body.validator }),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: text.slice(0, 400) || `Core HTTP ${res.status}` }, { status: res.status === 400 ? 400 : 502 });
    }
    return NextResponse.json(JSON.parse(text) as Record<string, unknown>);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
