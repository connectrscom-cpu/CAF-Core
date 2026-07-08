/**
 * Canonical Sign And Sound (SNS) brand profile + Brand Visual System bible.
 * Astrology / zodiac identity brand — @signandsound on Instagram.
 *
 * Applied via: npm run seed:sns-brand
 */

export const SNS_PROJECT_SLUG = "SNS";
export const SNS_DISPLAY_NAME = "Sign And Sound";

/** strategy_defaults row (partial — nulls omitted at upsert). */
export const SNS_STRATEGY = {
  project_type: "astrology_media",
  core_offer:
    "Sign And Sound is an astrology brand for people who follow their chart, not a newspaper horoscope. We make zodiac content feel personal, visually dreamy, and shareable — sign identity, relationships, growth, and \"that's so my sign\" moments.",
  target_audience:
    "Millennials and Gen Z (18–34) who know their sun sign, follow astrology on Instagram/TikTok, and want content that feels witty, relatable, and visually premium — not doom predictions or generic memes.",
  audience_problem:
    "Most astrology content is either too vague, too fear-based, or visually generic. They want identity content that feels made for their sign and looks good enough to save or share.",
  transformation_promise:
    "Help followers feel seen through their sign — entertained, slightly enlightened, and proud to rep their zodiac identity.",
  positioning_statement:
    "The cosmic identity brand — astrology that looks as good as it reads. Premium zodiac visuals + playful, knowing copy at @signandsound.",
  primary_business_goal: "Grow @signandsound Instagram following and saves",
  primary_content_goal: "Engagement; community; education",
  strategic_content_pillars:
    "sign identity listicles; compatibility & relationships; moon/transit explainers; \"that's so my sign\" hooks; cosmic aesthetic carousels",
  brand_archetype: "Sage + Jester — knowing but playful",
  differentiation_angle:
    "Premium midnight-cosmic visual system + sign-specific copy; entertainment-first, not fear-based predictions",
  growth_strategy: "Carousel saves + shareable zodiac listicles; mimic winning formats with SNS accent layer",
  instagram_handle: "signandsound",
  traffic_destination: "https://www.instagram.com/signandsound/",
  funnel_stage_focus: "awareness; engagement",
  publishing_intensity: "daily",
} as const;

/** brand_constraints row. */
export const SNS_BRAND_CONSTRAINTS = {
  tone: "Playful but knowing — like a friend who's read too much astrology TikTok but won't doom-post you",
  voice_style: "Conversational, sign-specific, witty; short punchy hooks; second person (you/your sign)",
  audience_level: "intermediate — knows sun sign, open to moon/rising references without heavy jargon",
  emotional_intensity: 0.55,
  humor_level: 0.65,
  emoji_policy: "sparse — zodiac glyphs and moon/sparkle only when they add flavor (max 2 per caption)",
  max_emojis_per_caption: 2,
  banned_claims:
    "guaranteed outcomes; medical/legal/financial advice disguised as astrology; definitive predictions of death/illness/breakups",
  banned_words:
    "guaranteed\n100% accurate\nyou will die\nmedical miracle\ncure\ninvestment advice\nbotanical\nherb garden\nolive branch",
  mandatory_disclaimers: "For entertainment purposes — not professional advice.",
  cta_style_rules: "Follow @signandsound; Save for your sign; Tag someone who needs this",
  storytelling_style: "Hook → sign-specific insight → relatable beat → soft CTA",
  positioning_statement:
    "Cosmic identity content — premium zodiac visuals, playful copy, zero fear-mongering.",
  differentiation_angle: "Midnight cosmic art direction + sign-native copy, not generic horoscope blurbs",
  risk_level_default: "medium",
  manual_review_required: true,
} as const;

/** product_profiles row. */
export const SNS_PRODUCT = {
  product_name: "Sign And Sound",
  product_category: "astrology_media",
  product_url: "https://www.instagram.com/signandsound/",
  one_liner: "Astrology content that looks as good as it reads.",
  value_proposition:
    "Premium zodiac identity carousels and reels for Instagram — sign listicles, compatibility, and cosmic aesthetics at @signandsound.",
  primary_audience:
    "Instagram-native astrology fans 18–34 who engage with sign identity and relationship content",
  instagram_handle: "signandsound",
  competitors: "The Pattern; Co-Star; popular zodiac meme pages; generic horoscope accounts",
  key_benefits: "Shareable; sign-specific; visually distinctive; entertainment-first",
  use_cases: "Instagram carousels; short-form video scripts; save-worthy listicles",
} as const;

