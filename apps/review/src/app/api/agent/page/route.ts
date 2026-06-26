import { NextResponse } from "next/server";
import { agentInspectionDisabledResponse, isAgentInspectionAuthorized } from "@/lib/agent-inspection/config";
import { buildPageSnapshot } from "@/lib/agent-inspection/snapshot";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAgentInspectionAuthorized(request)) {
    return agentInspectionDisabledResponse();
  }

  const path = new URL(request.url).searchParams.get("path")?.trim();
  if (!path || !path.startsWith("/")) {
    return NextResponse.json({ error: "Query param path is required (e.g. ?path=/brand/SNS)" }, { status: 400 });
  }

  const result = await buildPageSnapshot(path);
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }

  return NextResponse.json(result);
}
