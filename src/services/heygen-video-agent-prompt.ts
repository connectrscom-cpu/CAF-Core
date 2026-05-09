/**
 * Structured HeyGen Video Agent (`POST /v3/video-agents`) prompt construction.
 *
 * HeyGen recommends: clear intent, script when available, visual style, media-type guidance,
 * scene structure, duration per scene, A/B-roll hints, and explicit use of uploaded assets.
 * Target duration and post caption/hashtags are embedded in the prompt — not separate API fields.
 */

import { CANONICAL_FLOW_TYPES } from "../domain/canonical-flow-types.js";
import { extractSpokenScriptText, extractVideoPromptText } from "./video-gen-fields.js";

export type VideoAgentSpokenMode = "user_provided" | "agent_writes";

function cleanLine(s: string): string {
  return String(s || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Flatten nested objects into readable bullets (no raw JSON dumps in VISUAL STYLE). */
export function objectFieldToBullets(val: unknown, indent = ""): string[] {
  if (val == null) return [];
  if (typeof val === "string") {
    const t = cleanLine(val);
    return t ? [`${indent}- ${t}`] : [];
  }
  if (typeof val !== "object" || Array.isArray(val)) {
    const t = cleanLine(String(val));
    return t ? [`${indent}- ${t}`] : [];
  }
  const o = val as Record<string, unknown>;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    const label = k.replace(/_/g, " ");
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      const t = cleanLine(String(v));
      if (t) lines.push(`${indent}- ${label}: ${t}`);
    } else if (typeof v === "object" && !Array.isArray(v)) {
      lines.push(`${indent}- ${label}:`);
      lines.push(...objectFieldToBullets(v, `${indent}  `));
    }
  }
  return lines;
}

