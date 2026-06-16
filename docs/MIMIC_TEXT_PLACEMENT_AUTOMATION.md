# Mimic Text Placement — Automation Path (Design)

> **Status: design only.** This document describes how the human text-layout editor
> evolves into automated text placement. No data-capture plumbing is built yet — this
> is the architecture the current editor is deliberately built to support.

## Why this is mostly already automated

Automated placement already partially exists. For a top-performer mimic carousel:

1. **Document AI OCR** reads the original top-performer slide.
2. [`src/services/mimic-docai-overlay-layout.ts`](../src/services/mimic-docai-overlay-layout.ts)
   solves OCR boxes into `docai_text_layers` (role bucketing, single vs. multi-line).
3. [`services/renderer/mimic-docai-fit.js`](../services/renderer/mimic-docai-fit.js) auto-fits
   each layer at render time.

The human drag editor ([`MimicDocAiLayerPositionEditor.tsx`](../apps/review/src/components/MimicDocAiLayerPositionEditor.tsx))
only writes **corrections** as `docai_layer_positions`. So the human tool is an
**override layer on top of an existing automation spine** — not a from-scratch placer.

## Design principle: one schema for human and machine

The editor's per-box output is intentionally identical to what an automated placer would
emit, so swapping human → machine is a drop-in:

```jsonc
{
  "layer_key": "headline@0",
  "role": "headline",
  "x_px": 96, "y_px": 140, "w_px": 888, "h_px": 220,
  "font_size_px": 72,
  "font_weight": 700,
  "color_hex": "#111111",
  "font_family": "Inter",
  "font_style_italic": false,
  "hidden": false,
  "box_locked": false,
  "source": "human"        // NEW: ocr | human | vision  (provenance tag)
}
```

The only new concept is the **`source` tag** (added to `DocAiLayerOverride` as an optional
field today). It records who produced each box:

- `ocr` — deterministic solver seed (default).
- `human` — a reviewer edit in the drag editor.
- `vision` — a vision-model suggestion (future).

Persisting `source` end-to-end (Core zod schema + payload) is the **only** capture
plumbing required later; the shape is otherwise unchanged.

## Recommended automation routes (ranked)

### A. Strengthen the deterministic OCR → layout solver  *(lowest cost, already the spine)*
Improve copy → reference-box anchoring, role classification, and collision / center-avoid
in `mimic-docai-overlay-layout.ts`. Most slides already work this way; better anchoring
shrinks the human correction delta.

### B. Vision-model placement  *(suggestion layer)*
Send the generated art plate + target copy to a vision LLM; get back boxes in the **same
JSON schema** with `source: "vision"`. Render as "suggested," human accepts/nudges. Fall
back to the solver (route A) on low confidence.

### C. Closed-loop learning from human corrections
Pair the OCR-suggested box with the human-final box (the delta) as labeled data to
few-shot / finetune the placer. We already persist the finals (`docai_layer_positions`);
the missing half is storing the **OCR original alongside** (this is the capture plumbing
intentionally deferred). The `source` tag is what makes original-vs-final separable.

### D. Auto-contrast / auto-color
Extend [`services/renderer/mimic-docai-fit.js`](../services/renderer/mimic-docai-fit.js)
(and the contrast pass) with saliency / contrast detection to place text over low-detail
regions and auto-pick a legible colour from the **brand palette** (already surfaced in the
editor as swatches, see 1.5).

### E. Confidence gate  *(bridge from assisted → fully automated)*
Compute a placement confidence (OCR alignment + collision + contrast). Auto-approve
high-confidence slides; route low-confidence slides to the human editor. This is the
switch that turns the human tool into an exception handler rather than the default path.

## How the current editor already supports this

| Capability | Where it lives today | Automation reuse |
|---|---|---|
| Box geometry + style schema | `DocAiLayerOverride` | Machine placer emits the same shape |
| Per-box provenance | `source` tag (optional, this change) | Separates ocr / human / vision |
| Brand palette | swatches in editor (1.5) | Route D auto-colour source |
| Regenerate route knobs | similarity / reference (1.6) | Lets a confidence gate pick a route |
| Reprint = overlay only | `carousel_mimic_bg.hbs` + DocAI | Text never baked → boxes stay editable/automatable |

## Not in scope this round

- Persisting `source` through Core (zod schema + `mimic_v1` payload).
- Storing the OCR original next to the human final (route C capture).
- Any vision-model call or confidence scorer.
