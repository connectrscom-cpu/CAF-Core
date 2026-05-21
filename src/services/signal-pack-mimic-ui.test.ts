import { describe, expect, it } from "vitest";
import type { SignalPackRow } from "../repositories/signal-packs.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "../domain/signal-pack-top-performer-knowledge.js";
import {
  buildSignalPackMimicReferencesForUi,
  mimicKindToFlowType,
  groupMimicReferencesByTab,
} from "./signal-pack-mimic-ui.js";
import { plannerRowsFromMimicPicks } from "./run-candidates-materialize.js";

describe("buildSignalPackMimicReferencesForUi", () => {
  it("groups visual guideline entries by mimic kind", () => {
    const pack = {
      derived_globals_json: {
        [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]: {
          entries: [
            {
              insights_id: "ins_deep_1",
              analysis_tier: "top_performer_deep",
              source_evidence_row_id: "101",
              evidence_kind: "instagram_post",
              hook_text_preview: "Moon sign hook",
              why_it_worked: "Strong opener",
              inspection_media: { items: [{ public_url: "https://x/a.jpg" }] },
            },
            {
              insights_id: "ins_car_1",
              analysis_tier: "top_performer_carousel",
              source_evidence_row_id: "202",
              evidence_kind: "instagram_post",
              hook_text_preview: "12-slide deck",
              format_pattern: "listicle",
              inspection_media: { items: [{ public_url: "https://x/b.jpg" }] },
            },
          ],
        },
      },
    } as unknown as SignalPackRow;

    const rows = buildSignalPackMimicReferencesForUi(pack);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.mimic_kind).sort()).toEqual(["carousel", "image"]);

    const grouped = groupMimicReferencesByTab(rows);
    expect(grouped.get("mimic_image")).toHaveLength(1);
    expect(grouped.get("mimic_carousel")).toHaveLength(1);
    expect(grouped.get("mimic_video")).toHaveLength(0);
  });
});

describe("plannerRowsFromMimicPicks", () => {
  it("creates target_flow_type planner rows with grounding insight ids", () => {
    const pack = {
      derived_globals_json: {
        [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]: {
          entries: [
            {
              insights_id: "ins_car_1",
              analysis_tier: "top_performer_carousel",
              source_evidence_row_id: "202",
              evidence_kind: "instagram_post",
              hook_text_preview: "Deck hook",
            },
          ],
        },
      },
    } as unknown as SignalPackRow;

    const rows = plannerRowsFromMimicPicks(
      pack,
      [{ insights_id: "ins_car_1", mimic_kind: "carousel" }],
      "RUN_TEST"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target_flow_type).toBe(mimicKindToFlowType("carousel"));
    expect(rows[0]?.grounding_insight_ids).toEqual(["ins_car_1"]);
    expect(rows[0]?.manual_mimic_pick).toBe(true);
  });
});
