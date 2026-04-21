/**
 * Align LLM JSON with strict output_schemas before validation (carousel `variations` vs `slides`, etc.).
 *
 * Flow Engine `Carousel_Insight_Output` expects:
 * `{ variations: [ { variation_name, slides[], caption, cta_type, inputs_used, ... } ] }`
 * Models often return flat `slides[]`, `carousel[]`, or `variations` as slide rows — wrap here.
 */
import { slidesFromGeneratedOutput, slideHasRenderableContent } from "./carousel-render-pack.js";

function normalizeCaptionField(c: unknown): string {
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const t = (c as Record<string, unknown>).text;
    if (typeof t === "string") return t;
  }
  return String(c ?? "");
}

/** Top-level caption, or `variation.caption` / `content.caption` when models nest copy there. */
function captionFromOutAndVariation(out: Record<string, unknown>): string {
  const top = normalizeCaptionField(out.caption);
  if (top.trim()) return top;
  const v = out.variation;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const vc = normalizeCaptionField((v as Record<string, unknown>).caption);
    if (vc.trim()) return vc;
  }
  const c = out.content;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const cc = normalizeCaptionField((c as Record<string, unknown>).caption);
    if (cc.trim()) return cc;
  }
  return top;
}

/** When planners leave `{{structure_variables.slide_count}}` unsubtituted, QC still needs a numeric expected count. */
function ensureStructureVariablesSlideCount(out: Record<string, unknown>, count: number): void {
  if (!Number.isFinite(count) || count < 0) return;
  const existing =
    out.structure_variables && typeof out.structure_variables === "object" && !Array.isArray(out.structure_variables)
      ? { ...(out.structure_variables as Record<string, unknown>) }
      : {};
  if (existing.slide_count == null) existing.slide_count = Math.floor(count);
  out.structure_variables = existing;
}

/** Models sometimes echo `output_schema.schema_json` with slides/caption instead of top-level fields. */
function hoistOutputSchemaSchemaJsonCopyFields(out: Record<string, unknown>): void {
  const os = out.output_schema;
  if (!os || typeof os !== "object" || Array.isArray(os)) return;
  const rec = os as Record<string, unknown>;
  const sj = rec.schema_json;
  if (!sj || typeof sj !== "object" || Array.isArray(sj)) return;
  const inner = sj as Record<string, unknown>;
  if (!String(out.caption ?? "").trim() && typeof inner.caption === "string") {
    out.caption = inner.caption;
  }
  if (!Array.isArray(out.hashtags) && Array.isArray(inner.hashtags)) {
    out.hashtags = inner.hashtags;
  }
  if (out.cta == null && typeof inner.cta === "string" && inner.cta.trim()) {
    out.cta = inner.cta;
  }
}

function slidesArrayHasRenderableContent(arr: unknown): boolean {
  if (!Array.isArray(arr)) return false;
  return arr.some(
    (s) => s && typeof s === "object" && slideHasRenderableContent(s as Record<string, unknown>)
  );
}

