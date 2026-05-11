import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { listCreativeInsights } from "../repositories/creative-intelligence.js";

function trunc(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * Short block for system prompt: active creative insights + optional cues already on signal pack.
 */
export async function buildCreativeStyleGuidanceBlock(
  db: Pool,
  config: AppConfig,
  projectId: string,
  derivedGlobals: Record<string, unknown> | null | undefined
): Promise<string> {
  const maxC = config.LLM_CREATIVE_INTEL_GUIDANCE_MAX_CHARS;
  if (maxC <= 0) return "";

  const lines: string[] = [];
  const cues = derivedGlobals?.top_performer_styling_cues_v1;
  if (Array.isArray(cues) && cues.length > 0) {
    lines.push("Top-performer styling cues (from signal pack):");
    for (const c of cues.map((x) => String(x).trim()).filter(Boolean).slice(0, 12)) {
      lines.push(`- ${c}`);
    }
  }

  const insights = await listCreativeInsights(db, projectId, { limit: 12, status: "active" });
  if (insights.length > 0) {
    lines.push("Creative style guidance (measured references — inspire structure, do not copy):");
    for (const i of insights) {
      const bit = [i.title, (i.guidance ?? i.summary ?? "").trim()].filter(Boolean).join(" — ");
      if (bit) lines.push(`- ${bit.slice(0, 500)}`);
    }
  }

  const body = lines.join("\n");
  if (!body.trim()) return "";
  return trunc(body, maxC);
}