/** brand_profile_v1 — drives brand translation + creation_pack visual words. */
export const SNS_BRAND_PROFILE_V1 = {
  schema_version: "brand_profile_v1",
  brand_name: "Sign And Sound",
  palette: ["#0B0B16", "#14142A", "#9B5CFF", "#C9A962", "#F5F5F7"],
  visual_style:
    "Midnight cosmic editorial — deep navy star fields, soft violet glow accents, subtle gold highlights, illustrated zodiac glyphs, orbit rings, premium Instagram carousel aesthetic",
  tone: "Playful but knowing — witty, sign-specific, relatable; never fear-based or preachy",
  domain_metaphors: [
    "star field",
    "zodiac wheel",
    "moon phase",
    "orbit ring",
    "constellation map",
    "cosmic glow",
    "sign tribe",
    "chart reading",
  ],
  allowed_motifs: [
    "zodiac glyphs",
    "star fields",
    "constellations",
    "moon phases",
    "orbit rings",
    "midnight navy gradients",
    "soft violet glow",
    "cosmic dust",
    "sign listicles",
  ],
  forbidden_motifs: [
    "stock food photography",
    "unrelated lifestyle stock",
    "botanical/herb-garden aesthetic",
    "harsh unrelated neon",
    "fortune-teller clichés",
    "random faces as hero subjects",
  ],
  symbol_map: [
    { connotation: "exclusivity", brand_expression: "inner-circle cosmic insight — \"only your sign gets this\"" },
    { connotation: "transformation", brand_expression: "new moon reset / chart growth arc" },
    { connotation: "community", brand_expression: "sign tribe — tag someone who needs this" },
    { connotation: "urgency", brand_expression: "mercury retrograde timing (playful, not scary)" },
    { connotation: "authority", brand_expression: "cosmic guide voice — knowing, not lecturing" },
    { connotation: "desire", brand_expression: "sign compatibility chemistry / cosmic match" },
    { connotation: "fear", brand_expression: "avoid — reframe as self-awareness, never doom" },
  ],
  platform_focus: ["Instagram", "TikTok"],
} as const;

/** brand_bible_v1 — Brand Visual System source of truth. */
export const SNS_BRAND_BIBLE_V1 = {
  schema_version: "brand_bible_v1",
  visual_mode: "mixed",
  visual_mode_custom: "Midnight cosmic zodiac editorial",
  palette: ["#0B0B16", "#14142A", "#9B5CFF", "#C9A962", "#F5F5F7"],
  allowed_motifs: [
    "zodiac glyphs",
    "star fields",
    "constellations",
    "moon phases",
    "orbit rings",
    "midnight navy gradients",
    "soft violet accent glow",
    "cosmic listicle layouts",
  ],
  forbidden_motifs: [
    "botanical line art",
    "herb-garden aesthetic",
    "stock food photos",
    "unrelated lifestyle stock",
    "harsh off-brand neon",
    "fortune-teller stock imagery",
  ],
  application_guide: {
    instructions:
      "Sign And Sound is an astrology brand. Visuals should feel midnight-cosmic: deep navy backgrounds, star fields, zodiac glyphs, soft violet accents, subtle gold highlights. Copy is sign-specific, playful, and shareable — \"that's so my sign\" energy. Never fear-based predictions. Always include @signandsound on cover/CTA slides when a handle slot exists.",
    content_aims: ["awareness", "engagement", "community", "education"],
    mimic_policy:
      "ACCENT MODE for mimic: keep the reference deck's structure, slide beats, and visual grammar. Do not replace the entire look of a trending reference. Apply SNS accents only — midnight palette tints where backgrounds are regenerated, @signandsound handle, logo on cover/CTA, orbit-ring or zodiac frame motifs when they fit without breaking the reference layout. Copy must be rewritten for SNS voice and sign-native angles, never competitor words.",
    original_policy:
      "FULL BVS for original and visual-first carousels: lead with midnight cosmic identity on every slide — star fields, sign glyphs, orbit rings, navy + violet + gold palette. Use carousel_sns_cosmic_identity / educational clean energy. Sign listicles, compatibility hooks, moon/transit explainers.",
  },
  asset_refs: [],
  heygen_presenters: [],
} as const;
