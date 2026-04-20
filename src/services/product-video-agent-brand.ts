/**
 * Compact brand-constraints block appended to the HeyGen Video Agent `prompt`
 * for FLOW_PRODUCT_* jobs. Keeps the addition bounded (~10 short lines) so we
 * stay well under HeyGen's prompt ceiling while still enforcing the project's
 * tone of voice, banned words/claims, mandatory disclaimers and positioning.
 *
 * Returns `null` when no useful constraints exist — the caller should then
 * leave the prompt unchanged.
 */

import type { BrandConstraintsRow } from "../repositories/project-config.js";

const MAX_FIELD_CHARS = 280;
const MAX_TOTAL_LINES = 12;

function clean(v: string | null | undefined): string {
  if (v == null) return "";
  const t = String(v).replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > MAX_FIELD_CHARS ? `${t.slice(0, MAX_FIELD_CHARS - 1)}…` : t;
}

function describeScale(n: number | null | undefined, label: string): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(10, Number(n)));
  return `${label}: ${clamped}/10`;
}

export function buildProductVideoAgentBrandLines(
  brand: BrandConstraintsRow | null | undefined
): string[] {
  if (!brand) return [];
  const lines: string[] = [];

  const tone = clean(brand.tone);
  const voice = clean(brand.voice_style);
  const audience = clean(brand.audience_level);
  const story = clean(brand.storytelling_style);
  const positioning = clean(brand.positioning_statement);
  const differentiation = clean(brand.differentiation_angle);
  const cta = clean(brand.cta_style_rules);
  const disclaimers = clean(brand.mandatory_disclaimers);
  const bannedClaims = clean(brand.banned_claims);
  const bannedWords = clean(brand.banned_words);
  const emoji = clean(brand.emoji_policy);
  const emotional = describeScale(brand.emotional_intensity, "Emotional intensity");
  const humor = describeScale(brand.humor_level, "Humor level");

  const voiceParts = [tone, voice].filter((x) => x);
  if (voiceParts.length) lines.push(`Brand voice: ${voiceParts.join(" · ")}`);
  if (audience) lines.push(`Audience level: ${audience}`);
  if (story) lines.push(`Storytelling style: ${story}`);
  if (positioning) lines.push(`Brand positioning: ${positioning}`);
  if (differentiation) lines.push(`Differentiation angle: ${differentiation}`);
  if (emotional) lines.push(emotional);
  if (humor) lines.push(humor);
  if (cta) lines.push(`CTA rules: ${cta}`);
  if (disclaimers) lines.push(`Mandatory disclaimer: ${disclaimers}`);
  if (bannedClaims) lines.push(`Do NOT make these claims: ${bannedClaims}`);
  if (bannedWords) lines.push(`Do NOT use these words: ${bannedWords}`);
  if (emoji) {
    const max = brand.max_emojis_per_caption;
    lines.push(
      typeof max === "number"
        ? `Emoji policy: ${emoji} (max ${max} per caption)`
        : `Emoji policy: ${emoji}`
    );
  }

  return lines.slice(0, MAX_TOTAL_LINES);
}

/**
 * Builds the full prompt block (with header) to append to the Video Agent prompt.
 * Returns `null` when there are no constraint lines.
 */
export function buildProductVideoAgentBrandPromptBlock(
  brand: BrandConstraintsRow | null | undefined
): string | null {
  const lines = buildProductVideoAgentBrandLines(brand);
  if (lines.length === 0) return null;
  return ["Brand constraints (must be respected):", ...lines.map((l) => `- ${l}`)].join("\n");
}