export function onScreenTextBursts(gen: Record<string, unknown>, maxItems: number, maxWords: number): string[] {
  const ost = gen.on_screen_text;
  if (!Array.isArray(ost)) return [];
  const out: string[] = [];
  for (const x of ost) {
    if (typeof x !== "string" || !x.trim()) continue;
    const words = x.trim().split(/\s+/);
    const t = words.slice(0, maxWords).join(" ");
    out.push(t.length <= 48 ? t : `${t.slice(0, 47).trimEnd()}…`);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * Split total target seconds across five short-form beats (scaled, not fixed 0–3s etc.).
 */
export function allocateVideoAgentSceneSeconds(totalSec: number): {
  hook: number;
  context: number;
  value: number;
  proof: number;
  cta: number;
} {
  const T = Math.max(15, Math.min(300, Math.round(Number(totalSec)) || 30));
  let hook = Math.max(2, Math.min(5, Math.round(T * 0.1)));
  let cta = Math.max(3, Math.min(8, Math.round(T * 0.14)));
  let rest = T - hook - cta;
  let context = Math.max(3, Math.round(rest * 0.24));
  let proof = Math.max(3, Math.round(rest * 0.28));
  let value = rest - context - proof;
  value = Math.max(5, value);
  const sum = hook + context + value + proof + cta;
  if (sum !== T) value += T - sum;
  value = Math.max(4, value);
  return { hook, context, value, proof, cta };
}

export interface HeyGenVideoAgentProductionBriefArgs {
  gen: Record<string, unknown>;
  agentMode: "prompt_avatar" | "no_avatar";
  orientation: string;
  durationSec: number;
  platform: string | null | undefined;
  flowType: string | null | undefined;
  spokenMode: VideoAgentSpokenMode;
}

function isCanonicalScriptFlow(flowType: string | null | undefined): boolean {
  const ft = (flowType ?? "").trim();
  return ft === CANONICAL_FLOW_TYPES.VID_SCRIPT || /Video_Script|video_script|script_generator|Script_HeyGen|FLOW_HEYGEN_AVATAR_SCRIPT/i.test(
    ft
  );
}

function isCanonicalPromptFlow(flowType: string | null | undefined): boolean {
  const ft = (flowType ?? "").trim();
  return (
    ft === CANONICAL_FLOW_TYPES.VID_PROMPT ||
    /Video_Prompt|video_prompt|prompt_generator|Prompt_HeyGen|HEYGEN_AVATAR_PROMPT|FLOW_HEYGEN_AVATAR_PROMPT|HEYGEN_NO_AVATAR_PROMPT|FLOW_HEYGEN_NO_AVATAR_PROMPT/i.test(
      ft
    ) ||
    /no_avatar|heygen_no|HEYGEN_NO_AVATAR|NoAvatar/i.test(ft)
  );
}

/**
 * Single string passed as `prompt` on `POST /v3/video-agents`.
 */
export function buildHeyGenVideoAgentProductionBrief(args: HeyGenVideoAgentProductionBriefArgs): string {
  const { gen, agentMode, orientation, durationSec, platform, flowType, spokenMode } = args;
  const plat = cleanLine(platform ?? "") || "short-form social";
  const hook = cleanLine(String(gen.hook ?? gen.hook_line ?? "").trim());
  const spokenScript = cleanLine(extractSpokenScriptText(gen, 1));
  const videoPrompt = cleanLine(extractVideoPromptText(gen, 1));
  const cta = cleanLine(String(gen.cta ?? gen.cta_line ?? "").trim());
  const caption = cleanLine(String(gen.caption ?? "").trim());
  const disclaimer = cleanLine(
    String(gen.disclaimer ?? gen.disclaimer_line ?? gen.mandatory_disclaimer ?? "").trim()
  );
  const onScreen = onScreenTextBursts(gen, 8, 7);
  const scenes = allocateVideoAgentSceneSeconds(durationSec);

  const visualBullets = [
    ...objectFieldToBullets(gen.visual_direction),
    ...objectFieldToBullets(gen.camera_instructions),
    ...objectFieldToBullets(gen.editing_notes),
  ];
  const visualStyleSection =
    visualBullets.length > 0
      ? visualBullets.join("\n")
      : "- Derive look from the visual / generation prompt and platform norms; avoid generic stock clichés unless the brief specifies a mood.";

  let tagsLine = "";
  const tags = gen.hashtags;
  if (Array.isArray(tags) && tags.length) {
    const flat = tags
      .filter((t): t is string => typeof t === "string" && t.trim() !== "")
      .map((t) => t.trim().replace(/^#/g, ""));
    if (flat.length) tagsLine = flat.join(" ");
  } else if (typeof tags === "string" && tags.trim()) {
    tagsLine = tags.trim().replace(/^#/g, "");
  }

  const primaryGoal =
    isCanonicalPromptFlow(flowType) && !isCanonicalScriptFlow(flowType)
      ? "Deliver a scene-structured short video that matches the creative brief and platform context."
      : "Deliver a tight talking-head or hybrid avatar video that follows the supplied script with supportive B-roll and motion overlays.";

  const scriptSection =
    spokenMode === "user_provided" && spokenScript
      ? [
          "The following is the approved voiceover script. Follow it closely.",
          "You may make only minor grammar and pacing edits for natural delivery.",
          "Do not add unsupported claims, statistics, or product details that are not implied by the brief or brand/product sections below.",
          "",
          `SCRIPT (verbatim intent):\n${spokenScript}`,
        ].join("\n")
      : [
          "Write a concise voiceover that fits the target duration.",
          "Use ONE clear idea; sound native to short-form.",
          "Do not recite the product briefing or read features as a bullet list.",
          "Ground statements only in the facts given in PRODUCT FACTS / BRAND sections.",
          "If a mandatory disclaimer appears under BRAND / SAFETY CONSTRAINTS, speak it naturally once near the close (before or with the CTA).",
          hook ? `\nHook to open from: ${hook}` : "",
          videoPrompt ? `\nVisual direction summary: ${videoPrompt.slice(0, 600)}${videoPrompt.length > 600 ? "…" : ""}` : "",
        ]
          .filter(Boolean)
          .join("\n");

  const deliveryAvatar =
    agentMode === "prompt_avatar"
      ? "Use the assigned avatar when the route supports it; keep eyeline and framing consistent with short-form."
      : "No on-screen avatar, presenter, or talking head. Voiceover + graphics, b-roll, and text only.";

  const flowHint = isCanonicalScriptFlow(flowType)
    ? "Script-led flow: prioritize faithful delivery of SCRIPT (verbatim intent) above creative paraphrase."
    : isCanonicalPromptFlow(flowType)
      ? "Prompt-led flow: use SCENE PLAN and visual brief to control pacing and visuals."
      : "";

  /** Prefer hook for Scene 1 so the full `video_prompt` can appear once in VISUAL / GENERATION PROMPT (avoids duplicating long prompts). */
  const hookVisual = hook
    ? `Opener tied to hook: ${hook.slice(0, 200)}${hook.length > 200 ? "…" : ""}`
    : videoPrompt
      ? videoPrompt.slice(0, 200)
      : "Pattern-interrupt opener aligned to brief.";
  const problemVisual = hook
    ? `Relate visually to: ${hook.slice(0, 120)}`
    : "Context that mirrors the viewer's situation (b-roll or simple motion).";
  /** When a full VISUAL / GENERATION PROMPT follows, do not paste `video_prompt` into Scene 3 (avoids duplicate tokens). */
  const valueVisual =
    videoPrompt && videoPrompt !== spokenScript
      ? "Motion graphics, callouts, and diagram-style overlays aligned to the VISUAL / GENERATION PROMPT section below."
      : videoPrompt
        ? videoPrompt.slice(0, 280)
        : "Motion graphics, callouts, or simple diagram-style overlays for the core idea.";
  const proofVisual = "Quote card, stat callout, testimonial bubble, or concrete example visual — only if supported by the brief (no invented metrics).";
  const ctaVisual = "Clean end card; single primary action.";

  const hookOverlay = onScreen[0] ?? (hook ? hook.split(/\s+/).slice(0, 6).join(" ") : "Scroll-stopping hook");
  const problemOverlay = onScreen[1] ?? "Why this matters";
  const valueOverlay = onScreen[2] ?? "Core takeaway";
  const proofOverlay = onScreen[3] ?? "Proof / detail";
  const ctaOverlay = onScreen[4] ?? (cta ? cta.split(/\s+/).slice(0, 7).join(" ") : "CTA");

  const sections: string[] = [];

  sections.push("CAF VIDEO AGENT PRODUCTION BRIEF");
  sections.push("");
  sections.push("OBJECTIVE");
  sections.push(`- Platform: ${plat}`);
  sections.push("- Format: short-form social video");
  sections.push(`- Orientation: ${orientation}`);
  sections.push(`- Target duration: about ${durationSec} seconds (entire video — honor this in pacing and scene lengths)`);
  sections.push(`- Primary goal: ${primaryGoal}`);
  sections.push("- Audience: infer from brand constraints and product context when stated; otherwise broad platform-native viewers");
  if (flowHint) sections.push(`- Flow note: ${flowHint}`);

  sections.push("");
  sections.push("DELIVERY MODE");
  sections.push(`- ${deliveryAvatar}`);
  sections.push(`- Voiceover/script mode: ${spokenMode === "user_provided" ? "User-provided script (see SCRIPT / VOICEOVER)" : "Agent-authored VO from brief (see SCRIPT / VOICEOVER)"}`);
  sections.push("- Pacing: fast hook in first seconds, clear middle, single decisive CTA at the end");
  sections.push("- Tone: confident, conversational, platform-native — avoid generic corporate narration");

  sections.push("");
  sections.push("SCRIPT / VOICEOVER");
  sections.push(scriptSection);

  sections.push("");
  sections.push("SCENE PLAN");
  sections.push(
    `Scene 1 — Hook (~${scenes.hook}s)\n- Purpose: stop the scroll.\n- Visual: ${hookVisual}\n- A-roll/B-roll: avatar or tight A-roll if enabled; otherwise kinetic type + b-roll.\n- Overlay text: ${hookOverlay} (3–7 words)\n- Motion: quick cut or subtle push-in`
  );
  sections.push(
    `Scene 2 — Context / problem (~${scenes.context}s)\n- Purpose: make the viewer recognize the situation.\n- Visual: ${problemVisual}\n- Overlay: ${problemOverlay}\n- Motion: simple transition; avoid clutter`
  );
  sections.push(
    `Scene 3 — Insight / value (~${scenes.value}s)\n- Purpose: deliver the core idea.\n- Visual: ${valueVisual}\n- Overlay: ${valueOverlay}\n- Motion: animated text beats synced to VO; motion graphics for abstract ideas`
  );
  sections.push(
    `Scene 4 — Proof / example (~${scenes.proof}s)\n- Purpose: make the message concrete.\n- Visual: ${proofVisual}\n- Overlay: ${proofOverlay}\n- Motion: hold legible; optional split layout`
  );
  sections.push(
    `Scene 5 — CTA / end card (~${scenes.cta}s)\n- Purpose: one clear action.\n- Visual: ${ctaVisual}\n- Overlay: ${ctaOverlay}\n- Motion: slow settle; readable on mobile`
  );

  sections.push("");
  sections.push("VISUAL STYLE");
  sections.push(visualStyleSection);

  sections.push("");
  sections.push("MEDIA TYPE GUIDANCE");
  sections.push(
    "- Motion graphics: abstract concepts, frameworks, benefits, on-screen explanations, and text-forward beats."
  );
  sections.push("- Stock media: realistic human emotion and environment when the brief calls for relatability.");
  sections.push(
    "- Uploaded files/assets (if present on the request): use as product screenshots, brand marks, or reference visuals; follow any asset-specific instructions from the operator."
  );
  sections.push(
    "- AI-generated visuals: only for conceptual scenes where stock or provided assets are insufficient — stay on-brand and non-misleading."
  );
  sections.push("- Do not invent product UI, features, or metrics not supported by the product facts or brief.");

  sections.push("");
  sections.push("ON-SCREEN TEXT RULES");
  sections.push("- Short bursts only: 3–7 words per overlay.");
  sections.push("- Do not mirror the full voiceover as paragraphs on screen.");
  sections.push("- Keep text readable on mobile safe zones.");
  sections.push("- Sync text beats to spoken emphasis; no hashtag strings on screen unless explicitly requested.");

  if (videoPrompt && videoPrompt !== spokenScript) {
    sections.push("");
    sections.push("VISUAL / GENERATION PROMPT (director brief)");
    sections.push(videoPrompt);
  }

  sections.push("");
  sections.push("POST CONTEXT ONLY (not for on-screen hashtag rendering)");
  sections.push(
    "Use caption and hashtag lines only to understand platform and discovery context. Do not show hashtags as on-screen text unless the brief explicitly asks for it."
  );
  if (caption) sections.push(`- Caption context: ${caption}`);
  if (tagsLine) sections.push(`- Hashtag context: ${tagsLine}`);

  if (disclaimer) {
    sections.push("");
    sections.push("REQUIRED DISCLAIMER (voice or end text if appropriate)");
    sections.push(disclaimer);
  }

  if (cta) {
    sections.push("");
    sections.push("ENDING CTA");
    sections.push(cta);
  }

  sections.push("");
  sections.push("FINAL CHECK");
  sections.push("- Respect target duration across all scenes.");
  sections.push("- One primary CTA.");
  sections.push("- Astrology/wellness topics: avoid deterministic fate claims; prefer reflective, psychological framing when applicable.");

  return sections.join("\n").trim();
}
