import type { Pool } from "pg";
import { listLearningRulesMerged } from "../repositories/learning.js";

export interface CompiledLearning {
  global_context: string;
  project_context: string;
  merged_guidance: string;
  /** Rules whose text actually made it into the compiled guidance. */
  applied_rule_ids: string[];
  /** Rules withheld because this task fell into their holdout control group. */
  control_rule_ids: string[];
}

/** Default caps: prompts degrade past ~a dozen guidance blocks. */
const DEFAULT_MAX_GUIDANCE_RULES = 12;
const DEFAULT_MAX_GUIDANCE_CHARS = 4000;
/** Token-set Jaccard at/above this = near-duplicate guidance. */
const DEDUPE_SIMILARITY_THRESHOLD = 0.8;

function isGenerationGuidanceAction(row: Record<string, unknown>): boolean {
  const action = String(row.action_type ?? "");
  return /GENERATION_GUIDANCE|GUIDANCE|HINT/i.test(action);
}

function isGenerationRule(row: Record<string, unknown>): boolean {
  const fam = String(row.rule_family ?? "");
  const action = String(row.action_type ?? "");
  return (
    fam === "generation" ||
    /GENERATION|GUIDANCE|HINT/i.test(action)
  );
}

function matchesScope(row: Record<string, unknown>, flowType: string | null, platform: string | null): boolean {
  const sf = row.scope_flow_type as string | null | undefined;
  const sp = row.scope_platform as string | null | undefined;
  if (sf && flowType) {
    const pat = sf.includes("*")
      ? new RegExp(`^${sf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*")}$`, "i")
      : new RegExp(`^${sf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    if (!pat.test(flowType)) return false;
  }
  if (sp && platform && sp.toLowerCase() !== platform.toLowerCase()) return false;
  return true;
}

function guidanceText(payload: Record<string, unknown>): string {
  const v =
    payload.guidance ?? payload.hint ?? payload.text ?? payload.message ?? payload.summary;
  if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

function parseOptionalInstant(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Time windows shared with planning (`listActiveAppliedLearningRules`):
 * exclude when expires_at / valid_to are past, or valid_from is in the future.
 * Null windows mean "no restriction" (unlike raw SQL `valid_from <= now()`, which
 * would drop nulls — generation treats unset windows as open).
 */
export function isWithinValidityWindow(row: Record<string, unknown>, now: Date = new Date()): boolean {
  const expiresAt = parseOptionalInstant(row.expires_at);
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return false;
  const validTo = parseOptionalInstant(row.valid_to);
  if (validTo && validTo.getTime() <= now.getTime()) return false;
  const validFrom = parseOptionalInstant(row.valid_from);
  if (validFrom && validFrom.getTime() > now.getTime()) return false;
  return true;
}

function hasBeenApplied(row: Record<string, unknown>): boolean {
  return parseOptionalInstant(row.applied_at) != null;
}

/** FNV-1a → [0,1). Deterministic holdout assignment per (rule, task). */
export function hashToUnitInterval(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

function holdoutFraction(row: Record<string, unknown>): number {
  const payload = (row.action_payload as Record<string, unknown>) ?? {};
  const f = payload.holdout_fraction;
  const n = typeof f === "number" ? f : typeof f === "string" ? Number(f) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** True when this task is in the rule's holdout control group (rule withheld). */
export function isHoldoutControl(row: Record<string, unknown>, taskId: string): boolean {
  const fraction = holdoutFraction(row);
  if (fraction <= 0 || !taskId.trim()) return false;
  return hashToUnitInterval(`${String(row.rule_id ?? "")}:${taskId.trim()}`) < fraction;
}

function normalizedTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}

/** Token-set Jaccard similarity; also flags near-containment of short in long. */
export function guidanceSimilarity(a: string, b: string): number {
  const ta = normalizedTokens(a);
  const tb = normalizedTokens(b);
  if (ta.size === 0 || tb.size === 0) return a.trim() === b.trim() ? 1 : 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  // A rule whose tokens are (almost) fully contained in a longer one is a
  // duplicate even at low Jaccard — but only with enough tokens to be meaningful.
  const minSize = Math.min(ta.size, tb.size);
  const containment = minSize >= 4 ? intersection / minSize : 0;
  return Math.max(jaccard, containment >= 0.9 ? containment : 0);
}

export interface GuidanceEntry {
  rule_id: string;
  text: string;
}

/** Keep the first (highest-ranked) of each near-duplicate cluster. */
export function dedupeGuidanceEntries(
  entries: GuidanceEntry[],
  threshold: number = DEDUPE_SIMILARITY_THRESHOLD
): GuidanceEntry[] {
  const kept: GuidanceEntry[] = [];
  for (const e of entries) {
    const dup = kept.some((k) => guidanceSimilarity(k.text, e.text) >= threshold);
    if (!dup) kept.push(e);
  }
  return kept;
}

function ruleConfidence(row: Record<string, unknown>): number {
  const c = row.confidence;
  const n = typeof c === "number" ? c : typeof c === "string" ? Number(c) : NaN;
  return Number.isFinite(n) ? n : 0.5;
}

function ruleCreatedAtMs(row: Record<string, unknown>): number {
  const d = parseOptionalInstant(row.created_at);
  return d ? d.getTime() : 0;
}

export interface CompileLearningContextOptions {
  include_pending_generation_guidance?: boolean;
  /**
   * Task being generated. Enables holdout experiments: rules carrying
   * `action_payload.holdout_fraction` are deterministically withheld for that
   * fraction of tasks and reported in `control_rule_ids`.
   */
  task_id?: string | null;
  /** Cap on distinct guidance rules injected (default 12). */
  max_rules?: number;
  /** Char budget for merged guidance before trimming (default 4000). */
  max_guidance_chars?: number;
}

export async function compileLearningContexts(
  db: Pool,
  projectId: string,
  flowType: string | null,
  platform: string | null,
  opts?: CompileLearningContextOptions
): Promise<CompiledLearning> {
  // Project-level only for now (no caf-global merge).
  const rules = await listLearningRulesMerged(db, projectId, null);
  const now = new Date();

  // applyLearningRule always sets applied_at when activating; require it for
  // active generation rules (parity with planning). Pending rework guidance
  // is never applied, so skip that check there.
  const active = rules.filter(
    (r) =>
      String(r.status) === "active" &&
      isGenerationRule(r) &&
      hasBeenApplied(r) &&
      isWithinValidityWindow(r, now)
  );
  const pendingForRework =
    opts?.include_pending_generation_guidance
      ? rules.filter(
          (r) =>
            String(r.status) === "pending" &&
            isGenerationGuidanceAction(r) &&
            isWithinValidityWindow(r, now)
        )
      : [];

  // Rank: pending rework guidance first (targeted human steering), then
  // active rules by confidence desc, newest first on ties.
  const rankedActive = [...active].sort((a, b) => {
    const dc = ruleConfidence(b) - ruleConfidence(a);
    if (dc !== 0) return dc;
    return ruleCreatedAtMs(b) - ruleCreatedAtMs(a);
  });
  const candidates = [...pendingForRework, ...rankedActive];
  const scoped = candidates.filter((r) => matchesScope(r, flowType, platform));

  // Holdout split (learning experiments): withhold the rule for its control
  // fraction of tasks; the withheld ids feed attribution as the counterfactual.
  const taskId = opts?.task_id?.trim() ?? "";
  const controlIds: string[] = [];
  const treated = scoped.filter((r) => {
    if (taskId && isHoldoutControl(r, taskId)) {
      const rid = String(r.rule_id ?? "");
      if (rid) controlIds.push(rid);
      return false;
    }
    return true;
  });

  // Extract text, dedupe near-duplicates (keep highest rank), apply budget.
  const entries: GuidanceEntry[] = [];
  for (const r of treated) {
    const rid = String(r.rule_id ?? "");
    const payload = (r.action_payload as Record<string, unknown>) ?? {};
    const text = guidanceText(payload);
    if (!rid || !text) continue;
    entries.push({ rule_id: rid, text });
  }
  const deduped = dedupeGuidanceEntries(entries);

  const maxRules = Math.max(1, opts?.max_rules ?? DEFAULT_MAX_GUIDANCE_RULES);
  const maxChars = Math.max(200, opts?.max_guidance_chars ?? DEFAULT_MAX_GUIDANCE_CHARS);
  const included: GuidanceEntry[] = [];
  let usedChars = 0;
  for (const e of deduped) {
    if (included.length >= maxRules) break;
    const cost = e.text.length + (included.length > 0 ? 2 : 0);
    if (included.length > 0 && usedChars + cost > maxChars) continue;
    included.push(e);
    usedChars += cost;
  }

  const parts = included.map((e) => e.text);
  return {
    global_context: "",
    project_context: parts.join("\n\n"),
    merged_guidance: parts.join("\n\n"),
    applied_rule_ids: included.map((e) => e.rule_id),
    control_rule_ids: controlIds,
  };
}
