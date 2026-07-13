/**
 * LinkedIn document post lane — long-form copy + 2–3 companion images (1:1 or 4:5).
 */
export const FLOW_LINKEDIN_DOCUMENT_POST = "FLOW_LINKEDIN_DOCUMENT_POST" as const;

export type LinkedInAspectRatio = "1:1" | "4:5";

export function isLinkedInDocumentPostFlow(flowType: string | null | undefined): boolean {
  return String(flowType ?? "").trim() === FLOW_LINKEDIN_DOCUMENT_POST;
}

export function parseLinkedInAspectRatio(raw: unknown): LinkedInAspectRatio {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (s === "1:1" || s === "1x1" || s.toLowerCase() === "square") return "1:1";
  return "4:5";
}

/** Flux / BFL size string for companion images. */
export function linkedInImageRenderSize(ratio: LinkedInAspectRatio): string {
  return ratio === "1:1" ? "1024x1024" : "1024x1280";
}

export function normalizeLinkedInImageCount(raw: unknown): 2 | 3 {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (n >= 3) return 3;
  return 2;
}
