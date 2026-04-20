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

/** Find the rendered video URL inside a flattened generation payload. */
function pickRenderedVideoUrl(merged: Record<string, unknown>): string {
  const keys = [
    "merged_video_url",
    "final_video_url",
    "heygen_video_url",
    "rendered_video_url",
    "video_url",
    "mux_playback_url",
    "output_video_url",
  ];
  for (const k of keys) {
    const v = merged[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function sceneCount(merged: Record<string, unknown>): number {
  const sb = merged.scene_bundle;
  if (Array.isArray(sb)) return sb.length;
  if (sb && typeof sb === "object") {
    const scenes = (sb as Record<string, unknown>).scenes;
    if (Array.isArray(scenes)) return scenes.length;
  }
  const plan = merged.video_plan;
  if (plan && typeof plan === "object") {
    const scenes = (plan as Record<string, unknown>).scenes;
    if (Array.isArray(scenes)) return scenes.length;
  }
  return 0;
}

export function buildApprovedContentTextBundle(
  generationPayload: Record<string, unknown>,
  maxChars: number
): string {
  const merged = mergeGeneratedLayers(generationPayload);
  const parts: string[] = [];

  // Video-specific header: surface the rendered artifact location + shape so the reviewer knows
  // a real video exists even when the OpenAI chat API can't ingest video URLs directly.
  const videoUrl = pickRenderedVideoUrl(merged);
  const scenes = sceneCount(merged);
  const durationRaw = merged.duration_seconds ?? merged.video_duration_seconds ?? merged.duration;
  const duration = typeof durationRaw === "number" && Number.isFinite(durationRaw) ? durationRaw : null;
  if (videoUrl || scenes > 0 || duration != null) {
    const lines: string[] = [];
    if (videoUrl) lines.push(`rendered_video_url: ${videoUrl}`);
    if (scenes > 0) lines.push(`scene_count: ${scenes}`);
    if (duration != null) lines.push(`duration_seconds: ${duration}`);
    lines.push(
      "(note: you cannot fetch the video — score the plan, script, captions, and scene bundle as a proxy)"
    );
    parts.push(`## video_artifact\n${lines.join("\n")}`);
  }

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
  pickSection(
    "captions / subtitles",
    merged.captions ?? merged.subtitles ?? merged.srt ?? merged.subtitles_srt,
    parts
  );
  pickSection("cta", merged.cta ?? merged.primary_cta, parts);

  let body = parts.join("\n\n").trim();
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars)}\n\n…(truncated for model context)`;
  }
  return body || "(no extractable copy — empty generated_output)";
}
