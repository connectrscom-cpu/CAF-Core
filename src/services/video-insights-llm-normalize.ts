/**
 * Normalize top-performer video LLM JSON (esp. Nemotron) into the flat schema CAF persists.
 */

const WRAPPER_KEYS = [
  "video_wide",
  "video_wide_summary",
  "video",
  "analysis",
  "result",
  "response",
  "output",
  "data",
  "deck",
] as const;

const ROOT_STRING_FIELDS = [
  "hook_visual",
  "message_clarity",
  "pacing_notes",
  "video_arc",
  "opening_vs_body",
  "visual_consistency",
  "on_screen_text_summary",
  "spoken_hook",
  "cta_clarity",
  "format_pattern",
  "why_it_worked",
  "video_as_whole_summary",
  "message_thesis",
  "narrative_arc",
  "spoken_script_summary",
  "on_screen_text_script",
] as const;

const FORMAT_PATTERN_VALUES = new Set([
  "talking_head",
  "b_roll",
  "text_on_screen",
  "ugc",
  "product_demo",
  "mixed",
  "unknown",
]);

/** Nemotron sometimes emits research/junk keys — drop before persist. */
const JUNK_ROOT_KEYS = new Set([
  "alternative_tsla_alphabet_home",
  "concrete_examples",
  "disruptive_means",
  "latent_narrative",
  "conciseness_notes",
  "dance_analysis_na",
  "footwear_analysis_na",
  "conclusions_attempted",
  "secondary_vehicles",
  "subjectivity_notes",
  "design_optimization",
  "historical_crossref",
  "upload_risk_evaluation",
  "timestamp_peculiarities",
  "second_layer_description",
  "truth_feminisms_blogroll",
  "idealized_symbolic_structure",
  "visible_content_verification",
  "cross_platform_considerations",
  "risk_labels_suggested",
  "research_questions",
  "instructions",
  "legal_ethics",
  "asset_sources",
  "tooling_notes",
  "how_to_recreate",
  // Nemotron hallucination / meta keys (objects or strings)
  "actual",
  "angles",
  "backup",
  "chains",
  "counter",
  "metadata",
  "takeaway",
  "verifier",
  "benchmark",
  "framework",
  "llm_token",
  "timestamp",
  "directions",
  "guardrails",
  "offsetTuppn",
  "trace_index",
  "fringe_score",
  "post_details",
  "retry_policy",
  "approach_note",
  "frame_details",
  "image_history",
  "return_status",
  "analysis_style",
  "framework_type",
  "priority_index",
  "aesthetic_notes",
  "audio_recording",
  "document_vector",
  "event_iteration",
  "completed_chains",
  "cultural_context",
  "image_processing",
  "image_properties",
  "text_annotations",
  "correction_status",
  "device_recordings",
  "frame_annotations",
  "p_practice_system",
  "question_variance",
  "reach_implication",
  "relevance_factors",
  "spoken_transcript",
  "taxonomic_weights",
  "additional_context",
  "device_geolocation",
  "framework_selector",
  "replication_frames",
  "specific_recording",
  "diagnostic_response",
  "pre_llm_frame_count",
  "discussion_questions",
  "analyze_single_corpus",
  "approach_verification",
  "correlation_structure",
  "speculative_embedding",
  "veracity_verification",
  "additional_frame_details",
  "attribution_approximation",
  "title",
  "risk_basis",
  "colorpalette",
  "behavioral_notes",
  "knowledge_domain",
  "scenario_thinkfast",
  "process_descriptors",
  "sensitive_design_op",
  "strategy_disruption",
  "content_optimization",
  "composition_benchmarks",
  "risk_suggested_actions",
  "design_alignment_verdict",
  "astrology_content_analysis",
  "platform_composition_alignment",
]);

const PROMPT_ECHO_OCR =
  /every readable on-screen word|\[illegible\] when needed|use \\n between lines|reading order/i;

const WEAK_SUMMARY_PLACEHOLDER = /unable to summarize|not inferable from a single frame|not observable in a single frame/i;

const SPOKEN_HOOK_PLACEHOLDER =
  /^(n\/?a|none|unknown|not applicable|no audio|no speech|silent|not available|needs spoken transcript)[\s\-—.:,()]*|^empty$/i;

const SINGLE_FRAME_HONEST = {
  video_arc: "Single-frame sample — clip progression is not observable from one still.",
  opening_vs_body: "N/A — only one frame was sampled.",
  pacing_notes: "Only one frame was sampled; cut timing and motion cannot be inferred from stills.",
} as const;

const MAX_ROOT_STRING_CHARS = 4_000;

const COMPOSITION_BLUEPRINT_KEYS = new Set([
  "canvas_description",
  "layout_structure",
  "visual_hierarchy",
  "elements",
  "text_blocks",
  "background",
  "spacing_notes",
  "qwen_prompt_notes",
]);

