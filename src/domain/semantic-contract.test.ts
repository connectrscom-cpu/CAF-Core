import { describe, expect, it } from "vitest";
import {
  buildSemanticContractFromCandidate,
  buildSemanticContractPromptBlock,
  hasUsableSemanticContract,
  parseSemanticContractFromPayload,
  SEMANTIC_CONTRACT_SCHEMA,
} from "./semantic-contract.js";

describe("semantic-contract", () => {
  it("builds contract from canonical idea fields", () => {
    const c = buildSemanticContractFromCandidate({
      idea_id: "idea_12",
      candidate_id: "SNS_2026W09_Instagram_0006",
      thesis: "If each zodiac sign were represented as a food, what would each be?",
      three_liner: "A swipeable list pairing every sign with one iconic food and a short why.",
      key_points: ["Aries → hot wings", "Taurus → lasagna", "Gemini → tapas"],
    });
    expect(c).not.toBeNull();
    expect(c!.schema_version).toBe(SEMANTIC_CONTRACT_SCHEMA);
    expect(c!.core_question).toContain("zodiac");
    expect(c!.content_beats).toHaveLength(3);
    expect(hasUsableSemanticContract(c)).toBe(true);
  });

  it("returns null when candidate has no thesis-like fields", () => {
    expect(buildSemanticContractFromCandidate({ candidate_id: "x" })).toBeNull();
  });

  it("parses stored contract from generation_payload slice", () => {
    const built = buildSemanticContractFromCandidate({
      content_idea: "Roles as power tools for startup teams",
      key_points: ["CEO → drill", "CTO → multimeter"],
    });
    const round = parseSemanticContractFromPayload({
      semantic_contract_v1: built,
    });
    expect(round?.core_question).toContain("power tools");
    expect(round?.content_beats).toHaveLength(2);
  });

  it("prompt block leads with contract JSON and idea-faithful rules", () => {
    const c = buildSemanticContractFromCandidate({
      thesis: "Core question here",
      key_points: ["beat one"],
    })!;
    const block = buildSemanticContractPromptBlock(c);
    expect(block).toContain("semantic_contract_v1");
    expect(block).toContain("Core question here");
    expect(block).toContain("Idea-faithful mimic copy");
  });
});
