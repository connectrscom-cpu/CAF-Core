/**
 * Human-readable job titles and metadata for Review / exports (not opaque task_id labels).
 */
export const CONTENT_DISPLAY_SCHEMA_VERSION = "content_display_v1" as const;

export type ContentDisplayV1 = {
  schema_version: typeof CONTENT_DISPLAY_SCHEMA_VERSION;
  title: string;
  topic: string | null;
  theme: string | null;
  flow_label: string | null;
  platform: string | null;
};

function trimStr(v: unknown, max = 160): string {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
}

function asRec(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function humanizeFlowType(flowType: string): string {
  const ft = flowType.trim();
  if (ft === "FLOW_VISUAL_FIRST_CAROUSEL") return "Brand-style carousel";
  if (ft === "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL") return "Mimic carousel";
  if (ft === "FLOW_CAROUSEL") return "Carousel";
  return ft.replace(/^FLOW_/, "").replace(/_/g, " ").trim() || ft;
}

/** Pick a marketer-facing title from planned candidate / idea row data. */
export function pickCandidateDisplayTitle(candidateData: Record<string, unknown> | null | undefined): string {
  const c = candidateData ?? {};
  const candidates = [
    trimStr(c.content_idea, 120),
    trimStr(c.summary, 120),
    trimStr(c.headline, 120),
    trimStr(c.hook, 120),
    trimStr(c.novelty_angle, 120),
    trimStr(c.why_now, 120),
  ].filter(Boolean);
  return candidates[0] ?? "";
}

export function buildContentDisplayV1(opts: {
  candidateData?: Record<string, unknown> | null;
  flowType?: string | null;
  platform?: string | null;
  titleOverride?: string | null;
}): ContentDisplayV1 {
  const candidate = opts.candidateData ?? {};
  const title =
    trimStr(opts.titleOverride, 120) ||
    pickCandidateDisplayTitle(candidate) ||
    trimStr(candidate.idea_id, 80);

  const keyPoints = strList(candidate.key_points);
  const topic =
    trimStr(candidate.product_angle, 80) ||
    trimStr(keyPoints[0], 80) ||
    trimStr(candidate.content_lens, 80) ||
    null;

  const theme =
    trimStr(candidate.carousel_style, 40) ||
    trimStr(candidate.content_lens, 40) ||
    trimStr(candidate.execution_profile, 40) ||
    null;

  const flowType = trimStr(opts.flowType, 80);
  const platform = trimStr(opts.platform, 40);

  return {
    schema_version: CONTENT_DISPLAY_SCHEMA_VERSION,
    title,
    topic,
    theme,
    flow_label: flowType ? humanizeFlowType(flowType) : null,
    platform: platform || null,
  };
}

function slideRows(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const slides = parsed.slides;
  if (Array.isArray(slides)) {
    return slides.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object" && !Array.isArray(s));
  }
  const deck = asRec(parsed.slide_deck);
  const nested = deck?.slides;
  if (Array.isArray(nested)) {
    return nested.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object" && !Array.isArray(s));
  }
  return [];
}

/** Prefer explicit title fields, then first-slide headline (carousel decks). */
export function pickTitleFromGeneratedOutput(output: Record<string, unknown> | null | undefined): string {
  const o = output ?? {};
  const direct =
    trimStr(o.title, 120) ||
    trimStr(o.generated_title, 120) ||
    trimStr(o.headline, 120) ||
    trimStr(o.hook, 120) ||
    trimStr(o.cover, 120);
  if (direct) return direct;

  const slides = slideRows(o);
  const first = slides[0];
  if (first) {
    const slideTitle =
      trimStr(first.headline, 120) ||
      trimStr(first.title, 120) ||
      trimStr(first.cover, 120);
    if (slideTitle) return slideTitle;
  }
  return "";
}

export function pickTitleFromPayload(payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? {};
  const display = asRec(p.content_display);
  const fromDisplay = display?.schema_version === CONTENT_DISPLAY_SCHEMA_VERSION ? trimStr(display.title, 120) : "";
  return (
    pickTitleFromGeneratedOutput(asRec(p.generated_output)) ||
    trimStr(p.generated_title, 120) ||
    trimStr(p.title, 120) ||
    fromDisplay
  );
}

export function mergeContentDisplayTitle(
  existing: ContentDisplayV1 | null,
  generatedTitle: string,
  candidateTitle: string
): ContentDisplayV1 {
  const base = existing ?? buildContentDisplayV1({});
  const title = trimStr(generatedTitle, 120) || trimStr(candidateTitle, 120) || base.title;
  return { ...base, title };
}

export function parseContentDisplayV1(raw: unknown): ContentDisplayV1 | null {
  const rec = asRec(raw);
  if (!rec || rec.schema_version !== CONTENT_DISPLAY_SCHEMA_VERSION) return null;
  return buildContentDisplayV1({
    titleOverride: trimStr(rec.title, 120),
    flowType: trimStr(rec.flow_label, 80),
    platform: trimStr(rec.platform, 40),
    candidateData: {
      product_angle: rec.topic,
      content_lens: rec.theme,
      content_idea: rec.title,
    },
  });
}
