/** Pure helpers: turn generation_payload into a single text block for LLM review (no I/O). */

function pickSection(label: string, value: unknown, parts: string[]): void {
  if (value == null || value === "") return;
  if (typeof value === "string") {
    if (value.trim()) parts.push(`## ${label}\n${value.trim()}`);
    return;
  }
  try {
    parts.push(`## ${label}\n${JSON.stringify(value, null, 2)}`);
  } catch {
    parts.push(`## ${label}\n[Stringify error]`);
  }
}

function mergeGeneratedLayers(payload: Record<string, unknown>): Record<string, unknown> {
  const gen = (payload.generated_output as Record<string, unknown>) ?? {};
  const out: Record<string, unknown> = { ...gen };
  for (const k of Object.keys(payload)) {
    if (k === "generated_output" || k === "candidate_data") continue;
    if (out[k] == null && payload[k] != null) out[k] = payload[k];
  }
  const cand = (payload.candidate_data as Record<string, unknown>) ?? {};
  for (const k of ["content_idea", "topic", "angle", "title"]) {
    if (out[k] == null && cand[k] != null) out[k] = cand[k];
  }
  return out;
}

export function buildApprovedContentTextBundle(
  generationPayload: Record<string, unknown>,
  maxChars: number
): string {
  const merged = mergeGeneratedLayers(generationPayload);
  const parts: string[] = [];

  pickSection("hook", merged.hook, parts);
  pickSection("caption / post", merged.caption ?? merged.post_caption, parts);
  pickSection("title", merged.title, parts);
  pickSection("hashtags", merged.hashtags, parts);
  pickSection("slides", merged.slides, parts);
  pickSection("slide_deck", merged.slide_deck, parts);
  pickSection("carousel / deck", merged.carousel, parts);
  pickSection("video_prompt", merged.video_prompt, parts);
  pickSection("video_script", merged.video_script, parts);
  pickSection("spoken_script", merged.spoken_script, parts);
  pickSection("scene_bundle", merged.scene_bundle, parts);
  pickSection("heygen / video plan", merged.video_plan ?? merged.heygen_payload, parts);

  let body = parts.join("\n\n").trim();
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars)}\n\n…(truncated for model context)`;
  }
  return body || "(no extractable copy — empty generated_output)";
}
