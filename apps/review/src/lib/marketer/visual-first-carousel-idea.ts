/** Review-app mirror of Core `signal-pack-ideas-ui` visual-first carousel lane detection. */

export const NEW_VISUAL_CAROUSEL_FLOW = "FLOW_VISUAL_FIRST_CAROUSEL";

export function normalizeCarouselStyle(raw: unknown, fallback?: unknown): string {
  return String(raw ?? fallback ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

export function isNewVisualCarouselIdea(row: {
  format?: unknown;
  carousel_style?: unknown;
  execution_profile?: unknown;
  target_flow_type?: unknown;
  flow_type?: unknown;
}): boolean {
  const explicit = String(row.target_flow_type ?? row.flow_type ?? "")
    .trim()
    .toUpperCase();
  if (explicit === NEW_VISUAL_CAROUSEL_FLOW) return true;

  const format = String(row.format ?? "")
    .trim()
    .toLowerCase();
  if (format !== "carousel") return false;

  const style = normalizeCarouselStyle(row.carousel_style, row.execution_profile);
  return style === "visual_first" || style === "mixed";
}

export function newVisualCarouselLaneLabel(row: {
  carousel_style?: unknown;
  execution_profile?: unknown;
}): string {
  const style = normalizeCarouselStyle(row.carousel_style, row.execution_profile);
  if (style === "mixed") return "New visual · mixed";
  return "New visual";
}
