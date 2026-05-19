import { NextResponse } from "next/server";
import { CAF_CORE_TOKEN, CAF_CORE_URL } from "@/lib/env";

export const dynamic = "force-dynamic";

function headersNoBody(): HeadersInit {
  const h: Record<string, string> = { Accept: "application/json" };
  if (CAF_CORE_TOKEN) h["x-caf-core-token"] = CAF_CORE_TOKEN;
  return h;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const run_id = (url.searchParams.get("run_id") ?? "").trim();
    const project_slug = (url.searchParams.get("project_slug") ?? "").trim();
    const download = url.searchParams.get("download") === "1";

    if (!run_id || !project_slug) {
      return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
    }

    const base = CAF_CORE_URL.replace(/\/$/, "");
    const upstream = `${base}/v1/runs/${encodeURIComponent(project_slug)}/${encodeURIComponent(run_id)}/content-log-export`;

    const res = await fetch(upstream, { headers: headersNoBody(), cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { ok: false, error: "core_error", status: res.status, message: text.slice(0, 2000) },
        { status: res.status }
      );
    }

    const buf = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? "application/json; charset=utf-8";
    const cd =
      res.headers.get("content-disposition") ??
      (download
        ? `attachment; filename="caf_run_${project_slug}_${run_id}_content_log.json"`
        : undefined);

    const headers: Record<string, string> = { "Content-Type": contentType };
    if (cd) headers["Content-Disposition"] = cd;

    return new NextResponse(buf, { status: 200, headers });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
