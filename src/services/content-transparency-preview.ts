/**
 * Human-oriented excerpts from generation_payload for admin transparency (carousel / video / scenes).
 */
import { extractSpokenScriptText, extractVideoPromptText } from "./video-gen-fields.js";
import { slidesFromGeneratedOutput, slideHasRenderableContent } from "./carousel-render-pack.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export interface JobContentPreview {
  flow_hint: string | null;
  /** Present when the job is still at candidate handoff and nothing generated yet. */
  planned?: {
    stage: "PLANNED";
    title?: string;
    summary_excerpt?: string;
    key_point?: string;
  };
  carousel?: {
    slide_count: number;
    slides: Array<{ index: number; hook?: string; title?: string; body?: string; raw?: string }>;
  };
  video?: {
    spoken_script?: string;
    video_prompt?: string;
  };
  scene_assembly?: {
    scenes: Array<{
      order?: number | string;
      scene_id?: string;
      direction?: string;
      video_prompt?: string;
      script_text?: string;
    }>;
  };
}

function excerpt(text: string, maxChars: number): string {
  const t = text.trim();
  if (!t) return "";
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}…`;
}

export function buildJobContentPreview(flowType: string | null, generationPayload: unknown): JobContentPreview {
  const pay = asRecord(generationPayload) ?? {};
  const gen = asRecord(pay.generated_output) ?? {};

  const preview: JobContentPreview = { flow_hint: flowType };

  const resolvedSlides = slidesFromGeneratedOutput(gen);
  if (resolvedSlides.length > 0 && resolvedSlides.some((s) => slideHasRenderableContent(s as Record<string, unknown>))) {
    preview.carousel = {
      slide_count: resolvedSlides.length,
      slides: resolvedSlides.map((v, i) => {
        const r = asRecord(v) ?? {};
        const hook = String(r.hook ?? r.slide_hook ?? "").trim();
        const title = String(r.title ?? r.headline ?? "").trim();
        const body = String(r.body ?? r.caption ?? r.text ?? "").trim();
        return {
          index: i + 1,
          hook: hook || undefined,
          title: title || undefined,
          body: body || undefined,
          raw: JSON.stringify(r).length > 400 ? undefined : JSON.stringify(r),
        };
      }),
    };
  }

  const script = extractSpokenScriptText(gen, 1);
  const vprompt = extractVideoPromptText(gen, 1);
  if (script || vprompt) {
    preview.video = {
      spoken_script: script || undefined,
      video_prompt: vprompt || undefined,
    };
  }

  const bundle = asRecord(gen.scene_bundle);
  const sceneList = bundle?.scenes;
  if (Array.isArray(sceneList) && sceneList.length > 0) {
    preview.scene_assembly = {
      scenes: sceneList.map((s, i) => {
        const r = asRecord(s) ?? {};
        return {
          order: (r.order as number | string) ?? i + 1,
          scene_id: String(r.scene_id ?? "").trim() || undefined,
          direction: String(r.direction ?? "").trim() || undefined,
          video_prompt: String(r.video_prompt ?? r.prompt ?? "").trim() || undefined,
          script_text: String(r.script_text ?? r.spoken_script ?? "").trim() || undefined,
        };
      }),
    };
  }

  if (!preview.carousel && !preview.video && !preview.scene_assembly) {
    const cand = asRecord(pay.candidate_data) ?? {};
    const title = String(cand.content_idea ?? cand.title ?? "").trim();
    const summary = String(cand.summary ?? cand.three_liner ?? "").trim();
    const kp = cand.key_points;
    const firstPoint =
      Array.isArray(kp) && kp.length > 0 ? String(kp[0] ?? "").trim() : "";
    if (title || summary || firstPoint) {
      preview.planned = {
        stage: "PLANNED",
        title: title || undefined,
        summary_excerpt: summary ? excerpt(summary, 320) : undefined,
        key_point: firstPoint || undefined,
      };
    }
  }

  return preview;
}
