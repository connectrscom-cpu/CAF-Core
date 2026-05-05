/**
 * Compact ValidationOutput (v1) for editorial LLM synthesis — token-efficient, tolerant parsing.
 */

export type EditorialValidationCompact = {
  schema_version: string | null;
  decision: string | null;
  content_kind: string | null;
  notes: string | null;
  issue_tags: string[];
  rework_hints: Record<string, unknown>;
  findings: Array<{
    label: string;
    severity: string;
    message: string;
    suggestion?: string;
    location?: Record<string, unknown>;
  }>;
  /** Short preview of finalized copy (not full slide arrays). */
  reviewed_content_preview: string | null;
};

const PREVIEW_MAX = 320;

function trimPreview(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= PREVIEW_MAX) return t;
  return `${t.slice(0, PREVIEW_MAX)}…`;
}

function parseFindings(raw: unknown): EditorialValidationCompact["findings"] {
  if (!Array.isArray(raw)) return [];
  const out: EditorialValidationCompact["findings"] = [];
  for (const it of raw.slice(0, 24)) {
    if (!it || typeof it !== "object" || Array.isArray(it)) continue;
    const r = it as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const message = typeof r.message === "string" ? r.message.trim() : "";
    if (!label || !message) continue;
    const severity = typeof r.severity === "string" ? r.severity.trim() : "warn";
    const suggestion = typeof r.suggestion === "string" ? r.suggestion.trim() : undefined;
    let location: Record<string, unknown> | undefined;
    if (r.location && typeof r.location === "object" && !Array.isArray(r.location)) {
      location = r.location as Record<string, unknown>;
    }
    out.push({
      label,
      severity: severity || "warn",
      message: message.length > 500 ? `${message.slice(0, 500)}…` : message,
      ...(suggestion && suggestion.length > 0 ? { suggestion: suggestion.length > 400 ? `${suggestion.slice(0, 400)}…` : suggestion } : {}),
      ...(location ? { location } : {}),
    });
  }
  return out;
}

function parseIssueTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((t) => String(t).trim()).filter(Boolean))].slice(0, 40);
}

function buildReviewedContentPreview(rc: unknown): string | null {
  if (!rc || typeof rc !== "object" || Array.isArray(rc)) return null;
  const o = rc as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["title", "hook", "caption", "hashtags"] as const) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) parts.push(`${k}: ${trimPreview(v)}`);
  }
  const script = o.spoken_script;
  if (typeof script === "string" && script.trim()) {
    parts.push(`spoken_script: ${trimPreview(script)}`);
  }
  const slides = o.slides;
  if (Array.isArray(slides) && slides.length > 0) {
    const first = slides[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const s = first as Record<string, unknown>;
      const idx = s.index;
      const headline = typeof s.headline === "string" ? s.headline.trim() : "";
      const body = typeof s.body === "string" ? s.body.trim() : "";
      const bit = [headline && `h:${trimPreview(headline)}`, body && `b:${trimPreview(body)}`].filter(Boolean).join(" · ");
      if (bit) parts.push(`slide[${typeof idx === "number" ? idx : 0}]: ${bit}`);
    }
    if (slides.length > 1) parts.push(`(+${slides.length - 1} more slides)`);
  }
  return parts.length ? parts.join(" | ") : null;
}

/**
 * Returns null when `raw` is empty or has no usable fields (equivalent to `{}` stored default).
 */
export function compactValidationOutputForEditorialSynthesis(
  raw: Record<string, unknown> | null | undefined
): EditorialValidationCompact | null {
  if (!raw || typeof raw !== "object") return null;

  const issue_tags = parseIssueTags(raw.issue_tags);
  const findings = parseFindings(raw.findings);
  const rework =
    raw.rework_hints && typeof raw.rework_hints === "object" && !Array.isArray(raw.rework_hints)
      ? (raw.rework_hints as Record<string, unknown>)
      : {};

  const notes = typeof raw.notes === "string" ? raw.notes.trim() || null : null;
  const schema_version = typeof raw.schema_version === "string" ? raw.schema_version : null;
  const decision = typeof raw.decision === "string" ? raw.decision : null;
  const content_kind = typeof raw.content_kind === "string" ? raw.content_kind : null;
  const reviewed_content_preview = buildReviewedContentPreview(raw.reviewed_content);

  const emptyObj =
    issue_tags.length === 0 &&
    findings.length === 0 &&
    Object.keys(rework).length === 0 &&
    !notes &&
    !reviewed_content_preview;

  if (emptyObj && !schema_version && !decision && !content_kind) return null;

  return {
    schema_version,
    decision,
    content_kind,
    notes,
    issue_tags,
    rework_hints: rework,
    findings,
    reviewed_content_preview,
  };
}

/** True when structured validation alone warrants LLM context (beyond free-text reviewer notes). */
export function validationCompactHasStructuredSignal(c: EditorialValidationCompact): boolean {
  if (c.issue_tags.length > 0) return true;
  if (c.findings.length > 0) return true;
  const rh = c.rework_hints;
  if (rh.regenerate === true) return true;
  if (rh.rewrite_copy === true) return true;
  if (rh.skip_video_regeneration === true) return true;
  if (rh.skip_image_regeneration === true) return true;
  if (typeof rh.heygen_avatar_id === "string" && rh.heygen_avatar_id.trim()) return true;
  if (typeof rh.heygen_voice_id === "string" && rh.heygen_voice_id.trim()) return true;
  if (rh.heygen_force_rerender === true) return true;
  const vn = (c.notes ?? "").trim();
  if (vn.length > 0) return true;
  const prev = (c.reviewed_content_preview ?? "").trim();
  if (prev.length > 0) return true;
  return false;
}