const COMPOSITION_ELEMENT_KEYS = new Set([
  "element_id",
  "element_type",
  "description",
  "bbox_pct",
  "anchor",
  "layer_order",
  "prominence",
  "style_notes",
  "position_confidence",
]);

const COMPOSITION_TEXT_BLOCK_KEYS = new Set([
  "role",
  "text",
  "bbox_pct",
  "alignment",
  "typography_notes",
  "position_confidence",
]);

const VALID_COMPOSITION_PROMINENCE = new Set(["primary", "secondary", "tertiary", "background"]);
const VALID_COMPOSITION_TEXT_ALIGN = new Set(["left", "center", "right"]);
const VALID_COMPOSITION_CONFIDENCE = new Set(["low", "medium", "high"]);

export interface VideoInsightQualityResult {
  ok: boolean;
  score: number;
  reasons: string[];
}

export interface FinalizeVideoInsightOptions {
  frameCount: number;
  captionTranscript?: string;
  /** Whisper ASR transcript — used when model returns N/A for spoken_hook. */
  spokenTranscript?: string;
}

export interface FinalizeVideoInsightResult {
  parsed: Record<string, unknown> | null;
  quality: VideoInsightQualityResult;
  hashtags: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function mergeInstructionsWrapper(root: Record<string, unknown>): void {
  const instr = asRecord(root.instructions);
  if (!instr) return;

  const existing = asRecord(root.replication_blueprint) ?? {};
  const steps = instr.how_to_recreate ?? instr.steps_to_remake;
  root.replication_blueprint = {
    ...existing,
    ...(steps != null ? { steps_to_remake: steps } : {}),
    ...(instr.asset_sources != null ? { asset_sources: instr.asset_sources } : {}),
    ...(instr.tooling_notes != null ? { tooling_notes: instr.tooling_notes } : {}),
    ...(instr.legal_ethics != null ? { legal_ethics: instr.legal_ethics } : {}),
  };
}

function aliasVisualSystemFields(root: Record<string, unknown>): void {
  if (root.video_visual_system == null) {
    const alt = asRecord(root.visual_system) ?? asRecord(root.visual_blueprint);
    if (alt) root.video_visual_system = alt;
  }
  delete root.visual_system;
  delete root.visual_blueprint;
}

function normalizeFormatPattern(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return null;

  const tokens = cleaned
    .split(/[|,]/)
    .map((p) => p.trim().replace(/\s+/g, "_"))
    .filter(Boolean);

  for (const token of tokens) {
    if (FORMAT_PATTERN_VALUES.has(token)) return token;
    if (token.includes("talking_head")) return "talking_head";
    if (token.includes("text_on_screen") || token.includes("text_card")) return "text_on_screen";
    if (token.includes("product_demo")) return "product_demo";
    if (token.includes("b_roll") || token.includes("broll")) return "b_roll";
    if (token.includes("ugc")) return "ugc";
    if (token === "mixed") return "mixed";
  }

  return "unknown";
}

const PERSISTED_ROOT_KEYS = new Set<string>([
  ...ROOT_STRING_FIELDS,
  "frames",
  "risk_flags",
  "video_composition_system",
  "video_visual_system",
  "replication_blueprint",
  "_inference_limits",
  "_format_pattern_refined",
  "style_summary",
  "video_as_whole_summary",
  "full_video_analysis",
  "on_screen_text_script",
  "message_thesis",
  "narrative_arc",
  "spoken_script_summary",
  "_full_video_synthesis",
]);

const SINGLE_FRAME_TEMPORAL_FIELDS = ["video_arc", "opening_vs_body", "pacing_notes"] as const;

export function isPromptEchoOcrText(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return PROMPT_ECHO_OCR.test(t);
}

export function isSpokenHookPlaceholder(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  return SPOKEN_HOOK_PLACEHOLDER.test(t) || isGibberishInsightText(t);
}

/** Best hook line for DB hook_text — spoken hook, then opening line of ASR, then OCR. */
export function pickVideoInsightHookText(
  parsed: Record<string, unknown> | null | undefined,
  whisperTranscript?: string | null
): string | null {
  if (!parsed) return null;

  const fullAnalysis = asRecord(parsed.full_video_analysis);
  const hookAnalysis = asRecord(fullAnalysis?.hook_analysis);
  const hookSpoken = typeof hookAnalysis?.spoken === "string" ? hookAnalysis.spoken.trim() : "";
  if (hookSpoken && !isSpokenHookPlaceholder(hookSpoken)) {
    return hookSpoken.length > 400 ? `${hookSpoken.slice(0, 400)}…` : hookSpoken;
  }

  const spoken = typeof parsed.spoken_hook === "string" ? parsed.spoken_hook.trim() : "";
  if (spoken && !isSpokenHookPlaceholder(spoken)) {
    return spoken.length > 400 ? `${spoken.slice(0, 400)}…` : spoken;
  }

  const whisper = whisperTranscript?.trim();
  if (whisper) {
    const firstLine =
      whisper
        .split(/\n+/)
        .map((x) => x.trim())
        .find(Boolean) ??
      whisper.split(/[.!?]+\s+/)[0]?.trim() ??
      "";
    if (firstLine) return firstLine.length > 400 ? `${firstLine.slice(0, 400)}…` : firstLine;
  }

  const frames = Array.isArray(parsed.frames) ? parsed.frames : [];
  for (const raw of frames) {
    const frame = asRecord(raw);
    if (!frame) continue;
    let ocr = String(frame.on_screen_text_transcript ?? "").trim();
    if (!ocr || isPromptEchoOcrText(ocr)) {
      const bp = asRecord(frame.composition_blueprint);
      const blocks = Array.isArray(bp?.text_blocks) ? bp!.text_blocks : [];
      const fromBlocks = blocks
        .map((b) => String(asRecord(b)?.text ?? "").trim())
        .filter((x) => x && !isPromptEchoOcrText(x));
      if (fromBlocks.length > 0) ocr = fromBlocks.join("\n");
    }
    if (!ocr || isPromptEchoOcrText(ocr)) continue;
    const line = ocr.split(/\n+/).map((x) => x.trim()).find(Boolean);
    if (line) return line.length > 4000 ? `${line.slice(0, 4000)}…` : line;
  }

  const summary = String(parsed.on_screen_text_summary ?? "").trim();
  if (summary && !isPromptEchoOcrText(summary)) {
    return summary.length > 4000 ? `${summary.slice(0, 4000)}…` : summary;
  }
  return null;
}

export function isGibberishInsightText(s: string): boolean {
  const t = s.trim();
  if (!t) return false;

  if (
    /utteranceunknown|alternative_tsla|artifactementing|muscular use of astrological|pruning weapon bonito|davinci resident|haptenic|actfallin|ppcmd|generative_enaffineteness|jiang-ting|mythoinfinity|pret \|/i.test(
      t
    )
  ) {
    return true;
  }

  // Mixed-script / token-salad blobs Nemotron sometimes emits mid-collapse.
  if (t.length > 120 && /[\u0370-\u03FF\u0400-\u04FF]/.test(t) && /[a-zA-Z]{4,}/.test(t)) {
    const nonAscii = (t.match(/[^\x00-\x7F]/g) ?? []).length;
    if (nonAscii / t.length > 0.08) return true;
  }

  if (t.length < 80) return false;

  if (t.length > 1_200) {
    const sentences = t.split(/[.!?]\s+/).filter(Boolean);
    if (sentences.length < 3 && t.length > 2_000) return true;
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    const longWeird = words.filter((w) => w.length > 25).length;
    if (longWeird / words.length > 0.08) return true;
  }

  if (t.length > 400) {
    const letters = t.replace(/[^a-zA-Z]/g, "");
    if (letters.length > 200) {
      const vowels = letters.replace(/[^aeiouAEIOU]/g, "").length;
      if (vowels / letters.length < 0.15) return true;
    }
  }

  return false;
}

function truncateInsightString(s: string, max = MAX_ROOT_STRING_CHARS): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  return Math.max(0, Math.min(100, n));
}

