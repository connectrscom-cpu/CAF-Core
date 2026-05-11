import type { Pool } from "pg";
import { mergeSignalPackDerivedGlobalsJson } from "../repositories/signal-packs.js";
import { listCreativeInsights } from "../repositories/creative-intelligence.js";

/**
 * Merge compact creative design pointers + styling cue strings into `signal_packs.derived_globals_json`.
 */
export async function mergeCreativeStylingIntoSignalPack(
  db: Pool,
  projectId: string,
  signalPackId: string,
  opts?: { max_insights?: number }
): Promise<{ merged: boolean; insight_count: number }> {
  const maxI = Math.min(Math.max(opts?.max_insights ?? 24, 1), 80);
  const insights = await listCreativeInsights(db, projectId, { limit: maxI, status: "active" });
  const styleTags = new Set<string>();
  const cues: string[] = [];
  const summaries: string[] = [];
  for (const row of insights) {
    const g = (row.guidance ?? "").trim();
    const s = (row.summary ?? "").trim();
    if (s) summaries.push(s.slice(0, 280));
    if (g) cues.push(g.slice(0, 400));
    for (const w of (row.title ?? "").split(/\s+/).slice(0, 8)) {
      const t = w.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
      if (t.length > 2) styleTags.add(t);
    }
  }

  const patch =
    insights.length === 0
      ? {
          creative_design_intelligence_v1: {
            schema_version: 1,
            updated_at: new Date().toISOString(),
            insight_ids: [] as string[],
            insight_refs: [] as string[],
            style_tags: [] as string[],
            layout_summary: "",
            top_performer_note: "No active creative insights yet; ingest top performers first.",
          },
          top_performer_styling_cues_v1: [] as string[],
        }
      : {
          creative_design_intelligence_v1: {
            schema_version: 1,
            updated_at: new Date().toISOString(),
            insight_ids: insights.map((r) => r.id).slice(0, 48),
            insight_refs: insights.map((r) => r.insight_ref).slice(0, 48),
            style_tags: [...styleTags].slice(0, 24),
            layout_summary: summaries.slice(0, 4).join(" — ").slice(0, 1200),
            carousel_structure_hints: {
              text_density: "mixed",
              hook_pattern: "Ground creative_insights.guidance for hook rhythm.",
              cta_pattern: "Prefer simple end-slide CTA for carousels.",
            },
            replication_safety_note:
              "Pattern-level inspiration from measured references; do not copy third-party branding or copyrighted assets.",
          },
          top_performer_styling_cues_v1: [...new Set(cues)].slice(0, 16),
        };

  await mergeSignalPackDerivedGlobalsJson(db, signalPackId, patch);
  return { merged: true, insight_count: insights.length };
}
