import type { ReviewJobDetail } from "@/lib/caf-core-client";

/** Prefer server-computed flat slides; fall back to legacy `generation_payload.slides`. */
export function jobGeneratedSlidesJson(job: ReviewJobDetail): string {
  const fromReview = (job.review_slides_json ?? "").trim();
  if (fromReview) return fromReview;
  const sl = job.generation_payload?.slides;
  if (sl != null && typeof sl === "object") return JSON.stringify(sl);
  return "";
}
