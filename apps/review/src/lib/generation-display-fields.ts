/**
 * Map CAF `generation_payload` / `generated_output` into Workbench display fields.
 * Video script JSON uses hook_line / cta_line / on_screen_text — not always top-level title/hook/caption.
 */

function stringVal(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function recordVal(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function arrayVal(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function pickFromNestedCaptionObjects(root: Record<string, unknown> | null): string {
  if (!root) return "";
  const direct = stringVal(root.caption) || stringVal(root.post_caption) || stringVal(root.description);
  if (direct.trim()) return direct.trim();

  for (const k of ["content", "publish", "publication", "post", "video", "result", "output", "data"]) {
    const nest = recordVal(root[k]);
    if (!nest) continue;
    const v = stringVal(nest.caption) || stringVal(nest.post_caption) || stringVal(nest.description);
    if (v.trim()) return v.trim();
  }
  return "";
}

function composeCaptionFromVideoScriptJson(go: Record<string, unknown>): string {
  const cap = stringVal(go.caption).trim();
  if (cap) return cap;
  const post = stringVal(go.post_caption).trim();
  if (post) return post;
  const parts: string[] = [];
  const cta = stringVal(go.cta_line ?? go.cta).trim();
  if (cta) parts.push(cta);
  const ost = arrayVal(go.on_screen_text);
  if (ost) {
    const lines = ost.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
    if (lines.length) parts.push(lines.join("\n"));
  }
  const disc = stringVal(go.disclaimer_line).trim();
  if (disc) parts.push(disc);
  return parts.join("\n\n").trim();
}

/**
 * Post / carousel caption: explicit caption fields first, then video-script CTA + on-screen + disclaimer.
 */
export function pickCaptionFromGenerationPayload(payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? undefined;
  const direct =
    stringVal(p?.caption) ||
    stringVal(p?.generated_caption) ||
    stringVal(p?.post_caption) ||
    stringVal(p?.final_caption) ||
    stringVal(p?.final_caption_override);
  if (direct.trim()) return direct.trim();

  const generatedOutput = recordVal(p?.generated_output);
  if (generatedOutput) {
    const fromScript = composeCaptionFromVideoScriptJson(generatedOutput);
    if (fromScript.trim()) return fromScript.trim();

    const goDirect = pickFromNestedCaptionObjects(generatedOutput) || stringVal(generatedOutput?.generated_caption);
    if (goDirect.trim()) return goDirect.trim();

    const carousel = recordVal(generatedOutput?.carousel);
    const carouselCaption = pickFromNestedCaptionObjects(carousel);
    if (carouselCaption.trim()) return carouselCaption.trim();

    const variations = arrayVal(generatedOutput?.variations);
    const firstVar = variations?.[0] ? recordVal(variations[0]) : null;
    const varCaption = pickFromNestedCaptionObjects(firstVar);
    if (varCaption.trim()) return varCaption.trim();
  }

  return "";
}

/** Page / export title: prefer explicit title, then script hook_line (video script schema). */
export function pickTitleFromGenerationPayload(payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? undefined;
  const top =
    stringVal(p?.title).trim() ||
    stringVal(p?.generated_title).trim() ||
    stringVal(p?.headline).trim();
  if (top) return top;

  const go = recordVal(p?.generated_output);
  if (go) {
    const g =
      stringVal(go.title).trim() ||
      stringVal(go.headline).trim() ||
      stringVal(go.hook_line).trim() ||
      stringVal(go.hook).trim();
    if (g) return g;
  }
  return "";
}

/** Spoken VO for HeyGen / video script flows. */
export function pickSpokenScriptFromGenerationPayload(payload: Record<string, unknown> | null | undefined): string {
  const go = recordVal(payload?.generated_output);
  if (!go) return "";
  const s = stringVal(go.spoken_script) || stringVal(go.script) || stringVal(go.video_script);
  return s.trim();
}

/** Hook line for rework / sidebar — hook_line beats generic hook. */
export function pickHookFromGenerationPayload(payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? undefined;
  const top = stringVal(p?.hook).trim() || stringVal(p?.generated_hook).trim();
  if (top) return top;

  const go = recordVal(p?.generated_output);
  if (go) {
    const g = stringVal(go.hook_line).trim() || stringVal(go.hook).trim();
    if (g) return g;
  }
  return "";
}