function normalizeBboxPct(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const nums = raw.slice(0, 4).map((v) => clampPct(Number(v)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

function normalizeCompositionElements(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (!COMPOSITION_ELEMENT_KEYS.has(k)) continue;
      cleaned[k] = v;
    }
    const id = String(cleaned.element_id ?? "").trim();
    const type = String(cleaned.element_type ?? "").trim();
    const desc = String(cleaned.description ?? "").trim();
    if (!id || !type || !desc) continue;
    cleaned.element_id = id.slice(0, 80);
    cleaned.element_type = type.slice(0, 40);
    cleaned.description = desc.slice(0, 400);

    const bbox = normalizeBboxPct(cleaned.bbox_pct);
    if (bbox) cleaned.bbox_pct = bbox;
    else delete cleaned.bbox_pct;

    const anchor = String(cleaned.anchor ?? "").trim();
    if (anchor) cleaned.anchor = anchor.slice(0, 24);
    else delete cleaned.anchor;

    const layer = Number(cleaned.layer_order);
    if (Number.isFinite(layer)) cleaned.layer_order = Math.max(0, Math.min(100, Math.round(layer)));
    else delete cleaned.layer_order;

    const prom = String(cleaned.prominence ?? "").trim().toLowerCase();
    if (VALID_COMPOSITION_PROMINENCE.has(prom)) cleaned.prominence = prom;
    else if (prom) cleaned.prominence = "secondary";
    else delete cleaned.prominence;

    const style = String(cleaned.style_notes ?? "").trim();
    if (style) cleaned.style_notes = style.slice(0, 500);
    else delete cleaned.style_notes;

    const conf = String(cleaned.position_confidence ?? "").trim().toLowerCase();
    if (VALID_COMPOSITION_CONFIDENCE.has(conf)) cleaned.position_confidence = conf;
    else delete cleaned.position_confidence;

    out.push(cleaned);
    if (out.length >= 24) break;
  }
  return out;
}

function normalizeCompositionTextBlocks(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (!COMPOSITION_TEXT_BLOCK_KEYS.has(k)) continue;
      cleaned[k] = v;
    }
    const role = String(cleaned.role ?? "").trim();
    const text = String(cleaned.text ?? "").trim();
    if (!role || !text) continue;
    cleaned.role = role.slice(0, 24);
    cleaned.text = text.slice(0, 220);

    const bbox = normalizeBboxPct(cleaned.bbox_pct);
    if (bbox) cleaned.bbox_pct = bbox;
    else delete cleaned.bbox_pct;

    const align = String(cleaned.alignment ?? "").trim().toLowerCase();
    if (VALID_COMPOSITION_TEXT_ALIGN.has(align)) cleaned.alignment = align;
    else delete cleaned.alignment;

    const typo = String(cleaned.typography_notes ?? "").trim();
    if (typo) cleaned.typography_notes = typo.slice(0, 320);
    else delete cleaned.typography_notes;

    const conf = String(cleaned.position_confidence ?? "").trim().toLowerCase();
    if (VALID_COMPOSITION_CONFIDENCE.has(conf)) cleaned.position_confidence = conf;
    else delete cleaned.position_confidence;

    out.push(cleaned);
    if (out.length >= 24) break;
  }
  return out;
}

