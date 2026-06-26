/**

 * Human-facing flow labels for jobs that replicate top-performer references ("mimic" lanes).

 * Canonical `flow_type` stays unchanged for prompts, filters, and joins.

 */

import { CANONICAL_FLOW_TYPES } from "./canonical-flow-types.js";

import { MIMIC_BFL_MODEL_FLEX, MIMIC_BFL_MODEL_KLEIN_4B } from "./mimic-bfl-model.js";

import { groundingInsightIdsFromCandidate } from "./mimic-job-grounding.js";

import { pickMimicPayload } from "./mimic-payload.js";

import {

  parseMimicImageInputMode,

  type MimicImageInputMode,

  type MimicRenderSettingsSnapshot,

} from "./mimic-render-settings.js";

import type { VideoPipelineIntent } from "../decision_engine/video-flow-routing.js";

import {

  FLOW_TOP_PERFORMER_MIMIC_VIDEO,

  isTopPerformerMimicCarouselFlow,

  isTopPerformerMimicFlow,

  isTopPerformerMimicImageFlow,

  isTpGroundedCarouselRenderFlow,

  isVisualFirstCarouselFlow,

  isWhyMimicCarouselFlow,

} from "./top-performer-mimic-flow-types.js";

import {

  TOP_PERFORMER_MIMIC_VIDEO_HEYGEN_FLOWS,

  heygenLaneLabelForIntent,

} from "./top-performer-video-heygen-routing.js";



export type MimicReplicationKind = "image" | "carousel" | "video" | "why_carousel";



export interface JobFlowDisplayInfo {

  /** Canonical execution flow (unchanged). */

  flow_type: string;

  /** Human label — mimic lane + render path (full-bleed, ref edit vs text prompt, etc.). */

  flow_label: string;

  /** Operator subtitle — model, similarity %, text overlay mode, provider. */

  flow_detail: string | null;

  is_mimic_replication: boolean;

  mimic_kind: MimicReplicationKind | null;

}



function asRecord(v: unknown): Record<string, unknown> | null {

  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;

  return null;

}



function str(v: unknown): string {

  return typeof v === "string" ? v.trim() : "";

}



function mimicKindLabel(kind: MimicReplicationKind): string {

  switch (kind) {

    case "image":

      return "Mimic · Image";

    case "carousel":

      return "Reference Replica";

    case "why_carousel":

      return "Why Mimic";

    case "video":

      return "Mimic · Video";

  }

}



type CarouselRenderStyle = "visual" | "listicle";



/** Render style from `mimic_v1.mode` — surfaced in flow labels and content log. */

export function carouselRenderStyleFromMimicPayload(

  generationPayload?: unknown

): CarouselRenderStyle | null {

  const gp = asRecord(generationPayload);

  const mimic = asRecord(gp?.mimic_v1);

  if (!mimic) return null;

  const mode = str(mimic.mode);

  if (mode === "template_bg") return "listicle";

  if (mode === "carousel_visual") return "visual";

  return null;

}



function mimicV1FromPayload(gp: Record<string, unknown>): Record<string, unknown> | null {

  return asRecord(gp.mimic_v1) ?? asRecord(pickMimicPayload(gp));

}



function renderSettingsFromPayload(gp: Record<string, unknown>): MimicRenderSettingsSnapshot | null {

  const raw = asRecord(gp.mimic_render_settings);

  if (!raw || raw.schema_version !== 1) return null;

  const imageInputMode = parseMimicImageInputMode(raw.image_input_mode);

  if (!imageInputMode) return null;

  const pct = Number(raw.visual_similarity_pct);

  return {

    schema_version: 1,

    image_provider: str(raw.image_provider) || "bfl",

    bfl_model: str(raw.bfl_model) || MIMIC_BFL_MODEL_KLEIN_4B,

    visual_similarity_pct: Number.isFinite(pct) ? Math.round(pct) : 70,

    image_input_mode: imageInputMode,

    carousel_text_via_flux: raw.carousel_text_via_flux === true,

    why_mimic_copy_enabled: raw.why_mimic_copy_enabled === true,

  };

}



