import type { MimicImageAudit } from "@/lib/caf-core-client";

/** Pick the best api_call_audit row for a carousel slide's image generation. */
export function auditForSlide(audits: MimicImageAudit[], slideIndex: number): MimicImageAudit | null {
  const steps = [
    `mimic_slide_gen_${slideIndex}`,
    `mimic_slide_flux_text_${slideIndex}`,
    `mimic_flux_carousel_slide_${slideIndex}`,
    slideIndex === 1 ? "mimic_bg_extract" : `mimic_bg_extract_${slideIndex}`,
    "mimic_image_edit",
  ];
  for (const step of steps) {
    const hit = audits.find((a) => a.step === step);
    if (hit?.prompt || hit?.reference_url) return hit;
    if (hit) return hit;
  }
  return null;
}

export function imageProviderLabel(audit: MimicImageAudit | null | undefined): string {
  if (!audit) return "Image model";
  const p = audit.provider?.toLowerCase() ?? "";
  if (p === "bfl") return "BFL Flux";
  if (p.includes("dashscope") || p === "qwen") return "Qwen";
  if (p === "openai") return "OpenAI";
  if (p === "nvidia") return "NVIDIA NIM";
  return audit.provider || "Image model";
}
