import { NextResponse } from "next/server";
import { agentInspectionDisabledResponse, isAgentInspectionAuthorized } from "@/lib/agent-inspection/config";
import { scanTechnicalTermsInCopy } from "@/lib/agent-inspection/technical-terms";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAgentInspectionAuthorized(request)) {
    return agentInspectionDisabledResponse();
  }

  const hits = scanTechnicalTermsInCopy();
  return NextResponse.json({
    app: "CAF Review",
    data_source: "static_copy_inventory",
    technical_terms_visible: hits,
    count: hits.length,
  });
}
