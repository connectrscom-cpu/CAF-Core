import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import {
  mimicEvidenceTemplateBaseName,
  pickMimicEvidenceTemplateTheme,
} from "./mimic-evidence-carousel-template.js";

function mimic(partial: Partial<MimicPayloadV1>): MimicPayloadV1 {
  return {
    schema_version: 1,
    mode: "template_bg",
    classified_at: "2026-01-01T00:00:00.000Z",
    source_insights_id: "ins_top_performer_abc123",
    source_evidence_row_id: "8842",
    analysis_tier: "top_performer_carousel",
    reference_items: [
      {
        index: 1,
        role: "carousel_slide",
        vision_fetch_url: "https://example.com/a.jpg",
      },
    ],
    twist_brief: { visual_only: true, legal_note: "pattern only" },
    ...partial,
  };
}

describe("mimicEvidenceTemplateBaseName", () => {
  it("embeds evidence row id and insights id slug", () => {
    expect(mimicEvidenceTemplateBaseName(mimic({}))).toBe("mimic_e8842_ins_top_performer_abc123");
  });

  it("falls back when insights id is missing", () => {
    expect(
      mimicEvidenceTemplateBaseName(
        mimic({ source_insights_id: "", source_evidence_row_id: null })
      )
    ).toBe("mimic_ref");
  });
});

describe("pickMimicEvidenceTemplateTheme", () => {
  it("uses first slide color_tokens from visual guideline", () => {
    const theme = pickMimicEvidenceTemplateTheme({
      slides: [
        {
          slide_index: 1,
          color_tokens: {
            background: "#112233",
            primary_text: "#aabbcc",
            accent: ["#ddeeff"],
          },
        },
      ],
    });
    expect(theme).toEqual({
      paper: "#112233",
      ink: "#aabbcc",
      body: "#aabbcc",
    });
  });
});

describe("ensureMimicEvidenceCarouselTemplate", () => {
  it("writes traceable template file with evidence comment", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "mimic-tpl-"));
    const baseTpl = `<!DOCTYPE html>
<html><head><style>:root{ --paper:#fff; --ink:#000; --body:#111; }</style></head><body></body></html>`;
    await writeFile(path.join(tmp, "carousel_mimic_bg.hbs"), baseTpl, "utf8");

    const { ensureMimicEvidenceCarouselTemplate } = await import("./mimic-evidence-carousel-template.js");
    const db = {
      query: async () => ({ rows: [], rowCount: 0 }),
    } as any;
    const config = { CAROUSEL_TEMPLATES_DIR: tmp } as any;
    const payload = mimic({});

    const record = await ensureMimicEvidenceCarouselTemplate(
      db,
      config,
      "proj",
      { id: "j1", task_id: "RUN__IG__MIMIC__row0001__v1" },
      payload
    );

    expect(record.template_base).toBe("mimic_e8842_ins_top_performer_abc123");
    expect(record.reused_existing).toBe(false);
    const written = await readFile(record.path_written, "utf8");
    expect(written).toContain("source_insights_id=ins_top_performer_abc123");
    expect(written).toContain("source_evidence_row_id=8842");
    expect(written).toContain("seeded_by_task_id=RUN__IG__MIMIC__row0001__v1");
  });
});
