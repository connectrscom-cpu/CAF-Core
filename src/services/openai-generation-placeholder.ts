/**
 * Deterministic stub output when OPENAI_GENERATION_MODE=placeholder (no OpenAI API calls).
 */
import type { AppConfig } from "../config.js";
import { isCarouselFlow, isVideoFlow } from "../decision_engine/flow-kind.js";
import { isTpGroundedCarouselRenderFlow } from "../domain/top-performer-mimic-flow-types.js";
import { pickMimicPayload } from "../domain/mimic-payload.js";
import { targetMimicCarouselCopySlideCount } from "./mimic-carousel-render.js";
import type { OpenAiChatParams } from "./openai-chat.js";
import { loadConfig } from "../config.js";

export const OPENAI_PLACEHOLDER_MODEL = "openai-placeholder";

const TAG = "[PLACEHOLDER]";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export type OpenAiGenerationMode = "live" | "placeholder";

/** Parse per-project override from constraints row. */
export function parseProjectOpenAiGenerationMode(raw: unknown): OpenAiGenerationMode | null {
  const m = String(raw ?? "").trim().toLowerCase();
  if (m === "live" || m === "placeholder") return m;
  return null;
}

/** Server default: env OPENAI_GENERATION_MODE wins over parsed config when env is explicit. */
export function serverOpenAiGenerationMode(
  config?: Pick<AppConfig, "OPENAI_GENERATION_MODE">
): OpenAiGenerationMode {
  const raw = process.env.OPENAI_GENERATION_MODE?.trim().toLowerCase();
  if (raw === "placeholder") return "placeholder";
  if (raw === "live") return "live";
  const mode = config?.OPENAI_GENERATION_MODE ?? loadConfig().OPENAI_GENERATION_MODE;
  return mode === "placeholder" ? "placeholder" : "live";
}

/** True when OpenAI chat/vision must not call the network (server default only). */
export function isOpenAiPlaceholderMode(config?: Pick<AppConfig, "OPENAI_GENERATION_MODE">): boolean {
  return serverOpenAiGenerationMode(config) === "placeholder";
}

/** Project override when set; otherwise server default. */
export function effectiveOpenAiGenerationMode(
  projectMode: OpenAiGenerationMode | null | undefined,
  config?: Pick<AppConfig, "OPENAI_GENERATION_MODE">
): OpenAiGenerationMode {
  if (projectMode === "live" || projectMode === "placeholder") return projectMode;
  return serverOpenAiGenerationMode(config);
}

export function isOpenAiPlaceholderModeForProject(
  projectMode: OpenAiGenerationMode | null | undefined,
  config?: Pick<AppConfig, "OPENAI_GENERATION_MODE">
): boolean {
  return effectiveOpenAiGenerationMode(projectMode, config) === "placeholder";
}

function firstTextLine(text: string): string {
  return (
    text
      .split(/\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? ""
  );
}

function bodyFromReference(text: string): string {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return lines[0] ?? "";
  return lines.slice(1).join(" ");
}

function slideRole(slideIndex: number, total: number): string {
  if (slideIndex === 1) return "cover";
  if (slideIndex === total && total > 1) return "cta";
  return "body";
}

/** Mimic placeholder: preserve reference on-screen transcript verbatim (Flux/HBS copy source). */
function mimicPlaceholderSlides(
  slideCount: number,
  layoutRows: Array<{ reference_on_screen_text?: string | null }>
): Record<string, unknown>[] {
  const n = Math.max(1, Math.floor(slideCount));
  const slides: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const transcript = String(layoutRows[i]?.reference_on_screen_text ?? "").trim();
    const body = transcript || `On-screen copy for slide ${i + 1}`;
    slides.push({
      slide_index: i + 1,
      slide_number: i + 1,
      slide_role: slideRole(i + 1, n),
      headline: "",
      body,
    });
  }
  return slides;
}

function placeholderSlides(
  slideCount: number,
  layoutRows?: Array<{ reference_on_screen_text?: string | null }>
): Record<string, unknown>[] {
  const n = Math.max(1, Math.floor(slideCount));
  const slides: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const ref = String(layoutRows?.[i]?.reference_on_screen_text ?? "").trim();
    const headline = firstTextLine(ref) || `Slide ${i + 1}`;
    const body = bodyFromReference(ref) || `On-screen copy for slide ${i + 1}`;
    slides.push({
      slide_index: i + 1,
      slide_number: i + 1,
      slide_role: slideRole(i + 1, n),
      headline: `${TAG} ${headline}`.slice(0, 160),
      body: `${TAG} ${body}`.slice(0, 480),
    });
  }
  return slides;
}

function resolveMimicPlaceholderLayout(
  payload: Record<string, unknown>,
  mimicSlideCopyLayout?: Array<{ reference_on_screen_text?: string | null }>
): Array<{ reference_on_screen_text?: string | null }> {
  if (mimicSlideCopyLayout && mimicSlideCopyLayout.length > 0) return mimicSlideCopyLayout;
  const grounding = asRecord(payload.mimic_job_grounding);
  const layout = grounding?.slide_copy_layout;
  if (!Array.isArray(layout) || layout.length === 0) return [];
  return layout.map((row) => {
    const rec = asRecord(row);
    const raw = rec?.reference_on_screen_text;
    const reference_on_screen_text = typeof raw === "string" ? raw : null;
    return { reference_on_screen_text };
  });
}

