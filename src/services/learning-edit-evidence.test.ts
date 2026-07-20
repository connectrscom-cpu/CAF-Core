import { describe, expect, it } from "vitest";
import { buildEditorialEditDiffs, buildEditEvidenceDigest } from "./learning-edit-evidence.js";

describe("buildEditorialEditDiffs", () => {
  it("captures flat field before→after when the override differs", () => {
    const diffs = buildEditorialEditDiffs(
      { title: "Old title", hook: "Old hook", caption: "Same caption" },
      {
        final_title_override: "New title",
        final_hook_override: "New hook",
        final_caption_override: "Same caption",
      }
    );
    expect(diffs).toEqual([
      { field: "title", before: "Old title", after: "New title" },
      { field: "hook", before: "Old hook", after: "New hook" },
    ]);
  });

  it("reads carousel-nested caption/hashtags as before values", () => {
    const diffs = buildEditorialEditDiffs(
      { carousel: { post_caption: "old cap", hashtags: "#a #b" } },
      { final_caption_override: "new cap", final_hashtags_override: "#a #b" }
    );
    expect(diffs).toEqual([{ field: "caption", before: "old cap", after: "new cap" }]);
  });

  it("uses script as spoken_script fallback", () => {
    const diffs = buildEditorialEditDiffs(
      { script: "old script" },
      { final_spoken_script_override: "new script" }
    );
    expect(diffs).toEqual([{ field: "spoken_script", before: "old script", after: "new script" }]);
  });

  it("digests slide text changes from final_slides_json_override", () => {
    const diffs = buildEditorialEditDiffs(
      { slide_deck: { slides: [{ body: "slide one" }, { body: "slide two" }] } },
      {
        final_slides_json_override: JSON.stringify([{ body: "slide one" }, { body: "slide two EDITED" }]),
      }
    );
    expect(diffs).toEqual([
      { field: "slides", before: "slide one | slide two", after: "slide one | slide two EDITED" },
    ]);
  });

  it("ignores unchanged slides and malformed slide JSON", () => {
    expect(
      buildEditorialEditDiffs(
        { slides: [{ text: "a" }] },
        { final_slides_json_override: JSON.stringify([{ text: "a" }]) }
      )
    ).toEqual([]);
    expect(
      buildEditorialEditDiffs({ slides: [{ text: "a" }] }, { final_slides_json_override: "not json" })
    ).toEqual([]);
  });

  it("returns empty for missing generated output and empty overrides", () => {
    expect(buildEditorialEditDiffs(null, null)).toEqual([]);
    expect(buildEditorialEditDiffs({}, { rewrite_copy: true, regenerate: false })).toEqual([]);
  });

  it("caps very long values", () => {
    const long = "x".repeat(2000);
    const diffs = buildEditorialEditDiffs({ title: long }, { final_title_override: "short" });
    expect(diffs).toHaveLength(1);
    expect(diffs[0].before.length).toBeLessThanOrEqual(601);
    expect(diffs[0].before.endsWith("…")).toBe(true);
  });
});

describe("buildEditEvidenceDigest", () => {
  it("aggregates edit diffs and reprint adjustments", () => {
    const digest = buildEditEvidenceDigest([
      {
        source_type: "editorial_edit_diff",
        payload_json: {
          task_id: "t1",
          diffs: [
            { field: "hook", before: "b1", after: "a1" },
            { field: "caption", before: "b2", after: "a2" },
          ],
        },
      },
      {
        source_type: "editorial_edit_diff",
        payload_json: { task_id: "t2", diffs: [{ field: "hook", before: "b3", after: "a3" }] },
      },
      {
        source_type: "reprint_event",
        payload_json: { task_id: "t3", adjustments: ["typography", "layer_positions"] },
      },
      {
        source_type: "reprint_event",
        payload_json: { task_id: "t4", adjustments: ["typography"] },
      },
    ]);
    expect(digest.edit_count).toBe(2);
    expect(digest.reprint_count).toBe(2);
    expect(digest.edited_field_counts).toEqual({ hook: 2, caption: 1 });
    expect(digest.reprint_adjustment_counts).toEqual({ typography: 2, layer_positions: 1 });
    expect(digest.example_diffs).toHaveLength(3);
    expect(digest.example_diffs[0]).toEqual({ task_id: "t1", field: "hook", before: "b1", after: "a1" });
  });

  it("caps example diffs and tolerates malformed payloads", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      source_type: "editorial_edit_diff",
      payload_json: { task_id: `t${i}`, diffs: [{ field: "title", before: "b", after: "a" }] },
    }));
    rows.push({ source_type: "editorial_edit_diff", payload_json: null as never });
    const digest = buildEditEvidenceDigest(rows, { max_examples: 5 });
    expect(digest.example_diffs).toHaveLength(5);
    expect(digest.edit_count).toBe(31);
  });
});