function dominantImageInputMode(

  gp: Record<string, unknown>,

  mimic: Record<string, unknown> | null

): MimicImageInputMode | null {

  const fromSettings = renderSettingsFromPayload(gp)?.image_input_mode;

  if (fromSettings) return fromSettings;



  const prompts = asRecord(mimic?.flux_image_prompts);

  if (prompts) {

    let refEdit = 0;

    let t2i = 0;

    for (const row of Object.values(prompts)) {

      const rec = asRecord(row);

      const mode = parseMimicImageInputMode(rec?.image_input_mode);

      if (mode === "analysis_t2i") t2i += 1;

      else if (mode === "reference_edit") refEdit += 1;

    }

    if (t2i > 0 && refEdit === 0) return "analysis_t2i";

    if (refEdit > 0 && t2i === 0) return "reference_edit";

    if (t2i > refEdit) return "analysis_t2i";

    if (refEdit > 0) return "reference_edit";

  }



  if (str(mimic?.execution_mode) === "why_mimic") return "analysis_t2i";

  return null;

}



function imageInputPathSuffix(mode: MimicImageInputMode | null): string {

  if (mode === "analysis_t2i") return " · Text prompt";

  if (mode === "reference_edit") return " · Ref edit";

  return "";

}



function isFullBleedMimic(mimic: Record<string, unknown> | null, style: CarouselRenderStyle | null): boolean {

  if (!mimic) return style === "visual";

  const mode = str(mimic.mode);

  if (mode === "image_full" || mode === "carousel_visual") return true;

  if (mode === "template_bg") return false;

  const plans = Array.isArray(mimic.slide_plans) ? mimic.slide_plans : [];

  if (plans.length === 0) return style === "visual";

  let fullBleed = 0;

  let hbs = 0;

  for (const p of plans) {

    const rec = asRecord(p);

    if (str(rec?.render_mode) === "full_bleed") fullBleed += 1;

    else if (str(rec?.render_mode) === "hbs") hbs += 1;

  }

  if (fullBleed > 0 && hbs === 0) return true;

  if (hbs > 0 && fullBleed === 0) return false;

  return style === "visual";

}



function renderPathSuffix(

  mimic: Record<string, unknown> | null,

  style: CarouselRenderStyle | null

): string {

  if (isFullBleedMimic(mimic, style)) return " · Full-bleed";

  if (style === "listicle" || str(mimic?.mode) === "template_bg") return " · Listicle";

  return "";

}



function bflModelDisplayLabel(slug: string): string {

  const s = slug.trim().toLowerCase();

  if (s === MIMIC_BFL_MODEL_FLEX) return "FLUX Flex";

  if (s === MIMIC_BFL_MODEL_KLEIN_4B) return "FLUX Klein 4b";

  return slug.trim() || "FLUX";

}



function imageProviderDisplayLabel(provider: string): string {

  switch (provider.trim().toLowerCase()) {

    case "bfl":

      return "BFL";

    case "openai":

      return "OpenAI";

    case "nvidia":

      return "NVIDIA NIM";

    case "dashscope":

      return "DashScope";

    default:

      return provider.trim() || "Image model";

  }

}



function visualSimilarityPct(gp: Record<string, unknown>, settings: MimicRenderSettingsSnapshot | null): number | null {

  if (settings?.visual_similarity_pct != null) return settings.visual_similarity_pct;

  const ctx = asRecord(gp.mimic_render_context);

  const fromCtx = Number(ctx?.visual_similarity_pct);

  if (Number.isFinite(fromCtx)) return Math.round(fromCtx);

  return null;

}



function buildMimicFlowDetail(gp: Record<string, unknown>, mimic: Record<string, unknown> | null): string | null {

  if (!mimic) return null;

  const settings = renderSettingsFromPayload(gp);

  const parts: string[] = [];



  const provider = settings?.image_provider ?? "bfl";

  const providerLabel = imageProviderDisplayLabel(provider);

  if (provider === "bfl") {

    parts.push(bflModelDisplayLabel(settings?.bfl_model ?? MIMIC_BFL_MODEL_KLEIN_4B));

  } else {

    parts.push(providerLabel);

  }



  const sim = visualSimilarityPct(gp, settings);

  if (sim != null) parts.push(`${sim}% similarity`);



  const inputMode = dominantImageInputMode(gp, mimic);

  if (inputMode === "reference_edit") parts.push("reference image edit");

  else if (inputMode === "analysis_t2i") parts.push("text-to-image prompts");



  const textViaFlux = settings?.carousel_text_via_flux === true;

  parts.push(textViaFlux ? "Flux on-image text" : "DocAI / HTML overlay");



  if (settings?.why_mimic_copy_enabled || str(mimic.execution_mode) === "why_mimic") {

    parts.push("Why copy guidance");

  }



  return parts.length > 0 ? parts.join(" · ") : null;

}



