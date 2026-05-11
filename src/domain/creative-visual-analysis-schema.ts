import { z } from "zod";

export const creativeVisualAnalysisLlmSchema = z.object({
  visual_summary: z.string().optional(),
  style_tags: z.array(z.string()).optional().default([]),
  layout: z
    .object({
      type: z.string().optional(),
      hierarchy: z.string().optional(),
      text_density: z.enum(["low", "medium", "high"]).optional(),
      safe_area_notes: z.string().optional(),
    })
    .optional(),
  color_palette: z
    .object({
      dominant: z.array(z.string()).optional(),
      accent: z.array(z.string()).optional(),
      background_style: z.string().optional(),
      contrast: z.enum(["low", "medium", "high"]).optional(),
    })
    .optional(),
  typography: z
    .object({
      style: z.string().optional(),
      weight: z.string().optional(),
      case: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  composition: z
    .object({
      uses_faces: z.boolean().optional(),
      uses_product: z.boolean().optional(),
      uses_icons: z.boolean().optional(),
      uses_cards: z.boolean().optional(),
      uses_borders: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  text_overlay: z
    .object({
      has_overlay_text: z.boolean().optional(),
      approx_words_per_slide: z.number().optional(),
      placement: z.string().optional(),
      readability: z.enum(["high", "medium", "low"]).optional(),
    })
    .optional(),
  motion: z
    .object({
      pacing: z.string().optional(),
      cuts: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  performance_hypothesis: z.string().optional(),
  mimicry_notes: z.string().optional(),
  generation_guidance: z.string().optional(),
});

export type CreativeVisualAnalysisLlm = z.infer<typeof creativeVisualAnalysisLlmSchema>;

export function parseCreativeVisualAnalysisLlm(raw: unknown): CreativeVisualAnalysisLlm | null {
  const p = creativeVisualAnalysisLlmSchema.safeParse(raw);
  return p.success ? p.data : null;
}
