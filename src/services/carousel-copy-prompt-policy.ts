import { MIMIC_SEMANTIC_FIDELITY_COPY_RULES } from "../domain/mimic-job-grounding.js";

/**
 * Extra system guidance for carousel-style flows (e.g. Flow_Carousel_Copy), informed by recurring
 * editorial review themes: structure, depth, CTAs, hashtags, and slide roles.
 */
export const CAROUSEL_COPY_SYSTEM_ADDENDUM = `Carousel copy quality (editorial bar):
- **Structure:** Build a clear arc: hook/cover → supporting slides with one idea each → strong closing CTA. Avoid thin or repetitive slides; body copy should be **substantive** (explain the insight, not generic filler).
- **Cover / slide 01:** Include a short **kicker** on the cover slide as \`kicker\` (2–6 words; topic/category/series label). The cover should hook attention; subtitle or first body can carry the **project @handle** if the brand handle appears in candidate/signal context (do not invent handles).
- **Cover subtitle length:** The cover \`cover_subtitle\` / cover slide \`body\` must be **1–2 sentences max** and must read cleanly when line-wrapped. If your draft is longer, **rewrite it shorter** (do not just truncate mid-thought).
- **Panel / microcopy slots:** Fields like \`panel_title\`, \`panel_body\`, \`site_bar\`, \`note\` are **short UI labels or one beat of microcopy**—not the main essay. Put depth and long explanations in the primary \`body\` / \`headline\` fields for each slide; do not paste a full paragraph into \`panel_body\` when the template expects a quick callout.
- **Layout-safe wording:** Prefer normal spaces between words; avoid extremely long unbroken tokens or URLs in headlines. When templates use bottom cards/panels, reviewers should not need heavy rework to make text fit—write wrap-friendly lines.
- **Final CTA slide:** Must be a **clear CTA** and must include the **project @handle** when it is provided in context. Keep the **headline** punchy (one line); longer explanations belong in **cta_slide.sub** / body fields per schema — never repeat the same **@handle** in both the main CTA line and a duplicate handle slot.
  - Strong CTA examples: "Follow @brand for daily X", "Save this for later", "Share with a friend who needs this", "Comment your sign/experience", "Tag someone who'd love this".
- **No unrequested promotions:** Do **not** promote apps/products/features that are not explicitly present in the candidate, signal pack, strategy, or product context. If no app/product is mentioned in inputs, avoid inventing one.
  - If the input is not a product/app launch, avoid the words "app", "download", "install", "sign up", "try the app", or "available now" entirely.
- **Caption / post text:** If the schema includes caption or hashtags, include **relevant** hashtags grounded in signal_pack / publication hints; obey platform_constraints.max_hashtags. Do not omit hashtags when the schema expects them and the cap allows.
- **Tone & narrative:** Prefer specific, evidence-backed wording over generic platitudes (reduces "too_generic" / "quality_low" patterns).
- **Slide text length:** Headlines must read cleanly when line-wrapped (avoid awkward mid-word breaks; prefer shorter words or rephrase if a title would truncate badly in a narrow column).
- **Depth bar (anti-"quality_low"):** Obey the **carousel body length** block injected from platform_constraints.slide_min_chars / slide_max_chars (and any rework **scale**). Each body slide should use the full target range with at least one concrete detail (number, example, constraint, or “how-to”), not just a generic claim. Avoid one-liners on content slides unless the slide role is intentionally a punchline.
- **Emoji / hashtag hygiene (anti-"bad_structure"):**
  - Emojis are optional; if used, keep them inline with a sentence. Do **not** output a line that is only an emoji.
  - Do **not** include hashtags inside slide text. Put hashtags only in the dedicated 'hashtags' field (or caption), and only if the schema/platform expects it.
- **Video-adjacent jobs:** If this pack feeds HeyGen/avatar flows elsewhere, keep spoken or on-screen script **conversational** and aligned with the intended voice (reduces "mechanical" delivery when TTS reads literally).`;