function tpGroundedCarouselLaneLabel(

  flowType: string,

  mimicKind: MimicReplicationKind | null

): string {

  if (isVisualFirstCarouselFlow(flowType)) return "Visual-First";

  if (isWhyMimicCarouselFlow(flowType) || mimicKind === "why_carousel") return "Why Mimic";

  if (isTopPerformerMimicCarouselFlow(flowType) || mimicKind === "carousel") {

    return "Reference Replica";

  }

  return "Reference Replica";

}



function isTpGroundedCarouselLane(flowType: string, mimicKind: MimicReplicationKind | null): boolean {

  return (

    isVisualFirstCarouselFlow(flowType) ||

    isWhyMimicCarouselFlow(flowType) ||

    isTopPerformerMimicCarouselFlow(flowType) ||

    mimicKind === "why_carousel" ||

    (mimicKind === "carousel" && isTpGroundedCarouselRenderFlow(flowType))

  );

}



function mimicKindFromGroundingIds(ids: string[]): MimicReplicationKind | null {

  if (ids.some((id) => /_vdeep$/i.test(id))) return "video";

  if (ids.some((id) => /_(?:cdeep|broad)$/i.test(id))) return "carousel";

  return null;

}



function mimicKindFromCandidate(candidate: Record<string, unknown> | null): MimicReplicationKind | null {

  if (!candidate) return null;

  const kind = str(candidate.mimic_kind).toLowerCase();

  if (kind === "image" || kind === "carousel" || kind === "video" || kind === "why_carousel") return kind;



  const target = str(candidate.target_flow_type);

  if (isWhyMimicCarouselFlow(target)) return "why_carousel";

  if (isTopPerformerMimicImageFlow(target)) return "image";

  if (isTpGroundedCarouselRenderFlow(target)) return "carousel";

  if (target === FLOW_TOP_PERFORMER_MIMIC_VIDEO) return "video";



  const cid = str(candidate.candidate_id ?? candidate.idea_id ?? candidate.id);

  if (!cid.startsWith("mimic_")) return null;



  const fmt = str(candidate.format).toLowerCase();

  if (fmt === "video") return "video";

  if (fmt === "carousel") return "carousel";

  if (fmt === "post") return "image";

  return null;

}



function isHeygenMimicVideoFlow(flowType: string): boolean {

  return (TOP_PERFORMER_MIMIC_VIDEO_HEYGEN_FLOWS as readonly string[]).includes(flowType);

}



function heygenSubLabel(flowType: string, candidate: Record<string, unknown> | null): string {

  const style = str(candidate?.video_style) as VideoPipelineIntent;

  if (style === "script_avatar" || style === "prompt_avatar" || style === "no_avatar") {

    return heygenLaneLabelForIntent(style);

  }

  if (flowType === CANONICAL_FLOW_TYPES.VID_SCRIPT) return heygenLaneLabelForIntent("script_avatar");

  if (flowType === CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR) {

    return heygenLaneLabelForIntent("no_avatar");

  }

  if (flowType === CANONICAL_FLOW_TYPES.VID_PROMPT) return heygenLaneLabelForIntent("prompt_avatar");

  return "HeyGen";

}



function isMimicReplicationJob(

  flowType: string,

  gp: Record<string, unknown>,

  candidate: Record<string, unknown> | null

): boolean {

  if (isTopPerformerMimicFlow(flowType) || isVisualFirstCarouselFlow(flowType)) return true;

  if (isTpGroundedCarouselRenderFlow(flowType) || isTopPerformerMimicImageFlow(flowType)) return true;

  if (pickMimicPayload(gp)) return true;

  if (asRecord(gp.mimic_job_grounding)) return true;

  if (candidate?.manual_mimic_pick === true) return true;

  if (mimicKindFromCandidate(candidate)) return true;

  if (groundingInsightIdsFromCandidate(candidate).length > 0 && isHeygenMimicVideoFlow(flowType)) {

    return true;

  }

  return false;

}



