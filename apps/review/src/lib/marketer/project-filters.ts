/** Slugs hidden from the Social Media Manager workspace (system / global learning). */
const HIDDEN_MARKETER_SLUGS = new Set(["caf-global"]);

export function isMarketerVisibleBrand(slug: string): boolean {
  const s = slug.trim().toLowerCase();
  if (!s) return false;
  return !HIDDEN_MARKETER_SLUGS.has(s);
}

export function filterMarketerBrands<T extends { slug: string }>(rows: T[]): T[] {
  return rows.filter((r) => isMarketerVisibleBrand(r.slug));
}