function sanitizeCompositionBlueprint(raw: unknown): Record<string, unknown> | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!COMPOSITION_BLUEPRINT_KEYS.has(k)) continue;
    out[k] = v;
  }
  for (const key of ["canvas_description", "layout_structure", "visual_hierarchy", "background", "spacing_notes", "qwen_prompt_notes"] as const) {
    if (out[key] == null) continue;
    const s = String(out[key] ?? "").trim();
    if (!s) delete out[key];
    else out[key] = s.slice(0, key === "qwen_prompt_notes" ? 900 : 500);
  }
  const elems = normalizeCompositionElements(out.elements);
  if (elems.length > 0) out.elements = elems;
  else delete out.elements;
  const tbs = normalizeCompositionTextBlocks(out.text_blocks);
  if (tbs.length > 0) out.text_blocks = tbs;
  else delete out.text_blocks;
  return Object.keys(out).length > 0 ? out : null;
}

function isHallucinatedRiskFlag(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 160) return true;
  if (/^[IVX]+[A-Z0-9_]{10,}/.test(t)) return true;
  if (/vdscore|thinkfast|non-disclosed_copyrighted|inappropriate_all_materials/i.test(t)) return true;
  return false;
}

export function sanitizeVideoInsightRiskFlags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x ?? "").trim())
    .filter((s) => s && !isHallucinatedRiskFlag(s))
    .slice(0, 12);
}

function hoistMisplacedFrameFields(out: Record<string, unknown>): void {
  const typo = asRecord(out.typography);
  if (!typo) return;
  const hoistKeys = [
    "shot_type",
    "text_density",
    "layout_template",
    "graphic_elements",
    "visual_description",
    "color_tokens",
    "composition_blueprint",
  ] as const;
  for (const key of hoistKeys) {
    if (out[key] == null && typo[key] != null) {
      out[key] = typo[key];
    }
    delete typo[key];
  }
  if (Object.keys(typo).length === 0) delete out.typography;
}

function salvageFrameOcr(frame: Record<string, unknown>, root: Record<string, unknown>): void {
  const t = String(frame.on_screen_text_transcript ?? "").trim();
  if (t && !isPromptEchoOcrText(t)) return;

  const bp = asRecord(frame.composition_blueprint);
  const blocks = Array.isArray(bp?.text_blocks) ? bp!.text_blocks : [];
  const fromBlocks = blocks
    .map((b) => String(asRecord(b)?.text ?? "").trim())
    .filter((x) => x && !isPromptEchoOcrText(x));
  if (fromBlocks.length > 0) {
    frame.on_screen_text_transcript = fromBlocks.join("\n");
    return;
  }

  const summary = String(root.on_screen_text_summary ?? "").trim();
  if (summary && !isPromptEchoOcrText(summary)) {
    frame.on_screen_text_transcript = summary;
    return;
  }

  if (!t || isPromptEchoOcrText(t)) delete frame.on_screen_text_transcript;
}

function sanitizeWeakSummaries(root: Record<string, unknown>): void {
  const summary = typeof root.video_as_whole_summary === "string" ? root.video_as_whole_summary.trim() : "";
  if (!summary || !WEAK_SUMMARY_PLACEHOLDER.test(summary)) return;
  const alt =
    pickString(root, "why_it_worked", "message_clarity", "hook_visual", "on_screen_text_summary") ?? "";
  if (alt && !WEAK_SUMMARY_PLACEHOLDER.test(alt)) {
    root.video_as_whole_summary = truncateInsightString(alt);
    root.style_summary = root.video_as_whole_summary;
  }
}