function resolveMimicKind(

  flowType: string,

  candidate: Record<string, unknown> | null,

  isMimic: boolean

): MimicReplicationKind | null {

  const fromCandidate = mimicKindFromCandidate(candidate);

  if (fromCandidate) return fromCandidate;

  const fromGrounding = mimicKindFromGroundingIds(groundingInsightIdsFromCandidate(candidate));

  if (fromGrounding) return fromGrounding;

  if (!isMimic) return null;

  if (isTopPerformerMimicImageFlow(flowType)) return "image";

  if (isWhyMimicCarouselFlow(flowType)) return "why_carousel";

  if (isVisualFirstCarouselFlow(flowType) || isTopPerformerMimicCarouselFlow(flowType)) {

    return "carousel";

  }

  if (isTpGroundedCarouselRenderFlow(flowType)) return "carousel";

  if (isHeygenMimicVideoFlow(flowType) || flowType === FLOW_TOP_PERFORMER_MIMIC_VIDEO) return "video";

  return null;

}



function buildTpGroundedCarouselLabel(

  flowType: string,

  mimicKind: MimicReplicationKind | null,

  gp: Record<string, unknown>

): { flow_label: string; flow_detail: string | null } {

  const mimic = mimicV1FromPayload(gp);

  const style = carouselRenderStyleFromMimicPayload(gp);

  const lane = tpGroundedCarouselLaneLabel(flowType, mimicKind);

  const path = renderPathSuffix(mimic, style);

  const input = imageInputPathSuffix(dominantImageInputMode(gp, mimic));

  const flow_label = `${lane} · Carousel${path}${input}`;

  return { flow_label, flow_detail: buildMimicFlowDetail(gp, mimic) };

}



function buildImageMimicLabel(gp: Record<string, unknown>): { flow_label: string; flow_detail: string | null } {

  const mimic = mimicV1FromPayload(gp);

  const path = renderPathSuffix(mimic, carouselRenderStyleFromMimicPayload(gp));

  const input = imageInputPathSuffix(dominantImageInputMode(gp, mimic) ?? "reference_edit");

  return {

    flow_label: `Mimic · Image${path}${input}`,

    flow_detail: buildMimicFlowDetail(gp, mimic),

  };

}



export function resolveJobFlowDisplayLabel(

  flowTypeRaw: string | null | undefined,

  generationPayload?: unknown

): JobFlowDisplayInfo {

  const flow_type = str(flowTypeRaw) || "UNKNOWN";

  const gp = asRecord(generationPayload) ?? {};

  const candidate = asRecord(gp.candidate_data);

  const is_mimic_replication = isMimicReplicationJob(flow_type, gp, candidate);

  const mimic_kind = resolveMimicKind(flow_type, candidate, is_mimic_replication);



  if (!is_mimic_replication) {

    return {

      flow_type,

      flow_label: flow_type,

      flow_detail: null,

      is_mimic_replication: false,

      mimic_kind: null,

    };

  }



  let flow_label: string;

  let flow_detail: string | null = null;



  if (isTpGroundedCarouselLane(flow_type, mimic_kind)) {

    const built = buildTpGroundedCarouselLabel(flow_type, mimic_kind, gp);

    flow_label = built.flow_label;

    flow_detail = built.flow_detail;

  } else if (mimic_kind === "image" || isTopPerformerMimicImageFlow(flow_type)) {

    const built = buildImageMimicLabel(gp);

    flow_label = built.flow_label;

    flow_detail = built.flow_detail;

  } else if (mimic_kind === "carousel" && isHeygenMimicVideoFlow(flow_type)) {

    flow_label = `Mimic · Carousel ref → ${heygenSubLabel(flow_type, candidate)}`;

  } else if (mimic_kind === "video" && isHeygenMimicVideoFlow(flow_type)) {

    flow_label = `${mimicKindLabel("video")} → ${heygenSubLabel(flow_type, candidate)}`;

    flow_detail = heygenSubLabel(flow_type, candidate);

  } else if (mimic_kind) {

    flow_label = mimicKindLabel(mimic_kind);

  } else if (flow_type === FLOW_TOP_PERFORMER_MIMIC_VIDEO) {

    flow_label = mimicKindLabel("video");

  } else {

    flow_label = `Mimic · ${flow_type.replace(/^FLOW_/, "").replace(/_/g, " ")}`;

  }



  return { flow_type, flow_label, flow_detail, is_mimic_replication: true, mimic_kind };

}