/**
 * Top-performer mimic — `template_bg` branch. Full slide copy is burned onto stored background plates at render.
 */
export const MIMIC_TEMPLATE_BG_COPY_ADDENDUM = `Mimic template carousel (text-on-template):
- **Primary deliverable:** Complete per-slide copy for every slide in the deck (headline, body, kicker, CTA fields per schema). This copy will be composited onto pre-extracted background plates — write for on-slide reading, not caption-only.
- **Narrative:** Rephrase the reference deck slide-by-slide using \`slide_copy_layout\`. Match **roles, pacing, line count, and approximate length** (~80% structural similarity). Each slide must keep the **same subject and claim** as that slide's \`reference_on_screen_text\` — new wording only; do not transcribe verbatim and do not invent a new topic for a slide.
- **Do not inflate copy length:** Prefer *tight* rewrites that match the reference slide's reading length. If the reference slide is a short title line, output a short title line — do not expand into an explanatory paragraph just to “add depth”.
- **Use the reference text blocks:** When \`slide_copy_layout[N].text_blocks\` exist, treat them as the authoritative on-screen lines for that slide. Rewrite those lines in new wording while keeping the same named entities, product/brand mentions, and claim.
${MIMIC_SEMANTIC_FIDELITY_COPY_RULES}
- **Slide count (required):** Output **exactly** \`mimic_render_context.target_slide_count\` slides — one per row in \`slide_copy_layout\` (same order). Do not omit content slides from the reference; do not add extra slides.
- **No brand/app promo slides:** Do not write copy for sponsor frames, app download CTAs, or cash-back promos omitted from \`slide_copy_layout\`.
- Obey all carousel structure rules above (hook → body slides → CTA, substantive bodies, @handle on CTA when provided).`;

/**
 * Top-performer mimic — `carousel_visual` branch. Art-only visual plate (~80% similarity) + HBS text overlay.
 */
export const MIMIC_FULL_BLEED_COPY_ADDENDUM = `Mimic visual carousel (full-bleed / Flux-baked on-image text):
- **Primary deliverable:** Complete per-slide copy for every slide (headline, body, kicker, CTA per schema). Render generates an art-only visual plate per slide, then composites this copy via HBS at the same screen region as Nemotron \`text_blocks\` / \`typography.text_placement\` (not a default top stack) — write for on-slide reading.
- **Narrative:** Rephrase the reference deck slide-by-slide using \`slide_copy_layout\`. Match slide roles, line count, and approximate length (~80% structural similarity). Each slide's on-screen copy must preserve the **same meaning** as that slide's \`reference_on_screen_text\` and \`visual_description\` — rephrase only; never transcribe verbatim and never substitute a different sign, product, or topic on that slide.
- **Do not inflate copy length:** Prefer *tight* rewrites that match the reference slide's reading length. If the reference slide is 1–2 short lines, keep your output to ~1–2 short lines; do not expand into a long paragraph that changes the “feel” of the slide.
- **Use the reference text blocks:** When \`slide_copy_layout[N].text_blocks\` exist, treat them as the authoritative on-screen lines for that slide. Rewrite those lines in new wording while keeping the same named entities, product/brand mentions, and claim.
${MIMIC_SEMANTIC_FIDELITY_COPY_RULES}
- **Caption / hashtags:** Include when the schema expects them; they are the Instagram post text, separate from on-slide fields.
- **Slide count (required):** Output **exactly** \`mimic_render_context.target_slide_count\` slides — one per row in \`slide_copy_layout\` (same order). This is every content slide from the original post except promo/video frames in \`skipped_promotional_slide_indices\`. Do not skip or invent slides.
- **No brand/app promo slides:** Do not write copy for sponsor frames, app download CTAs, cash-back offers, or "link in bio" promos — those reference slides are omitted from \`slide_copy_layout\`.
- **Ignore generic carousel "depth bar" / slide_min_chars** — obey the per-slide length caps block when present; short reference bubbles must stay short.
- Obey carousel CTA / @handle rules when the schema expects them; do not inflate body slides beyond reference reading length.`;
