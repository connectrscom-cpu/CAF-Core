/** Operator-defined extra insight dimensions (stored in processing profile criteria_json). */
export type InsightColumnLabels = { l1: string; l2: string; l3: string };

export function insightColumnLabelsFromCriteria(
  criteria: Record<string, unknown> | null | undefined
): InsightColumnLabels {
  const raw = criteria?.insight_column_labels;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { l1: "", l2: "", l3: "" };
  }
  const o = raw as Record<string, unknown>;
  return {
    l1: String(o.custom_label_1 ?? "").trim(),
    l2: String(o.custom_label_2 ?? "").trim(),
    l3: String(o.custom_label_3 ?? "").trim(),
  };
}

/** Reject echoed column titles and other non-answers. */
export function sanitizeCustomLabelAnswer(
  value: string | null | undefined,
  labelQuestion: string | null | undefined
): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const q = String(labelQuestion ?? "").trim();
  if (q && v.toLowerCase() === q.toLowerCase()) return null;
  const lower = v.toLowerCase();
  if (lower === "n/a" || lower === "na" || lower === "none" || lower === "unknown") return null;
  return v;
}

function customLabelFieldInstruction(slot: 1 | 2 | 3, question: string): string {
  return (
    `- custom_label_${slot}: your **answer** for the operator column **"${question}"** on this specific post ` +
    `(short phrase — e.g. a zodiac sign, audience segment, angle). ` +
    `Do NOT repeat the column title "${question}" as the value unless that word is literally the only correct answer. ` +
    `Use "" when you cannot infer from the evidence.`
  );
}

/** System-prompt appendix for broad + carousel insight passes. */
export function customLabelPromptInstructions(labels: InsightColumnLabels): string {
  const lines: string[] = [];
  if (labels.l1) lines.push(customLabelFieldInstruction(1, labels.l1));
  if (labels.l2) lines.push(customLabelFieldInstruction(2, labels.l2));
  if (labels.l3) lines.push(customLabelFieldInstruction(3, labels.l3));
  if (!lines.length) return "";
  return (
    "\n\n**Custom analysis columns** — the operator configured extra table headers. " +
    "Each custom_label_N field must hold the **inferred answer** for that column on this post, not the column title:\n" +
    lines.join("\n")
  );
}

/** User-prompt block listing the questions the model must answer per row. */
export function customLabelUserPromptBlock(labels: InsightColumnLabels): string {
  const lines: string[] = [];
  if (labels.l1) {
    lines.push(
      `- custom_label_1 → column **"${labels.l1}"**: infer the value for this post (answer the question implied by the header).`
    );
  }
  if (labels.l2) {
    lines.push(
      `- custom_label_2 → column **"${labels.l2}"**: infer the value for this post (answer the question implied by the header).`
    );
  }
  if (labels.l3) {
    lines.push(
      `- custom_label_3 → column **"${labels.l3}"**: infer the value for this post (answer the question implied by the header).`
    );
  }
  if (!lines.length) {
    return "No operator-defined custom columns — set custom_label_1..3 to empty strings.";
  }
  return (
    "Operator-defined extra columns (answer per row; empty string when unknown — never echo the column title):\n" +
    lines.join("\n")
  );
}

/** JSON schema lines for custom_label fields in LLM output. */
export function customLabelJsonSchemaLines(labels: InsightColumnLabels): string[] {
  const lines: string[] = [];
  const add = (slot: 1 | 2 | 3, question: string) => {
    lines.push(
      `    "custom_label_${slot}":"short answer for column \\"${question}\\" on this post (not the title itself)"`
    );
  };
  if (labels.l1) add(1, labels.l1);
  else lines.push(`    "custom_label_1":"string (empty unless operator column configured)"`);
  if (labels.l2) add(2, labels.l2);
  else lines.push(`    "custom_label_2":"string (empty unless operator column configured)"`);
  if (labels.l3) add(3, labels.l3);
  else lines.push(`    "custom_label_3":"string (empty unless operator column configured)"`);
  return lines;
}
