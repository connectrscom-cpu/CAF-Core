import { NextResponse } from "next/server";
import { agentInspectionDisabledResponse, isAgentInspectionAuthorized } from "@/lib/agent-inspection/config";
import { buildCopyInventory } from "@/lib/agent-inspection/copy-inventory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAgentInspectionAuthorized(request)) {
    return agentInspectionDisabledResponse();
  }

  return NextResponse.json({
    app: "CAF Review",
    data_source: "static_copy_inventory",
    ...buildCopyInventory(),
  });
}
