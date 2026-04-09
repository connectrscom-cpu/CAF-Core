import { NextResponse } from "next/server";
import {
  CAF_CORE_URL,
  CAF_CORE_TOKEN,
  PROJECT_SLUG,
  reviewQueueFallbackSlug,
  reviewUsesAllProjects,
} from "@/lib/env";

export const dynamic = "force-dynamic";

function coreHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (CAF_CORE_TOKEN) h["x-caf-core-token"] = CAF_CORE_TOKEN;
  return h;
}

/**
 * Diagnostic: what Vercel/server sees for Core connectivity and review counts.
 * Open: /api/health/core (no secrets in response).
 */
export async function GET() {
  const base = CAF_CORE_URL.replace(/\/$/, "");
  const onVercel = process.env.VERCEL === "1";

  let healthStatus = 0;
  let healthOk = false;
  try {
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    healthStatus = res.status;
    healthOk = res.ok;
  } catch (e) {
    return NextResponse.json({
      ok: false,
      step: "health",
      caf_core_url: base,
      on_vercel: onVercel,
      error: e instanceof Error ? e.message : String(e),
      hint:
        onVercel && /localhost|127\.0\.0\.1/i.test(base)
          ? "CAF_CORE_URL must be your deployed Core (e.g. https://caf-core.fly.dev), not localhost."
          : "Check CAF_CORE_URL is reachable from this host.",
    });
  }

  const allPath = "/v1/review-queue-all/counts";
  const singlePath = `/v1/review-queue/${encodeURIComponent(PROJECT_SLUG || reviewQueueFallbackSlug())}/counts`;

  let countsPath = reviewUsesAllProjects() ? allPath : singlePath;
  let countsStatus = 0;
  let counts: Record<string, unknown> | null = null;
  let countsError: string | null = null;
  let counts_fallback_from_all = false;
  try {
    let res = await fetch(`${base}${countsPath}`, { headers: coreHeaders(), cache: "no-store" });
    countsStatus = res.status;
    if (reviewUsesAllProjects() && res.status === 404) {
      const trySingle = await fetch(`${base}${singlePath}`, { headers: coreHeaders(), cache: "no-store" });
      if (trySingle.ok) {
        countsPath = singlePath;
        countsStatus = trySingle.status;
        counts = (await trySingle.json()) as Record<string, unknown>;
        counts_fallback_from_all = true;
        countsError = null;
      } else {
        countsError = (await res.text()).slice(0, 500);
      }
    } else if (res.ok) {
      counts = (await res.json()) as Record<string, unknown>;
    } else {
      countsError = (await res.text()).slice(0, 500);
    }
  } catch (e) {
    countsError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    ok: healthOk && countsStatus === 200,
    caf_core_url: base,
    on_vercel: onVercel,
    review_scope: reviewUsesAllProjects() ? "all_projects" : "single",
    project_slug_config: PROJECT_SLUG || "(empty → all projects mode)",
    health_http_status: healthStatus,
    counts_path: countsPath,
    counts_http_status: countsStatus,
    counts_body: counts,
    counts_error: countsError,
    counts_fallback_legacy_core: counts_fallback_from_all,
    token_configured: Boolean(CAF_CORE_TOKEN),
    explain:
      "Local admin (localhost:3847) uses your PC database. This probe uses CAF_CORE_URL from env — if that Core uses another DATABASE_URL, counts differ from local.",
  });
}
