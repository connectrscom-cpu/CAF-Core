import { describe, expect, it } from "vitest";
import { deriveJobHealth, pickJobPersistedError } from "./job-health.js";
import { TOP_PERFORMER_MIMIC_RENDER_NOT_READY_MESSAGE } from "./top-performer-mimic-flow-types.js";

const baseQc = {
  passed: false,
  score: 0,
  blocking_count: 1,
  risk_level: "CRITICAL",
  risk_findings_count: 1,
  recommended_route: "BLOCKED",
  reason_short: "Banned claim language",
  reasons: ["Banned claim language"],
  blocking_risk_policies: [
    { policy_name: "Medical claims", severity: "CRITICAL", matched_terms: ["cure"] },
  ],
};

describe("pickJobPersistedError", () => {
  it("prefers render_state.error then generation_error", () => {
    expect(
      pickJobPersistedError({ generation_error: "gen" }, { error: "render boom" })
    ).toBe("render boom");
    expect(pickJobPersistedError({ last_error: "last" }, null)).toBe("last");
  });
});

describe("deriveJobHealth", () => {
  it("healthy job in review", () => {
    const h = deriveJobHealth({
      status: "IN_REVIEW",
      flow_type: "FLOW_CAROUSEL",
      generation_payload: { generated_output: { title: "ok" } },
      render_state: { status: "completed", provider: "carousel-renderer" },
    });
    expect(h.state).toBe("healthy");
    expect(h.reason_code).toBe("ok");
    expect(h.human_message.length).toBeGreaterThan(0);
  });

  it("schema_or_llm_failed", () => {
    const h = deriveJobHealth({
      status: "FAILED",
      flow_type: "FLOW_CAROUSEL",
      generation_payload: {
        last_error: "LLM generation failed: Schema validation failed: slides required",
      },
    });
    expect(h.state).toBe("failed");
    expect(h.reason_code).toBe("schema_or_llm_failed");
    expect(h.human_message).toMatch(/LLM generation failed/i);
    expect(h.action_hint).toBe("regenerate");
  });

  it("qc_blocked_critical_risk shows finding text", () => {
    const h = deriveJobHealth({
      status: "BLOCKED",
      flow_type: "FLOW_CAROUSEL",
      generation_payload: {
        generated_output: { title: "x" },
        qc_result: baseQc,
      },
    });
    expect(h.state).toBe("blocked");
    expect(h.reason_code).toBe("qc_blocked_critical_risk");
    expect(h.human_message).toMatch(/Medical claims/);
    expect(h.human_message).toMatch(/CRITICAL/);
    expect(h.human_message).toMatch(/cure/);
    expect(h.action_hint).toBe("rework");
  });

  it("render_provider_timeout", () => {
    const h = deriveJobHealth({
      status: "FAILED",
      flow_type: "FLOW_VID_SCRIPT",
      generation_payload: { generated_output: { spoken_script: "hi" } },
      render_state: { error: "HeyGen polling timed out after 600s", phase: "polling" },
    });
    expect(h.state).toBe("failed");
    expect(h.reason_code).toBe("render_provider_timeout");
    expect(h.human_message).toMatch(/timed out/i);
  });

  it("waiting_on_provider when session active", () => {
    const h = deriveJobHealth({
      status: "RENDERING",
      flow_type: "FLOW_VID_SCRIPT",
      generation_payload: { generated_output: { spoken_script: "hi" } },
      render_state: { phase: "polling", video_id: "vid_abc" },
    });
    expect(h.state).toBe("waiting_on_provider");
    expect(h.reason_code).toBe("waiting_on_provider");
    expect(h.suggested_action).toMatch(/intentionally guarded/i);
    expect(h.action_hint).toBe("wait");
  });

  it("mimic_image_disabled from persisted error", () => {
    const h = deriveJobHealth({
      status: "FAILED",
      flow_type: "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
      generation_payload: {
        generated_output: { title: "x" },
        last_error: TOP_PERFORMER_MIMIC_RENDER_NOT_READY_MESSAGE,
      },
    });
    expect(h.state).toBe("failed");
    expect(h.reason_code).toBe("mimic_image_disabled");
    expect(h.action_hint).toBe("enable_mimic_env");
  });

  it("mimic_image_disabled when env flag false on mimic lane without other error", () => {
    const h = deriveJobHealth({
      status: "FAILED",
      flow_type: "FLOW_VISUAL_FIRST_CAROUSEL",
      generation_payload: { generated_output: { title: "x" } },
      mimic_image_enabled: false,
    });
    expect(h.reason_code).toBe("mimic_image_disabled");
  });

  it("stuck_rendering when stale without session", () => {
    const now = new Date("2026-07-16T12:00:00Z");
    const h = deriveJobHealth({
      status: "RENDERING",
      flow_type: "FLOW_VID_SCRIPT",
      generation_payload: { generated_output: { spoken_script: "hi" } },
      render_state: { phase: "starting" },
      updated_at: new Date("2026-07-16T11:00:00Z"),
      now,
    });
    expect(h.state).toBe("stuck");
    expect(h.reason_code).toBe("stuck_rendering");
  });
});
