/**
 * Carousel reference / output analysis contracts (Document AI OCR + Nemotron visual).
 */

export const CAROUSEL_REFERENCE_OCR_SCHEMA = "document_ai_ocr_v1" as const;
export const CAROUSEL_RUN_OUTPUT_ANALYSIS_SCHEMA = "run_output_analysis_v1" as const;

export interface BboxPct {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CarouselTextLayerFont {
  family_detected: string | null;
  size_px: number | null;
  weight: number | null;
  bold: boolean | null;
  italic: boolean | null;
  underline: boolean | null;
  color_hex: string | null;
  background_color_hex: string | null;
  letter_spacing: string | null;
}

export interface CarouselDetectedTextLayer {
  layer_index: number;
  text: string;
  bbox_pct: BboxPct;
  alignment: "left" | "center" | "right" | "unknown";
  font: CarouselTextLayerFont;
  reading_order: number;
  confidence: number | null;
  source: "document_ai";
}

export interface CarouselDocumentAiSlideOcr {
  schema_version: typeof CAROUSEL_REFERENCE_OCR_SCHEMA;
  slide_index: number;
  canvas_width_px: number | null;
  canvas_height_px: number | null;
  full_text: string;
  ocr_confidence_mean: number | null;
  text_layers: CarouselDetectedTextLayer[];
  token_count: number;
}

export interface CarouselIntendedTextLayer {
  id: string;
  text: string;
  bbox_pct: BboxPct | null;
  font: Partial<CarouselTextLayerFont>;
}

export interface CarouselOutputIntended {
  canvas: { width_px: number; height_px: number };
  text_layers: CarouselIntendedTextLayer[];
  forbidden_text: string[];
  safe_margin_pct: number;
  art_only_image: boolean;
}

export interface CarouselOutputTextQa {
  expected_text_present: boolean;
  missing_text: string[];
  extra_text: string[];
  forbidden_text_hits: string[];
  text_in_art_only_zone: boolean;
  position_drift: Array<{
    layer_id: string;
    expected_bbox_pct: BboxPct | null;
    detected_bbox_pct: BboxPct | null;
    iou: number | null;
  }>;
  contrast_pass: boolean | null;
  within_safe_margins: boolean | null;
  text_check_pass: boolean;
}

export interface CarouselOutputNemotronVisual {
  matches_intended_layout: boolean | null;
  matches_reference_composition: string | null;
  layout_similarity: "low" | "medium" | "high" | null;
  background_quality: string | null;
  visual_artifacts: string[];
  unwanted_text_in_image: boolean | null;
  mimic_faithfulness: "low" | "medium" | "high" | null;
  main_deviation: string | null;
  readability_issues: string[];
  brand_safety_issues: string[];
  recommended_action: "approve" | "revise_text" | "regenerate_background" | "manual_review";
  confidence: number | null;
}

export interface CarouselOutputAssetAnalysis {
  asset_id: string | null;
  asset_type: string | null;
  slide_index: number;
  public_url: string | null;
  reference_asset_url: string | null;
  document_ai: CarouselDocumentAiSlideOcr | null;
  document_ai_error: string | null;
  text_qa: CarouselOutputTextQa | null;
  nemotron_visual: CarouselOutputNemotronVisual | null;
  nemotron_error: string | null;
  asset_verdict: "pass" | "warn" | "fail" | "skipped";
  blocking_issues: string[];
  warnings: string[];
}

export interface CarouselOutputJobAnalysis {
  task_id: string;
  job_id: string;
  flow_type: string;
  platform: string | null;
  status: string;
  mimic_mode: string | null;
  source_insights_id: string | null;
  intended: CarouselOutputIntended | null;
  assets: CarouselOutputAssetAnalysis[];
  job_verdict: "pass" | "warn" | "fail" | "skipped";
  job_blocking_issues: string[];
  job_warnings: string[];
  error: string | null;
}

export interface RunCarouselOutputAnalysisV1 {
  schema_version: typeof CAROUSEL_RUN_OUTPUT_ANALYSIS_SCHEMA;
  run_id: string;
  project_id: string;
  analyzed_at: string;
  status_filter: string[];
  providers: {
    document_ai: { project_id: string; location: string; processor_id: string };
    nemotron: { model: string; provider: string };
  };
  summary: {
    jobs_total: number;
    jobs_analyzed: number;
    jobs_skipped: number;
    assets_analyzed: number;
    assets_failed: number;
    text_pass: number;
    text_fail: number;
    visual_warn: number;
    blocking_count: number;
  };
  duration_ms: number;
  jobs: CarouselOutputJobAnalysis[];
}