function mimicPlaceholderCaption(
  layoutRows: Array<{ reference_on_screen_text?: string | null }>
): string {
  const first = layoutRows.map((r) => String(r.reference_on_screen_text ?? "").trim()).find(Boolean);
  if (first) {
    const line = firstTextLine(first);
    return line ? `${TAG} ${line}` : `${TAG} Mimic carousel caption — OpenAI disabled.`;
  }
  return `${TAG} Mimic carousel caption — OpenAI disabled.`;
}

export interface JobGenerationPlaceholderOptions {
  flowType: string;
  payload: Record<string, unknown>;
  mimicSlideCopyLayout?: Array<{ reference_on_screen_text?: string | null }>;
  sceneCount?: { min: number; max: number };
  wantSceneBundle?: boolean;
}

/** Structured job output for carousel / mimic / video flows (schema-friendly). */
export function buildJobGenerationPlaceholderOutput(
  opts: JobGenerationPlaceholderOptions
): Record<string, unknown> {
  if (opts.wantSceneBundle) {
    const min = Math.max(1, opts.sceneCount?.min ?? 2);
    const max = Math.max(min, opts.sceneCount?.max ?? min);
    const count = min;
    const scenes = Array.from({ length: count }, (_, i) => ({
      scene_id: `scene_${String(i + 1).padStart(2, "0")}`,
      order: i + 1,
      direction: `${TAG} Visual direction for scene ${i + 1}.`,
      video_prompt: `${TAG} B-roll prompt for scene ${i + 1}.`,
      scene_narration_line: `${TAG} Narration line ${i + 1}.`,
    }));
    return {
      scene_bundle: { scenes },
      spoken_script: `${TAG} Placeholder spoken script for scene assembly testing.`,
      caption: `${TAG} Video caption placeholder.`,
      hashtags: ["#placeholder", "#caf"],
    };
  }

  if (isTpGroundedCarouselRenderFlow(opts.flowType)) {
    const mimic = pickMimicPayload(opts.payload);
    const layout = resolveMimicPlaceholderLayout(opts.payload, opts.mimicSlideCopyLayout);
    const fromTarget = targetMimicCarouselCopySlideCount(opts.payload, mimic);
    const slideCount = Math.max(layout.length, fromTarget ?? 0, 1);
    const slides = mimicPlaceholderSlides(slideCount, layout);
    return {
      slides,
      carousel: { slides },
      caption: mimicPlaceholderCaption(layout),
      hashtags: ["#placeholder"],
      package_type: "carousel_copy",
    };
  }

  if (isCarouselFlow(opts.flowType)) {
    const struct = asRecord(opts.payload.structure_variables);
    const fromStruct =
      typeof struct?.slide_count === "number" && struct.slide_count > 0
        ? Math.floor(struct.slide_count)
        : null;
    const slideCount = fromStruct ?? 3;
    const slides = placeholderSlides(slideCount);
    return {
      slides,
      carousel: { slides },
      caption: `${TAG} Carousel caption — OpenAI disabled.`,
      hashtags: ["#placeholder"],
    };
  }

  if (isVideoFlow(opts.flowType)) {
    return {
      spoken_script: `${TAG} Placeholder spoken script. OpenAI generation is disabled for testing.`,
      hook_line: `${TAG} Hook line placeholder.`,
      cta_line: `${TAG} CTA placeholder.`,
      caption: `${TAG} Video caption placeholder.`,
      hashtags: ["#placeholder"],
    };
  }

  return {
    caption: `${TAG} Generated copy placeholder — OpenAI disabled.`,
    hashtags: ["#placeholder"],
  };
}

/** Generic chat completion stub for non-job OpenAI callers. */
export function buildGenericOpenAiPlaceholderContent(params: OpenAiChatParams): string {
  if (params.response_format === "json_object") {
    return JSON.stringify({
      placeholder: true,
      note: "OpenAI generation disabled (OPENAI_GENERATION_MODE=placeholder)",
      summary: `${TAG} Stub JSON response.`,
    });
  }
  return `${TAG} OpenAI generation disabled (OPENAI_GENERATION_MODE=placeholder).`;
}

/** Multimodal vision stub (approval review, creative intel, etc.). */
export function buildGenericOpenAiMultimodalPlaceholderContent(
  responseFormat?: "json_object" | "text"
): string {
  if (responseFormat === "json_object") {
    return JSON.stringify({
      placeholder: true,
      passed: true,
      summary: `${TAG} Vision review skipped — OpenAI disabled.`,
      recommendations: [],
      upstream_recommendations: [],
    });
  }
  return `${TAG} OpenAI vision disabled (OPENAI_GENERATION_MODE=placeholder).`;
}

export function openAiPlaceholderChatResult(params: OpenAiChatParams): {
  content: string;
  model: string;
  total_tokens: number;
} {
  return {
    content: buildGenericOpenAiPlaceholderContent(params),
    model: OPENAI_PLACEHOLDER_MODEL,
    total_tokens: 0,
  };
}
