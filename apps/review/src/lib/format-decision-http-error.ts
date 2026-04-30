/** Readable errors when POST /api/task/decision fails (including bare CDN/gateway 502 with empty JSON). */
export async function formatDecisionHttpError(res: Response): Promise<string> {
  const text = await res.text();
  let parsed: { error?: string } = {};
  try {
    parsed = JSON.parse(text) as { error?: string };
  } catch {
    /* use raw body */
  }
  const fromJson = typeof parsed.error === "string" ? parsed.error.trim() : "";
  if (fromJson) return fromJson;
  const raw = text.trim();
  if (raw) return raw.length > 900 ? `${raw.slice(0, 900)}…` : raw;
  if (res.status === 502) {
    return [
      "502 Bad Gateway — the Review app did not get a successful response from CAF Core.",
      "Common causes: CAF_CORE_URL on Vercel is wrong, localhost, or Core is down; missing or wrong CAF_CORE_TOKEN; or Core returned 5xx.",
      "Open DevTools → Network → the red “decision” request → Response tab. On Vercel, check Project → Environment Variables and Core server logs for POST /v1/review-queue/.../decide.",
    ].join(" ");
  }
  return `HTTP ${res.status}`;
}
