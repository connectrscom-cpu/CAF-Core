import { describe, expect, it } from "vitest";
import { annotateNoteWithFlowType } from "./editorial-notes-llm-synthesis.js";

describe("annotateNoteWithFlowType", () => {
  it("prefixes notes from video flows with a [video · flow_type] tag", () => {
    expect(annotateNoteWithFlowType("Captions are weak.", "Video_Script_Generator")).toBe(
      "[video · Video_Script_Generator] Captions are weak."
    );
    expect(annotateNoteWithFlowType("Scenes don't match script.", "FLOW_PRODUCT_FEATURE")).toBe(
      "[video · FLOW_PRODUCT_FEATURE] Scenes don't match script."
    );
  });

  it("leaves carousel / non-video flow notes untouched", () => {
    expect(annotateNoteWithFlowType("Body too short.", "Flow_Carousel_Copy")).toBe("Body too short.");
    expect(annotateNoteWithFlowType("No change.", null)).toBe("No change.");
    expect(annotateNoteWithFlowType("No change.", "")).toBe("No change.");
  });

  it("is idempotent (does not double-tag a note that is already tagged)", () => {
    const tagged = annotateNoteWithFlowType("Weak hook.", "Video_Script_Generator");
    expect(annotateNoteWithFlowType(tagged, "Video_Script_Generator")).toBe(tagged);
  });

  it("returns empty input unchanged", () => {
    expect(annotateNoteWithFlowType("", "Video_Script_Generator")).toBe("");
    expect(annotateNoteWithFlowType("   ", "Video_Script_Generator")).toBe("");
  });
});
