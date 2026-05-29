import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  it("uses light text on dark backgrounds from vision color_tokens", () => {
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
    expect(theme).toEqual(
      expect.objectContaining({
        paper: "#112233",
        ink: "#f5f5f7",
        body: "#e8e8ed",
      })
    );
  });
});

describe("ensureMimicEvidenceCarouselTemplate", () => {
  it("forks a project layout template with background plate support for template_bg", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "mimic-tpl-"));
    const repoTpl = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../services/renderer/templates"
    );
    await copyFile(
      path.join(repoTpl, "carousel_notes_app_minimal.hbs"),
      path.join(tmp, "carousel_notes_app_minimal.hbs")
    );

    const { ensureMimicEvidenceCarouselTemplate } = await import("./mimic-evidence-carousel-template.js");
    const db = {
      query: async () => ({ rows: [], rowCount: 0 }),
    } as any;
    const config = { CAROUSEL_TEMPLATES_DIR: tmp } as any;
    const payload = mimic({
      visual_guideline: { format_pattern: "listicle" },
    });

    const record = await ensureMimicEvidenceCarouselTemplate(
      db,
      config,
      "proj",
      { id: "j1", task_id: "RUN__IG__MIMIC__row0001__v1" },
      payload,
      { projectPinnedTemplates: ["carousel_notes_app_minimal.hbs"] }
    );

    expect(record.template_base).toBe("mimic_e8842_ins_top_performer_abc123");
    expect(record.layout_base_template).toBe("carousel_notes_app_minimal");
    expect(record.reused_existing).toBe(false);
    const written = await readFile(record.path_written, "utf8");
    expect(written).toContain("layout_base_template=carousel_notes_app_minimal");
    expect(written).toContain("slide-bg");
    expect(written).toContain("{{{background_image_url}}}");
    expect(written).toContain("source_insights_id=ins_top_performer_abc123");
  });
});
