/**
 * HTTP paths served by CAF Core (Fastify). Everything else is proxied to the
 * embedded Review Next.js app when CAF_REVIEW_ENABLED is on.
 */
export function isCoreHttpPath(pathname: string): boolean {
  const p = (pathname.split("?")[0] ?? pathname).replace(/\/+$/, "") || "/";

  if (p === "/health" || p === "/readyz" || p === "/health/rendering" || p === "/robots.txt") {
    return true;
  }
  if (p === "/v1" || p.startsWith("/v1/")) return true;
  if (p.startsWith("/static/processing/")) return true;
  if (p === "/api/templates" || p.startsWith("/api/templates/")) return true;
  if (p === "/admin" || p.startsWith("/admin/")) return true;

  return false;
}
