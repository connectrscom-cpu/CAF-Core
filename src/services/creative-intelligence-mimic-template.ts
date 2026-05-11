import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  getCreativeInsight,
  getCreativeInsightByRef,
  getCreativeVisualAnalysis,
  insertCreativeCarouselMimicTemplate,
} from "../repositories/creative-intelligence.js";
import { addProjectCarouselTemplate } from "../repositories/project-config.js";

const NAME_RE = /^[a-zA-Z0-9_-]+\.hbs$/;

function safeTemplateBase(name: string): string | null {
  const base = path.basename(name.trim()).replace(/\.hbs$/i, "");
  if (!/^[a-zA-Z0-9_-]{3,48}$/.test(base)) return null;
  return base;
}

function pickHexes(palette: Record<string, unknown> | null | undefined): { paper: string; ink: string; body: string } {
  const dom = palette && Array.isArray(palette.dominant) ? (palette.dominant as unknown[]) : [];
  const acc = palette && Array.isArray(palette.accent) ? (palette.accent as unknown[]) : [];
  const first = (x: unknown[]) => {
    for (const v of x) {
      const s = String(v ?? "").trim();
      if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
    }
    return "";
  };
  const paper = first(dom) || "#fffef9";
  const ink = first(acc) || first(dom.slice(1)) || "#1c1c1e";
  const body = first(dom.slice(2)) || "#3a3a3c";
  return { paper, ink, body };
}

/**
 * Writes a carousel .hbs next to built-in templates and pins it on the project.
 * V1: clones `carousel_notes_app_minimal.hbs` and overrides :root paper/ink/body from analysis color palette.
 */
export async function generateMimicCarouselTemplate(
  db: Pool,
  config: AppConfig,
  projectId: string,
  opts: { creative_insight_id?: string; insight_ref?: string; template_base_name?: string }
): Promise<{ template_file_name: string; path_written: string }> {
  const row = opts.creative_insight_id
    ? await getCreativeInsight(db, projectId, opts.creative_insight_id)
    : opts.insight_ref
      ? await getCreativeInsightByRef(db, projectId, opts.insight_ref)
      : null;
  if (!row) throw new Error("creative_insight not found");

  const rawIds = row.evidence_analysis_ids_json as unknown;
  const analysisIds = Array.isArray(rawIds)
    ? rawIds.map((x) => String(x).trim()).filter(Boolean)
    : typeof rawIds === "string"
      ? (JSON.parse(rawIds) as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];
  let palette: Record<string, unknown> | null = null;
  for (const aid of analysisIds.slice(0, 3)) {
    const a = await getCreativeVisualAnalysis(db, projectId, aid);
    const cp = a?.color_palette_json as unknown;
    if (cp && typeof cp === "object" && !Array.isArray(cp)) {
      palette = cp as Record<string, unknown>;
      break;
    }
    if (typeof cp === "string") {
      try {
        const o = JSON.parse(cp) as Record<string, unknown>;
        if (o && typeof o === "object") {
          palette = o;
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const baseName =
    safeTemplateBase(opts.template_base_name ?? row.title.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40)) ??
    `ci-${row.insight_ref.replace(/^ci_/, "").slice(0, 20)}`;
  const fileName = `${baseName}.hbs`;
  if (!NAME_RE.test(fileName)) throw new Error("invalid template file name");

  const tplDir = config.CAROUSEL_TEMPLATES_DIR;
  const basePath = path.join(tplDir, "carousel_notes_app_minimal.hbs");
  let source = await readFile(basePath, "utf8");
  const { paper, ink, body } = pickHexes(palette);
  const inject = `
    /* creative_intel_mimic — pattern inspiration, not a pixel clone */
    :root{
      --paper: ${paper};
      --ink: ${ink};
      --body: ${body};
    }
`;
  if (source.includes(":root{")) {
    source = source.replace(/:root\s*\{[^}]*\}/m, inject.trim());
  } else {
    source = source.replace("</style>", `${inject}</style>`);
  }

  const outPath = path.join(tplDir, fileName);
  await writeFile(outPath, source, "utf8");

  await insertCreativeCarouselMimicTemplate(db, {
    project_id: projectId,
    creative_insight_id: row.id,
    source_group_id: null,
    template_file_name: fileName,
    hbs_source: source,
    metadata_json: { from_insight_ref: row.insight_ref, color_palette_used: palette },
  });
  await addProjectCarouselTemplate(db, projectId, fileName);

  return { template_file_name: fileName, path_written: outPath };
}