function sanitizeFramesArray(root: Record<string, unknown>): void {
  const frames = Array.isArray(root.frames) ? root.frames : [];
  if (frames.length === 0) return;
  root.frames = frames
    .map((raw, i) => {
      const frame = normalizeFrameRecord(raw, i + 1);
      if (!frame) return null;
      hoistMisplacedFrameFields(frame);
      salvageFrameOcr(frame, root);
      return frame;
    })
    .filter((f): f is Record<string, unknown> => f != null);
}

function stripDegenerateRootFields(root: Record<string, unknown>): void {
  for (const key of JUNK_ROOT_KEYS) {
    delete root[key];
  }

  for (const [key, value] of Object.entries(root)) {
    if (JUNK_ROOT_KEYS.has(key)) {
      delete root[key];
      continue;
    }
    if (typeof value === "string") {
      if (isGibberishInsightText(value)) {
        delete root[key];
        continue;
      }
      root[key] = truncateInsightString(value);
    }
  }
}

/** Keep only schema fields CAF downstream consumers read — drops Nemotron object noise. */
export function pruneVideoInsightRootForPersist(root: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PERSISTED_ROOT_KEYS) {
    if (root[key] !== undefined) out[key] = root[key];
  }
  return out;
}

function firstSpokenLine(transcript: string): string | null {
  const t = transcript.trim();
  if (!t) return null;
  const line = t.split(/\n+/).map((x) => x.trim()).find(Boolean);
  if (!line || line.length < 3) return null;
  return line.length > 400 ? `${line.slice(0, 400)}…` : line;
}

function enrichSpokenHookFromTranscripts(
  root: Record<string, unknown>,
  opts: FinalizeVideoInsightOptions
): void {
  const current = typeof root.spoken_hook === "string" ? root.spoken_hook.trim() : "";
  if (current && !isSpokenHookPlaceholder(current)) {
    return;
  }

  const whisper = opts.spokenTranscript?.trim() ?? "";
  const fromWhisper = firstSpokenLine(whisper);
  if (fromWhisper) {
    root.spoken_hook = fromWhisper;
    return;
  }

  const caption = opts.captionTranscript?.trim() ?? "";
  const fromCaption = firstSpokenLine(caption);
  if (fromCaption && !fromCaption.startsWith("#")) {
    root.spoken_hook = fromCaption;
    return;
  }

  if (current && isSpokenHookPlaceholder(current)) {
    delete root.spoken_hook;
  }
}

/**
 * Static single-frame promos with no narration read better as text_on_screen → HeyGen no-avatar.
 */
function refineSingleFrameFormatPattern(root: Record<string, unknown>, frameCount: number): void {
  if (frameCount !== 1) return;
  const fp = String(root.format_pattern ?? "").trim();
  if (fp !== "product_demo" && fp !== "mixed") return;

  const vis = asRecord(root.video_visual_system);
  const motion = String(vis?.motion_or_energy ?? "").toLowerCase();
  const spoken = String(root.spoken_hook ?? "").trim();
  const noNarration = !spoken || isSpokenHookPlaceholder(spoken);

  if (noNarration && (motion.includes("static") || motion === "")) {
    root.format_pattern = "text_on_screen";
    root._format_pattern_refined = "single_static_text_card";
  }
}

function sanitizeReplicationBlueprint(root: Record<string, unknown>): void {
  const bp = asRecord(root.replication_blueprint);
  if (!bp) return;

  for (const key of ["legal_ethics", "tooling_notes"] as const) {
    const v = bp[key];
    if (typeof v === "string" && isGibberishInsightText(v)) {
      delete bp[key];
    } else if (Array.isArray(v)) {
      bp[key] = v.filter((item) => typeof item !== "string" || !isGibberishInsightText(item));
    }
  }

  const steps = bp.steps_to_remake;
  if (Array.isArray(steps)) {
    bp.steps_to_remake = steps.filter((item) => typeof item !== "string" || !isGibberishInsightText(item));
  }
}

function sanitizeRootStrings(root: Record<string, unknown>): void {
  for (const key of ROOT_STRING_FIELDS) {
    const v = root[key];
    if (v == null) continue;
    if (typeof v !== "string") {
      root[key] = truncateInsightString(String(v));
      continue;
    }
    if (isGibberishInsightText(v)) {
      delete root[key];
      continue;
    }
    root[key] = truncateInsightString(v);
  }

  const format = normalizeFormatPattern(root.format_pattern);
  if (format) root.format_pattern = format;

  sanitizeReplicationBlueprint(root);
}

function applySingleFrameHonesty(root: Record<string, unknown>, frameCount: number): void {
  if (frameCount !== 1) return;

  for (const key of SINGLE_FRAME_TEMPORAL_FIELDS) {
    root[key] = SINGLE_FRAME_HONEST[key];
  }

  root._inference_limits = {
    single_frame_only: true,
    frame_count: frameCount,
    temporal_fields: "replaced_with_honest_placeholders",
  };
}

