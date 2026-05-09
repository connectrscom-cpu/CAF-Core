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

/** Product video angle for HeyGen Video Agent prompt prioritization. */
export type ProductVideoAngle =
  | "PROBLEM"
  | "FEATURE"
  | "COMPARISON"
  | "USECASE"
  | "SOCIAL_PROOF"
  | "OFFER"
  | "GENERIC";

const MAX_VIDEO_AGENT_PRODUCT_LINES = 14;

export function productFlowTypeToAngle(flowType: string | null | undefined): ProductVideoAngle {
  const ft = (flowType ?? "").trim();
  if (!/^FLOW_PRODUCT_/i.test(ft)) return "GENERIC";
  const rest = ft.replace(/^FLOW_PRODUCT_/i, "").toUpperCase();
  if (rest === "PROBLEM") return "PROBLEM";
  if (rest === "FEATURE") return "FEATURE";
  if (rest === "COMPARISON") return "COMPARISON";
  if (rest === "USECASE") return "USECASE";
  if (rest === "SOCIAL_PROOF") return "SOCIAL_PROOF";
  if (rest === "OFFER") return "OFFER";
  return "GENERIC";
}

function firstSentenceOrLine(s: string | null | undefined, maxLen: number): string {
  const c = clean(s);
  if (!c) return "";
  const cut = c.split(/[.\n]/)[0]?.trim() ?? c;
  return cut.length > maxLen ? `${cut.slice(0, maxLen - 1)}…` : cut;
}

/**
 * Prioritized, bounded product lines for Video Agent (not a full profile dump).
 */
export function buildProductProfileVideoAgentLines(
  product: ProductProfileRow | null | undefined,
  flowType: string | null | undefined
): string[] {
  if (!product) return [];
  const angle = productFlowTypeToAngle(flowType);
  const lines: string[] = [];
  const push = (label: string, val: string | null | undefined) => {
    const c = clean(val);
    if (c) lines.push(`${label}: ${c}`);
  };

  switch (angle) {
    case "SOCIAL_PROOF":
      push("Social proof", product.social_proof);
      push("Proof points", product.proof_points);
      push("One-liner", product.one_liner);
      push("Primary audience", product.primary_audience);
      push("Audience pain (context)", firstSentenceOrLine(product.audience_pain_points, 200));
      push("Primary CTA", product.primary_cta);
      push("Guarantee / trust", product.guarantee);
      break;
    case "USECASE":
      push("Use cases", firstSentenceOrLine(product.use_cases, MAX_FIELD_CHARS));
      push("Primary audience", product.primary_audience);
      push("Key benefits", firstSentenceOrLine(product.key_benefits, MAX_FIELD_CHARS));
      push("One-liner", product.one_liner);
      push("Value proposition", firstSentenceOrLine(product.value_proposition, MAX_FIELD_CHARS));
      push("Primary CTA", product.primary_cta);
      break;
    case "PROBLEM":
      push("Audience pain points", firstSentenceOrLine(product.audience_pain_points, MAX_FIELD_CHARS));
      push("Audience desires", firstSentenceOrLine(product.audience_desires, MAX_FIELD_CHARS));
      push("Value proposition", firstSentenceOrLine(product.value_proposition, MAX_FIELD_CHARS));
      push("One-liner", product.one_liner);
      push("Primary CTA", product.primary_cta);
      break;
    case "FEATURE": {
      push("One-liner", product.one_liner);
      const feat = clean(product.key_features);
      if (feat) {
        const oneFeat = firstSentenceOrLine(feat, 220);
        if (oneFeat) lines.push(`Single feature focus (do not turn into a feature list): ${oneFeat}`);
      }
      push("Key benefit", firstSentenceOrLine(product.key_benefits, 220));
      push("Primary CTA", product.primary_cta);
      break;
    }
    case "COMPARISON":
      push("Differentiators", firstSentenceOrLine(product.differentiators, MAX_FIELD_CHARS));
      push("Comparison angles", firstSentenceOrLine(product.comparison_angles, MAX_FIELD_CHARS));
      push("One-liner", product.one_liner);
      push("Primary CTA", product.primary_cta);
      lines.push(
        "Framing: position factually vs alternatives; do not attack, insult, or defame named competitors."
      );
      break;
    case "OFFER":
      push("Current offer", product.current_offer);
      push("Offer urgency", product.offer_urgency);
      push("Pricing", firstSentenceOrLine(product.pricing_summary, MAX_FIELD_CHARS));
      push("Primary CTA", product.primary_cta);
      push("Secondary CTA", product.secondary_cta);
      break;
    default:
      push("Product", [clean(product.product_name), clean(product.product_category)].filter(Boolean).join(" — "));
      push("One-liner", product.one_liner);
      push("Value proposition", firstSentenceOrLine(product.value_proposition, MAX_FIELD_CHARS));
      push("Primary CTA", product.primary_cta);
  }

  const out = lines
    .filter((l) => l && !l.endsWith(": "))
    .slice(0, MAX_VIDEO_AGENT_PRODUCT_LINES);
  return out;
}

/**
 * Compact product block for HeyGen Video Agent — angle-prioritized, not a full dump.
 */
export function buildProductProfileVideoAgentPromptBlock(
  product: ProductProfileRow | null | undefined,
  flowType: string | null | undefined
): string | null {
  const lines = buildProductProfileVideoAgentLines(product, flowType);
  if (lines.length === 0) return null;
  return [
    "PRODUCT FACTS / PRODUCT STORY (use only what appears here; do not invent features or UI):",
    ...lines.map((l) => (l.startsWith("-") ? l : `- ${l}`)),
  ].join("\n");
}
