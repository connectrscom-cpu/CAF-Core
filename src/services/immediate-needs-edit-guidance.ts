export type ImmediateNeedsEditGuidanceInput = {
  task_id: string;
  flow_type: string | null;
  platform: string | null;
  carousel_template_name?: string | null;
  notes?: string | null;
  rejection_tags?: unknown;
};

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => String(t ?? "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 24);
}

function sanitizeNotes(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  // Keep short: this is guidance, not an audit log.
  const max = 1200;
  const clipped = t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
  // Collapse >2 consecutive blank lines.
  return clipped.replace(/\n{3,}/g, "\n\n").trim();
}

function fnv1a32(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // unsigned hex, short and stable
  return (h >>> 0).toString(16).padStart(8, "0");
}

function tagToGuidanceLine(tag: string): string | null {
  switch (tag) {
    case "cta_weak":
      return "Ensure the final slide is an explicit CTA (follow/save/share/comment), not a sign-off. Keep CTA headline short and imperative.";
    case "bad_structure":
      return "Rebuild the carousel arc: hook/cover → one clear idea per body slide → strong CTA on the final slide. Avoid repetitive slide cadence.";
    case "quality_low":
      return "Increase specificity: add at least one concrete detail per body slide (example, number, constraint, or actionable step). Avoid generic platitudes.";
    case "too_generic":
      return "Replace generic claims with concrete, situation-specific language and examples grounded in the signal pack.";
    case "visual_tweak_needed":
      return "Keep CTA body copy concise and readable; avoid long paragraphs in CTA headline fields.";
    case "hook_strategy_wrong":
      return "Rewrite the cover slide hook to be sharper and more curiosity-driven; align hook to the candidate angle and audience.";
    case "format_mismatch":
      return "Match the expected carousel format: cover + body slides + CTA; no hashtags inside slide text; slide roles must be respected.";
    default:
      return null;
  }
}

export function buildImmediateNeedsEditGenerationGuidance(
  input: ImmediateNeedsEditGuidanceInput
): { rule_id: string; guidance: string } | null {
  const taskId = String(input.task_id ?? "").trim();
  if (!taskId) return null;

  const tags = normalizeTags(input.rejection_tags);
  const notes = sanitizeNotes(String(input.notes ?? ""));

  const tagLines = tags
    .map(tagToGuidanceLine)
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0);

  // If there is no guidance signal at all, don't mint noise.
  if (tagLines.length === 0 && notes.length < 12) return null;

  const scopeBits = [
    input.flow_type ? `flow=${input.flow_type}` : "",
    input.platform ? `platform=${input.platform}` : "",
    input.carousel_template_name ? `template=${input.carousel_template_name}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const parts: string[] = [];
  parts.push(`Immediate rework guidance${scopeBits ? ` (${scopeBits})` : ""}:`);
  if (tagLines.length > 0) {
    for (const line of Array.from(new Set(tagLines))) parts.push(`- ${line}`);
  }
  if (notes) {
    parts.push("- Address the reviewer notes below (do not quote verbatim; implement the intent):");
    parts.push(`  ${notes.replace(/\n/g, "\n  ")}`);
  }

  const guidance = parts.join("\n").trim();
  const rule_id = `immediate_needs_edit_${fnv1a32(`${taskId}\n${input.flow_type ?? ""}\n${input.platform ?? ""}`)}`;
  return { rule_id, guidance };
}

