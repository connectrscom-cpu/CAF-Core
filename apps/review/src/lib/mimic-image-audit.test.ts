import { describe, expect, it } from "vitest";
import type { MimicImageAudit } from "@/lib/caf-core-client";
import { auditForSlide, imageProviderLabel } from "./mimic-image-audit";

function audit(step: string, extras: Partial<MimicImageAudit> = {}): MimicImageAudit {
  return {
    id: step,
    created_at: "",
    step,
    provider: "bfl",
    model: "flux-2-klein-4b",
    ok: true,
    error_message: null,
    prompt: `prompt for ${step}`,
    endpoint: null,
    reference_url: null,
    size: null,
    latency_ms: null,
    ...extras,
  };
}

describe("mimic-image-audit", () => {
  it("prefers slide gen audit with prompt", () => {
    const audits = [
      audit("mimic_flux_carousel_slide_2", { prompt: null }),
      audit("mimic_slide_gen_2", { prompt: "full flux prompt" }),
    ];
    expect(auditForSlide(audits, 2)?.prompt).toBe("full flux prompt");
  });

  it("labels BFL provider", () => {
    expect(imageProviderLabel(audit("mimic_slide_gen_1"))).toBe("BFL Flux");
  });
});
