/**
 * Brand kit uploads use Core multipart (`/v1/projects/.../brand-assets/upload`).
 *
 * When Review is embedded in CAF Core (Fly), browser POSTs to `/api/*` are proxied through
 * Fastify reply-from; multipart bodies are corrupted ("Failed to parse body as FormData").
 * Same-origin `/v1/...` hits Core directly and works.
 *
 * Standalone `next dev` on :3000 has no Fastify proxy — use the Next API route instead.
 */
export function resolveBrandAssetUploadUrl(projectSlug: string): string {
  const slug = encodeURIComponent(projectSlug.trim());
  const proxyUrl = `/api/project-config/brand-assets/upload?project=${slug}`;

  if (typeof window === "undefined") return proxyUrl;

  const { hostname, port } = window.location;
  if (hostname === "localhost" && port === "3000") {
    return proxyUrl;
  }

  const coreBase = (process.env.NEXT_PUBLIC_CAF_CORE_URL ?? "").replace(/\/$/, "");
  if (coreBase) {
    try {
      if (new URL(coreBase).host !== window.location.host) {
        return `${coreBase}/v1/projects/${slug}/brand-assets/upload`;
      }
    } catch {
      /* same-origin /v1 below */
    }
  }

  return `/v1/projects/${slug}/brand-assets/upload`;
}
