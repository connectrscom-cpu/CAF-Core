/**
 * Project-agnostic semantic contract for TP-grounded carousel jobs.
 * Anchors generation to the planned idea (thesis / key_points), not reference OCR subjects.
 */
import type { SlideIntelligenceBundleV1 } from "./slide-intelligence.js";
import { parseSlideIntelligenceBundle } from "./slide-intelligence.js";

export const SEMANTIC_CONTRACT_SCHEMA = "semantic_contract_v1" as const;

export interface SemanticContractV1 {
  schema_version: typeof SEMANTIC_CONTRACT_SCHEMA;
  /** One-sentence question or premise the deck must answer. */
  core_question: string;
  /** Longer idea framing (three_liner / summary). */
  idea_framing: string | null;
  /** Enumerated content beats — entity checklist when present. */
  content_beats: string[];
  /** Deck shape from SIL when available (hook → list_item → cta). */
  narrative_spine: string[];
  /** Dominant persuasion mechanism when known. */
  dominant_mechanism: string | null;
  source: {
    idea_id: string | null;
    candidate_id: string | null;
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function str(v: unknown, max = 800): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function strList(raw: unknown, maxItems = 12, maxItemLen = 280): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = str(item, maxItemLen);
    if (!s) continue;
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Minimum signal to treat the contract as authoritative during copy generation. */
export function hasUsableSemanticContract(contract: SemanticContractV1 | null | undefined): boolean {
  if (!contract) return false;
  if (contract.schema_version !== SEMANTIC_CONTRACT_SCHEMA) return false;
  if (!contract.core_question.trim()) return false;
  return contract.core_question.length >= 12 || contract.content_beats.length >= 2;
}

export function parseSemanticContractFromPayload(payload: {
  semantic_contract_v1?: unknown;
}): SemanticContractV1 | null {
  const raw = payload.semantic_contract_v1;
  const rec = asRecord(raw);
  if (!rec || rec.schema_version !== SEMANTIC_CONTRACT_SCHEMA) return null;
  const core = str(rec.core_question, 800);
  if (!core) return null;
  const src = asRecord(rec.source) ?? {};
  return {
    schema_version: SEMANTIC_CONTRACT_SCHEMA,
    core_question: core,
    idea_framing: str(rec.idea_framing, 1200),
    content_beats: strList(rec.content_beats, 14, 320),
    narrative_spine: strList(rec.narrative_spine, 16, 80),
    dominant_mechanism: str(rec.dominant_mechanism, 400),
    source: {
      idea_id: str(src.idea_id, 120),
      candidate_id: str(src.candidate_id, 200),
    },
  };
}

/**
 * Build a semantic contract from planner candidate / signal-pack idea fields.
 */
export function buildSemanticContractFromCandidate(
  candidateData: Record<string, unknown> | null | undefined,
  opts?: { slideIntelligence?: SlideIntelligenceBundleV1 | null }
): SemanticContractV1 | null {
  if (!candidateData) return null;

  const thesis =
    str(candidateData.thesis, 800) ??
    str(candidateData.content_idea, 800) ??
    str(candidateData.summary, 800) ??
    str(candidateData.title, 400);
  if (!thesis) return null;

  const ideaFraming =
    str(candidateData.three_liner, 1200) ??
    str(candidateData.summary, 800) ??
    str(candidateData.content_idea, 800);

  let contentBeats = strList(candidateData.key_points, 14, 320);
  if (contentBeats.length === 0) {
    contentBeats = strList(candidateData.key_points_json, 14, 320);
  }

  const sil = opts?.slideIntelligence ?? null;
  const narrativeSpine = sil?.why_analysis?.narrative_spine?.map((s) => String(s).trim()).filter(Boolean) ?? [];

  const contract: SemanticContractV1 = {
    schema_version: SEMANTIC_CONTRACT_SCHEMA,
    core_question: thesis,
    idea_framing: ideaFraming,
    content_beats: contentBeats,
    narrative_spine: narrativeSpine.slice(0, 16),
    dominant_mechanism: sil?.why_analysis?.dominant_mechanism
      ? str(sil.why_analysis.dominant_mechanism, 400)
      : null,
    source: {
      idea_id: str(candidateData.idea_id ?? candidateData.id, 120),
      candidate_id: str(candidateData.candidate_id, 200),
    },
  };

  return hasUsableSemanticContract(contract) ? contract : null;
}

/** Merge SIL narrative spine / mechanism onto an existing stored contract. */
export function enrichSemanticContractWithSlideIntelligence(
  contract: SemanticContractV1,
  bundle: SlideIntelligenceBundleV1 | null | undefined
): SemanticContractV1 {
  if (!bundle) return contract;
  const spine = bundle.why_analysis?.narrative_spine?.map((s) => String(s).trim()).filter(Boolean) ?? [];
  const mechanism = str(bundle.why_analysis?.dominant_mechanism, 400);
  return {
    ...contract,
    narrative_spine: spine.length > 0 ? spine.slice(0, 16) : contract.narrative_spine,
    dominant_mechanism: mechanism ?? contract.dominant_mechanism,
  };
}

export const MIMIC_IDEA_FAITHFUL_COPY_RULES = `Idea-faithful mimic copy (required):
- **Immutable contract:** \`semantic_contract_v1\` is the source of truth for what this deck is about. Every content slide must advance \`core_question\`. Do not drift into generic filler, unrelated topics, recipes, restaurant promos, or reference-default subjects when they conflict with the planned idea.
- **Content beats:** When \`content_beats\` lists enumerated beats, assign each beat to exactly one content slide in order (hook/CTA slides frame the question; do not consume beats on promo slides).
- **Reference role:** \`slide_copy_layout\` supplies slide count, copy-slot placement, and approximate length only — not the semantic subject when it conflicts with the idea contract.
- **Coherence:** A reader who swipes the full deck must still understand \`core_question\` without reading the prompt.`;

/** Prompt block injected before reference grounding when a usable contract exists. */
export function buildSemanticContractPromptBlock(contract: SemanticContractV1): string {
  const payload: Record<string, unknown> = {
    schema_version: contract.schema_version,
    core_question: contract.core_question,
    idea_framing: contract.idea_framing,
    content_beats: contract.content_beats,
    narrative_spine: contract.narrative_spine,
    dominant_mechanism: contract.dominant_mechanism,
  };
  const lines = [
    "Planned idea contract (semantic_contract_v1 — PRIMARY; reference layout is secondary):",
    JSON.stringify(payload, null, 2),
    "",
    MIMIC_IDEA_FAITHFUL_COPY_RULES,
  ];
  return lines.join("\n").trim();
}

/** Compact JSON for logging / payload persistence. */
export function serializeSemanticContract(contract: SemanticContractV1): Record<string, unknown> {
  return {
    schema_version: contract.schema_version,
    core_question: contract.core_question,
    idea_framing: contract.idea_framing,
    content_beats: contract.content_beats,
    narrative_spine: contract.narrative_spine,
    dominant_mechanism: contract.dominant_mechanism,
    source: contract.source,
  };
}

function candidateFromPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(payload.candidate_data) ?? asRecord(payload.candidate);
}

/**
 * Resolve the effective semantic contract for a job payload (stored slice, candidate, optional SIL enrich).
 */
export function resolveSemanticContractForJob(
  payload: Record<string, unknown>,
  opts?: { slideIntelligence?: SlideIntelligenceBundleV1 | null }
): SemanticContractV1 | null {
  const candidate = candidateFromPayload(payload);
  let contract =
    parseSemanticContractFromPayload(payload) ?? buildSemanticContractFromCandidate(candidate);
  if (!contract) return null;

  const sil =
    opts?.slideIntelligence ??
    parseSlideIntelligenceBundle(
      asRecord(asRecord(payload.mimic_v1)?.slide_intelligence) ??
        asRecord(payload.slide_intelligence)
    );
  if (sil) {
    contract = enrichSemanticContractWithSlideIntelligence(contract, sil);
  }
  return hasUsableSemanticContract(contract) ? contract : null;
}

/** Attach or refresh `semantic_contract_v1` on a generation_payload object. */
export function attachSemanticContractToPayload(
  payload: Record<string, unknown>,
  contract: SemanticContractV1 | null
): Record<string, unknown> {
  if (!contract || !hasUsableSemanticContract(contract)) return payload;
  return { ...payload, semantic_contract_v1: serializeSemanticContract(contract) };
}
