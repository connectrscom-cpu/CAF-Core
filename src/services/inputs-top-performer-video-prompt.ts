/** Rich top-performer video vision prompt (carousel-depth, per-frame + replication). */

export const TOP_PERFORMER_VIDEO_SYSTEM_PROMPT = `You analyze a **short-form social video** from **ordered static frame attachments** (sampled through the clip; attachment 1 ≈ earliest timestamp). You do **not** hear audio — a separate **spoken_transcript** block may be supplied from automatic speech recognition; treat it as ground truth for narration when present.

Return ONLY valid JSON with **video-wide summary fields** plus **per-frame reproduction detail**:

— Video-wide (succinct but informative) —
{
  "hook_visual": "what the opening frames signal",
  "message_clarity": "core message from visuals + spoken/caption text",
  "pacing_notes": "cuts, energy, retention tricks inferred from frame sequence",
  "video_arc": "how the story or list progresses start → end",
  "opening_vs_body": "how the hook frames differ from middle/ending",
  "visual_consistency": "palette, template, persona, how unified it feels",
  "on_screen_text_summary": "recurring on-screen patterns (not necessarily full spoken script)",
  "spoken_hook": "best opening spoken line from transcript if any, else from visible text",
  "cta_clarity": "how clear the ask / next step is",
  "format_pattern": "talking_head | b_roll | text_on_screen | ugc | product_demo | mixed | unknown",
  "risk_flags": ["meaningful risk strings only; use [] when none — never \\"none\\" or \\"n/a\\""],
  "why_it_worked": "why this may perform (short)",

  "video_as_whole_summary": "2–5 sentences: story, vibe, pacing, what makes it watchable",
  "video_composition_system": {
    "recurring_layout_pattern": "Recurring spatial pattern across frames (short)",
    "repeated_element_positions": ["Captions usually top 10–20%", "Creator face centered", "CTA sticker bottom-right"],
    "safe_margin_pattern": "Text safe area / margins pattern",
    "visual_hierarchy_pattern": "Captions first, face second, product/CTA third"
  },
  "video_visual_system": {
    "overall_aesthetic": "e.g. lo-fi UGC / polished studio / meme edit",
    "canvas_aspect": "portrait_9_16 | square | landscape | unknown",
    "safe_margins_gutters": "padding / caption-safe zones",
    "repeated_template": "text box, split screen, green-screen, etc.",
    "motion_or_energy": "static talking head vs jump cuts vs kinetic text",
    "emoji_or_sticker_usage": "none | sparse | dense"
  },
  "replication_blueprint": {
    "steps_to_remake": ["ordered recipe a creator could follow without the original"],
    "asset_sources": ["generic b-roll / stock class / UGC archetype — no copyrighted targets"],
    "tooling_notes": "CapCut class, native IG text, teleprompter, etc.",
    "legal_ethics": "Recreate the *pattern*, not copyrighted footage or logos verbatim."
  },

  "frames": [
    {
      "frame_index": 1,
      "timestamp_sec": 0,
      "on_screen_text_transcript": "Every readable on-screen word in reading order; use \\n between lines; [illegible] when needed",
      "visual_description": "Subjects, framing, background, props — concrete enough to brief an editor",
      "layout_template": "talking_head_center | split_screen | full_bleed_broll | text_card | unknown",
      "composition_blueprint": {
        "canvas_description": "Short: aspect/orientation + safe margins if visible",
        "layout_structure": "Short: where captions/subject/CTA sit spatially",
        "visual_hierarchy": "What draws attention first → last",
        "elements": [
          {
            "element_id": "caption_1",
            "element_type": "headline | body_text | cta | logo | person | product | background | shape | icon | screenshot | decorative_element | other",
            "description": "what it is",
            "bbox_pct": [10, 12, 80, 18],
            "anchor": "top_left | top_center | top_right | center_left | center | center_right | bottom_left | bottom_center | bottom_right",
            "layer_order": 3,
            "prominence": "primary | secondary | tertiary | background",
            "style_notes": "optional",
            "position_confidence": "low | medium | high"
          }
        ],
        "text_blocks": [
          {
            "role": "headline | subheadline | body | cta | logo | other",
            "text": "visible line",
            "bbox_pct": [10, 12, 80, 18],
            "alignment": "left | center | right",
            "typography_notes": "optional",
            "position_confidence": "low | medium | high"
          }
        ],
        "background": "Short: background plate description",
        "spacing_notes": "Short: margins, negative space, caption-safe zones",
        "qwen_prompt_notes": "Preserve spatial layout + relative positions; use reference image for composition, not copyrighted details."
      },
      "typography": {
        "headline_guess": "font class + weight/case",
        "body_guess": "or none",
        "accent_guess": "or none",
        "relative_scale": "xs|sm|md|lg|xl vs frame or % guess",
        "text_placement": "top | center | bottom | full_bleed",
        "hierarchy": "largest → smallest elements"
      },
      "color_tokens": {
        "background": "#hex or name or unknown",
        "primary_text": "#hex or name or unknown",
        "accent": ["#hex or names"],
        "grade": "warm | cool | high_contrast | flat | unknown"
      },
      "graphic_elements": "captions, stickers, progress bars, arrows",
      "shot_type": "close_up | medium | wide | insert | screen_recording | unknown",
      "text_density": "low | medium | high"
    }
  ]
}

**Rules**
- frames.length MUST equal the number of frame image attachments; frame_index runs 1..N in attachment order.
- timestamp_sec should match the user message list when provided; else guess from position in sequence.
- Be faithful to visible pixels; do not invent UI chrome that is not visible.
- When spoken_transcript is provided, use it for narration/hooks but still describe **visible** on-screen text separately.
- Be conservative on sensitive claims; use risk_flags when needed.`;

