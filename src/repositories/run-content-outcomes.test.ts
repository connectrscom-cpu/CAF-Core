import { describe, expect, it } from "vitest";
import {
  outcomeLabelFromJobStatus,
  resolveJobErrorMessage,
  type ContentLogDraftEntry,
} from "./run-content-outcomes.js";
function mapDraftForTest(row: {
  draft_id: string;
  attempt_no: number | null;
  revision_round: number | null;
  prompt_name: string | null;
  prompt_version: string | null;
  generated_payload: unknown;
  created_at: Date;
}): ContentLogDraftEntry["draft_package"] {
  const gp =
    row.generated_payload && typeof row.generated_payload === "object" && !Array.isArray(row.generated_payload)
      ? (row.generated_payload as Record<string, unknown>)
      : {};
  const parsed = gp.parsed;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

describe("run-content-outcomes", () => {
  it("maps job lifecycle statuses to content-log outcome labels", () => {
    expect(outcomeLabelFromJobStatus("PLANNED")).toBe("planned");
    expect(outcomeLabelFromJobStatus("GENERATING")).toBe("generating");
    expect(outcomeLabelFromJobStatus("GENERATED")).toBe("generated");
    expect(outcomeLabelFromJobStatus("RENDERING")).toBe("rendering");
    expect(outcomeLabelFromJobStatus("IN_REVIEW")).toBe("in_review");
    expect(outcomeLabelFromJobStatus("APPROVED")).toBe("approved");
    expect(outcomeLabelFromJobStatus("FAILED")).toBe("failed");
  });

  it("keeps parsed draft package on content-log draft entries", () => {
    const pkg = mapDraftForTest({
      draft_id: "d_test",
      attempt_no: 1,
      revision_round: 0,
      prompt_name: "carousel_v1",
      prompt_version: "1.0",
      created_at: new Date("2026-05-21T08:00:00.000Z"),
      generated_payload: {
        parsed: { package_type: "carousel_package", caption: "Hello", slides: [{ headline: "H1" }] },
        model: "gpt-4o",
        tokens: 1200,
      },
    });
    expect(pkg?.package_type).toBe("carousel_package");
    expect(pkg?.caption).toBe("Hello");
  });

  it("resolveJobErrorMessage prefers generation_payload errors and transition metadata", () => {
    expect(
      resolveJobErrorMessage({
        generation_payload: { generation_error: "MIMIC_IMAGE_ENABLED is off" },
        render_state: null,
      })
    ).toBe("MIMIC_IMAGE_ENABLED is off");

    expect(
      resolveJobErrorMessage(
        { generation_payload: {}, render_state: null },
        null,
        {
          events: [
            {
              at: "2026-05-21T08:00:00.000Z",
              from_state: "GENERATING",
              to_state: "FAILED",
              actor: "job-pipeline",
              error: "No visual guideline entry for mimic",
            },
          ],
        }
      )
    ).toBe("No visual guideline entry for mimic");
  });
});