export function extractHashtagsFromVideoInsight(
  parsed: Record<string, unknown> | null | undefined,
  captionTranscript = ""
): string | null {
  if (!parsed) return null;
  const chunks: string[] = [captionTranscript];

  if (typeof parsed.on_screen_text_summary === "string") chunks.push(parsed.on_screen_text_summary);
  const frames = Array.isArray(parsed.frames) ? parsed.frames : [];
  for (const raw of frames) {
    const frame = asRecord(raw);
    if (!frame) continue;
    for (const key of ["on_screen_text_transcript", "on_screen_text", "visible_text"] as const) {
      const v = frame[key];
      if (typeof v === "string" && v.trim()) chunks.push(v);
    }
  }

  const tags = new Set<string>();
  const re = /#[\p{L}\p{N}_]+/gu;
  for (const chunk of chunks) {
    for (const match of chunk.matchAll(re)) {
      tags.add(match[0].toLowerCase());
    }
  }

  if (tags.size === 0) return null;
  return [...tags].slice(0, 40).join(" ");
}

export function assessVideoInsightQuality(
  root: Record<string, unknown> | null | undefined,
  opts: { frameCount: number }
): VideoInsightQualityResult {
  const reasons: string[] = [];
  if (!root) {
    return { ok: false, score: 0, reasons: ["empty_payload"] };
  }

  let score = 1;

  const format = pickString(root, "format_pattern");
  const hook = pickString(root, "hook_visual");
  const why = pickString(root, "why_it_worked");
  const message = pickString(root, "message_clarity");
  const summary = pickString(root, "video_as_whole_summary");

  if (!format && !hook) {
    reasons.push("missing_format_and_hook");
    score -= 0.4;
  }
  if (!why && !message && !summary) {
    reasons.push("missing_performance_rationale");
    score -= 0.35;
  }

  for (const key of ROOT_STRING_FIELDS) {
    const v = root[key];
    if (typeof v === "string" && isGibberishInsightText(v)) {
      reasons.push(`gibberish_${key}`);
      score -= 0.5;
    }
  }

  const frames = Array.isArray(root.frames) ? root.frames : [];
  if (opts.frameCount > 0 && frames.length === 0) {
    reasons.push("missing_frames_array");
    score -= 0.12;
  } else if (frames.length > 0 && frames.length !== opts.frameCount) {
    reasons.push("frame_count_mismatch");
    score -= 0.08;
  }

  const hasFatalGibberish = reasons.some((r) => r.startsWith("gibberish_"));
  const ok =
    score >= 0.45 &&
    !hasFatalGibberish &&
    (!!format || !!hook) &&
    (!!why || !!message || !!summary);

  return { ok, score: Math.max(0, Math.min(1, score)), reasons };
}

export function finalizeVideoInsightParsed(
  parsed: Record<string, unknown> | null | undefined,
  opts: FinalizeVideoInsightOptions
): FinalizeVideoInsightResult {
  const normalized = normalizeVideoInsightsLlmJson(parsed);
  if (!normalized) {
    return {
      parsed: null,
      quality: { ok: false, score: 0, reasons: ["normalize_failed"] },
      hashtags: null,
    };
  }

  stripDegenerateRootFields(normalized);
  sanitizeRootStrings(normalized);
  sanitizeWeakSummaries(normalized);
  sanitizeFramesArray(normalized);
  normalized.risk_flags = sanitizeVideoInsightRiskFlags(normalized.risk_flags);
  enrichSpokenHookFromTranscripts(normalized, opts);
  applySingleFrameHonesty(normalized, opts.frameCount);
  refineSingleFrameFormatPattern(normalized, opts.frameCount);
  const pruned = pruneVideoInsightRootForPersist(normalized);

  const quality = assessVideoInsightQuality(pruned, { frameCount: opts.frameCount });
  const hashtags = extractHashtagsFromVideoInsight(pruned, opts.captionTranscript ?? "");

  if (!quality.ok) {
    return { parsed: null, quality, hashtags };
  }

  return { parsed: pruned, quality, hashtags };
}

function looksLikeGarbageVideoPayload(root: Record<string, unknown>): boolean {
  if ("error" in root || "ppcmd" in root || "missing_frame_pattern" in root) return true;
  if ("cmd" in root && !Array.isArray(root.frames)) return true;
  if ("zoom" in root && !Array.isArray(root.frames) && !root.video_arc) return true;
  return false;
}

function normalizeTextDensity(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s === "low" || s === "medium" || s === "high") return s;
  return null;
}

