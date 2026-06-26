/**
 * Agent inspection mode — gated instrumentation for AI/browser agents.
 * Does not affect normal product behavior when disabled.
 */

export function isAgentInspectionEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_AGENT_INSPECTION_ENABLED === "true" ||
    process.env.AGENT_INSPECTION_ENABLED === "true"
  );
}

/** Returns true when the request may access agent inspection endpoints. */
export function isAgentInspectionAuthorized(request: Request): boolean {
  if (isAgentInspectionEnabled()) return true;

  const token = (process.env.AGENT_INSPECTION_TOKEN ?? "").trim();
  if (!token) return false;

  const header = request.headers.get("x-agent-inspection-token")?.trim();
  const urlToken = new URL(request.url).searchParams.get("token")?.trim();
  return header === token || urlToken === token;
}

export function agentInspectionDisabledResponse(): Response {
  return new Response(JSON.stringify({ error: "Agent inspection is disabled" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
