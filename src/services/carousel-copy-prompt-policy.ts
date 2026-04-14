/**
 * Extra system guidance for carousel-style flows (e.g. Flow_Carousel_Copy), informed by recurring
 * editorial review themes: structure, depth, CTAs, hashtags, and slide roles.
 */
export const CAROUSEL_COPY_SYSTEM_ADDENDUM = `Carousel copy quality (editorial bar):
- **Structure:** Build a clear arc: hook/cover → supporting slides with one idea each → strong closing CTA. Avoid thin or repetitive slides; body copy should be **substantive** (explain the insight, not generic filler).
- **Cover / slide 01:** When the schema has cover + subtitle fields, the cover should hook attention; subtitle or first body can carry the **project @handle** if the brand handle appears in candidate/signal context (do not invent handles).
- **Final CTA slide:** Use **explicit imperative verbs** plus the handle when known. Avoid vague closers ("check us out" only).
  - Strong CTA examples: "Follow @brand for daily X", "Save this for later", "Share with a friend who needs this", "Comment your sign/experience", "Tag someone who'd love this".
- **Caption / post text:** If the schema includes caption or hashtags, include **relevant** hashtags grounded in signal_pack / publication hints; obey platform_constraints.max_hashtags. Do not omit hashtags when the schema expects them and the cap allows.
- **Tone & narrative:** Prefer specific, evidence-backed wording over generic platitudes (reduces "too_generic" / "quality_low" patterns).
- **Slide text length:** Headlines must read cleanly when line-wrapped (avoid awkward mid-word breaks; prefer shorter words or rephrase if a title would truncate badly in a narrow column).
- **Depth bar (anti-"quality_low"):** Each body slide should include 2–4 short sentences (or 3–6 bullets) with at least one concrete detail (number, example, constraint, or “how-to”), not just a generic claim. Avoid one-liners on content slides unless the slide role is intentionally a punchline.
- **Emoji / hashtag hygiene (anti-"bad_structure"):**
  - Emojis are optional; if used, keep them inline with a sentence. Do **not** output a line that is only an emoji.
  - Do **not** include hashtags inside slide text. Put hashtags only in the dedicated `hashtags` field (or caption), and only if the schema/platform expects it.
- **Video-adjacent jobs:** If this pack feeds HeyGen/avatar flows elsewhere, keep spoken or on-screen script **conversational** and aligned with the intended voice (reduces "mechanical" delivery when TTS reads literally).`;
