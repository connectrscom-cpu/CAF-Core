import { NextResponse } from "next/server";
import { agentInspectionDisabledResponse, isAgentInspectionAuthorized } from "@/lib/agent-inspection/config";
import { buildAgentSnapshot } from "@/lib/agent-inspection/snapshot";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAgentInspectionAuthorized(request)) {
    return agentInspectionDisabledResponse();
  }

  const snapshot = await buildAgentSnapshot();
  return NextResponse.json(snapshot);
}
