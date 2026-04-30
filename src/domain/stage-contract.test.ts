import { describe, expect, it } from "vitest";
import {
  STAGE_CONTRACT_SCHEMA_VERSION,
  buildPlannedGenerationPayloadBase,
  buildPromptBinding,
  coerceIngestedGenerationPayload,
  normalizeCandidateDataContract,
} from "./stage-contract.js";

describe("normalizeCandidateDataContract", () => {
  it("mirrors confidence_score to confidence and adds idea_format from format", () => {
    const out = normalizeCandidateDataContract({
      format: "carousel",
      confidence_score: 0.82,
      summary: "x",
    });
    expect(out.idea_format).toBe("carousel");
    expect(out.format).toBe("carousel");
    expect(out.confidence_score).toBe(0.82);
    expect(out.confidence).toBe(0.82);
  });

  it("prefers confidence_score over confidence", () => {
    const out = normalizeCandidateDataContract({
      format: "video",
      confidence_score: 0.79,
      confidence: 0.1,
    });
    expect(out.confidence).toBe(0.79);
    expect(out.confidence_score).toBe(0.79);
  });
});

describe("buildPromptBinding", () => {
  it("is deferred when prompt_id empty", () => {
    const b = buildPromptBinding({ prompt_id: null, prompt_version_id: "x", prompt_version_label: "1" });
    expect(b.status).toBe("deferred");
    expect(b.prompt_id).toBeNull();
  });

  it("is bound when prompt_id set", () => {
    const b = buildPromptBinding({
      prompt_id: "SNS_Carousel_Flow_Generator",
      prompt_version_id: "ae99",
      prompt_version_label: "1",
    });
    expect(b.status).toBe("bound");
    expect(b.prompt_id).toBe("SNS_Carousel_Flow_Generator");
  });
});

describe("buildPlannedGenerationPayloadBase", () => {
  it("includes schema_version and prompt_binding", () => {
    const p = buildPlannedGenerationPayloadBase({
      signal_pack_id: "cdfe0196-2880-454f-8176-22152b9a63fe",
      candidate_data: { format: "post", confidence: 0.8 },
      prompt_id: null,
      prompt_version_id: null,
      prompt_version_label: null,
      variation_index: 0,
    });
    expect(p.schema_version).toBe(STAGE_CONTRACT_SCHEMA_VERSION);
    expect((p.prompt_binding as { status: string }).status).toBe("deferred");
    expect(p.prompt_id).toBeNull();
    const cand = p.candidate_data as Record<string, unknown>;
    expect(cand.idea_format).toBe("post");
    expect(cand.confidence_score).toBe(0.8);
  });
});

describe("coerceIngestedGenerationPayload", () => {
  it("fills schema_version and prompt_binding when missing", () => {
    const o = coerceIngestedGenerationPayload({
      prompt_id: "P1",
      candidate_data: { format: "carousel", confidence_score: 0.77 },
    });
    expect(o.schema_version).toBe(STAGE_CONTRACT_SCHEMA_VERSION);
    expect((o.prompt_binding as { status: string }).status).toBe("bound");
  });
});