export const TOP_PERFORMER_VIDEO_USER_PROMPT_TEMPLATE = `Evidence kind: {{EVIDENCE_KIND}}
Pre-LLM score: {{PRE_LLM_SCORE}}
Frame count: {{FRAME_COUNT}}
Frame timestamps (seconds, same order as attachments):
{{FRAME_TIMESTAMPS}}

Caption / ingest transcript (may be empty):
{{CAPTION_TRANSCRIPT}}

Spoken transcript (Whisper ASR, may be empty):
{{SPOKEN_TRANSCRIPT}}`;

const RISK_NOISE = new Set(["none", "n/a", "na", "-", "no risk", "no risks", "unknown"]);

export function parseTopPerformerVideoRiskFlags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x).trim())
    .filter((s) => s && !RISK_NOISE.has(s.toLowerCase()))
    .slice(0, 40);
}

export function buildVideoAestheticAnalysisJson(parsed: Record<string, unknown> | null): Record<string, unknown> {
  if (!parsed) return {};
  const out: Record<string, unknown> = {
    hook_visual: parsed.hook_visual,
    message_clarity: parsed.message_clarity,
    pacing_notes: parsed.pacing_notes,
    video_arc: parsed.video_arc,
    opening_vs_body: parsed.opening_vs_body,
    visual_consistency: parsed.visual_consistency,
    on_screen_text_summary: parsed.on_screen_text_summary,
    spoken_hook: parsed.spoken_hook,
    cta_clarity: parsed.cta_clarity,
    format_pattern: parsed.format_pattern,
    style_summary: parsed.video_as_whole_summary ?? parsed.style_summary,
  };
  if (Array.isArray(parsed.frames)) out.frames = parsed.frames;
  if (parsed.video_as_whole_summary != null) out.video_as_whole_summary = parsed.video_as_whole_summary;
  if (parsed.video_composition_system != null) out.video_composition_system = parsed.video_composition_system;
  if (parsed.video_visual_system != null) out.video_visual_system = parsed.video_visual_system;
  if (parsed.replication_blueprint != null) out.replication_blueprint = parsed.replication_blueprint;
  if (parsed._inference_limits != null) out._inference_limits = parsed._inference_limits;
  if (parsed.palette != null) out.palette = parsed.palette;
  if (parsed.on_screen_text != null) out.on_screen_text = parsed.on_screen_text;
  return out;
}

import {
  TOP_PERFORMER_VIDEO_SINGLE_FRAME_USER_APPENDIX,
} from "./video-insights-llm-normalize.js";

export function buildVideoInsightUserText(args: {
  evidenceKind: string;
  preLlmScore: number;
  frameCount: number;
  frameTimestampsSec: number[];
  captionTranscript: string;
  spokenTranscript: string;
  frameSource: string;
}): string {
  const tsLines =
    args.frameTimestampsSec.length > 0
      ? args.frameTimestampsSec.map((t, i) => `${i + 1}. ${t}s`).join("\n")
      : "(not provided — infer order from attachments)";
  const singleFrameNote = args.frameCount === 1 ? TOP_PERFORMER_VIDEO_SINGLE_FRAME_USER_APPENDIX : "";
  return `Evidence kind: ${args.evidenceKind}
Pre-LLM score: ${args.preLlmScore}
Frame count: ${args.frameCount}
Frame source: ${args.frameSource}
Frame timestamps (seconds, same order as attachments):
${tsLines}

Caption / ingest transcript (may be empty):
${args.captionTranscript || "(none)"}

Spoken transcript (Whisper ASR, may be empty):
${args.spokenTranscript || "(none)"}${singleFrameNote}`;
}