function normalizeFrameRecord(raw: unknown, fallbackIndex: number): Record<string, unknown> | null {
  const f = asRecord(raw);
  if (!f) return null;
  const out: Record<string, unknown> = { ...f };
  const frameIndex = Number(f.frame_index);
  out.frame_index = Number.isFinite(frameIndex) && frameIndex > 0 ? frameIndex : fallbackIndex;

  const shot = pickString(f, "shot_type", "hot_type", "hook_type", "frame_type");
  if (shot) out.shot_type = shot;

  const density = normalizeTextDensity(f.text_density);
  if (density) out.text_density = density;

  if (!out.on_screen_text_transcript) {
    const alt = pickString(f, "on_screen_text", "text_transcript", "ocr_text", "visible_text");
    if (alt) out.on_screen_text_transcript = alt;
  }

  if (f.composition_blueprint != null) {
    const cleaned = sanitizeCompositionBlueprint(f.composition_blueprint);
    if (cleaned) out.composition_blueprint = cleaned;
    else delete out.composition_blueprint;
  }

  return out;
}

function collectFrames(root: Record<string, unknown>): unknown[] {
  const direct = root.frames ?? root.frame_analysis ?? root.frame;
  if (Array.isArray(direct)) return direct;

  for (const wrap of WRAPPER_KEYS) {
    const inner = asRecord(root[wrap]);
    if (!inner) continue;
    const nested = inner.frames ?? inner.frame_analysis ?? inner.frame;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function unwrapRoot(parsed: Record<string, unknown>): Record<string, unknown> {
  let root: Record<string, unknown> = { ...parsed };

  mergeInstructionsWrapper(root);

  for (const wrap of WRAPPER_KEYS) {
    const inner = asRecord(root[wrap]);
    if (!inner) continue;
    mergeInstructionsWrapper(inner);
    const merged: Record<string, unknown> = { ...root, ...inner };
    delete merged[wrap];
    root = merged;
  }

  mergeInstructionsWrapper(root);
  aliasVisualSystemFields(root);

  return root;
}

function applyAliases(root: Record<string, unknown>): void {
  if (!pickString(root, "format_pattern")) {
    const hook = pickString(root, "hook_type", "video_format", "format");
    if (hook) root.format_pattern = hook;
  }
  if (!pickString(root, "why_it_worked")) {
    const why = pickString(root, "performance_reason", "summary", "why_it_performed");
    if (why) root.why_it_worked = why;
  }
  if (!pickString(root, "spoken_hook")) {
    const hook = pickString(root, "hook", "opening_hook", "hook_text");
    if (hook) root.spoken_hook = hook;
  }
  if (!pickString(root, "video_arc")) {
    const arc = pickString(root, "narrative_arc", "story_arc");
    if (arc) root.video_arc = arc;
  }
}

export function normalizeVideoInsightsLlmJson(
  parsed: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!parsed) return null;

  let root = unwrapRoot(parsed);
  if (looksLikeGarbageVideoPayload(root)) {
    const salvaged = pickString(root, "video_arc") ?? pickString(root, "why_it_worked");
    if (!salvaged) return null;
    root = {
      video_arc: root.video_arc,
      why_it_worked: root.why_it_worked,
      format_pattern: root.format_pattern,
      cta_clarity: root.cta_clarity,
      risk_flags: root.risk_flags ?? [],
    };
  }

  applyAliases(root);

  const framesRaw = collectFrames(root);
  if (framesRaw.length > 0) {
    root.frames = framesRaw
      .map((raw, i) => normalizeFrameRecord(raw, i + 1))
      .filter((f): f is Record<string, unknown> => f != null);
  }

  if (!Array.isArray(root.risk_flags)) {
    const risks = root.risk_flags ?? root.risks;
    root.risk_flags = Array.isArray(risks) ? risks : [];
  }

  if (root.video_composition_system != null) {
    const sys = asRecord(root.video_composition_system);
    if (!sys) {
      delete root.video_composition_system;
    } else {
      const out: Record<string, unknown> = {};
      const recurring = pickString(sys, "recurring_layout_pattern");
      if (recurring) out.recurring_layout_pattern = truncateInsightString(recurring, 700);
      const safe = pickString(sys, "safe_margin_pattern");
      if (safe) out.safe_margin_pattern = truncateInsightString(safe, 500);
      const hier = pickString(sys, "visual_hierarchy_pattern");
      if (hier) out.visual_hierarchy_pattern = truncateInsightString(hier, 500);
      const rep = sys.repeated_element_positions;
      if (Array.isArray(rep)) {
        const items = rep.map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
        if (items.length > 0) out.repeated_element_positions = items;
      }
      if (Object.keys(out).length > 0) root.video_composition_system = out;
      else delete root.video_composition_system;
    }
  }

  for (const key of ROOT_STRING_FIELDS) {
    const v = root[key];
    if (v != null && typeof v !== "string") {
      root[key] = String(v);
    }
  }

  aliasVisualSystemFields(root);
  const format = normalizeFormatPattern(root.format_pattern);
  if (format) root.format_pattern = format;

  return root;
}

export function mergeVideoInsightChunks(chunks: Array<Record<string, unknown> | null>): Record<string, unknown> {
  const normalized = chunks
    .map((c) => normalizeVideoInsightsLlmJson(c))
    .filter((c): c is Record<string, unknown> => c != null);

  if (normalized.length === 0) return {};

  const merged: Record<string, unknown> = { ...normalized[0] };
  const frames: Record<string, unknown>[] = [];

  for (const part of normalized) {
    const partFrames = Array.isArray(part.frames) ? part.frames : [];
    for (const raw of partFrames) {
      const frame = normalizeFrameRecord(raw, frames.length + 1);
      if (frame) frames.push(frame);
    }
  }

  if (frames.length > 0) {
    frames.sort((a, b) => Number(a.frame_index) - Number(b.frame_index));
    merged.frames = frames;
  }

  return normalizeVideoInsightsLlmJson(merged) ?? merged;
}

export const TOP_PERFORMER_VIDEO_NVIDIA_JSON_APPENDIX = `

NVIDIA / Nemotron — strict output contract:
- Return ONE flat JSON object at the root. Never nest under "video_wide", "video_wide_summary", "analysis", or "result".
- Required root strings: hook_visual, message_clarity, video_arc, on_screen_text_summary, cta_clarity, format_pattern, why_it_worked
- Required root arrays: risk_flags (use [] when none), frames (one object per attached frame image)
- Each frames[] entry MUST include frame_index, on_screen_text_transcript, visual_description, layout_template, typography, color_tokens, shot_type, text_density
- Each frames[] entry MUST also include composition_blueprint (compact, model-neutral, for regeneration):
  - composition_blueprint.canvas_description
  - composition_blueprint.layout_structure
  - composition_blueprint.visual_hierarchy
  - composition_blueprint.elements[] (element_id, element_type, description, bbox_pct [x,y,w,h] in 0-100, anchor, layer_order, prominence, style_notes, position_confidence low|medium|high)
  - composition_blueprint.text_blocks[] (role, text, bbox_pct, alignment, typography_notes, position_confidence)
  - composition_blueprint.background
  - composition_blueprint.spacing_notes
  - composition_blueprint.qwen_prompt_notes
- format_pattern MUST be one of: talking_head, b_roll, text_on_screen, ugc, product_demo, mixed, unknown
- When only ONE frame is attached: do NOT invent cuts, body frames, or motion. State honestly that progression is not observable.
- Never emit extra research/meta keys (e.g. research_questions, concrete_examples, alternative_tsla_*, actual, angles, chains, backup, image_history, llm_token, framework_selector).`;

export const TOP_PERFORMER_VIDEO_SINGLE_FRAME_USER_APPENDIX = `

Single-frame sample (1 attachment only):
- Describe only what is visible in this still.
- Do NOT claim later body frames, cuts, escalation, or multi-scene arcs.
- For video_arc, opening_vs_body, and pacing_notes: say the clip progression cannot be inferred from one still.`;

export const TOP_PERFORMER_VIDEO_FRAMES_CHUNK_PROMPT = `You analyze a subset of frames from a larger short-form video.

Return ONLY flat JSON (no wrappers):
{
  "frames": [
    {
      "frame_index": <global index from user message>,
      "timestamp_sec": <seconds if known>,
      "on_screen_text_transcript": "...",
      "visual_description": "...",
      "layout_template": "...",
      "composition_blueprint": {
        "canvas_description": "short, include aspect + orientation if inferable",
        "layout_structure": "short: e.g. top captions, central subject, lower thirds",
        "visual_hierarchy": "what draws attention first → last",
        "elements": [
          {
            "element_id": "caption_1",
            "element_type": "headline | body_text | cta | logo | person | product | background | shape | icon | screenshot | decorative_element | other",
            "description": "what it is",
            "bbox_pct": [10, 12, 80, 18],
            "anchor": "top_left | top_center | top_right | center_left | center | center_right | bottom_left | bottom_center | bottom_right",
            "layer_order": 3,
            "prominence": "primary | secondary | tertiary | background",
            "style_notes": "optional",
            "position_confidence": "low | medium | high"
          }
        ],
        "text_blocks": [
          {
            "role": "headline | subheadline | body | cta | logo | other",
            "text": "visible line",
            "bbox_pct": [10, 12, 80, 18],
            "alignment": "left | center | right",
            "typography_notes": "optional",
            "position_confidence": "low | medium | high"
          }
        ],
        "background": "short",
        "spacing_notes": "short, include safe margins",
        "qwen_prompt_notes": "Preserve spatial layout + relative positions; use reference image for composition, not copyrighted details."
      },
      "typography": { "headline_guess": "...", "body_guess": "...", "hierarchy": "..." },
      "color_tokens": { "background": "...", "primary_text": "...", "accent": [] },
      "shot_type": "...",
      "text_density": "low | medium | high"
    }
  ]
}

frames.length MUST equal the number of frame image attachments. frame_index values MUST match the global indices in the user message.`;
