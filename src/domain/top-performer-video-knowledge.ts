/**
 * Build grounding-scoped top-performer video knowledge for HeyGen creation packs.
 */
import { slimVisualGuidelineEntryForLlm } from "../services/llm-creation-pack-budget.js";
import { findGroundedVisualGuidelineEntry } from "./top-performer-grounding.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function stringCap(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function compactFrame(frame: unknown): Record<string, unknown> | null {
  const f = asRecord(frame);
  if (!f) return null;
  const out: Record<string, unknown> = {};
  if (f.frame_index != null) out.frame_index = f.frame_index;
  const purpose = stringCap(f.frame_purpose ?? f.slide_purpose, 80);
  if (purpose) out.frame_purpose = purpose;
  const vis = stringCap(f.visual_description, 280);
  if (vis) out.visual_description = vis;
  const spoken = stringCap(f.spoken_text ?? f.on_screen_text_transcript, 280);
  if (spoken) out.spoken_text = spoken;
  const layout = stringCap(f.layout_template, 80);
  if (layout) out.layout_template = layout;
  return Object.keys(out).length > 0 ? out : null;
}

/** Slim video insight entry for LLM — pattern cues only, scoped to one grounded reference. */
export function buildTopPerformerVideoKnowledgeForLlm(
  derivedGlobals: Record<string, unknown> | null | undefined,
  insightIds: string[]
): Record<string, unknown> | null {
  const entry = findGroundedVisualGuidelineEntry(derivedGlobals, insightIds, "top_performer_video");
  if (!entry) return null;

  const slim = slimVisualGuidelineEntryForLlm(entry);
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  const out: Record<string, unknown> = {
    insights_id: entry.insights_id,
    analysis_tier: entry.analysis_tier,
    format_pattern: slim.format_pattern ?? aes.format_pattern,
    hook_visual: stringCap(aes.hook_visual ?? slim.hook_visual, 400),
    video_arc: stringCap(aes.video_arc, 500),
    pacing_notes: stringCap(aes.pacing_notes, 400),
    why_it_worked: stringCap(entry.why_it_worked ?? aes.why_it_worked, 800),
    message_thesis: stringCap(aes.message_thesis, 400),
    narrative_arc: stringCap(aes.narrative_arc ?? aes.video_arc, 600),
    spoken_script_summary: stringCap(aes.spoken_script_summary, 800),
    on_screen_text_script: stringCap(aes.on_screen_text_script ?? aes.on_screen_text_summary, 600),
    spoken_transcript_whisper: stringCap(aes.spoken_transcript_whisper, 1200),
    video_visual_system: aes.video_visual_system ?? slim.video_visual_system,
    video_composition_system: aes.video_composition_system ?? slim.video_composition_system,
  };

  const blueprint = asRecord(aes.replication_blueprint) ?? asRecord(slim.replication_blueprint);
  if (blueprint) {
    const steps = Array.isArray(blueprint.steps_to_remake)
      ? (blueprint.steps_to_remake as unknown[]).slice(0, 8).map((s) => stringCap(s, 200)).filter(Boolean)
      : [];
    out.replication_blueprint = {
      steps_to_remake: steps,
      asset_sources: Array.isArray(blueprint.asset_sources)
        ? (blueprint.asset_sources as unknown[]).slice(0, 6).map((s) => stringCap(s, 120)).filter(Boolean)
        : [],
      tooling_notes: stringCap(blueprint.tooling_notes, 300),
      legal_ethics: stringCap(blueprint.legal_ethics, 300),
    };
  }

  const framesRaw = Array.isArray(aes.frames) ? aes.frames : [];
  if (framesRaw.length > 0) {
    const frames = framesRaw
      .slice(0, 8)
      .map(compactFrame)
      .filter((x): x is Record<string, unknown> => x != null);
    if (frames.length > 0) out.frames = frames;
  }

  return out;
}

export const TOP_PERFORMER_VIDEO_HEYGEN_SYSTEM_ADDENDUM = `Top-performer video reference (pattern only):
- When creation_pack includes top_performer_video_knowledge, recreate the **format pattern** (hook structure, pacing, visual system) from replication_blueprint — not a verbatim copy of transcript or on-screen text.
- Adapt hooks and beats to the planned idea and brand; do not reproduce competitor-specific names, logos, or copyrighted footage references.`;

export function topPerformerVideoHeygenSystemSuffix(pack: Record<string, unknown>): string {
  const k = pack.top_performer_video_knowledge;
  if (k && typeof k === "object" && !Array.isArray(k)) {
    return `\n\n${TOP_PERFORMER_VIDEO_HEYGEN_SYSTEM_ADDENDUM}`;
  }
  return "";
}

export const TOP_PERFORMER_VIDEO_GROUNDING_MISSING_MESSAGE =
  "Top-performer video job is missing visual guideline grounding in the signal pack (top_performer_video_knowledge). Rebuild the signal pack, confirm the cart insight exists under visual_guidelines_pack_v1, then re-run.";

/** Append scoped TP video reference JSON when Flow Engine templates only inject {{script_input}} (candidate). */
export function appendTopPerformerVideoKnowledgeToUserPrompt(
  userPrompt: string,
  knowledge: Record<string, unknown> | null | undefined,
  maxJsonChars = 12_000
): string {
  if (!knowledge || typeof knowledge !== "object" || Array.isArray(knowledge)) return userPrompt;
  let json = JSON.stringify(knowledge);
  if (json.length > maxJsonChars) {
    json = `${json.slice(0, maxJsonChars)}…`;
  }
  return `${userPrompt.trim()}\n\n---\nTop-performer video reference (adapt format pattern and beats — do not copy transcript or on-screen text verbatim):\n${json}`.trim();
}
