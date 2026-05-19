/** Query keys kept when navigating inside an admin iframe (`embed=admin`). */
export const PRESERVED_NAV_QUERY_KEYS = ["embed", "tab"] as const;

type QuerySource = { get(name: string): string | null };

export function mergePreservedNavQuery(merged: URLSearchParams, source: QuerySource): void {
  for (const key of PRESERVED_NAV_QUERY_KEYS) {
    const v = source.get(key);
    if (v) merged.set(key, v);
  }
}

/** Append preserved keys from the current URL onto an href (path + optional query). */
export function withPreservedNavQuery(href: string, source: QuerySource): string {
  const raw = href.trim() || "/";
  const [path, existingQs] = raw.split("?");
  const merged = new URLSearchParams(existingQs ?? "");
  mergePreservedNavQuery(merged, source);
  const qs = merged.toString();
  return qs ? `${path}?${qs}` : path;
}
