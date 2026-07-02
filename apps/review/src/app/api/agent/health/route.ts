import { NextResponse } from "next/server";
import { CAF_CORE_URL } from "@/lib/env";
import { agentInspectionDisabledResponse, isAgentInspectionAuthorized, isAgentInspectionEnabled } from "@/lib/agent-inspection/config";

export const dynamic = "force-dynamic";

const AGENT_ENDPOINTS = [
  { path: "/agent-map", description: "HTML index of routes and agent APIs" },
  { path: "/api/agent/health", description: "Inspection + Core connectivity probe" },
  { path: "/api/agent/snapshot", description: "Full marketer app structure JSON" },
  { path: "/api/agent/page?path=/brand/SNS/content", description: "Per-page descriptor" },
  { path: "/api/agent/queue?project=SNS&tab=in_review&page=1&limit=25", description: "Slim paginated review queue" },
  { path: "/api/agent/copy-inventory", description: "Marketer-facing label inventory" },
  { path: "/api/agent/technical-terms", description: "Jargon scan for UX audits" },
];

async function probeCoreHealth(): Promise<{
  ok: boolean;
  http_status?: number;
  latency_ms?: number;
  error?: string;
}> {
  const base = CAF_CORE_URL.replace(/\/$/, "");
  const started = Date.now();
  try {
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    return {
      ok: res.ok,
      http_status: res.status,
      latency_ms: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      latency_ms: Date.now() - started,
    };
  }
}

async function probeCoreReady(): Promise<{
  ok: boolean;
  http_status?: number;
  review_ok?: boolean;
  error?: string;
}> {
  const base = CAF_CORE_URL.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/readyz`, { cache: "no-store" });
    const body = (await res.json()) as { ok?: boolean; review?: { ok?: boolean } };
    return {
      ok: res.ok && body.ok === true,
      http_status: res.status,
      review_ok: body.review?.ok,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function GET(request: Request) {
  if (!isAgentInspectionAuthorized(request)) {
    return agentInspectionDisabledResponse();
  }

  const [coreHealth, coreReady] = await Promise.all([probeCoreHealth(), probeCoreReady()]);
  const ok = coreHealth.ok && coreReady.ok;

  return NextResponse.json(
    {
      ok,
      inspection_enabled: isAgentInspectionEnabled(),
      caf_core_url: CAF_CORE_URL.replace(/\/$/, ""),
      core_health: coreHealth,
      core_ready: coreReady,
      agent_endpoints: AGENT_ENDPOINTS,
      recommended_workflow: [
        "GET /api/agent/health — confirm ok before crawling",
        "GET /api/agent/snapshot — brands, nav, dashboard counts",
        "GET /api/agent/queue?project=SNS&tab=in_review — slim job manifest (paginate with page=)",
        "Open task_href or GET /v1/review-queue/SNS/task?task_id=… for full job detail",
      ],
      generated_at: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