/** `variations` already shaped like Carousel_Insight_Output items (each has `slides[]`). */
function isCarouselInsightVariationsShape(v: unknown): boolean {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = v[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return false;
  const slides = (first as Record<string, unknown>).slides;
  if (!Array.isArray(slides)) return false;
  return slidesArrayHasRenderableContent(slides);
}

/** LLM returned slide rows in `variations` instead of variation objects. */
function variationArrayIsFlatSlides(arr: unknown[]): boolean {
  if (arr.length === 0) return false;
  const first = arr[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return false;
  const o = first as Record<string, unknown>;
  if (Array.isArray(o.slides)) return false;
  return (
    slideHasRenderableContent(o) ||
    o.slide_number != null ||
    o.slide_role != null ||
    (typeof o.headline === "string" && o.headline.trim().length > 0) ||
    (typeof o.body === "string" && o.body.trim().length > 0)
  );
}

function ensureNestedVariationDefaults(out: Record<string, unknown>): Record<string, unknown> {
  const vars = out.variations as Record<string, unknown>[];
  const patched = vars.map((v) => {
    const slidesRaw = Array.isArray(v.slides) ? v.slides : [];
    const numbered = slidesRaw.map((s, i) => {
      if (!s || typeof s !== "object" || Array.isArray(s)) return { slide_number: i + 1 };
      const row = { ...(s as Record<string, unknown>) };
      if (row.slide_number == null) row.slide_number = i + 1;
      return row;
    });
    let inputs = v.inputs_used;
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
      inputs = { reference_post_ids: [], themes_used: [] };
    } else {
      const io = { ...(inputs as Record<string, unknown>) };
      if (!Array.isArray(io.reference_post_ids)) io.reference_post_ids = [];
      if (!Array.isArray(io.themes_used)) io.themes_used = [];
      inputs = io;
    }
    const name =
      typeof v.variation_name === "string" && v.variation_name.trim()
        ? v.variation_name.trim()
        : "V1";
    return {
      ...v,
      variation_name: name,
      slides: numbered,
      caption: normalizeCaptionField(v.caption),
      cta_type:
        typeof v.cta_type === "string" && v.cta_type.trim() ? v.cta_type.trim() : "Save",
      hashtags: Array.isArray(v.hashtags) ? v.hashtags : [],
      inputs_used: inputs,
    };
  });
  out.variations = patched;
  const first = patched[0];
  if (first && Array.isArray(first.slides)) {
    out.slides = first.slides as Record<string, unknown>[];
    ensureStructureVariablesSlideCount(out, first.slides.length);
  }
  return out;
}

function wrapSlidesAsCarouselInsightOutput(
  out: Record<string, unknown>,
  slides: Record<string, unknown>[]
): Record<string, unknown> {
  const numbered = slides.map((s, i) => ({
    ...s,
    slide_number:
      typeof s.slide_number === "number" && Number.isFinite(s.slide_number) ? s.slide_number : i + 1,
  }));
  const variationName =
    (typeof out.variation_name === "string" && out.variation_name.trim() && out.variation_name) || "V1";
  const caption = captionFromOutAndVariation(out);
  const cta_type =
    typeof out.cta_type === "string" && out.cta_type.trim() ? out.cta_type.trim() : "Save";
  const hashtags = Array.isArray(out.hashtags) ? out.hashtags : [];
  let inputs_used: Record<string, unknown>;
  if (out.inputs_used && typeof out.inputs_used === "object" && !Array.isArray(out.inputs_used)) {
    inputs_used = { ...(out.inputs_used as Record<string, unknown>) };
  } else {
    inputs_used = {
      reference_post_ids: Array.isArray(out.reference_post_ids) ? out.reference_post_ids : [],
      themes_used: Array.isArray(out.themes_used) ? out.themes_used : [],
    };
  }
  if (!Array.isArray(inputs_used.reference_post_ids)) inputs_used.reference_post_ids = [];
  if (!Array.isArray(inputs_used.themes_used)) inputs_used.themes_used = [];

  out.variations = [
    {
      variation_name: variationName,
      slides: numbered,
      caption,
      cta_type,
      hashtags,
      inputs_used,
    },
  ];
  out.slides = numbered;
  ensureStructureVariablesSlideCount(out, numbered.length);
  return out;
}

export function normalizeLlmParsedForSchemaValidation(
  flowType: string,
  parsed: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...parsed };
  const carouselish = /carousel/i.test(flowType) || flowType === "Flow_Carousel_Copy";
  if (!carouselish) return out;

  hoistOutputSchemaSchemaJsonCopyFields(out);

  const slideDeck = out.slide_deck;
  if (slideDeck && typeof slideDeck === "object" && !Array.isArray(slideDeck)) {
    const sv = (slideDeck as Record<string, unknown>).structure_variables;
    if (sv && typeof sv === "object" && !Array.isArray(sv) && out.structure_variables == null) {
      out.structure_variables = sv;
    }
  }

  if (out.slide_count != null) {
    const scTop = out.slide_count;
    const nTop =
      typeof scTop === "number" && Number.isFinite(scTop)
        ? Math.floor(scTop)
        : parseInt(String(scTop).trim(), 10);
    if (Number.isFinite(nTop) && nTop >= 0) {
      const existing =
        out.structure_variables && typeof out.structure_variables === "object" && !Array.isArray(out.structure_variables)
          ? (out.structure_variables as Record<string, unknown>)
          : null;
      const base: Record<string, unknown> = existing ? { ...existing } : {};
      if (base.slide_count == null) base.slide_count = nTop;
      if (typeof out.narrative_arc === "string" && base.narrative_arc == null) base.narrative_arc = out.narrative_arc;
      if (typeof out.hook_type === "string" && base.hook_type == null) base.hook_type = out.hook_type;
      if (typeof out.cta_type === "string" && base.cta_type == null) base.cta_type = out.cta_type;
      if (typeof out.cta_placement === "string" && base.cta_placement == null) base.cta_placement = out.cta_placement;
      out.structure_variables = base;
    }
  }

  /** LLM drift: `structure: { slide_count, narrative_arc, ... }` instead of `structure_variables`. */
  const struct = out.structure;
  if (struct && typeof struct === "object" && !Array.isArray(struct)) {
    const src = struct as Record<string, unknown>;
    const existing =
      out.structure_variables && typeof out.structure_variables === "object" && !Array.isArray(out.structure_variables)
        ? { ...(out.structure_variables as Record<string, unknown>) }
        : {};
    const merged: Record<string, unknown> = { ...existing, ...src };
    if (Array.isArray(merged.narrative_arc)) {
      merged.narrative_arc = merged.narrative_arc.map(String).join(",");
    }
    out.structure_variables = merged;
  }

  if (isCarouselInsightVariationsShape(out.variations)) {
    return ensureNestedVariationDefaults(out);
  }

  let slides: Record<string, unknown>[] = [];

  if (Array.isArray(out.variations) && variationArrayIsFlatSlides(out.variations)) {
    slides = (out.variations as unknown[]).filter(
      (x): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x))
    );
  } else {
    // Prefer pickBestSlideDeck / slidesFromGeneratedOutput first so editorial `slides_json` and
    // nested decks win over stale merged top-level `slides` when scores tie (see DECK_PRIORITY).
    const rebuilt = slidesFromGeneratedOutput(out);
    const rebuiltOk =
      rebuilt.length > 0 && rebuilt.some((s) => slideHasRenderableContent(s as Record<string, unknown>));

    if (rebuiltOk) {
      slides = rebuilt;
    } else {
      const usableVariations = slidesArrayHasRenderableContent(out.variations);
      const usableSlides = slidesArrayHasRenderableContent(out.slides);

      if (usableVariations && !usableSlides) {
        slides = (out.variations as unknown[]).filter(
          (x): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x))
        );
      } else if (usableSlides && !usableVariations) {
        slides = (out.slides as unknown[]).filter(
          (x): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x))
        );
      }
    }
  }

  if (slides.length === 0) return out;

  return wrapSlidesAsCarouselInsightOutput(out, slides);
}
