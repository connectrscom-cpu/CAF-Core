/**
 * Maps recurring editorial signals to engineering surfaces.
 * Extend this list as your team stabilizes rejection tags and override field names.
 */
export type EngineeringTriggerKind = "rejection_tag" | "override_field" | "low_approval_flow";

export type EngineeringTriggerMatch = "exact" | "substring";

export interface EditorialEngineeringTrigger {
  /** Stable id for logs / API responses */
  id: string;
  kind: EngineeringTriggerKind;
  match: EngineeringTriggerMatch;
  /** Tag text, override JSON key, or flow_type — compared per `match` */
  pattern: string;
  /** Short label for humans (e.g. "Carousel renderer") */
  subsystem: string;
  /** Repo paths or globs to point Claude/Cursor at the right code */
  search_paths: string[];
  /** What kind of change usually fixes this class of issue */
  remediation_hint: string;
}

export const EDITORIAL_ENGINEERING_TRIGGERS: EditorialEngineeringTrigger[] = [
  {
    id: "tag_layout",
    kind: "rejection_tag",
    match: "substring",
    pattern: "layout",
    subsystem: "Carousel / static render (layout & safe zones)",
    search_paths: ["services/renderer/templates/", "services/renderer/server.js"],
    remediation_hint:
      "Adjust Handlebars/CSS for safe zones, font scaling, or overflow; add a regression snapshot or fixture render if possible.",
  },
  {
    id: "tag_typography",
    kind: "rejection_tag",
    match: "substring",
    pattern: "typography",
    subsystem: "Carousel renderer (text styling)",
    search_paths: ["services/renderer/templates/", "services/renderer/public/"],
    remediation_hint: "Tune font stacks, sizes, line-height, and truncation rules in templates or renderer CSS.",
  },
  {
    id: "tag_crop",
    kind: "rejection_tag",
    match: "substring",
    pattern: "crop",
    subsystem: "Renderer or asset pipeline (framing)",
    search_paths: ["services/renderer/", "services/video-assembly/"],
    remediation_hint:
      "Review viewport, image fit, and assembly dimensions; ensure export aspect matches platform expectations.",
  },
  {
    id: "tag_brand",
    kind: "rejection_tag",
    match: "substring",
    pattern: "brand",
    subsystem: "Templates + brand tokens / copy guardrails",
    search_paths: ["services/renderer/templates/", "src/services/llm-generator.ts"],
    remediation_hint:
      "If violations are visual, fix templates; if copy/tone, tighten generation prompts or post-process checks in Core.",
  },
  {
    id: "override_hook",
    kind: "override_field",
    match: "exact",
    pattern: "hook",
    subsystem: "Generation prompts & job payload shaping",
    search_paths: ["src/services/llm-generator.ts", "src/decision_engine/"],
    remediation_hint:
      "Humans often rewrite hooks: improve prompt instructions, examples, or structured output validation for hook fields.",
  },
  {
    id: "override_caption",
    kind: "override_field",
    match: "exact",
    pattern: "caption",
    subsystem: "Generation prompts & job payload shaping",
    search_paths: ["src/services/llm-generator.ts"],
    remediation_hint: "Same as hook — treat as generation-quality / instruction issue unless tied to a fixed template string.",
  },
  {
    id: "override_slide",
    kind: "override_field",
    match: "substring",
    pattern: "slide",
    subsystem: "Carousel slide copy or template bindings",
    search_paths: ["services/renderer/templates/", "src/services/llm-generator.ts"],
    remediation_hint:
      "If overrides target slide text, fix template placeholders or generation schema so slides match editorial expectations.",
  },
  {
    id: "low_approval_carousel",
    kind: "low_approval_flow",
    match: "substring",
    pattern: "CAROUSEL",
    subsystem: "End-to-end carousel flow (gen + render + review)",
    search_paths: ["services/renderer/", "src/services/llm-generator.ts", "apps/review/"],
    remediation_hint:
      "Low approval may be generation, layout, or review UX; triage using rejection tags and override fields before changing code.",
  },
  {
    id: "tag_bad_structure",
    kind: "rejection_tag",
    match: "substring",
    pattern: "bad_structure",
    subsystem: "Carousel / copy structure (LLM instructions)",
    search_paths: ["src/services/llm-generator.ts", "src/services/carousel-copy-prompt-policy.ts"],
    remediation_hint:
      "Tighten slide arc, cover vs body roles, and CTA clarity in carousel system addendum + Flow Engine user prompts for Flow_Carousel_Copy.",
  },
  {
    id: "tag_quality_low",
    kind: "rejection_tag",
    match: "substring",
    pattern: "quality_low",
    subsystem: "Generation depth and specificity",
    search_paths: ["src/services/llm-generator.ts", "src/services/publish-metadata-enrich.ts"],
    remediation_hint:
      "Increase substantive body copy, evidence grounding, and anti-generic guidance; review prompt_templates for the flow in DB.",
  },
  {
    id: "tag_too_generic",
    kind: "rejection_tag",
    match: "substring",
    pattern: "too_generic",
    subsystem: "Generation prompts + signal grounding",
    search_paths: ["src/services/llm-generator.ts", "src/services/carousel-copy-prompt-policy.ts"],
    remediation_hint:
      "Require concrete hooks to signal_pack rows; adjust user_prompt_template to forbid filler phrases.",
  },
  {
    id: "tag_cta_weak",
    kind: "rejection_tag",
    match: "substring",
    pattern: "cta_weak",
    subsystem: "CTA / caption closing",
    search_paths: ["src/services/publish-metadata-enrich.ts", "src/services/carousel-copy-prompt-policy.ts"],
    remediation_hint:
      "Enforce imperative CTAs + handle in publication contract and final-slide fields in schema/prompts.",
  },
  {
    id: "tag_subtitles",
    kind: "rejection_tag",
    match: "substring",
    pattern: "subtitle",
    subsystem: "Video assembly / captions pipeline",
    search_paths: ["services/video-assembly/", "src/services/scene-pipeline.ts"],
    remediation_hint:
      "Check SRT generation, burn-in vf chain, and timing vs speech; reproduce on sample task assets.",
  },
  {
    id: "tag_audio_voiceover",
    kind: "rejection_tag",
    match: "substring",
    pattern: "voiceover",
    subsystem: "Video script + TTS / HeyGen voice selection",
    search_paths: ["src/services/video-script-generator.ts", "src/services/llm-generator.ts"],
    remediation_hint:
      "Align script tone with voice_id; shorten sentences for natural TTS; not fixable in static carousel templates.",
  },
];

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function triggerMatchesValue(trigger: EditorialEngineeringTrigger, value: string): boolean {
  const v = norm(value);
  const p = norm(trigger.pattern);
  if (!v || !p) return false;
  if (trigger.match === "exact") return v === p;
  return v.includes(p);
}

export function triggersForInsight(
  insightType: string,
  scope: string
): EditorialEngineeringTrigger[] {
  const kind: EngineeringTriggerKind | null =
    insightType === "frequent_rejection_tag"
      ? "rejection_tag"
      : insightType === "frequent_override_field"
        ? "override_field"
        : insightType === "low_approval_flow"
          ? "low_approval_flow"
          : null;
  if (!kind) return [];
  return EDITORIAL_ENGINEERING_TRIGGERS.filter((t) => t.kind === kind && triggerMatchesValue(t, scope));
}
