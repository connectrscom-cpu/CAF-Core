/**
 * Compact product-profile block appended to the HeyGen Video Agent `prompt`
 * for FLOW_PRODUCT_* jobs. Gives HeyGen a concrete briefing about the product
 * (value proposition, features, differentiators, audience pain, offer, CTA)
 * so its Video Agent uses accurate product details instead of generic copy.
 *
 * Returns `null` when no useful product data exists — the caller should then
 * leave the prompt unchanged.
 */

import type { ProductProfileRow } from "../repositories/project-config.js";

const MAX_FIELD_CHARS = 320;
const MAX_TOTAL_LINES = 18;

function clean(v: string | null | undefined): string {
  if (v == null) return "";
  const t = String(v).replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > MAX_FIELD_CHARS ? `${t.slice(0, MAX_FIELD_CHARS - 1)}…` : t;
}

export function buildProductProfileLines(
  product: ProductProfileRow | null | undefined
): string[] {
  if (!product) return [];
  const out: string[] = [];

  const name = clean(product.product_name);
  const category = clean(product.product_category);
  const url = clean(product.product_url);
  const oneLiner = clean(product.one_liner);
  const vp = clean(product.value_proposition);
  const pitch = clean(product.elevator_pitch);
  const audience = clean(product.primary_audience);
  const pains = clean(product.audience_pain_points);
  const desires = clean(product.audience_desires);
  const useCases = clean(product.use_cases);
  const features = clean(product.key_features);
  const benefits = clean(product.key_benefits);
  const diff = clean(product.differentiators);
  const proofs = clean(product.proof_points);
  const social = clean(product.social_proof);
  const competitors = clean(product.competitors);
  const comparisons = clean(product.comparison_angles);
  const pricing = clean(product.pricing_summary);
  const offer = clean(product.current_offer);
  const urgency = clean(product.offer_urgency);
  const guarantee = clean(product.guarantee);
  const cta = clean(product.primary_cta);
  const cta2 = clean(product.secondary_cta);
  const doSay = clean(product.do_say);
  const dontSay = clean(product.dont_say);
  const taglines = clean(product.taglines);
  const keywords = clean(product.keywords);

  const headerParts = [name, category].filter((x) => x);
  if (headerParts.length) out.push(`Product: ${headerParts.join(" — ")}`);
  if (oneLiner) out.push(`One-liner: ${oneLiner}`);
  if (vp) out.push(`Value proposition: ${vp}`);
  if (pitch) out.push(`Elevator pitch: ${pitch}`);
  if (audience) out.push(`Primary audience: ${audience}`);
  if (pains) out.push(`Audience pain points: ${pains}`);
  if (desires) out.push(`Audience desires: ${desires}`);
  if (useCases) out.push(`Use cases: ${useCases}`);
  if (features) out.push(`Key features: ${features}`);
  if (benefits) out.push(`Key benefits: ${benefits}`);
  if (diff) out.push(`Differentiators: ${diff}`);
  if (proofs) out.push(`Proof points: ${proofs}`);
  if (social) out.push(`Social proof: ${social}`);
  if (competitors) out.push(`Competitors: ${competitors}`);
  if (comparisons) out.push(`Comparison angles: ${comparisons}`);
  if (pricing) out.push(`Pricing: ${pricing}`);
  if (offer) out.push(`Current offer: ${offer}`);
  if (urgency) out.push(`Urgency: ${urgency}`);
  if (guarantee) out.push(`Guarantee: ${guarantee}`);
  if (cta) out.push(`Primary CTA: ${cta}`);
  if (cta2) out.push(`Secondary CTA: ${cta2}`);
  if (taglines) out.push(`Taglines: ${taglines}`);
  if (keywords) out.push(`Keywords: ${keywords}`);
  if (doSay) out.push(`Always say: ${doSay}`);
  if (dontSay) out.push(`Never say: ${dontSay}`);
  if (url) out.push(`Product URL: ${url}`);

  return out.slice(0, MAX_TOTAL_LINES);
}

/**
 * Builds the full prompt block (with header) to append to the Video Agent prompt.
 * Returns `null` when there is no product data to add.
 */
export function buildProductProfilePromptBlock(
  product: ProductProfileRow | null | undefined
): string | null {
  const lines = buildProductProfileLines(product);
  if (lines.length === 0) return null;
  return [
    "Product briefing (use these concrete facts; do not invent features):",
    ...lines.map((l) => `- ${l}`),
  ].join("\n");
}
