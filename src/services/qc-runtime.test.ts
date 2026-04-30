import { describe, expect, it } from "vitest";
import { runQcChecklistRow } from "./qc-runtime.js";

describe("qc-runtime: not_empty for video_prompt", () => {
  it("fails when video_prompt missing/empty", () => {
    const check = {
      id: "x",
      check_id: "vid_prompt__require_video_prompt",
      check_name: "Video prompt must be present",
      check_type: "not_empty",
      field_path: "video_prompt",
      operator: null,
      threshold_value: null,
      severity: "HIGH",
      blocking: true,
      failure_message: "Missing video_prompt",
      auto_fix_action: null,
      flow_type: "FLOW_VID_PROMPT",
      qc_checklist_name: "Video_Prompt_Generator",
      qc_checklist_version: "1.0",
      notes: null,
      active: true,
    } as any;

    const r1 = runQcChecklistRow(check, {});
    expect(r1.passed).toBe(false);
    expect(r1.blocking).toBe(true);

    const r2 = runQcChecklistRow(check, { video_prompt: "" });
    expect(r2.passed).toBe(false);

    const r3 = runQcChecklistRow(check, { video_prompt: "   " });
    expect(r3.passed).toBe(false);
  });

  it("passes when video_prompt present", () => {
    const check = {
      id: "x",
      check_id: "vid_prompt__require_video_prompt",
      check_name: "Video prompt must be present",
      check_type: "not_empty",
      field_path: "video_prompt",
      operator: null,
      threshold_value: null,
      severity: "HIGH",
      blocking: true,
      failure_message: "Missing video_prompt",
      auto_fix_action: null,
      flow_type: "FLOW_VID_PROMPT",
      qc_checklist_name: "Video_Prompt_Generator",
      qc_checklist_version: "1.0",
      notes: null,
      active: true,
    } as any;

    const r = runQcChecklistRow(check, { video_prompt: "A clear visual prompt." });
    expect(r.passed).toBe(true);
    expect(r.failure_message).toBeNull();
  });
});

