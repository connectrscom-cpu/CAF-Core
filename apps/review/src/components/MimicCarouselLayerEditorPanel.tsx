"use client";



import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MimicDocAiLayerPositionEditor,
  openHighlightBoxForText,
  type DocAiLayerBox,

  type DocAiLayerOverride,

  type DocAiLayerTypographyStyle,
  type DocAiLayerPlacementStyle,

} from "@/components/MimicDocAiLayerPositionEditor";

import {
  formatMimicTextBackingBackground,
  mimicTextBackingColorToHex,
} from "@caf-core-carousel/mimic-slide-typography";
import { refKeyFromLayerPositionKey } from "@caf-core-carousel/mimic-docai-layer-positions";
import {
  templateBgSlideIndicesForSlot,
  templateBgSlotForSlide,
  type MimicTemplateBgSlot,
} from "@/lib/mimic-template-bg";
import { registerReviewBackgroundJob } from "@/lib/review-background-jobs";
import type { BrandSlideFrameOption } from "@/lib/brand-asset-url";
import { BvsInfluencePanel } from "@/components/BvsInfluencePanel";
import { MimicSlideWhyPanel } from "@/components/MimicSlideWhyPanel";
import { NewVisualSlideWhyPanel } from "@/components/NewVisualSlideWhyPanel";
import { hasSlideIntelligenceBundle, isNewVisualCarouselMimic } from "@/lib/new-visual-slide-why";
import {
  clusterIndexForOcrBoxIndex,
  ocrBoxSpanForClusterIndex,
  slideRecordForCopySlots,
} from "@/lib/carousel-slides";
import {
  copySlotsForSlideRecord,
  splitLineForRefBlocks,
  type MimicReferenceCopySlot,
} from "@caf-core-carousel/mimic-copy-slots";

const LAYER_PERSIST_TIMEOUT_MS = 45_000;
const DECK_PERSIST_TIMEOUT_MS = 120_000;
const INSPECT_FETCH_TIMEOUT_MS = 30_000;
const DECK_INSPECT_FETCH_TIMEOUT_MS = 90_000;
const DECK_PERSIST_CONCURRENCY = 4;

type PersistAllSlideDraftsResult = {
  savedCount: number;
  failedSlides: number[];
};

async function runTasksWithConcurrency<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workerCount = Math.min(Math.max(1, concurrency), queue.length || 1);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) break;
        await run(item);
      }
    })
  );
}

function isDraftHiddenForLayer(
  layerKey: string,
  draftByKey: Map<string, DocAiLayerOverride>
): boolean {
  if (draftByKey.get(layerKey)?.hidden) return true;
  const refKey = refKeyFromLayerPositionKey(layerKey);
  if (refKey !== layerKey && draftByKey.get(refKey)?.hidden) return true;
  return false;
}

function looksLikeHandleText(text: string): boolean {
  return /^@[a-z0-9_.]{2,}$/i.test(text.trim());
}

function layoutRoleMatchesField(layerRole: string, fieldRole: string): boolean {
  const lr = layerRole.toLowerCase();
  const fr = fieldRole.toLowerCase();
  if (lr === fr) return true;
  if (fr === "headline" && ["headline", "title", "hook", "subheadline"].includes(lr)) return true;
  if (fr === "body" && ["body", "subtitle", "caption"].includes(lr)) return true;
  if (fr === "handle" && ["handle", "watermark"].includes(lr)) return true;
  return false;
}

function roleFromLayerKey(layerKey: string): string {
  if (layerKey.startsWith("custom@")) {
    return (layerKey.split("@")[1] ?? "body").trim().toLowerCase();
  }
  const at = layerKey.indexOf("@");
  if (at <= 0) return "body";
  return layerKey.slice(0, at).toLowerCase();
}

function inferDocAiLayerRole(
  layer: DocAiLayerBox,
  row: DocAiLayerOverride | undefined,
  fullBleed: boolean,
  templateBg = false
): string {
  const ocrRole = (layer.role ?? "").trim().toLowerCase();
  if (templateBg) {
    if (ocrRole === "handle") return "handle";
    if (ocrRole === "headline" || ocrRole === "title" || ocrRole === "hook" || ocrRole === "subheadline") {
      return "headline";
    }
    if (ocrRole === "body" || ocrRole === "subtitle" || ocrRole === "caption") return "body";
  }
  const text = (row?.text ?? layer.text ?? "").trim();
  if (looksLikeHandleText(text)) return "handle";
  if (layer.role === "handle" || layer.layer_key?.includes("handle")) return "handle";
  if (fullBleed) return "body";
  return layer.role || "body";
}

/** Role for placement/copy sync — prefer stable layer_key + copy-slot field over OCR heuristics. */
function layoutRoleForLayer(
  layer: Pick<DocAiLayerBox, "layer_key" | "role" | "text">,
  row: DocAiLayerOverride | undefined,
  fullBleedMode: boolean,
  templateBgMode: boolean,
  slideSlots?: MimicReferenceCopySlot[]
): string {
  if (isCopySlotEditorLayerKey(layer.layer_key) && slideSlots?.length) {
    const field = copySlotLlmFieldForLayerKey(layer.layer_key, slideSlots);
    if (field) return field;
  }
  if (layer.layer_key.startsWith("custom@")) {
    return roleFromLayerKey(layer.layer_key);
  }
  const fromKey = roleFromLayerKey(layer.layer_key);
  if (templateBgMode) return fromKey;
  if (fromKey !== "body" && fromKey !== "slot") return fromKey;
  return inferDocAiLayerRole(layer as DocAiLayerBox, row, fullBleedMode, templateBgMode);
}

function templateBgFieldRoleForLayer(
  layer: Pick<DocAiLayerBox, "layer_key" | "role" | "text">,
  row: DocAiLayerOverride | undefined,
  templateBgFieldRoles: string[],
  fullBleedMode: boolean,
  templateBgMode: boolean
): string | undefined {
  const role = layoutRoleForLayer(layer, row, fullBleedMode, templateBgMode);
  return templateBgFieldRoles.find((fr) => layoutRoleMatchesField(role, fr));
}

function isPlaceholderCustomLayer(layer: DocAiLayerBox, row: DocAiLayerOverride | undefined): boolean {
  if (!layer.layer_key?.startsWith("custom@")) return false;
  const text = (row?.text ?? layer.text ?? "").trim();
  return !text || text === "New text";
}

/** Drop empty reviewer-added boxes — they must not persist, inspect, or duplicate OCR slots. */
function dropPlaceholderCustomOverrides(rows: DocAiLayerOverride[]): DocAiLayerOverride[] {
  return rows.filter((row) => {
    if (!row.layer_key.startsWith("custom@")) return true;
    if (row.hidden) return true;
    const text = row.text?.trim();
    return Boolean(text && text !== "New text");
  });
}

/** Legacy inspect echoed custom copy under body@x,y:text keys — skip when a custom@ draft matches. */
function isLegacyInspectEchoOfCustomDraft(
  inspectLayer: DocAiLayerBox,
  draftRow: DocAiLayerOverride
): boolean {
  if (inspectLayer.layer_key.startsWith("custom@")) return false;
  const inspectText = (inspectLayer.text ?? "").trim();
  const draftText = (draftRow.text ?? "").trim();
  if (!inspectText || !draftText || inspectText !== draftText) return false;
  return (
    Math.abs(inspectLayer.x_px - draftRow.x_px) <= 32 &&
    Math.abs(inspectLayer.y_px - draftRow.y_px) <= 32
  );
}

function normalizePhraseKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Apply saved reviewer geometry onto inspect OCR boxes (template_bg + full-bleed). */
function applyLayerDraftGeometryToBoxes(
  boxes: DocAiLayerBox[],
  draft: DocAiLayerOverride[]
): DocAiLayerBox[] {
  if (draft.length === 0) return boxes;
  const byKey = new Map(draft.map((row) => [row.layer_key, row]));
  const byRefKey = new Map(draft.map((row) => [refKeyFromLayerPositionKey(row.layer_key), row]));
  return boxes.map((layer) => {
    const row =
      byKey.get(layer.layer_key) ??
      byRefKey.get(refKeyFromLayerPositionKey(layer.layer_key));
    if (!row || row.hidden) return layer;
    return {
      ...layer,
      x_px: row.x_px,
      y_px: row.y_px,
      ...(row.w_px != null && row.w_px > 0 ? { w_px: row.w_px } : {}),
      ...(row.h_px != null && row.h_px > 0 ? { h_px: row.h_px } : {}),
      ...(row.font_size_px != null && row.font_size_px > 0 ? { font_size_px: row.font_size_px } : {}),
    };
  });
}

/** Listicle slot field roles per slide (cover / body / CTA) — stable without slide copy. */
function templateBgEditorFieldRolesForSlideIndex(slideIndex1Based: number, slideCount: number): string[] {
  const slot = templateBgSlotForSlide(slideIndex1Based, slideCount);
  if (slot === "cover") return ["headline", "body"];
  if (slot === "cta") return slideCount > 2 ? ["headline", "body", "handle"] : ["headline", "handle"];
  return ["headline", "body"];
}

function templateBgDeckApplyScopeLabel(sourceSlot: MimicTemplateBgSlot, slideCount: number): string {
  const count = templateBgSlideIndicesForSlot(sourceSlot, slideCount).length;
  if (sourceSlot === "cover") return "cover slide";
  if (sourceSlot === "cta") return count === 1 ? "CTA slide" : `${count} CTA slides`;
  return `${count} middle slide${count === 1 ? "" : "s"}`;
}

/** Reuse inspect OCR boxes from another slide in the same slot when this slide was never opened. */
function resolveTemplateBgInspectJsonForDeckApply(
  slideIndex1Based: number,
  slideCount: number,
  editorSlide: number,
  inspectCache: Record<number, Record<string, unknown>>
): Record<string, unknown> | null {
  const direct = inspectCache[slideIndex1Based];
  if (direct) return direct;
  const slot = templateBgSlotForSlide(slideIndex1Based, slideCount);
  for (const anchor of templateBgSlideIndicesForSlot(slot, slideCount)) {
    if (inspectCache[anchor]) return inspectCache[anchor]!;
  }
  return inspectCache[editorSlide] ?? null;
}

function docAiLayerMatchesTargetRole(
  layer: Pick<DocAiLayerBox, "layer_key" | "role" | "text">,
  row: DocAiLayerOverride | undefined,
  targetRole: "headline" | "body",
  fieldRoles: string[],
  fullBleedMode: boolean,
  templateBgMode: boolean
): boolean {
  const mapped = templateBgFieldRoleForLayer(layer, row, fieldRoles, fullBleedMode, templateBgMode);
  if (mapped && layoutRoleMatchesField(mapped, targetRole)) return true;
  const role = layoutRoleForLayer(layer, row, fullBleedMode, templateBgMode);
  return layoutRoleMatchesField(role, targetRole);
}

function draftRowMatchesTargetRole(
  row: DocAiLayerOverride,
  targetRole: "headline" | "body",
  fieldRoles: string[],
  fullBleedMode: boolean,
  templateBgMode: boolean
): boolean {
  const pseudoLayer: DocAiLayerBox = {
    layer_key: row.layer_key,
    text: row.text ?? "",
    role: roleFromLayerKey(row.layer_key),
    x_px: row.x_px,
    y_px: row.y_px,
    w_px: row.w_px ?? 280,
    h_px: row.h_px ?? 72,
  };
  return docAiLayerMatchesTargetRole(pseudoLayer, row, targetRole, fieldRoles, fullBleedMode, templateBgMode);
}

function combinedLayoutPatchFromRow(
  row: DocAiLayerOverride,
  layer: DocAiLayerBox | null
): Partial<DocAiLayerOverride> {
  return {
    x_px: row.x_px,
    y_px: row.y_px,
    w_px: row.w_px ?? layer?.w_px ?? 280,
    h_px: row.h_px ?? layer?.h_px ?? 72,
    font_size_px: row.font_size_px ?? layer?.font_size_px ?? 45,
    font_weight: row.font_weight ?? layer?.font_weight ?? 700,
    color_hex: row.color_hex ?? layer?.color_hex ?? "#111111",
    ...(row.font_family || layer?.font_family
      ? { font_family: row.font_family ?? layer?.font_family }
      : {}),
    ...(row.font_style_italic ? { font_style_italic: true } : {}),
    box_locked: true,
  };
}

function shouldRefitHeadlineOnDeckApply(successLabel: string): boolean {
  return successLabel === "typography" || successLabel === "box placement" || successLabel === "layout";
}

function shouldRefitBodyHeightOnDeckApply(successLabel: string): boolean {
  return successLabel === "layout";
}

/** After deck apply, size each slide's box to its own copy (headlines stay single-line when short). */
function refitDeckApplyRowToSlideCopy(
  row: DocAiLayerOverride,
  targetRole: "headline" | "body",
  copyText: string,
  opts: { refitHeadline: boolean; refitBodyHeight: boolean }
): DocAiLayerOverride {
  const text = copyText.trim() || row.text?.trim() || "";
  const fontSize = Math.max(12, row.font_size_px ?? (targetRole === "headline" ? 45 : 37));

  if (targetRole === "headline" && opts.refitHeadline) {
    const fitted = openHighlightBoxForText(text, fontSize, row.x_px, row.y_px);
    return { ...row, text, w_px: fitted.w_px, h_px: fitted.h_px };
  }

  if (targetRole === "body" && opts.refitBodyHeight) {
    const fixedW = row.w_px ?? 864;
    const fitted = openHighlightBoxForText(text, fontSize, row.x_px, row.y_px, { fixedWidthPx: fixedW });
    return {
      ...row,
      text,
      w_px: fixedW,
      h_px: Math.max(row.h_px ?? fitted.h_px, fitted.h_px),
    };
  }

  return text && text !== row.text ? { ...row, text } : row;
}

/** Apply typography + placement for one role on one listicle slide (template_bg). */
function applyTemplateBgRolePatchToSlide(
  slideIndex1Based: number,
  slideCount: number,
  targetRole: "headline" | "body",
  patch: Partial<DocAiLayerOverride>,
  inspectLayers: DocAiLayerBox[],
  existingRows: DocAiLayerOverride[],
  fullBleedMode: boolean,
  deckApply?: {
    copyText?: string;
    refitHeadline?: boolean;
    refitBodyHeight?: boolean;
  }
): { rows: DocAiLayerOverride[]; touched: boolean } {
  const fieldRoles = templateBgEditorFieldRolesForSlideIndex(slideIndex1Based, slideCount);
  const patchRow = (row: DocAiLayerOverride): DocAiLayerOverride => {
    let next: DocAiLayerOverride = {
      ...row,
      ...patch,
      box_locked: patch.box_locked ?? row.box_locked ?? true,
    };
    if (deckApply && (deckApply.refitHeadline || deckApply.refitBodyHeight)) {
      next = refitDeckApplyRowToSlideCopy(next, targetRole, deckApply.copyText ?? "", {
        refitHeadline: deckApply.refitHeadline ?? false,
        refitBodyHeight: deckApply.refitBodyHeight ?? false,
      });
    }
    return next;
  };

  const rest = existingRows.filter(
    (row) => !row.hidden && !draftRowMatchesTargetRole(row, targetRole, fieldRoles, fullBleedMode, true)
  );

  const patched: DocAiLayerOverride[] = [];
  const seen = new Set<string>();

  const pushPatched = (layer: DocAiLayerBox, baseRow?: DocAiLayerOverride) => {
    if (!docAiLayerMatchesTargetRole(layer, baseRow, targetRole, fieldRoles, fullBleedMode, true)) return;
    const key = layer.layer_key;
    if (seen.has(key)) return;
    seen.add(key);
    const base: DocAiLayerOverride =
      baseRow ??
      ({
        layer_key: key,
        x_px: layer.x_px,
        y_px: layer.y_px,
        w_px: layer.w_px ?? 280,
        h_px: layer.h_px ?? 72,
        box_locked: true,
      } as DocAiLayerOverride);
    patched.push(patchRow(base));
  };

  for (const layer of inspectLayers) {
    if (layer.layer_key.startsWith("custom@")) continue;
    const roleKey = roleFromLayerKey(layer.layer_key);
    if (targetRole === "body" && roleKey === "handle") continue;
    if (targetRole === "headline" && roleKey === "handle") continue;
    const saved =
      existingRows.find((r) => r.layer_key === layer.layer_key) ??
      existingRows.find(
        (r) => refKeyFromLayerPositionKey(r.layer_key) === refKeyFromLayerPositionKey(layer.layer_key)
      );
    pushPatched(layer, saved);
  }

  for (const row of existingRows) {
    if (row.hidden) continue;
    pushPatched(
      {
        layer_key: row.layer_key,
        text: row.text ?? "",
        role: roleFromLayerKey(row.layer_key),
        x_px: row.x_px,
        y_px: row.y_px,
        w_px: row.w_px ?? 280,
        h_px: row.h_px ?? 72,
        font_size_px: row.font_size_px,
      },
      row
    );
  }

  if (patched.length === 0) {
    const fieldRole = fieldRoles.find((fr) => layoutRoleMatchesField(fr, targetRole));
    if (!fieldRole) return { rows: existingRows, touched: false };
    const x = patch.x_px ?? 108;
    const y = patch.y_px ?? (fieldRole === "headline" ? 108 : 280);
    const synthKey = `${fieldRole}@${Math.round(x)},${Math.round(y)}:template_bg_deck_apply`;
    patched.push(
      patchRow({
        layer_key: synthKey,
        x_px: x,
        y_px: y,
        w_px: patch.w_px ?? 864,
        h_px: patch.h_px ?? (fieldRole === "headline" ? 120 : 520),
        box_locked: true,
      })
    );
  }

  return {
    rows: normalizeLayerPosDraft([...rest, ...patched], true),
    touched: true,
  };
}

function copySlotEditorLayerKey(slotIndex: number): string {
  return `slot@${slotIndex}`;
}

function isCopySlotEditorLayerKey(layerKey: string): boolean {
  return /^slot@\d+$/.test(layerKey);
}

function copySlotsForSlideIndex(
  mimicV1: Record<string, unknown> | null | undefined,
  slideCopyLayout: Array<Record<string, unknown>> | null | undefined,
  slideIndex: number
): MimicReferenceCopySlot[] {
  const vg =
    mimicV1?.visual_guideline && typeof mimicV1.visual_guideline === "object"
      ? (mimicV1.visual_guideline as Record<string, unknown>)
      : null;
  const rec = slideRecordForCopySlots(vg, slideCopyLayout ?? null, slideIndex);
  return copySlotsForSlideRecord(rec);
}

function copySlotKeysForLlmRole(
  slots: MimicReferenceCopySlot[],
  targetRole: "headline" | "body"
): string[] {
  return slots
    .filter((s) => s.llm_field !== "handle" && layoutRoleMatchesField(s.llm_field, targetRole))
    .map((s) => copySlotEditorLayerKey(s.slot_index));
}

function copySlotLlmFieldForLayerKey(
  layerKey: string,
  slots: MimicReferenceCopySlot[]
): string | null {
  if (!isCopySlotEditorLayerKey(layerKey)) return null;
  const slotIdx = Number(layerKey.slice("slot@".length));
  if (!Number.isFinite(slotIdx)) return null;
  return slots.find((s) => s.slot_index === slotIdx)?.llm_field ?? null;
}

function slideUsesCopySlotEditorLayers(
  mimicV1: Record<string, unknown> | null | undefined,
  slideCopyLayout: Array<Record<string, unknown>> | null | undefined,
  slideIndex: number
): boolean {
  return copySlotsForSlideIndex(mimicV1, slideCopyLayout, slideIndex).some((s) => s.llm_field !== "handle");
}

/** Keep one draft row per copy slot + custom/hidden rows — drop orphan OCR keys that re-expand the editor. */
function pruneDraftToCopySlotLayers(
  rows: DocAiLayerOverride[],
  slots: MimicReferenceCopySlot[]
): DocAiLayerOverride[] {
  if (slots.length === 0) return rows;
  const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index);
  const slotKeys = new Set(
    sorted.filter((s) => s.llm_field !== "handle").map((s) => copySlotEditorLayerKey(s.slot_index))
  );
  return rows.filter(
    (r) =>
      r.hidden ||
      r.layer_key.startsWith("custom@") ||
      (isCopySlotEditorLayerKey(r.layer_key) && slotKeys.has(r.layer_key))
  );
}

function resolveDraftForCopySlot(
  slot: MimicReferenceCopySlot,
  _sorted: MimicReferenceCopySlot[],
  matched: DocAiLayerBox[],
  draftByKey: Map<string, DocAiLayerOverride>
): DocAiLayerOverride | undefined {
  const slotKey = copySlotEditorLayerKey(slot.slot_index);
  const direct = draftByKey.get(slotKey);
  if (direct) return direct;
  for (const layer of matched) {
    const row = draftByKey.get(layer.layer_key);
    if (!row) continue;
    if (layoutRoleMatchesField(roleFromLayerKey(layer.layer_key), slot.llm_field)) {
      return row;
    }
  }
  return undefined;
}

function newCustomLayerKeyForPanel(): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `custom@body@${id}`;
}

function buildCustomPhraseOverride(
  text: string,
  blockIndex: number,
  boxes: DocAiLayerBox[]
): DocAiLayerOverride {
  const sorted = [...boxes].sort((a, b) => b.y_px - a.y_px || b.x_px - a.x_px);
  const anchor = sorted[0];
  const x_px = anchor?.x_px ?? 216;
  const y_px = anchor
    ? Math.min(1280, anchor.y_px + (anchor.h_px ?? 72) + 20 + blockIndex * 12)
    : 200 + blockIndex * 72;
  const font_size_px = 50;
  const open = openHighlightBoxForText(text, font_size_px, x_px, y_px);
  return {
    layer_key: newCustomLayerKeyForPanel(),
    x_px,
    y_px,
    w_px: open.w_px,
    h_px: open.h_px,
    font_size_px,
    text,
    box_locked: true,
  };
}

function asRec(v: unknown): Record<string, unknown> | null {

  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

}

function readJobTextBackingColorHex(job: Record<string, unknown> | null): string {
  const gp = asRec(job?.generation_payload);
  const gen = asRec(gp?.generated_output);
  const render = asRec(gen?.render);
  const stored = typeof render?.mimic_text_backing_color === "string" ? render.mimic_text_backing_color : null;
  return mimicTextBackingColorToHex(stored);
}



function pickCarouselTemplateName(generationPayload: Record<string, unknown>): string {

  const gp = generationPayload ?? {};

  const go = asRec(gp.generated_output);

  const goRender = go ? asRec(go.render) : null;

  const gpRender = asRec(gp.render);

  const v =

    goRender?.html_template_name ??

    goRender?.template_key ??

    gpRender?.html_template_name ??

    gpRender?.template_key ??

    gp.template;

  const s = typeof v === "string" ? v.trim() : "";

  return s ? s.replace(/\.hbs$/i, "") : "";

}



/** template_bg: hidden is reprint-only — never hydrate the editor from saved hidden markers. */
function stripTemplateBgHiddenOverrides(rows: DocAiLayerOverride[]): DocAiLayerOverride[] {
  return rows.map((row) => {
    if (!row.hidden) return row;
    const { hidden: _hidden, ...rest } = row;
    return rest as DocAiLayerOverride;
  });
}

function overridesForPersist(rows: DocAiLayerOverride[], templateBgMode = false): DocAiLayerOverride[] {
  return dropPlaceholderCustomOverrides(rows).map((r) => {
    if (r.hidden) return r;
    const isPlacedBox =
      r.layer_key.startsWith("custom@") || /^slot@\d+$/.test(r.layer_key);
    const hasTypography =
      r.font_size_px != null ||
      Boolean(r.color_hex?.trim()) ||
      r.font_weight != null ||
      Boolean(r.font_family?.trim()) ||
      r.font_style_italic != null;
    const lockBox = r.box_locked || isPlacedBox || hasTypography;
    if (r.layer_key.startsWith("custom@") || /^slot@\d+$/.test(r.layer_key)) {
      const text = r.text?.trim();
      return {
        ...r,
        box_locked: true,
        w_px: r.w_px ?? 280,
        h_px: r.h_px ?? 72,
        ...(text ? { text } : {}),
      };
    }
    if (templateBgMode) {
      const { text: _text, ...rest } = r;
      if (lockBox) return { ...rest, box_locked: true } as DocAiLayerOverride;
      const { w_px: _w, h_px: _h, box_locked: _b, ...posOnly } = rest;
      return posOnly as DocAiLayerOverride;
    }
    const text = r.text?.trim();
    if (text) {
      return { ...r, text, ...(lockBox ? { box_locked: true } : {}) };
    }
    if (lockBox) return { ...r, box_locked: true };
    const { w_px: _w, h_px: _h, box_locked: _b, text: _t, ...rest } = r;
    return rest;
  });
}

/** Inspect must always return full OCR slots — hidden is reprint-only for template_bg. */
function overridesForInspect(rows: DocAiLayerOverride[], templateBgMode = false): DocAiLayerOverride[] {
  const persisted = dropPlaceholderCustomOverrides(overridesForPersist(rows, templateBgMode));
  if (!templateBgMode) return persisted;
  return persisted.filter((row) => !row.hidden);
}

/** template_bg: copy lives in slide fields — layer draft stores geometry only. */
function stripTextFromLayerDraft(rows: DocAiLayerOverride[]): DocAiLayerOverride[] {
  return rows.map(({ text: _text, ...rest }) => rest as DocAiLayerOverride);
}

/** Drop custom@ rows that duplicate OCR copy or repeat the same phrase (bad auto-seed recovery). */
function dedupeRedundantCustomOverrides(rows: DocAiLayerOverride[]): DocAiLayerOverride[] {
  const ocrPhraseKeys = new Set<string>();
  for (const row of rows) {
    if (row.hidden || row.layer_key.startsWith("custom@")) continue;
    const key = normalizePhraseKey(row.text ?? "");
    if (key.length >= 3) ocrPhraseKeys.add(key);
  }
  const seenCustom = new Set<string>();
  return rows.filter((row) => {
    if (!row.layer_key.startsWith("custom@") || row.hidden) return true;
    if (isPlaceholderCustomLayer(
      {
        layer_key: row.layer_key,
        text: row.text ?? "",
        role: roleFromLayerKey(row.layer_key),
        x_px: row.x_px,
        y_px: row.y_px,
        w_px: row.w_px ?? 120,
        h_px: row.h_px ?? 48,
      },
      row
    )) {
      return false;
    }
    const key = normalizePhraseKey(row.text ?? "");
    if (key.length < 3) return false;
    if (seenCustom.has(key)) return false;
    for (const ocrKey of ocrPhraseKeys) {
      if (ocrKey.includes(key) || key.includes(ocrKey)) return false;
    }
    seenCustom.add(key);
    return true;
  });
}

function normalizeLayerPosDraft(rows: DocAiLayerOverride[], templateBgMode: boolean): DocAiLayerOverride[] {
  const stripped = templateBgMode ? stripTextFromLayerDraft(rows) : rows;
  return dedupeRedundantCustomOverrides(stripped);
}

function layoutDraftCompareKey(rows: DocAiLayerOverride[], _templateBgMode = false): string {
  // Geometry + style only — copy edits must not retrigger inspect, auto-save, or reseed.
  return JSON.stringify(
    rows.map((r) => ({
      k: r.layer_key,
      x: r.x_px,
      y: r.y_px,
      w: r.w_px,
      h: r.h_px,
      f: r.font_size_px,
      hidden: r.hidden,
      locked: r.box_locked,
      c: r.color_hex,
      fw: r.font_weight,
      ff: r.font_family,
    }))
  );
}

function mergedSlideDraftsForCompare(
  slideDrafts: Record<number, DocAiLayerOverride[]>,
  editorSlide: number,
  layerPosDraft: DocAiLayerOverride[]
): Record<number, DocAiLayerOverride[]> {
  return {
    ...slideDrafts,
    ...(layerPosDraft.length > 0 ? { [editorSlide]: layerPosDraft } : {}),
  };
}

/** Deck-wide saved-state fingerprint — switching slides must not spuriously show Unsaved. */
function mergedLayoutDraftCompareKey(
  slideDrafts: Record<number, DocAiLayerOverride[]>,
  templateBgMode: boolean
): string {
  const slides = Object.keys(slideDrafts)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1 && (slideDrafts[n]?.length ?? 0) > 0)
    .sort((a, b) => a - b);
  if (slides.length === 0) return "";
  return JSON.stringify(
    slides.map((slide) => [slide, layoutDraftCompareKey(slideDrafts[slide]!, templateBgMode)])
  );
}

function mergeDocAiLayerPositionsForReprint(
  mimicV1: Record<string, unknown> | null,
  slideDrafts: Record<number, DocAiLayerOverride[]>,
  editorSlide: number,
  currentDraft: DocAiLayerOverride[],
  templateBgMode = false
): Record<string, DocAiLayerOverride[]> | undefined {

  const raw = mimicV1?.docai_layer_positions;

  const merged: Record<string, DocAiLayerOverride[]> = {};

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {

    for (const [key, rows] of Object.entries(raw as Record<string, unknown>)) {

      if (!Array.isArray(rows)) continue;

      merged[key] = rows as DocAiLayerOverride[];

    }

  }

  for (const [slideKey, rows] of Object.entries(slideDrafts)) {

    if (rows.length > 0) merged[slideKey] = overridesForPersist(rows, templateBgMode);
  }
  if (currentDraft.length > 0) {
    merged[String(editorSlide)] = overridesForPersist(currentDraft, templateBgMode);

  }

  return Object.keys(merged).length > 0 ? merged : undefined;

}



function savedLayoutSlideIndices(mimicV1: Record<string, unknown> | null): Set<number> {

  const raw = mimicV1?.docai_layer_positions;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Set();

  const out = new Set<number>();

  for (const [key, rows] of Object.entries(raw as Record<string, unknown>)) {

    if (!Array.isArray(rows) || rows.length === 0) continue;

    const n = Number(key);

    if (Number.isFinite(n) && n >= 1) out.add(n);

  }

  return out;

}



function serverSlideDraftsFromMimicV1(
  mimicV1: Record<string, unknown> | null | undefined,
  templateBgMode: boolean
): Record<number, DocAiLayerOverride[]> {
  const raw = mimicV1?.docai_layer_positions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<number, DocAiLayerOverride[]> = {};
  for (const [key, rows] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const slideIndex = Number(key);
    if (!Number.isFinite(slideIndex) || slideIndex < 1) continue;
    out[slideIndex] = normalizeLayerPosDraft(
      templateBgMode
        ? stripTemplateBgHiddenOverrides(rows as DocAiLayerOverride[])
        : (rows as DocAiLayerOverride[]),
      templateBgMode
    );
  }
  return out;
}

function parseDocAiLayerBoxes(renderInspect: Record<string, unknown> | null): DocAiLayerBox[] {

  const raw = renderInspect?.docai_text_layers;

  if (!Array.isArray(raw)) return [];

  return raw

    .map((row, blockIndex) => {

      const r = asRec(row);

      if (!r) return null;

      const layer_key = String(r.layer_key ?? "").trim();

      if (!layer_key) return null;

      const text = String(r.text ?? "");

      const font_weight = Number(r.font_weight);

      const color_hex = typeof r.color_hex === "string" ? r.color_hex.trim() : undefined;

      const font_family = typeof r.font_family === "string" ? r.font_family.trim() : undefined;

      return {

        layer_key,

        text,

        role: String(r.role ?? "body"),

        x_px: Number(r.x_px) || 0,

        y_px: Number(r.y_px) || 0,

        w_px: Math.max(24, Number(r.w_px) || 120),

        h_px: Math.max(20, Number(r.h_px) || 48),

        font_size_px: Number(r.font_size_px) > 0 ? Number(r.font_size_px) : undefined,

        ...(Number.isFinite(font_weight) && font_weight >= 100 ? { font_weight } : {}),

        ...(color_hex && /^#[0-9a-fA-F]{3,8}$/.test(color_hex) ? { color_hex } : {}),

        ...(font_family ? { font_family } : {}),

        block_index: blockIndex,

        skip_center_avoid: r.skip_center_avoid === true,

      };

    })

    .filter(Boolean) as DocAiLayerBox[];

}

/** Fast placeholder inspect from saved layer positions so the editor canvas is not blank while OCR loads. */
function syntheticInspectFromDraftOverrides(
  slideIndex: number,
  rows: DocAiLayerOverride[]
): Record<string, unknown> {
  return {
    ok: true,
    slide_index: slideIndex,
    synthetic: true,
    docai_text_layers: rows.map((row) => ({
      layer_key: row.layer_key,
      text: row.text ?? "",
      role: roleFromLayerKey(row.layer_key),
      x_px: row.x_px,
      y_px: row.y_px,
      w_px: row.w_px ?? 280,
      h_px: row.h_px ?? 72,
      ...(row.font_size_px != null ? { font_size_px: row.font_size_px } : {}),
      ...(row.font_weight != null ? { font_weight: row.font_weight } : {}),
      ...(row.color_hex ? { color_hex: row.color_hex } : {}),
      ...(row.font_family ? { font_family: row.font_family } : {}),
    })),
    docai_layer_positions: rows,
  };
}

function parseDocAiSavedOverrides(renderInspect: Record<string, unknown> | null): DocAiLayerOverride[] {

  const raw = renderInspect?.docai_layer_positions;

  if (!Array.isArray(raw)) return [];

  return raw

    .map((row) => {

      const r = asRec(row);

      if (!r) return null;

      const layer_key = String(r.layer_key ?? "").trim();

      const x_px = Number(r.x_px);

      const y_px = Number(r.y_px);

      if (!layer_key || !Number.isFinite(x_px) || !Number.isFinite(y_px)) return null;

      const font_size_px = Number(r.font_size_px);

      const w_px = Number(r.w_px);

      const h_px = Number(r.h_px);

      const text = typeof r.text === "string" ? r.text : undefined;
      const box_locked = r.box_locked === true;
      const hidden = r.hidden === true;
      const custom = layer_key.startsWith("custom@");
      const font_weight = Number(r.font_weight);
      const color_hex =
        typeof r.color_hex === "string" && /^#[0-9a-fA-F]{3,8}$/.test(r.color_hex.trim())
          ? r.color_hex.trim()
          : undefined;
      const font_family = typeof r.font_family === "string" ? r.font_family.trim() : undefined;

      return {

        layer_key,

        x_px,

        y_px,

        ...(Number.isFinite(font_size_px) && font_size_px > 0 ? { font_size_px } : {}),

        ...(Number.isFinite(w_px) && w_px > 0 ? { w_px } : {}),

        ...(Number.isFinite(h_px) && h_px > 0 ? { h_px } : {}),

        ...(text?.trim() ? { text: text.trim() } : custom ? { text: "New text" } : {}),

        ...(Number.isFinite(font_weight) && font_weight >= 100 ? { font_weight } : {}),

        ...(color_hex ? { color_hex } : {}),

        ...(font_family ? { font_family } : {}),

        ...(r.font_style_italic === true ? { font_style_italic: true } : {}),

        ...(Number.isFinite(w_px) && w_px > 0 && Number.isFinite(h_px) && h_px > 0
          ? { box_locked: true }
          : box_locked
            ? { box_locked: true }
            : {}),

        ...(hidden ? { hidden: true } : {}),

      };

    })

    .filter(Boolean) as DocAiLayerOverride[];

}



export interface MimicCarouselLayerEditorPanelProps {

  job: Record<string, unknown> | null;

  taskId: string;

  projectSlug: string;

  slideCount: number;

  activeSlideIndex?: number;

  buildInspectPayload?: () => Record<string, unknown>;

  template?: string;

  instagramHandle?: string;

  getBackgroundUrl?: (slideIndex1Based: number) => string | undefined;

  onReprintComplete?: () => void | Promise<void>;

  buildReprintTypographyPatch?: () => Record<string, number>;

  /** Persist saved layout into local job state (avoids stale inspect until refetch). */

  onMimicLayoutSaved?: (slideIndex: number, positions: DocAiLayerOverride[]) => void;

  onSlideSelect?: (slideIndex1Based: number) => void;

  onDeleteSlide?: (slideIndex1Based: number) => void;

  activeTextBlockIndex?: number | null;

  onActiveTextBlockIndexChange?: (blockIndex: number | null) => void;

  /** Full-bleed mimic (not template_bg): neutral box labels + text-block sync. */
  fullBleedMode?: boolean;

  /** template_bg: map left-column fields to layout layers by OCR role, not array index. */
  templateBgMode?: boolean;

  /** Ordered roles for left-column fields (e.g. ["headline", "body"]). */
  templateBgFieldRoles?: string[];

  /** Parallel copy for left-column fields — synced into layout boxes without refetching inspect. */
  templateBgFieldTexts?: string[];

  /** Full-bleed: LLM copy per editable copy slot (left column → layout boxes). */
  fullBleedSlotTexts?: string[];

  /** Fired when layout boxes for the active slide change (for left-column text fields). */
  onLayoutTextBlocksChange?: (
    slideIndex: number,
    blocks: Array<{ role: string; text: string; layer_key: string }>
  ) => void;

  /** Register handler so left-column text edits update layout box copy. */
  registerTextBlockUpdater?: (
    fn: ((blockIndex: number, text: string) => void) | null
  ) => void;

  /** template_bg: push layout-editor copy edits back into slide copy (left column + reprint). */
  onTemplateBgFieldTextChange?: (slideIndex: number, fieldRole: string, text: string) => void;

  /** On-screen copy for a slide field — used to refit headline/body boxes per slide on deck apply. */
  resolveSlideFieldText?: (slideIndex1Based: number, fieldRole: "headline" | "body") => string;

  /** Editor slide copy for reprint — inspect uses this locally; reprint must send it to Core. */
  buildSlideCopyOverrides?: (slideIndices: number[] | undefined) => Array<{
    slide_index: number;
    llm_slide: Record<string, unknown>;
  }>;

  /** Project brand palette (hex) for color quick-pick swatches. */
  brandPalette?: string[];

  /** Project brand logo URL — composited lower-right when the logo toggle is on. */
  brandLogoUrl?: string;
  /** Absolute URL for Puppeteer reprint (may differ from display proxy URL). */
  brandLogoReprintUrl?: string;

  /** Brand bible slide_frame assets — composited on top when the frame toggle is on. */
  brandFrames?: BrandSlideFrameOption[];

  /** Shared mimic slide-regen prompt note (carousel header + layout editor). */
  regenerationNote?: string;
  onRegenerationNoteChange?: (value: string) => void;

  /** Bumped when carousel assets refetch after reprint/regen — clears stale inspect cache. */
  assetRefreshKey?: number;

}



function collapseDocAiLayerBoxesToCopySlots(
  boxes: DocAiLayerBox[],
  draftByKey: Map<string, DocAiLayerOverride>,
  slots: MimicReferenceCopySlot[],
  slotTexts?: string[]
): DocAiLayerBox[] {
  const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index);
  const editable = sorted.filter((s) => s.llm_field !== "handle");
  if (editable.length === 0) return boxes;
  if (boxes.length <= editable.length && boxes.every((b) => isCopySlotEditorLayerKey(b.layer_key))) {
    return boxes;
  }

  const usedKeys = new Set<string>();
  const out: DocAiLayerBox[] = [];

  for (let ei = 0; ei < editable.length; ei++) {
    const slot = editable[ei]!;
    const slotKey = copySlotEditorLayerKey(slot.slot_index);
    const refNorm = normalizePhraseKey(slot.reference_text || slot.block_texts.join(" "));
    const slotIdx = sorted.indexOf(slot);
    const { start, count } = ocrBoxSpanForClusterIndex(slotIdx, sorted);

    let matched: DocAiLayerBox[] = [];
    for (let i = start; i < start + count && i < boxes.length; i++) {
      const layer = boxes[i]!;
      if (!usedKeys.has(layer.layer_key)) matched.push(layer);
    }

    if (matched.length === 0) {
      for (const layer of boxes) {
        if (usedKeys.has(layer.layer_key) || isCopySlotEditorLayerKey(layer.layer_key)) continue;
        const layerRole = roleFromLayerKey(layer.layer_key);
        if (layoutRoleMatchesField(layerRole, slot.llm_field)) {
          matched.push(layer);
        }
      }
    }

    if (matched.length === 0 && refNorm.length >= 3) {
      for (const layer of boxes) {
        if (usedKeys.has(layer.layer_key) || isCopySlotEditorLayerKey(layer.layer_key)) continue;
        const lt = normalizePhraseKey(draftByKey.get(layer.layer_key)?.text ?? layer.text ?? "");
        if (
          lt.length >= 3 &&
          (refNorm.includes(lt.slice(0, 12)) || lt.includes(refNorm.slice(0, 12)))
        ) {
          matched.push(layer);
        }
      }
    }

    matched.forEach((l) => usedKeys.add(l.layer_key));

    const row = resolveDraftForCopySlot(slot, sorted, matched, draftByKey);
    const first = matched[0];
    const unionX = matched.length > 0 ? Math.min(...matched.map((l) => l.x_px)) : 80;
    const unionY = matched.length > 0 ? Math.min(...matched.map((l) => l.y_px)) : 120 + ei * 80;
    const unionX2 =
      matched.length > 0 ? Math.max(...matched.map((l) => l.x_px + (l.w_px ?? 0))) : unionX + 320;
    const unionY2 =
      matched.length > 0 ? Math.max(...matched.map((l) => l.y_px + (l.h_px ?? 0))) : unionY + 64;
    const text =
      (slotTexts?.[ei]?.trim() || row?.text?.trim() || first?.text?.trim() || "").trim() ||
      slot.reference_text;
    out.push({
      layer_key: slotKey,
      text,
      role: slot.llm_field === "headline" ? "headline" : first?.role ?? "body",
      block_index: ei,
      x_px: row?.x_px ?? unionX,
      y_px: row?.y_px ?? unionY,
      w_px: Math.max(24, row?.w_px ?? unionX2 - unionX),
      h_px: Math.max(20, row?.h_px ?? unionY2 - unionY),
      font_size_px: row?.font_size_px ?? first?.font_size_px,
    });
  }

  return out;
}

function collapseLayoutBlocksToCopySlots(
  boxes: DocAiLayerBox[],
  draftByKey: Map<string, DocAiLayerOverride>,
  slots: MimicReferenceCopySlot[],
  fullBleedMode: boolean,
  templateBgMode: boolean,
  slotTexts?: string[]
): Array<{ role: string; text: string; layer_key: string; block_index: number }> {
  const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index);
  const editable = sorted.filter((s) => s.llm_field !== "handle");
  if (editable.length === 0) return [];
  return editable.map((slot) => {
    const ei = editable.indexOf(slot);
    const slotKey = copySlotEditorLayerKey(slot.slot_index);
    const fromSlide = slotTexts?.[ei]?.trim();
    const layer =
      boxes.find((b) => b.layer_key === slotKey) ??
      boxes[ocrBoxSpanForClusterIndex(sorted.indexOf(slot), sorted).start];
    if (!layer) {
      return {
        role: slot.llm_field,
        text: fromSlide ?? "",
        layer_key: slotKey,
        block_index: ei,
      };
    }
    const row = draftByKey.get(layer.layer_key) ?? draftByKey.get(slotKey);
    const draftText = (row?.text ?? layer.text ?? "").trim();
    const text = fromSlide || draftText || slot.reference_text.trim();
    return {
      role: slot.llm_field === "handle" ? "handle" : slot.llm_field === "headline" ? "headline" : "body",
      text,
      layer_key: slotKey,
      block_index: ei,
    };
  });
}

export function MimicCarouselLayerEditorPanel({

  job,

  taskId,

  projectSlug,

  slideCount,

  activeSlideIndex = 1,

  buildInspectPayload,

  template = "",

  instagramHandle = "",

  getBackgroundUrl,

  onReprintComplete,

  buildReprintTypographyPatch,

  onMimicLayoutSaved,

  onSlideSelect,

  onDeleteSlide,

  activeTextBlockIndex = null,

  onActiveTextBlockIndexChange,

  fullBleedMode = false,

  templateBgMode = false,

  templateBgFieldRoles = [],

  templateBgFieldTexts = [],

  fullBleedSlotTexts = [],

  onLayoutTextBlocksChange,

  registerTextBlockUpdater,

  onTemplateBgFieldTextChange,

  resolveSlideFieldText,

  buildSlideCopyOverrides,

  brandPalette = [],

  brandLogoUrl = "",
  brandLogoReprintUrl = "",

  brandFrames = [],

  regenerationNote: regenerationNoteProp,

  onRegenerationNoteChange,

  assetRefreshKey = 0,

}: MimicCarouselLayerEditorPanelProps) {

  const [logoEnabled, setLogoEnabled] = useState(() => {
    if (typeof window === "undefined" || !taskId.trim()) return false;
    try {
      return sessionStorage.getItem(`caf-logo-stamp:${taskId.trim()}`) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!taskId.trim()) return;
    try {
      sessionStorage.setItem(`caf-logo-stamp:${taskId.trim()}`, logoEnabled ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [logoEnabled, taskId]);

  const logoStampUrl = (brandLogoReprintUrl.trim() || brandLogoUrl.trim());
  const logoOverlayPayload = useMemo(
    () => (logoEnabled && logoStampUrl ? { url: logoStampUrl, position: "br" } : undefined),
    [logoEnabled, logoStampUrl]
  );

  const [frameEnabled, setFrameEnabled] = useState(false);
  const [selectedFrameAssetId, setSelectedFrameAssetId] = useState("");
  useEffect(() => {
    if (selectedFrameAssetId && brandFrames.some((f) => f.assetId === selectedFrameAssetId)) return;
    setSelectedFrameAssetId(brandFrames[0]?.assetId ?? "");
  }, [brandFrames, selectedFrameAssetId]);

  const selectedFrame = useMemo(
    () => brandFrames.find((f) => f.assetId === selectedFrameAssetId) ?? brandFrames[0] ?? null,
    [brandFrames, selectedFrameAssetId]
  );
  const frameOverlayPayload = useMemo(() => {
    if (!frameEnabled || !selectedFrame) return undefined;
    const url = selectedFrame.reprintUrl.trim() || selectedFrame.displayUrl.trim();
    if (!url) return undefined;
    return { url, asset_id: selectedFrame.assetId };
  }, [frameEnabled, selectedFrame]);
  const framePreviewUrl = frameEnabled && selectedFrame ? selectedFrame.displayUrl : "";

  // Current slide is controlled by the parent (`activeSlideIndex`) — single source of
  // truth. No local slide state, so carousel arrows and these slide buttons can never
  // ping-pong against each other.
  const editorSlide = Math.max(1, Math.min(Math.max(slideCount, 1), Math.floor(activeSlideIndex) || 1));

  const [renderInspect, setRenderInspect] = useState<Record<string, unknown> | null>(null);

  const [renderInspectLoading, setRenderInspectLoading] = useState(false);

  const inspectRequestGenRef = useRef(0);
  const inspectCacheRef = useRef<Record<number, Record<string, unknown>>>({});
  /** Slide copy → layout sync; skip layout → slide copy echo (preserves spaces while typing). */
  const templateBgCopySyncingToLayoutRef = useRef(false);

  const pruneInspectSlideCache = useCallback((keepSlide: number) => {
    const cache = inspectCacheRef.current;
    const keys = Object.keys(cache).map(Number);
    const max = 10;
    if (keys.length <= max) return;
    const ranked = keys.sort((a, b) => {
      const da = Math.abs(a - keepSlide);
      const db = Math.abs(b - keepSlide);
      return da !== db ? da - db : a - b;
    });
    const keep = new Set(ranked.slice(0, max));
    for (const k of keys) {
      if (!keep.has(k)) delete cache[k];
    }
  }, []);

  useEffect(() => {
    inspectCacheRef.current = {};
  }, [taskId]);

  const [reprintScope, setReprintScope] = useState<"all" | "current" | "picked">("all");
  const [reprintPickedSlides, setReprintPickedSlides] = useState<Set<number>>(() => new Set());

  const [reprintTextBacking, setReprintTextBacking] = useState(true);
  const [reprintTextBackingHex, setReprintTextBackingHex] = useState(() => readJobTextBackingColorHex(job));
  const [userTouchedLayout, setUserTouchedLayout] = useState(false);
  const [draftSyncRevision, setDraftSyncRevision] = useState(0);
  const [layoutResetToken, setLayoutResetToken] = useState(0);

  useEffect(() => {
    setReprintTextBackingHex(readJobTextBackingColorHex(job));
  }, [job]);

  useEffect(() => {
    setReprintPickedSlides((prev) => {
      if (prev.size > 0) return prev;
      return new Set([editorSlide]);
    });
  }, [editorSlide]);

  const toggleReprintPickedSlide = useCallback((slide: number) => {
    setReprintPickedSlides((prev) => {
      const next = new Set(prev);
      if (next.has(slide)) next.delete(slide);
      else next.add(slide);
      return next;
    });
  }, []);

  const reprintTargetSlides = useMemo(() => {
    if (reprintScope === "all") return undefined;
    if (reprintScope === "current") return [editorSlide];
    return [...reprintPickedSlides].filter((n) => n >= 1 && n <= slideCount).sort((a, b) => a - b);
  }, [reprintScope, editorSlide, reprintPickedSlides, slideCount]);

  const reprintTextBackingCss = useMemo(
    () => formatMimicTextBackingBackground(reprintTextBackingHex),
    [reprintTextBackingHex]
  );

  const [reprintBusy, setReprintBusy] = useState(false);

  const [reprintMsg, setReprintMsg] = useState<string | null>(null);

  const [reprintError, setReprintError] = useState<string | null>(null);

  const [regenerateBusy, setRegenerateBusy] = useState(false);

  const [regenerateMsg, setRegenerateMsg] = useState<string | null>(null);

  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  /** Which template_bg slot regen is in flight (for button feedback). */
  const [regeneratingSlot, setRegeneratingSlot] = useState<MimicTemplateBgSlot | null>(null);
  const [regeneratingAllSlides, setRegeneratingAllSlides] = useState(false);

  // Regenerate route picker (1.6): similarity preset + reference on/off.
  const [regenSimilarityPct, setRegenSimilarityPct] = useState<number>(85);
  const [regenUseReference, setRegenUseReference] = useState<boolean>(true);
  const [localRegenNote, setLocalRegenNote] = useState("");
  const regenNote = regenerationNoteProp ?? localRegenNote;
  const setRegenNote = onRegenerationNoteChange ?? setLocalRegenNote;
  const [showRegenRoute, setShowRegenRoute] = useState<boolean>(false);
  const [regenPlateOpen, setRegenPlateOpen] = useState(true);

  const lastEmittedTextBlocksRef = useRef<string>("");
  const [layerPosDraft, setLayerPosDraft] = useState<DocAiLayerOverride[]>([]);

  const [slideDrafts, setSlideDrafts] = useState<Record<number, DocAiLayerOverride[]>>({});

  // Per-slide fingerprint of the last content we persisted to the server.
  const lastPersistedKeysBySlideRef = useRef<Record<number, string>>({});
  const lastPersistedKeyRef = useRef<string>("");
  const slideDraftsRef = useRef(slideDrafts);
  slideDraftsRef.current = slideDrafts;
  const persistKeyFor = useCallback(
    (slideIndex: number, rows: DocAiLayerOverride[]) =>
      `${slideIndex}:${layoutDraftCompareKey(rows, templateBgMode)}`,
    [templateBgMode]
  );

  // Slide change: restore per-slide inspect cache immediately; only show loading when uncached.
  useEffect(() => {
    lastEmittedTextBlocksRef.current = "";
    setUserTouchedLayout(false);

    const cachedInspect = inspectCacheRef.current[editorSlide];
    if (cachedInspect) {
      setRenderInspect(cachedInspect);
      setRenderInspectLoading(false);
    } else {
      const draftRows = slideDraftsRef.current[editorSlide];
      if (draftRows?.length) {
        setRenderInspect(syntheticInspectFromDraftOverrides(editorSlide, draftRows));
        setRenderInspectLoading(false);
      } else {
        setRenderInspect(null);
        setRenderInspectLoading(true);
      }
    }

    const cached = slideDraftsRef.current[editorSlide];
    setLayerPosDraft(
      cached?.length
        ? normalizeLayerPosDraft(
            templateBgMode ? stripTemplateBgHiddenOverrides(cached) : [...cached],
            templateBgMode
          )
        : []
    );
  }, [editorSlide, templateBgMode]);

  // Initial load: if slideDrafts arrives after first render, hydrate layerPosDraft
  // only when we currently have no draft.
  useEffect(() => {
    if (layerPosDraft.length > 0) return;
    const cached = slideDrafts[editorSlide];
    if (cached?.length) setLayerPosDraft([...cached]);
  }, [slideDrafts, editorSlide]);

  const [layerPosSaving, setLayerPosSaving] = useState(false);

  const [layerPosMsg, setLayerPosMsg] = useState<string | null>(null);

  const [layerPosError, setLayerPosError] = useState<string | null>(null);

  const [layoutBaseline, setLayoutBaseline] = useState("");

  const [slidesWithSavedLayout, setSlidesWithSavedLayout] = useState<Set<number>>(() => new Set());

  const userTouchedLayoutRef = useRef(false);
  userTouchedLayoutRef.current = userTouchedLayout;
  const buildInspectPayloadRef = useRef(buildInspectPayload);

  const getBackgroundUrlRef = useRef(getBackgroundUrl);

  buildInspectPayloadRef.current = buildInspectPayload;

  getBackgroundUrlRef.current = getBackgroundUrl;



  const gp = useMemo(() => asRec(job?.generation_payload) ?? {}, [job]);

  const mimicV1 = useMemo(() => asRec(gp.mimic_v1), [gp]);
  const showNewVisualWhyPanel = useMemo(() => isNewVisualCarouselMimic(mimicV1), [mimicV1]);
  const showReferenceWhyPanel = useMemo(
    () => !showNewVisualWhyPanel && hasSlideIntelligenceBundle(mimicV1),
    [showNewVisualWhyPanel, mimicV1]
  );

  const slideCopyLayout = useMemo(() => {
    const grounding = asRec(gp.mimic_job_grounding);
    const raw = grounding?.slide_copy_layout;
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : null;
  }, [gp]);

  const copySlotsForEditor = useMemo((): MimicReferenceCopySlot[] => {
    if (templateBgMode || !fullBleedMode) return [];
    const vg =
      mimicV1?.visual_guideline && typeof mimicV1.visual_guideline === "object"
        ? (mimicV1.visual_guideline as Record<string, unknown>)
        : null;
    const rec = slideRecordForCopySlots(vg, slideCopyLayout, editorSlide);
    return copySlotsForSlideRecord(rec);
  }, [templateBgMode, fullBleedMode, mimicV1, slideCopyLayout, editorSlide]);

  const copySlotsRef = useRef(copySlotsForEditor);
  copySlotsRef.current = copySlotsForEditor;
  const fullBleedSlotTextsRef = useRef(fullBleedSlotTexts);
  fullBleedSlotTextsRef.current = fullBleedSlotTexts;

  const generatedOnScreenText = useMemo(() => {
    const parts = templateBgMode
      ? templateBgFieldTexts.map((t) => t.trim()).filter(Boolean)
      : fullBleedSlotTexts.map((t) => t.trim()).filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [templateBgMode, templateBgFieldTexts, fullBleedSlotTexts]);

  useEffect(() => {
    inspectCacheRef.current = {};
    setRenderInspect(null);
  }, [assetRefreshKey]);

  const templateUsed = useMemo(() => template || pickCarouselTemplateName(gp), [template, gp]);

  const mergedDraftsForDirty = useMemo(
    () => mergedSlideDraftsForCompare(slideDrafts, editorSlide, layerPosDraft),
    [slideDrafts, editorSlide, layerPosDraft]
  );

  const layoutDirty =
    userTouchedLayout &&
    Object.values(mergedDraftsForDirty).some((rows) => rows.length > 0) &&
    (layoutBaseline === "" ||
      mergedLayoutDraftCompareKey(mergedDraftsForDirty, templateBgMode) !== layoutBaseline);

  useEffect(() => {

    setSlidesWithSavedLayout(savedLayoutSlideIndices(mimicV1));

    const fromServer = serverSlideDraftsFromMimicV1(mimicV1, templateBgMode);

    if (Object.keys(fromServer).length === 0) return;

    const serverKeys: Record<number, string> = {};
    for (const [slideKey, rows] of Object.entries(fromServer)) {
      const slide = Number(slideKey);
      if (Number.isFinite(slide) && slide >= 1 && rows.length > 0) {
        serverKeys[slide] = persistKeyFor(slide, rows);
      }
    }
    lastPersistedKeysBySlideRef.current = { ...serverKeys };

    // Do not clobber in-progress editor drafts when the server echoes a save we already have locally.
    if (userTouchedLayoutRef.current && layoutDirty) return;

    setSlideDrafts((prev) => {
      const merged = { ...fromServer };
      // Only keep stale local drafts for the slide actively being edited — never let
      // old prev[] overwrite freshly persisted server positions after reprint/save.
      const dirtyActiveSlide =
        userTouchedLayoutRef.current && layoutDirty && editorSlide >= 1;
      if (dirtyActiveSlide && prev[editorSlide]?.length) {
        merged[editorSlide] = prev[editorSlide]!;
      }
      return merged;
    });

    setLayoutBaseline(mergedLayoutDraftCompareKey(fromServer, templateBgMode));

    setLayerPosDraft((prev) => {
      if (prev.length > 0 || userTouchedLayoutRef.current) return prev;
      const cached = fromServer[editorSlide];
      return cached?.length ? normalizeLayerPosDraft(cached, templateBgMode) : prev;
    });

  }, [mimicV1, taskId, templateBgMode, layoutDirty, editorSlide, persistKeyFor]);



  const persistLayerPositions = useCallback(

    async (
      slideIndex: number,
      positions: DocAiLayerOverride[],
      timeoutMs = LAYER_PERSIST_TIMEOUT_MS
    ): Promise<void> => {

      if (!taskId.trim() || !projectSlug.trim()) return;

      const res = await fetch("/api/task/mimic-docai-layer-positions", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        signal: AbortSignal.timeout(timeoutMs),

        body: JSON.stringify({

          task_id: taskId,

          project: projectSlug.trim(),

          slide_index: slideIndex,

          positions: overridesForPersist(positions, templateBgMode),

        }),

      });

      const json = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !json.ok) {

        throw new Error(json.error ?? `Save failed (${res.status})`);

      }

      onMimicLayoutSaved?.(slideIndex, overridesForPersist(positions, templateBgMode));
    },
    [taskId, projectSlug, onMimicLayoutSaved, templateBgMode]
  );

  const persistAllSlideDrafts = useCallback(
    async (
      drafts: Record<number, DocAiLayerOverride[]>,
      opts?: {
        updateUserTouched?: boolean;
        timeoutMs?: number;
        onProgress?: (slide: number, total: number) => void;
      }
    ): Promise<PersistAllSlideDraftsResult> => {
      if (!taskId.trim() || !projectSlug.trim()) return { savedCount: 0, failedSlides: [] };
      const savedSlides: number[] = [];
      const failedSlides: number[] = [];
      const slides = Object.keys(drafts)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 1 && (drafts[n]?.length ?? 0) > 0)
        .sort((a, b) => a - b);
      const pending = slides.filter((slide) => {
        const rows = drafts[slide]!;
        const key = persistKeyFor(slide, rows);
        return lastPersistedKeysBySlideRef.current[slide] !== key;
      });
      const timeoutMs = opts?.timeoutMs ?? LAYER_PERSIST_TIMEOUT_MS;
      let completed = 0;
      await runTasksWithConcurrency(pending, DECK_PERSIST_CONCURRENCY, async (slide) => {
        const rows = drafts[slide]!;
        const key = persistKeyFor(slide, rows);
        try {
          await persistLayerPositions(slide, rows, timeoutMs);
          lastPersistedKeysBySlideRef.current[slide] = key;
          savedSlides.push(slide);
        } catch {
          failedSlides.push(slide);
        } finally {
          completed += 1;
          opts?.onProgress?.(completed, pending.length);
        }
      });
      if (savedSlides.length === 0 && failedSlides.length > 0) {
        const label = failedSlides.length === 1 ? "slide" : "slides";
        throw new Error(
          `Save failed for ${failedSlides.length} ${label} (${failedSlides.join(", ")}) — signal timed out or server error`
        );
      }
      if (savedSlides.length > 0) {
        setSlidesWithSavedLayout((prev) => {
          const next = new Set(prev);
          for (const slide of savedSlides) next.add(slide);
          return next;
        });
        setLayoutBaseline(mergedLayoutDraftCompareKey(drafts, templateBgMode));
        if (opts?.updateUserTouched !== false) setUserTouchedLayout(false);
      }
      return { savedCount: savedSlides.length, failedSlides: failedSlides.sort((a, b) => a - b) };
    },
    [taskId, projectSlug, persistKeyFor, persistLayerPositions, templateBgMode]
  );


  const refreshCarouselAfterReprint = useCallback(() => {
    void onReprintComplete?.();
    window.setTimeout(() => void onReprintComplete?.(), 35_000);
  }, [onReprintComplete]);

  const requestTextOverlayReprint = useCallback(
    async (
      slideIndices: number[] | undefined,
      allDrafts: Record<number, DocAiLayerOverride[]>,
      currentSlide: number,
      currentDraft: DocAiLayerOverride[]
    ) => {
      if (!taskId.trim() || !projectSlug.trim()) return;
      if (logoEnabled && brandLogoUrl.trim() && !logoStampUrl) {
        throw new Error(
          "Brand logo is enabled but has no renderer URL — re-upload the logo in Brand profile, then reprint."
        );
      }
      const docai_layer_positions = mergeDocAiLayerPositionsForReprint(
        mimicV1,
        allDrafts,
        currentSlide,
        currentDraft,
        templateBgMode
      );
      const render_typography = buildReprintTypographyPatch?.();
      const slide_copy_overrides = buildSlideCopyOverrides?.(slideIndices);
      const res = await fetch("/api/task/reprint-text-overlay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          project: projectSlug.trim(),
          ...(slideIndices && slideIndices.length > 0 ? { slide_indices: slideIndices } : {}),
          ...(render_typography && Object.keys(render_typography).length > 0 ? { render_typography } : {}),
          ...(docai_layer_positions ? { docai_layer_positions } : {}),
          ...(slide_copy_overrides && slide_copy_overrides.length > 0
            ? { slide_copy_overrides }
            : {}),
          text_backing: reprintTextBacking,
          text_backing_color: reprintTextBackingCss,
          ...(logoOverlayPayload ? { logo_overlay: logoOverlayPayload } : {}),
          ...(frameOverlayPayload ? { frame_overlay: frameOverlayPayload } : {}),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; accepted?: boolean; message?: string; error?: string };
      if ((!res.ok && res.status !== 202) || !json.ok) {
        throw new Error(json.error ?? json.message ?? `Reprint failed (${res.status})`);
      }
      void registerReviewBackgroundJob({
        kind: "text_reprint",
        taskId,
        project: projectSlug.trim(),
        slideIndices,
        startedMessage: "Text reprint queued — you can leave this page.",
      });
      setReprintMsg("Reprint started — we'll notify you when it's ready.");
      refreshCarouselAfterReprint();
    },
    [
      taskId,
      projectSlug,
      mimicV1,
      reprintTextBacking,
      reprintTextBackingCss,
      logoOverlayPayload,
      logoStampUrl,
      logoEnabled,
      brandLogoUrl,
      frameOverlayPayload,
      buildReprintTypographyPatch,
      buildSlideCopyOverrides,
      refreshCarouselAfterReprint,
    ]
  );

  const flushCurrentSlideLayout = useCallback(async (): Promise<boolean> => {

    if (!taskId.trim() || !projectSlug.trim() || layerPosDraft.length === 0) return true;

    if (!userTouchedLayout || !layoutDirty) return true;

    const merged = mergedSlideDraftsForCompare(slideDrafts, editorSlide, layerPosDraft);
    const key = persistKeyFor(editorSlide, layerPosDraft);
    if (lastPersistedKeysBySlideRef.current[editorSlide] === key) {
      setLayoutBaseline(mergedLayoutDraftCompareKey(merged, templateBgMode));
      setUserTouchedLayout(false);
      return true;
    }

    try {
      await persistAllSlideDrafts(merged);
      lastPersistedKeyRef.current = key;
      return true;
    } catch (e) {

      setLayerPosError(e instanceof Error ? e.message : "Auto-save failed");

      return false;

    }

  }, [

    taskId,

    projectSlug,

    layerPosDraft,

    userTouchedLayout,

    layoutDirty,

    editorSlide,

    slideDrafts,

    persistKeyFor,

    templateBgMode,

    persistAllSlideDrafts,

  ]);



  // Persist any pending layout for the slide we are leaving, then ask the parent to
  // switch. The parent updates `activeSlideIndex`, which flows back as `editorSlide`.
  const goToSlide = useCallback(
    (nextSlide: number) => {
      const n = Math.max(1, Math.min(slideCount, Math.floor(nextSlide) || 1));
      if (n === editorSlide) return;
      if (userTouchedLayout && layoutDirty) {
        void flushCurrentSlideLayout();
      }
      setLayerPosMsg(null);
      setLayerPosError(null);
      onSlideSelect?.(n);
    },
    [editorSlide, slideCount, userTouchedLayout, layoutDirty, flushCurrentSlideLayout, onSlideSelect]
  );

  // Debounced auto-save: persist layout positions only — reprint runs on explicit Reprint click.
  useEffect(() => {
    if (!userTouchedLayout || !layoutDirty || layerPosDraft.length === 0) return;
    const t = setTimeout(() => {
      void (async () => {
        const merged = mergedSlideDraftsForCompare(
          slideDraftsRef.current,
          editorSlide,
          layerPosDraft
        );
        const key = persistKeyFor(editorSlide, layerPosDraft);
        if (lastPersistedKeysBySlideRef.current[editorSlide] === key) {
          setLayoutBaseline(mergedLayoutDraftCompareKey(merged, templateBgMode));
          if (!templateBgMode) setUserTouchedLayout(false);
          return;
        }
        try {
          const { savedCount: saved } = await persistAllSlideDrafts(merged, {
            updateUserTouched: !templateBgMode,
          });
          if (saved > 0) lastPersistedKeyRef.current = key;
        } catch (e) {
          setLayerPosError(e instanceof Error ? e.message : "Auto-save failed");
        }
      })();
    }, 1200);
    return () => clearTimeout(t);
  }, [
    layerPosDraft,
    userTouchedLayout,
    layoutDirty,
    editorSlide,
    persistAllSlideDrafts,
    templateBgMode,
    persistKeyFor,
  ]);



  const handleLayoutInitialized = useCallback((overrides: DocAiLayerOverride[]) => {

    if (userTouchedLayoutRef.current) return;

    let normalized = normalizeLayerPosDraft(overrides, templateBgMode);
    if (fullBleedMode && copySlotsRef.current.length > 0) {
      normalized = pruneDraftToCopySlotLayers(normalized, copySlotsRef.current);
    }

    setLayerPosDraft((prev) => {
      if (prev.length > 0) return prev;
      return normalized;
    });

    setSlideDrafts((prev) => {
      if (prev[editorSlide]?.length) return prev;
      const next = { ...prev, [editorSlide]: normalized };
      setLayoutBaseline((baseline) =>
        baseline || mergedLayoutDraftCompareKey(next, templateBgMode)
      );
      return next;
    });

    setUserTouchedLayout(false);

  }, [editorSlide, templateBgMode, fullBleedMode]);



  const fetchInspectForSlide = useCallback(
    async (
      slideIndex: number,
      timeoutMs = INSPECT_FETCH_TIMEOUT_MS
    ): Promise<Record<string, unknown> | null> => {
      const cached = inspectCacheRef.current[slideIndex];
      if (cached) return cached;
      if (!buildInspectPayloadRef.current || !templateUsed) return null;
      try {
        const payload = buildInspectPayloadRef.current() ?? {};
        const bg = getBackgroundUrlRef.current?.(slideIndex);
        const draft = slideDraftsRef.current[slideIndex] ?? [];
        const positions = overridesForInspect(draft, templateBgMode);
        const res = await fetch("/api/renderer/inspect-slide-context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            template: templateUsed,
            slide_index: slideIndex,
            payload,
            instagram_handle: instagramHandle,
            text_backing: reprintTextBacking,
            text_backing_color: reprintTextBackingCss,
            ...(positions.length > 0 ? { docai_layer_positions: positions } : {}),
            ...(bg ? { background_image_url: bg } : {}),
          }),
        });
        const json = (await res.json()) as Record<string, unknown>;
        if (json.ok) {
          inspectCacheRef.current[slideIndex] = json;
          pruneInspectSlideCache(slideIndex);
          if (slideIndex === editorSlide) setRenderInspect(json);
          return json;
        }
      } catch {
        // ignore — caller handles empty layers
      }
      return null;
    },
    [
      templateUsed,
      templateBgMode,
      instagramHandle,
      reprintTextBacking,
      reprintTextBackingCss,
      editorSlide,
      pruneInspectSlideCache,
    ]
  );

  const fetchInspectForSlideRef = useRef(fetchInspectForSlide);
  fetchInspectForSlideRef.current = fetchInspectForSlide;

  const getFieldTextForSlide = useCallback(
    (slideIndex1Based: number, fieldRole: "headline" | "body"): string => {
      const fromResolver = resolveSlideFieldText?.(slideIndex1Based, fieldRole)?.trim();
      if (fromResolver) return fromResolver;
      if (buildSlideCopyOverrides) {
        const overrides = buildSlideCopyOverrides([slideIndex1Based]);
        const llm = overrides[0]?.llm_slide;
        if (fieldRole === "headline") return String(llm?.headline ?? "").trim();
        if (fieldRole === "body") return String(llm?.body ?? "").trim();
      }
      return "";
    },
    [resolveSlideFieldText, buildSlideCopyOverrides]
  );

  const applyLayerPatchToRoleAcrossDeck = useCallback(
    async (
      targetRole: "headline" | "body",
      patch: Partial<DocAiLayerOverride>,
      successLabel: string,
      options?: {
        silent?: boolean;
        baseDrafts?: Record<number, DocAiLayerOverride[]>;
        skipPersist?: boolean;
      }
    ): Promise<{ ok: boolean; message: string; drafts?: Record<number, DocAiLayerOverride[]> }> => {
      const serverDrafts = serverSlideDraftsFromMimicV1(mimicV1, templateBgMode);
      const nextDrafts: Record<number, DocAiLayerOverride[]> = {
        ...(options?.baseDrafts ?? slideDraftsRef.current),
      };

      const roleRefKeys = new Set<string>();
      if (!templateBgMode) {
        for (let s = 1; s <= slideCount; s++) {
          const slideSlots = copySlotsForSlideIndex(mimicV1, slideCopyLayout, s);
          const useCopySlotKeys =
            fullBleedMode && slideSlots.some((slot) => slot.llm_field !== "handle");
          if (useCopySlotKeys) {
            for (const key of copySlotKeysForLlmRole(slideSlots, targetRole)) {
              roleRefKeys.add(refKeyFromLayerPositionKey(key));
            }
            for (const row of nextDrafts[s] ?? serverDrafts[s] ?? []) {
              const field = copySlotLlmFieldForLayerKey(row.layer_key, slideSlots);
              if (field && layoutRoleMatchesField(field, targetRole)) {
                roleRefKeys.add(refKeyFromLayerPositionKey(row.layer_key));
              }
            }
            continue;
          }
          const inspectLayers = parseDocAiLayerBoxes(inspectCacheRef.current[s] ?? null);
          for (const layer of inspectLayers) {
            const role = layoutRoleForLayer(layer, undefined, fullBleedMode, templateBgMode, slideSlots);
            if (layoutRoleMatchesField(role, targetRole)) {
              roleRefKeys.add(refKeyFromLayerPositionKey(layer.layer_key));
            }
          }
          for (const row of nextDrafts[s] ?? serverDrafts[s] ?? []) {
            const field = copySlotLlmFieldForLayerKey(row.layer_key, slideSlots);
            const role = field ?? roleFromLayerKey(row.layer_key);
            if (layoutRoleMatchesField(role, targetRole)) {
              roleRefKeys.add(refKeyFromLayerPositionKey(row.layer_key));
            }
          }
        }
      }

      const patchRow = (row: DocAiLayerOverride): DocAiLayerOverride => ({
        ...row,
        ...patch,
        box_locked: patch.box_locked ?? row.box_locked ?? true,
      });

      const patchRowWithRefit = (row: DocAiLayerOverride, slideIndex: number): DocAiLayerOverride => {
        const next = patchRow(row);
        const refitHeadline =
          targetRole === "headline" && shouldRefitHeadlineOnDeckApply(successLabel);
        const refitBodyHeight =
          targetRole === "body" && shouldRefitBodyHeightOnDeckApply(successLabel);
        if (!refitHeadline && !refitBodyHeight) return next;
        return refitDeckApplyRowToSlideCopy(next, targetRole, getFieldTextForSlide(slideIndex, targetRole), {
          refitHeadline,
          refitBodyHeight,
        });
      };

      const deckApplyOpts = (slideIndex: number) => ({
        copyText: getFieldTextForSlide(slideIndex, targetRole),
        refitHeadline: targetRole === "headline" && shouldRefitHeadlineOnDeckApply(successLabel),
        refitBodyHeight: targetRole === "body" && shouldRefitBodyHeightOnDeckApply(successLabel),
      });

      if (!options?.skipPersist) {
        setLayerPosSaving(true);
      }
      setLayerPosError(null);
      const sourceSlot = templateBgMode ? templateBgSlotForSlide(editorSlide, slideCount) : null;
      const scopeLabel = sourceSlot ? templateBgDeckApplyScopeLabel(sourceSlot, slideCount) : null;
      try {
        if (!templateBgMode) {
          const slidesToPrefetch: number[] = [];
          for (let slide = 1; slide <= slideCount; slide++) {
            if (sourceSlot && templateBgSlotForSlide(slide, slideCount) !== sourceSlot) continue;
            if (!inspectCacheRef.current[slide]) slidesToPrefetch.push(slide);
          }
          if (slidesToPrefetch.length > 0) {
            if (!options?.silent) {
              setLayerPosMsg(`Loading slide layouts (${slidesToPrefetch.length})…`);
            }
            await Promise.all(
              slidesToPrefetch.map((slide) =>
                fetchInspectForSlide(slide, DECK_INSPECT_FETCH_TIMEOUT_MS)
              )
            );
          }
        }

        let touchedSlides = 0;
        const failedSlides: number[] = [];
        for (let slide = 1; slide <= slideCount; slide++) {
          if (sourceSlot && templateBgSlotForSlide(slide, slideCount) !== sourceSlot) continue;
          if (!options?.silent) {
            setLayerPosMsg(`Applying ${targetRole} ${successLabel} — slide ${slide} of ${slideCount}…`);
          }
          try {
            const existing = [...(nextDrafts[slide] ?? serverDrafts[slide] ?? [])];
            let inspectLayers: DocAiLayerBox[] = [];

            if (templateBgMode) {
              const cachedInspect = resolveTemplateBgInspectJsonForDeckApply(
                slide,
                slideCount,
                editorSlide,
                inspectCacheRef.current
              );
              inspectLayers = applyLayerDraftGeometryToBoxes(
                parseDocAiLayerBoxes(cachedInspect),
                existing
              );
            } else {
              let inspectJson: Record<string, unknown> | null = inspectCacheRef.current[slide] ?? null;
              if (!inspectJson) {
                inspectJson = await fetchInspectForSlide(slide);
              }
              inspectLayers = parseDocAiLayerBoxes(inspectJson);
            }

            if (templateBgMode) {
              const { rows, touched } = applyTemplateBgRolePatchToSlide(
                slide,
                slideCount,
                targetRole,
                patch,
                inspectLayers,
                existing,
                fullBleedMode,
                deckApplyOpts(slide)
              );
              if (touched) {
                nextDrafts[slide] = rows;
                touchedSlides += 1;
              }
              continue;
            }

          const byKey = new Map(existing.map((r) => [r.layer_key, { ...r }]));
          let slideTouched = false;
          const slideSlots = copySlotsForSlideIndex(mimicV1, slideCopyLayout, slide);
          const useCopySlotKeys =
            !templateBgMode &&
            fullBleedMode &&
            slideSlots.some((slot) => slot.llm_field !== "handle");

          if (useCopySlotKeys) {
            for (const key of copySlotKeysForLlmRole(slideSlots, targetRole)) {
              const row = byKey.get(key);
              const inspectSlotBox = inspectLayers.find((layer) => layer.layer_key === key);
              const base: DocAiLayerOverride =
                row ??
                ({
                  layer_key: key,
                  x_px: inspectSlotBox?.x_px ?? patch.x_px ?? 80,
                  y_px: inspectSlotBox?.y_px ?? patch.y_px ?? 120,
                  w_px: inspectSlotBox?.w_px ?? patch.w_px ?? 320,
                  h_px: inspectSlotBox?.h_px ?? patch.h_px ?? 64,
                  box_locked: true,
                } as DocAiLayerOverride);
              byKey.set(key, patchRowWithRefit(base, slide));
              slideTouched = true;
            }
            for (const [key, row] of byKey.entries()) {
              if (!isCopySlotEditorLayerKey(key) && !key.startsWith("custom@")) continue;
              const field = copySlotLlmFieldForLayerKey(key, slideSlots);
              const role = field ?? roleFromLayerKey(key);
              const ref = refKeyFromLayerPositionKey(key);
              const matchesRole = layoutRoleMatchesField(role, targetRole);
              const matchesRef = roleRefKeys.has(ref);
              if (!matchesRole && !matchesRef) continue;
              byKey.set(key, patchRowWithRefit(row, slide));
              slideTouched = true;
            }
          } else {
            for (const layer of inspectLayers) {
              const row = byKey.get(layer.layer_key);
              const role = layoutRoleForLayer(layer, row, fullBleedMode, templateBgMode, slideSlots);
              const ref = refKeyFromLayerPositionKey(layer.layer_key);
              const matchesRole = layoutRoleMatchesField(role, targetRole);
              const matchesRef = !templateBgMode && roleRefKeys.size > 0 && roleRefKeys.has(ref);
              if (!matchesRole && !matchesRef) continue;
              const base: DocAiLayerOverride =
                row ??
                ({
                  layer_key: layer.layer_key,
                  x_px: layer.x_px,
                  y_px: layer.y_px,
                  w_px: layer.w_px,
                  h_px: layer.h_px,
                  box_locked: true,
                } as DocAiLayerOverride);
              byKey.set(layer.layer_key, patchRowWithRefit(base, slide));
              slideTouched = true;
            }

            for (const [key, row] of byKey.entries()) {
              const role = roleFromLayerKey(key);
              const ref = refKeyFromLayerPositionKey(key);
              const matchesRole = layoutRoleMatchesField(role, targetRole);
              const matchesRef = !templateBgMode && roleRefKeys.has(ref);
              if (!matchesRole && !matchesRef) continue;
              byKey.set(key, patchRowWithRefit(row, slide));
              slideTouched = true;
            }
          }

          if (slideTouched && byKey.size > 0) {
            let rows = normalizeLayerPosDraft(Array.from(byKey.values()), templateBgMode);
            if (useCopySlotKeys) {
              rows = pruneDraftToCopySlotLayers(rows, slideSlots);
            }
            nextDrafts[slide] = rows;
            touchedSlides += 1;
          }
          } catch {
            failedSlides.push(slide);
          }
        }

        if (touchedSlides === 0) {
          const msg = `No ${targetRole} boxes found to update — select a ${targetRole} box on this slide first.`;
          if (!options?.silent) setLayerPosMsg(msg);
          return { ok: false, message: msg, drafts: nextDrafts };
        }

        setSlideDrafts(nextDrafts);
        let current = nextDrafts[editorSlide];
        if (
          fullBleedMode &&
          slideUsesCopySlotEditorLayers(mimicV1, slideCopyLayout, editorSlide) &&
          current?.length
        ) {
          const editorSlots = copySlotsForSlideIndex(mimicV1, slideCopyLayout, editorSlide);
          current = pruneDraftToCopySlotLayers(current, editorSlots);
        }
        if (current?.length) {
          setLayerPosDraft(current);
          setDraftSyncRevision((v) => v + 1);
          setLayoutBaseline(mergedLayoutDraftCompareKey(nextDrafts, templateBgMode));
        }
        setUserTouchedLayout(true);

        let persistedCount = 0;
        let persistFailedSlides: number[] = [];
        if (!options?.skipPersist) {
          try {
            const persistResult = await persistAllSlideDrafts(nextDrafts, {
              timeoutMs: DECK_PERSIST_TIMEOUT_MS,
              onProgress: options?.silent
                ? undefined
                : (done, total) => setLayerPosMsg(`Saving layouts — ${done} of ${total}…`),
            });
            persistedCount = persistResult.savedCount;
            persistFailedSlides = persistResult.failedSlides;
          } catch (e) {
            const saveErr = e instanceof Error ? e.message : "Failed to save layouts";
            setLayerPosError(saveErr);
            const msg = `Applied ${targetRole} ${successLabel} to ${touchedSlides} slides but save failed — click Save all slides before refreshing.`;
            if (!options?.silent) setLayerPosMsg(msg);
            return { ok: false, message: msg, drafts: nextDrafts };
          }
        }

        const allFailedSlides = [...new Set([...failedSlides, ...persistFailedSlides])].sort(
          (a, b) => a - b
        );
        const failSuffix =
          allFailedSlides.length > 0
            ? ` (${allFailedSlides.length} slide${allFailedSlides.length === 1 ? "" : "s"} could not be updated)`
            : "";
        const scopeSuffix = scopeLabel ? ` (${scopeLabel} only)` : "";
        const persistSuffix = options?.skipPersist
          ? ""
          : ` and saved ${persistedCount}`;
        const msg = `Applied ${targetRole} ${successLabel} to ${touchedSlides} slide${touchedSlides === 1 ? "" : "s"}${scopeSuffix}${persistSuffix}${failSuffix}. Safe to refresh — reprint when ready.`;
        if (!options?.silent) setLayerPosMsg(msg);
        return { ok: allFailedSlides.length === 0, message: msg, drafts: nextDrafts };
      } catch (e) {
        const msg = e instanceof Error ? e.message : `Failed to apply ${targetRole} ${successLabel}`;
        setLayerPosError(msg);
        return { ok: false, message: msg, drafts: nextDrafts };
      } finally {
        if (!options?.skipPersist) {
          setLayerPosSaving(false);
        }
      }
    },
    [
      mimicV1,
      slideCopyLayout,
      templateBgMode,
      slideDrafts,
      slideCount,
      fullBleedMode,
      editorSlide,
      fetchInspectForSlide,
      persistLayerPositions,
      onMimicLayoutSaved,
      persistKeyFor,
      getFieldTextForSlide,
      persistAllSlideDrafts,
    ]
  );

  const applyTypographyToRole = useCallback(
    (targetRole: "headline" | "body", style: DocAiLayerTypographyStyle) =>
      applyLayerPatchToRoleAcrossDeck(targetRole, style, "typography"),
    [applyLayerPatchToRoleAcrossDeck]
  );

  const applyPlacementToRole = useCallback(
    (targetRole: "headline" | "body", placement: DocAiLayerPlacementStyle) =>
      applyLayerPatchToRoleAcrossDeck(targetRole, placement, "box placement"),
    [applyLayerPatchToRoleAcrossDeck]
  );



  const renderInspectRef = useRef(renderInspect);
  renderInspectRef.current = renderInspect;

  const handleLayerDraftChange = useCallback(

    (overrides: DocAiLayerOverride[]) => {

      if (
        templateBgMode &&
        onTemplateBgFieldTextChange &&
        templateBgFieldRoles.length > 0 &&
        !templateBgCopySyncingToLayoutRef.current
      ) {
        const prevByKey = new Map(layerPosDraft.map((row) => [row.layer_key, row]));
        const inspectBoxes = parseDocAiLayerBoxes(renderInspectRef.current);
        for (const row of overrides) {
          const prev = prevByKey.get(row.layer_key);
          const nextText = row.text?.trim();
          if (!nextText || nextText === "New text" || nextText === prev?.text?.trim()) continue;
          const layer = inspectBoxes.find((l) => l.layer_key === row.layer_key);
          const fieldRole = templateBgFieldRoleForLayer(
            layer ?? {
              layer_key: row.layer_key,
              text: nextText,
              role: "body",
              x_px: row.x_px,
              y_px: row.y_px,
              w_px: row.w_px ?? 120,
              h_px: row.h_px ?? 48,
            },
            row,
            templateBgFieldRoles,
            fullBleedMode,
            templateBgMode
          );
          if (fieldRole) onTemplateBgFieldTextChange(editorSlide, fieldRole, nextText);
        }
      }

      let normalized = normalizeLayerPosDraft(overrides, templateBgMode);
      if (fullBleedMode && copySlotsRef.current.length > 0) {
        normalized = pruneDraftToCopySlotLayers(normalized, copySlotsRef.current);
      }

      if (fullBleedMode && onLayoutTextBlocksChange && copySlotsRef.current.length > 0) {
        const prevTextFp = JSON.stringify(
          layerPosDraft
            .filter((r) => isCopySlotEditorLayerKey(r.layer_key))
            .map((r) => r.text?.trim() ?? "")
        );
        const nextTextFp = JSON.stringify(
          normalized
            .filter((r) => isCopySlotEditorLayerKey(r.layer_key))
            .map((r) => r.text?.trim() ?? "")
        );
        if (nextTextFp !== prevTextFp) {
          const sorted = [...copySlotsRef.current].sort((a, b) => a.slot_index - b.slot_index);
          const editable = sorted.filter((s) => s.llm_field !== "handle");
          const blocks = editable
            .map((slot) => {
              const slotKey = copySlotEditorLayerKey(slot.slot_index);
              const text = normalized.find((r) => r.layer_key === slotKey)?.text?.trim() ?? "";
              if (!text) return null;
              return {
                role: slot.llm_field === "headline" ? "headline" : "body",
                text,
                layer_key: slotKey,
              };
            })
            .filter((b): b is { role: string; text: string; layer_key: string } => Boolean(b));
          if (blocks.length > 0) {
            const fp = `${editorSlide}:${JSON.stringify(blocks)}`;
            if (fp !== lastEmittedTextBlocksRef.current) {
              lastEmittedTextBlocksRef.current = fp;
              onLayoutTextBlocksChange(editorSlide, blocks);
            }
          }
        }
      }

      setLayerPosDraft(normalized);

      setSlideDrafts((prev) => ({ ...prev, [editorSlide]: normalized }));

      setUserTouchedLayout(true);

    },

    [
      editorSlide,
      templateBgMode,
      onTemplateBgFieldTextChange,
      templateBgFieldRoles,
      fullBleedMode,
      onLayoutTextBlocksChange,
      layerPosDraft,
    ]

  );

  const persistedPositionsForInspect = useMemo(
    () =>
      overridesForInspect(
        layerPosDraft.length > 0 ? layerPosDraft : slideDrafts[editorSlide] ?? [],
        templateBgMode
      ),
    [layerPosDraft, slideDrafts, editorSlide, templateBgMode]
  );

  // Inspect only needs the *base* OCR layer geometry, which changes per slide — not on
  // every keystroke. We read the current copy/positions from refs so typing never
  // retriggers the fetch (this is what caused the flicker between text blocks).
  const persistedPositionsForInspectRef = useRef(persistedPositionsForInspect);
  persistedPositionsForInspectRef.current = persistedPositionsForInspect;

  const inspectSlideForRender = useMemo(() => {
    if (!renderInspect || renderInspect.error) return null;
    const idx = Number(renderInspect.slide_index);
    return Number.isFinite(idx) && idx >= 1 ? idx : null;
  }, [renderInspect]);



  useEffect(() => {

    if (!buildInspectPayloadRef.current || !templateUsed || slideCount < 1) {

      setRenderInspect(null);

      setRenderInspectLoading(false);

      return;

    }

    const gen = ++inspectRequestGenRef.current;
    const hadCachedInspect = Boolean(inspectCacheRef.current[editorSlide]);

    const timer = window.setTimeout(() => {

      void (async () => {

        if (!hadCachedInspect) setRenderInspectLoading(true);

        try {

          const payload = buildInspectPayloadRef.current?.() ?? {};

          const bg = getBackgroundUrlRef.current?.(editorSlide);

          const res = await fetch("/api/renderer/inspect-slide-context", {

            method: "POST",

            headers: { "Content-Type": "application/json" },

            signal: AbortSignal.timeout(INSPECT_FETCH_TIMEOUT_MS),

            body: JSON.stringify({

              template: templateUsed,

              slide_index: editorSlide,

              payload,

              instagram_handle: instagramHandle,

              text_backing: reprintTextBacking,

              text_backing_color: reprintTextBackingCss,

              ...(persistedPositionsForInspectRef.current.length > 0

                ? { docai_layer_positions: persistedPositionsForInspectRef.current }

                : {}),

              ...(bg ? { background_image_url: bg } : {}),

            }),

          });

          const json = (await res.json()) as Record<string, unknown>;

          if (inspectRequestGenRef.current !== gen) return;

          if (json.ok) {
            inspectCacheRef.current[editorSlide] = json;
            pruneInspectSlideCache(editorSlide);
            setRenderInspect(json);
            for (const neighbor of [editorSlide - 1, editorSlide + 1]) {
              if (neighbor < 1 || neighbor > slideCount) continue;
              if (inspectCacheRef.current[neighbor]) continue;
              void fetchInspectForSlideRef.current(neighbor);
            }
          } else {
            setRenderInspect({ error: json.error ?? "inspect failed" });
          }

        } catch (e) {

          if (inspectRequestGenRef.current !== gen) return;

          setRenderInspect({ error: e instanceof Error ? e.message : "inspect failed" });

        } finally {

          if (inspectRequestGenRef.current === gen) setRenderInspectLoading(false);

        }

      })();

    }, hadCachedInspect ? 120 : 0);

    return () => {

      inspectRequestGenRef.current += 1;

      window.clearTimeout(timer);

    };

  }, [
    templateUsed,
    editorSlide,
    slideCount,
    instagramHandle,
    reprintTextBacking,
    reprintTextBackingCss,
    assetRefreshKey,
  ]);

function collapseTemplateBgDocAiLayerBoxes(
  boxes: DocAiLayerBox[],
  templateBgFieldRoles: string[],
  fullBleedMode: boolean,
  templateBgMode: boolean
): DocAiLayerBox[] {
  if (!templateBgMode || templateBgFieldRoles.length === 0) return boxes;
  const kept: DocAiLayerBox[] = [];
  const seenFieldRoles = new Set<string>();
  for (const layer of boxes) {
    const role = layoutRoleForLayer(layer, undefined, fullBleedMode, templateBgMode);
    const fieldRole = templateBgFieldRoles.find((fr) => layoutRoleMatchesField(role, fr));
    if (!fieldRole) {
      kept.push(layer);
      continue;
    }
    if (seenFieldRoles.has(fieldRole)) continue;
    seenFieldRoles.add(fieldRole);
    kept.push(layer);
  }
  return kept;
}

/** When inspect only returned headline OCR, still show editable body/handle slots from slide copy. */
function ensureTemplateBgFieldLayerBoxes(
  boxes: DocAiLayerBox[],
  templateBgFieldRoles: string[],
  templateBgFieldTexts: string[],
  fullBleedMode: boolean,
  templateBgMode: boolean,
  slot: ReturnType<typeof templateBgSlotForSlide>
): DocAiLayerBox[] {
  if (!templateBgMode || templateBgFieldRoles.length === 0) return boxes;
  const result = [...boxes];
  const rolePresent = (fieldRole: string) =>
    result.some((layer) =>
      layoutRoleMatchesField(layoutRoleForLayer(layer, undefined, fullBleedMode, templateBgMode), fieldRole)
    );

  const headlineLayer = result.find((layer) =>
    layoutRoleMatchesField(layoutRoleForLayer(layer, undefined, fullBleedMode, templateBgMode), "headline")
  );

  for (let i = 0; i < templateBgFieldRoles.length; i++) {
    const fieldRole = templateBgFieldRoles[i]!;
    const fieldText = templateBgFieldTexts[i] ?? "";
    if (fieldRole === "handle" && slot !== "cta") continue;
    if (!fieldText.trim()) continue;
    if (rolePresent(fieldRole)) continue;

    const anchor = headlineLayer ?? result[result.length - 1];
    const xPx = anchor?.x_px ?? 108;
    const wPx = anchor?.w_px ?? 864;
    const yPx =
      fieldRole === "headline"
        ? (anchor?.y_px ?? 108)
        : fieldRole === "body"
          ? headlineLayer
            ? headlineLayer.y_px + headlineLayer.h_px + 24
            : 280
          : anchor
            ? anchor.y_px + anchor.h_px + 16
            : 1180;
    const hPx = fieldRole === "body" ? 520 : fieldRole === "headline" ? 120 : 48;

    result.push({
      layer_key: `${fieldRole}@${Math.round(xPx)},${Math.round(yPx)}:template_bg_synth`,
      text: fieldText,
      role: fieldRole,
      x_px: xPx,
      y_px: Math.min(yPx, 1220),
      w_px: wPx,
      h_px: hPx,
    });
  }
  return result;
}

/** When OCR inspect is empty, seed one editable box per on-slide phrase so the three-column editor still loads. */
function ensureFullBleedTextLayerBoxes(
  boxes: DocAiLayerBox[],
  slotTexts: string[],
  draftByKey: Map<string, DocAiLayerOverride>,
  useCopySlotKeys: boolean
): DocAiLayerBox[] {
  if (boxes.length > 0) return boxes;
  const trimmed = slotTexts.map((t) => t.trim()).filter(Boolean);
  if (trimmed.length === 0) return boxes;

  const out: DocAiLayerBox[] = [];
  let blockIndex = 0;
  for (let i = 0; i < slotTexts.length; i++) {
    const text = slotTexts[i]?.trim();
    if (!text) continue;
    const layerKey = useCopySlotKeys ? copySlotEditorLayerKey(i) : `slot@${blockIndex}`;
    const row = draftByKey.get(layerKey);
    const role = blockIndex === 0 ? "headline" : "body";
    const yPx = blockIndex === 0 ? 108 : 280 + (blockIndex - 1) * 140;
    const hPx = blockIndex === 0 ? 120 : Math.min(520, 180 + Math.ceil(text.length / 48) * 40);
    out.push({
      layer_key: layerKey,
      text: row?.text?.trim() || text,
      role,
      block_index: blockIndex,
      x_px: row?.x_px ?? 108,
      y_px: row?.y_px ?? yPx,
      w_px: Math.max(24, row?.w_px ?? 864),
      h_px: Math.max(20, row?.h_px ?? hPx),
      font_size_px: row?.font_size_px,
    });
    blockIndex += 1;
  }
  return out;
}

  const docAiLayerBoxes = useMemo(() => {
    let boxes = parseDocAiLayerBoxes(renderInspect);
    if (templateBgMode) {
      const slot = templateBgSlotForSlide(editorSlide, slideCount);
      if (slot !== "cta") {
        boxes = boxes.filter((layer) => {
          if (layer.layer_key?.startsWith("custom@")) return true;
          const role = (layer.role ?? "").trim().toLowerCase();
          return role !== "handle";
        });
      }
      boxes = collapseTemplateBgDocAiLayerBoxes(
        boxes,
        templateBgFieldRoles,
        fullBleedMode,
        templateBgMode
      );
      boxes = ensureTemplateBgFieldLayerBoxes(
        boxes,
        templateBgFieldRoles,
        templateBgFieldTexts,
        fullBleedMode,
        templateBgMode,
        slot
      );
      let blockIndex = 0;
      const withIndices = boxes.map((layer) => {
        const withIdx = { ...layer, block_index: blockIndex };
        blockIndex += 1;
        return withIdx;
      });
      const draftForGeometry =
        layerPosDraft.length > 0 ? layerPosDraft : slideDrafts[editorSlide] ?? [];
      return applyLayerDraftGeometryToBoxes(withIndices, draftForGeometry);
    }
    const draftByKey = new Map(layerPosDraft.map((row) => [row.layer_key, row]));
    const customDraftRows = layerPosDraft.filter(
      (row) => row.layer_key.startsWith("custom@") && !row.hidden && !isPlaceholderCustomLayer(
        {
          layer_key: row.layer_key,
          text: row.text ?? "",
          role: roleFromLayerKey(row.layer_key),
          x_px: row.x_px,
          y_px: row.y_px,
          w_px: row.w_px ?? 120,
          h_px: row.h_px ?? 48,
        },
        row
      )
    );
    const filtered = boxes.filter((layer) => {
      if (isDraftHiddenForLayer(layer.layer_key, draftByKey)) return false;
      if (isPlaceholderCustomLayer(layer, draftByKey.get(layer.layer_key))) return false;
      if (
        customDraftRows.some((draftRow) => isLegacyInspectEchoOfCustomDraft(layer, draftRow))
      ) {
        return false;
      }
      return true;
    });
    const dedupedInspect = filtered.filter((layer, index, arr) => {
      const layerText = normalizePhraseKey(layer.text ?? "");
      if (layerText.length < 3 || layer.layer_key?.startsWith("custom@")) return true;
      const firstIndex = arr.findIndex(
        (other) =>
          !other.layer_key?.startsWith("custom@") &&
          normalizePhraseKey(other.text ?? "") === layerText &&
          Math.abs(other.x_px - layer.x_px) <= 48 &&
          Math.abs(other.y_px - layer.y_px) <= 48
      );
      return firstIndex === index;
    });
    const willCollapseToCopySlots =
      fullBleedMode &&
      copySlotsForEditor.filter((s) => s.llm_field !== "handle").length > 0;
    const seenKeys = new Set(dedupedInspect.map((l) => l.layer_key));
    if (!willCollapseToCopySlots) {
      for (const row of layerPosDraft) {
        if (row.hidden || seenKeys.has(row.layer_key)) continue;
        if (isPlaceholderCustomLayer(
          { layer_key: row.layer_key, text: row.text ?? "", role: roleFromLayerKey(row.layer_key), x_px: row.x_px, y_px: row.y_px, w_px: row.w_px ?? 120, h_px: row.h_px ?? 48 },
          row
        )) continue;
        dedupedInspect.push({
          layer_key: row.layer_key,
          text: row.text ?? "",
          role: roleFromLayerKey(row.layer_key),
          x_px: row.x_px,
          y_px: row.y_px,
          w_px: Math.max(24, row.w_px ?? 120),
          h_px: Math.max(20, row.h_px ?? 48),
          font_size_px: row.font_size_px,
        });
        seenKeys.add(row.layer_key);
      }
    } else {
      for (const row of layerPosDraft) {
        if (row.hidden || !isCopySlotEditorLayerKey(row.layer_key) || seenKeys.has(row.layer_key)) {
          continue;
        }
        dedupedInspect.push({
          layer_key: row.layer_key,
          text: row.text ?? "",
          role:
            copySlotLlmFieldForLayerKey(row.layer_key, copySlotsForEditor) ??
            roleFromLayerKey(row.layer_key),
          x_px: row.x_px,
          y_px: row.y_px,
          w_px: Math.max(24, row.w_px ?? 120),
          h_px: Math.max(20, row.h_px ?? 48),
          font_size_px: row.font_size_px,
        });
        seenKeys.add(row.layer_key);
      }
    }
    let collapsed = dedupedInspect;
    if (willCollapseToCopySlots) {
      collapsed = collapseDocAiLayerBoxesToCopySlots(
        dedupedInspect,
        draftByKey,
        copySlotsForEditor,
        fullBleedSlotTexts
      );
    }
    if (collapsed.length === 0 && fullBleedSlotTexts.some((t) => t.trim())) {
      collapsed = ensureFullBleedTextLayerBoxes(
        collapsed,
        fullBleedSlotTexts,
        draftByKey,
        willCollapseToCopySlots
      );
    }
    let blockIndex = 0;
    return collapsed.map((layer) => {
      const withIdx = { ...layer, block_index: blockIndex };
      blockIndex += 1;
      return withIdx;
    });
  }, [
    renderInspect,
    layerPosDraft,
    slideDrafts,
    templateBgMode,
    editorSlide,
    slideCount,
    templateBgFieldRoles,
    templateBgFieldTexts,
    fullBleedMode,
    copySlotsForEditor,
    fullBleedSlotTexts,
  ]);

  const applyAllLayoutSettingsToDeck = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const sourceDraft = layerPosDraft.length > 0 ? layerPosDraft : slideDrafts[editorSlide] ?? [];
    const fieldRoles = templateBgEditorFieldRolesForSlideIndex(editorSlide, slideCount);
    const layers = docAiLayerBoxes;

    const findSource = (targetRole: "headline" | "body") => {
      for (const layer of layers) {
        const row = sourceDraft.find(
          (r) =>
            r.layer_key === layer.layer_key ||
            refKeyFromLayerPositionKey(r.layer_key) === refKeyFromLayerPositionKey(layer.layer_key)
        );
        if (docAiLayerMatchesTargetRole(layer, row, targetRole, fieldRoles, fullBleedMode, templateBgMode)) {
          const baseRow: DocAiLayerOverride =
            row ??
            ({
              layer_key: layer.layer_key,
              x_px: layer.x_px,
              y_px: layer.y_px,
              w_px: layer.w_px,
              h_px: layer.h_px,
              font_size_px: layer.font_size_px,
              box_locked: true,
            } as DocAiLayerOverride);
          return { layer, row: baseRow };
        }
      }
      for (const row of sourceDraft) {
        if (draftRowMatchesTargetRole(row, targetRole, fieldRoles, fullBleedMode, templateBgMode)) {
          const layer = layers.find((l) => l.layer_key === row.layer_key) ?? null;
          return { layer, row };
        }
      }
      return null;
    };

    const headlineSource = findSource("headline");
    const bodySource = findSource("body");
    if (!headlineSource && !bodySource) {
      return {
        ok: false,
        message: "Edit headline and body boxes on this slide first, then apply to all.",
      };
    }

    let workingDrafts = { ...slideDraftsRef.current };
    let appliedHeadline = false;
    let appliedBody = false;

    setLayerPosSaving(true);
    setLayerPosError(null);
    setLayerPosMsg("Applying layout to slides…");

    if (headlineSource) {
      const patch = combinedLayoutPatchFromRow(headlineSource.row, headlineSource.layer);
      const res = await applyLayerPatchToRoleAcrossDeck("headline", patch, "layout", {
        silent: true,
        baseDrafts: workingDrafts,
        skipPersist: true,
      });
      if (res.drafts) {
        workingDrafts = res.drafts;
        appliedHeadline = true;
      }
    }

    if (bodySource) {
      const patch = combinedLayoutPatchFromRow(bodySource.row, bodySource.layer);
      const res = await applyLayerPatchToRoleAcrossDeck("body", patch, "layout", {
        silent: true,
        baseDrafts: workingDrafts,
        skipPersist: true,
      });
      if (res.drafts) {
        workingDrafts = res.drafts;
        appliedBody = true;
      }
    }

    if (!appliedHeadline && !appliedBody) {
      const msg = "Could not apply layout — select headline/body boxes on this slide and try again.";
      setLayerPosMsg(msg);
      setLayerPosSaving(false);
      return { ok: false, message: msg };
    }

    setSlideDrafts(workingDrafts);
    const current = workingDrafts[editorSlide];
    if (current?.length) {
      setLayerPosDraft(current);
      setDraftSyncRevision((v) => v + 1);
      setLayoutBaseline(mergedLayoutDraftCompareKey(workingDrafts, templateBgMode));
    }
    setUserTouchedLayout(true);

    let persistFailedSlides: number[] = [];
    let persistedCount = 0;
    try {
      const persistResult = await persistAllSlideDrafts(workingDrafts, {
        timeoutMs: DECK_PERSIST_TIMEOUT_MS,
        onProgress: (done, total) => setLayerPosMsg(`Saving layouts — ${done} of ${total}…`),
      });
      persistedCount = persistResult.savedCount;
      persistFailedSlides = persistResult.failedSlides;
    } catch (e) {
      const saveErr = e instanceof Error ? e.message : "Failed to save layouts";
      setLayerPosError(saveErr);
      const msg =
        "Layout applied in the editor but save failed — click Save all slides before refreshing.";
      setLayerPosMsg(msg);
      return { ok: false, message: msg };
    } finally {
      setLayerPosSaving(false);
    }

    const roleLabel = [appliedHeadline ? "headline" : null, appliedBody ? "body" : null]
      .filter(Boolean)
      .join(" + ");
    const scopeLabel = templateBgDeckApplyScopeLabel(
      templateBgSlotForSlide(editorSlide, slideCount),
      slideCount
    );
    const failSuffix =
      persistFailedSlides.length > 0
        ? ` (${persistFailedSlides.length} slide${persistFailedSlides.length === 1 ? "" : "s"} could not be saved)`
        : "";
    const msg = `Applied ${roleLabel} to ${scopeLabel} (headlines auto-sized per slide). Saved ${persistedCount} slide${persistedCount === 1 ? "" : "s"}${failSuffix} — safe to refresh. Reprint when images should match.`;
    setLayerPosMsg(msg);
    return { ok: persistFailedSlides.length === 0, message: msg };
  }, [
    layerPosDraft,
    slideDrafts,
    editorSlide,
    slideCount,
    docAiLayerBoxes,
    fullBleedMode,
    templateBgMode,
    applyLayerPatchToRoleAcrossDeck,
    persistAllSlideDrafts,
  ]);

  const editorLayers = useMemo(() => {
    if (fullBleedMode && fullBleedSlotTexts.length > 0) {
      return docAiLayerBoxes.map((layer) => {
        const slotIdx = layer.block_index ?? 0;
        const slotText = fullBleedSlotTexts[slotIdx]?.trim();
        return slotText ? { ...layer, text: slotText } : layer;
      });
    }
    if (!templateBgMode || templateBgFieldRoles.length === 0) return docAiLayerBoxes;
    const fieldTextsByRole = new Map(
      templateBgFieldRoles.map((role, i) => [role, templateBgFieldTexts[i] ?? ""])
    );
    const draftByKey = new Map(layerPosDraft.map((row) => [row.layer_key, row]));
    return docAiLayerBoxes.map((layer) => {
      const fieldRole = templateBgFieldRoleForLayer(
        layer,
        draftByKey.get(layer.layer_key),
        templateBgFieldRoles,
        fullBleedMode,
        templateBgMode
      );
      const copyText = fieldRole ? fieldTextsByRole.get(fieldRole) : undefined;
      const role = layoutRoleForLayer(
        layer,
        draftByKey.get(layer.layer_key),
        fullBleedMode,
        templateBgMode
      );
      if (copyText !== undefined && copyText.trim()) {
        return { ...layer, text: copyText };
      }
      return layer;
    });
  }, [
    docAiLayerBoxes,
    templateBgMode,
    templateBgFieldRoles,
    templateBgFieldTexts,
    layerPosDraft,
    fullBleedMode,
    fullBleedSlotTexts,
  ]);

  const layoutTextBlocks = useMemo(() => {
    const draftByKey = new Map(layerPosDraft.map((row) => [row.layer_key, row]));
    const fieldTextsByRole =
      templateBgMode && templateBgFieldRoles.length > 0
        ? new Map(templateBgFieldRoles.map((role, i) => [role, templateBgFieldTexts[i] ?? ""]))
        : null;
    const perBox = docAiLayerBoxes.map((layer) => {
      const row = draftByKey.get(layer.layer_key);
      const role = layoutRoleForLayer(layer, row, fullBleedMode, templateBgMode, copySlotsForEditor);
      const fieldRole = templateBgFieldRoleForLayer(
        layer,
        row,
        templateBgFieldRoles,
        fullBleedMode,
        templateBgMode
      );
      const fromField = fieldRole && fieldTextsByRole ? fieldTextsByRole.get(fieldRole) : undefined;
      return {
        role,
        text: (fromField !== undefined ? fromField : row?.text) ?? layer.text,
        layer_key: layer.layer_key,
        block_index: layer.block_index ?? 0,
      };
    });
    if (fullBleedMode && copySlotsForEditor.length > 0) {
      const collapsed = collapseLayoutBlocksToCopySlots(
        docAiLayerBoxes,
        draftByKey,
        copySlotsForEditor,
        fullBleedMode,
        templateBgMode,
        fullBleedSlotTexts
      );
      if (collapsed.length > 0) return collapsed;
    }
    return perBox;
  }, [
    docAiLayerBoxes,
    layerPosDraft,
    fullBleedMode,
    templateBgMode,
    templateBgFieldRoles,
    templateBgFieldTexts,
    copySlotsForEditor,
    fullBleedSlotTexts,
  ]);

  useEffect(() => {
    if (!onLayoutTextBlocksChange || templateBgMode || fullBleedMode) return;
    if (renderInspectLoading) return;
    if (inspectSlideForRender !== editorSlide) return;
    const next = layoutTextBlocks.map(({ role, text, layer_key }) => ({ role, text, layer_key }));
    const fingerprint = `${editorSlide}:${JSON.stringify(next)}`;
    if (fingerprint === lastEmittedTextBlocksRef.current) return;
    lastEmittedTextBlocksRef.current = fingerprint;
    onLayoutTextBlocksChange(editorSlide, next);
  }, [
    layoutTextBlocks,
    editorSlide,
    onLayoutTextBlocksChange,
    templateBgMode,
    renderInspectLoading,
    inspectSlideForRender,
  ]);

  const activeLayoutBlockIndex = useMemo(() => {
    if (activeTextBlockIndex == null) return null;
    if (fullBleedMode && copySlotsForEditor.length > 0) {
      const { start } = ocrBoxSpanForClusterIndex(activeTextBlockIndex, copySlotsForEditor);
      return start;
    }
    if (!templateBgMode || templateBgFieldRoles.length === 0) return activeTextBlockIndex;
    const fieldRole = templateBgFieldRoles[activeTextBlockIndex];
    if (!fieldRole) return activeTextBlockIndex;
    const match = layoutTextBlocks.find((layer) => layoutRoleMatchesField(layer.role, fieldRole));
    return match?.block_index ?? activeTextBlockIndex;
  }, [activeTextBlockIndex, templateBgMode, templateBgFieldRoles, layoutTextBlocks, fullBleedMode, copySlotsForEditor]);

  const handleActiveLayoutBlockChange = useCallback(
    (blockIndex: number | null) => {
      if (!onActiveTextBlockIndexChange) return;
      if (fullBleedMode && blockIndex != null && copySlotsRef.current.length > 0) {
        onActiveTextBlockIndexChange(clusterIndexForOcrBoxIndex(blockIndex, copySlotsRef.current));
        return;
      }
      if (!templateBgMode || blockIndex == null) {
        onActiveTextBlockIndexChange(blockIndex);
        return;
      }
      const layer = layoutTextBlocks.find((l) => l.block_index === blockIndex);
      if (!layer) {
        onActiveTextBlockIndexChange(blockIndex);
        return;
      }
      const fieldIdx = templateBgFieldRoles.findIndex((role) => layoutRoleMatchesField(layer.role, role));
      onActiveTextBlockIndexChange(fieldIdx >= 0 ? fieldIdx : blockIndex);
    },
    [onActiveTextBlockIndexChange, templateBgMode, templateBgFieldRoles, layoutTextBlocks]
  );

  const templateBgFieldRolesRef = useRef(templateBgFieldRoles);
  templateBgFieldRolesRef.current = templateBgFieldRoles;

  useEffect(() => {
    if (!registerTextBlockUpdater) return;
    registerTextBlockUpdater((blockIndex, text) => {
      const slots = copySlotsRef.current;
      const fieldRole = templateBgMode ? templateBgFieldRolesRef.current[blockIndex] : undefined;
      const inspectBoxes = parseDocAiLayerBoxes(renderInspectRefForUpdater.current);
      const draft = layerPosDraftRef.current;
      const boxes = docAiLayerBoxesRef.current;
      const blocks = layoutTextBlocksRef.current;
      const draftByKey = new Map(draft.map((row) => [row.layer_key, row]));

      if (fullBleedMode && slots.length > 0 && fieldRole == null) {
        const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index);
        const slot = sorted[blockIndex];
        if (!slot || slot.llm_field === "handle") return;
        const slotKey = copySlotEditorLayerKey(slot.slot_index);
        const box = boxes.find((layer) => layer.layer_key === slotKey) ?? boxes[blockIndex];
        const base =
          draft.length > 0
            ? [...draft]
            : boxes.map((layer) => ({
                layer_key: layer.layer_key,
                x_px: layer.x_px,
                y_px: layer.y_px,
                w_px: layer.w_px,
                h_px: layer.h_px,
                font_size_px: layer.font_size_px,
                text: layer.text,
                box_locked: true,
              }));
        const byKey = new Map(base.map((r) => [r.layer_key, { ...r }]));
        const prev = (byKey.get(slotKey) ?? (box ? byKey.get(box.layer_key) : undefined)) as
          | DocAiLayerOverride
          | undefined;
        if (!box && !prev) return;
        byKey.set(slotKey, {
          ...prev,
          layer_key: slotKey,
          x_px: prev?.x_px ?? box?.x_px ?? 80,
          y_px: prev?.y_px ?? box?.y_px ?? 120,
          w_px: prev?.w_px ?? box?.w_px ?? 320,
          h_px: prev?.h_px ?? box?.h_px ?? 64,
          font_size_px: prev?.font_size_px ?? box?.font_size_px,
          text: text.trim(),
          box_locked: true,
        });
        handleLayerDraftChangeRef.current(Array.from(byKey.values()));
        return;
      }

      const roleForBox = (layer: DocAiLayerBox) =>
        layoutRoleForLayer(layer, draftByKey.get(layer.layer_key), fullBleedMode, templateBgMode, slots);

      const resolveLayoutBlockToBox = (
        layoutBlock: (typeof blocks)[number] | undefined
      ): DocAiLayerBox | undefined => {
        if (!layoutBlock) return undefined;
        return boxes.find((layer) => layer.layer_key === layoutBlock.layer_key);
      };

      let target: DocAiLayerBox | undefined;
      if (fieldRole != null) {
        target = inspectBoxes.find((layer) => layoutRoleMatchesField(roleForBox(layer), fieldRole));
        if (!target) {
          const layoutMatch = blocks.find((layer) => layoutRoleMatchesField(layer.role, fieldRole));
          target = resolveLayoutBlockToBox(layoutMatch);
        }
      } else {
        target = inspectBoxes[blockIndex] ?? resolveLayoutBlockToBox(blocks[blockIndex]);
      }
      if (!target) target = resolveLayoutBlockToBox(blocks[blockIndex]);
      if (!target) {
        const trimmed = text.trim();
        if (!trimmed || fullBleedMode) return;
        const custom = buildCustomPhraseOverride(trimmed, blockIndex, boxes);
        const base =
          draft.length > 0
            ? draft
            : boxes.map((layer) => ({
                layer_key: layer.layer_key,
                x_px: layer.x_px,
                y_px: layer.y_px,
                w_px: layer.w_px,
                h_px: layer.h_px,
                font_size_px: layer.font_size_px,
                text: layer.text,
                box_locked: true,
              }));
        handleLayerDraftChangeRef.current([...base, custom]);
        return;
      }
      if (fieldRole === "body" && roleForBox(target) === "handle") return;
      if (fieldRole === "headline" && roleForBox(target) === "handle") return;
      const base =
        draft.length > 0
          ? draft
          : boxes.map((layer) => ({
              layer_key: layer.layer_key,
              x_px: layer.x_px,
              y_px: layer.y_px,
              w_px: layer.w_px,
              h_px: layer.h_px,
              font_size_px: layer.font_size_px,
              text: layer.text,
              box_locked: true,
            }));
      const next = base.some((r) => r.layer_key === target.layer_key)
        ? base.map((r) => (r.layer_key === target.layer_key ? { ...r, text } : r))
        : [
            ...base,
            {
              layer_key: target.layer_key,
              x_px: target.x_px,
              y_px: target.y_px,
              w_px: target.w_px,
              h_px: target.h_px,
              text,
              box_locked: true,
            },
          ];
      templateBgCopySyncingToLayoutRef.current = true;
      try {
        handleLayerDraftChangeRef.current(next);
      } finally {
        templateBgCopySyncingToLayoutRef.current = false;
      }
    });
    return () => registerTextBlockUpdater(null);
  }, [registerTextBlockUpdater, templateBgMode, fullBleedMode]);

  const docAiSavedOverrides = useMemo(() => parseDocAiSavedOverrides(renderInspect), [renderInspect]);

  const initialOverridesForEditor = useMemo(() => {
    let rows: DocAiLayerOverride[];
    if (layerPosDraft.length > 0) {
      rows = layerPosDraft;
    } else if (slideDrafts[editorSlide]?.length) {
      rows = templateBgMode
        ? stripTemplateBgHiddenOverrides(slideDrafts[editorSlide]!)
        : slideDrafts[editorSlide]!;
    } else {
      rows = templateBgMode
        ? stripTemplateBgHiddenOverrides(docAiSavedOverrides)
        : docAiSavedOverrides;
    }
    let normalized = normalizeLayerPosDraft(rows, templateBgMode);
    if (fullBleedMode && copySlotsForEditor.length > 0) {
      normalized = pruneDraftToCopySlotLayers(normalized, copySlotsForEditor);
    }
    return normalized;
  }, [
    layerPosDraft,
    slideDrafts,
    editorSlide,
    docAiSavedOverrides,
    templateBgMode,
    fullBleedMode,
    copySlotsForEditor,
  ]);

  const restoreDefaultLayout = useCallback(() => {
    const cleared = layerPosDraft.filter((row) => !row.hidden);
    handleLayerDraftChange(cleared);
  }, [layerPosDraft, handleLayerDraftChange]);

  const resetSlideLayout = useCallback(async () => {
    if (!taskId.trim() || !projectSlug.trim()) return;
    const ok = window.confirm(
      `Clear all saved layout for slide ${editorSlide}? OCR boxes return to defaults; added boxes are removed.`
    );
    if (!ok) return;
    setLayerPosSaving(true);
    setLayerPosError(null);
    setLayerPosMsg(null);
    try {
      await persistLayerPositions(editorSlide, []);
      setLayerPosDraft([]);
      setSlideDrafts((prev) => {
        const next = { ...prev };
        delete next[editorSlide];
        return next;
      });
      setUserTouchedLayout(false);
      setLayoutBaseline("");
      setLayoutResetToken((t) => t + 1);
      setLayerPosMsg(`Layout reset for slide ${editorSlide} — use Reprint text to refresh the image.`);
      onMimicLayoutSaved?.(editorSlide, []);
    } catch (e) {
      setLayerPosError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setLayerPosSaving(false);
    }
  }, [taskId, projectSlug, editorSlide, persistLayerPositions, onMimicLayoutSaved]);

  const handleLayerDraftChangeRef = useRef(handleLayerDraftChange);
  handleLayerDraftChangeRef.current = handleLayerDraftChange;
  const layerPosDraftRef = useRef(layerPosDraft);
  layerPosDraftRef.current = layerPosDraft;
  const editorSlideRef = useRef(editorSlide);
  editorSlideRef.current = editorSlide;

  useEffect(() => {
    const flushPendingLayouts = () => {
      if (!taskId.trim() || !userTouchedLayoutRef.current) return;
      const merged = mergedSlideDraftsForCompare(
        slideDraftsRef.current,
        editorSlideRef.current,
        layerPosDraftRef.current
      );
      if (Object.values(merged).every((rows) => !rows?.length)) return;
      void persistAllSlideDrafts(merged, { updateUserTouched: false });
    };
    const onPageHide = () => flushPendingLayouts();
    window.addEventListener("pagehide", onPageHide);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushPendingLayouts();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persistAllSlideDrafts, taskId]);

  const docAiLayerBoxesRef = useRef(docAiLayerBoxes);
  docAiLayerBoxesRef.current = docAiLayerBoxes;
  const layoutTextBlocksRef = useRef(layoutTextBlocks);
  layoutTextBlocksRef.current = layoutTextBlocks;
  const renderInspectRefForUpdater = useRef(renderInspect);
  renderInspectRefForUpdater.current = renderInspect;

  async function handleSaveAllLayerPositions() {
    if (!taskId.trim() || !projectSlug.trim()) return;

    const mergedDrafts: Record<number, DocAiLayerOverride[]> = {
      ...slideDrafts,
      ...(layerPosDraft.length > 0 ? { [editorSlide]: layerPosDraft } : {}),
    };

    if (Object.values(mergedDrafts).every((rows) => !rows?.length)) {
      setLayerPosError("No layout drafts to save — edit at least one slide first.");
      return;
    }

    setLayerPosSaving(true);
    setLayerPosError(null);
    setLayerPosMsg(null);

    try {
      const { savedCount, failedSlides } = await persistAllSlideDrafts(mergedDrafts, {
        timeoutMs: DECK_PERSIST_TIMEOUT_MS,
        onProgress: (done, total) => setLayerPosMsg(`Saving layouts — ${done} of ${total}…`),
      });
      setSlideDrafts(mergedDrafts);
      if (layerPosDraft.length > 0) {
        lastPersistedKeyRef.current = persistKeyFor(editorSlide, layerPosDraft);
      }
      if (failedSlides.length > 0) {
        setLayerPosError(
          `Some slides failed to save (${failedSlides.join(", ")}) — retry Save all slides for those.`
        );
      }
      setLayerPosMsg(
        savedCount > 0
          ? `Saved layouts for ${savedCount} slide${savedCount === 1 ? "" : "s"}${failedSlides.length > 0 ? ` (${failedSlides.length} failed)` : ""} — safe to refresh.`
          : "All layouts already saved."
      );
    } catch (e) {
      setLayerPosError(e instanceof Error ? e.message : "Save all failed");
    } finally {
      setLayerPosSaving(false);
    }
  }

  function dedupeCurrentSlideBoxes() {
    if (layerPosDraft.length === 0) {
      setLayerPosMsg(`Slide ${editorSlide}: no text boxes on this slide.`);
      return;
    }
    const deduped = normalizeLayerPosDraft(layerPosDraft, templateBgMode);
    if (deduped.length === layerPosDraft.length) {
      setLayerPosMsg(`Slide ${editorSlide}: no duplicate boxes to remove.`);
      return;
    }
    handleLayerDraftChange(deduped);
    setLayerPosMsg(
      `Slide ${editorSlide}: removed ${layerPosDraft.length - deduped.length} duplicate box${
        layerPosDraft.length - deduped.length === 1 ? "" : "es"
      } — save and reprint when ready.`
    );
  }

  async function handleSaveLayerPositions() {

    if (!taskId.trim() || !projectSlug.trim() || layerPosDraft.length === 0) return;

    setLayerPosSaving(true);

    setLayerPosError(null);

    setLayerPosMsg(null);

    try {

      await persistLayerPositions(editorSlide, layerPosDraft);

      const key = persistKeyFor(editorSlide, layerPosDraft);
      lastPersistedKeyRef.current = key;
      lastPersistedKeysBySlideRef.current[editorSlide] = key;

      const nextDrafts = { ...slideDrafts, [editorSlide]: layerPosDraft };
      setSlideDrafts(nextDrafts);
      setLayoutBaseline(mergedLayoutDraftCompareKey(nextDrafts, templateBgMode));

      setUserTouchedLayout(false);

      setSlidesWithSavedLayout((prev) => {

        const next = new Set(prev).add(editorSlide);

        const savedList = [...next].sort((a, b) => a - b);

        setLayerPosMsg(`Saved slide ${editorSlide}. Layouts: ${savedList.join(", ")}.`);

        return next;

      });

    } catch (e) {

      setLayerPosError(e instanceof Error ? e.message : "Save failed");

    } finally {

      setLayerPosSaving(false);

    }

  }



  const runTextOverlayReprint = useCallback(
    async (forceAllSlides = false) => {
      if (!taskId.trim() || !projectSlug.trim()) return;

      setReprintBusy(true);
      setReprintError(null);

      try {
        const reprintAll = forceAllSlides || reprintScope === "all";
        const slide_indices = reprintAll ? undefined : reprintTargetSlides;

        if (!reprintAll && (!slide_indices || slide_indices.length === 0)) {
          throw new Error("Pick at least one slide to reprint.");
        }

        const allDrafts: Record<number, DocAiLayerOverride[]> = { ...slideDrafts };

        if (layerPosDraft.length > 0) allDrafts[editorSlide] = layerPosDraft;

        const slidesToPersist = reprintAll
          ? Object.keys(allDrafts)
              .map(Number)
              .filter((n) => Number.isFinite(n) && n >= 1 && (allDrafts[n]?.length ?? 0) > 0)
          : (slide_indices ?? [editorSlide]);

        if ((reprintAll || (slide_indices?.length ?? 0) > 1) && slidesToPersist.length > 1) {
          const subset: Record<number, DocAiLayerOverride[]> = {};
          for (const slideIndex of slidesToPersist) {
            const rows = allDrafts[slideIndex];
            if (rows?.length) subset[slideIndex] = rows;
          }
          const { savedCount, failedSlides } = await persistAllSlideDrafts(subset, {
            timeoutMs: DECK_PERSIST_TIMEOUT_MS,
          });
          if (savedCount === 0 && failedSlides.length > 0) {
            const label = failedSlides.length === 1 ? "slide" : "slides";
            throw new Error(
              `Save failed for ${failedSlides.length} ${label} (${failedSlides.join(", ")}) — timed out or server error`
            );
          }
        } else {
          for (const slideIndex of slidesToPersist) {
            const positions = allDrafts[slideIndex];
            if (!positions?.length) continue;
            const key = persistKeyFor(slideIndex, positions);
            if (lastPersistedKeysBySlideRef.current[slideIndex] === key) continue;
            await persistLayerPositions(slideIndex, positions);
            lastPersistedKeysBySlideRef.current[slideIndex] = key;
          }
        }

        await requestTextOverlayReprint(slide_indices, allDrafts, editorSlide, layerPosDraft);

        if (layerPosDraft.length > 0) {
          lastPersistedKeyRef.current = persistKeyFor(editorSlide, layerPosDraft);
        }

        setSlidesWithSavedLayout((prev) => {
          const next = new Set(prev);

          for (const key of Object.keys(slideDrafts)) {
            const n = Number(key);

            if (Number.isFinite(n) && n >= 1) next.add(n);
          }

          if (layerPosDraft.length > 0) next.add(editorSlide);

          return next;
        });

        const syncedDrafts: Record<number, DocAiLayerOverride[]> = { ...slideDrafts };
        for (const [slideKey, positions] of Object.entries(allDrafts)) {
          if (positions.length === 0) continue;
          const slideIndex = Number(slideKey);
          if (!Number.isFinite(slideIndex) || slideIndex < 1) continue;
          syncedDrafts[slideIndex] = normalizeLayerPosDraft(positions, templateBgMode);
        }
        setSlideDrafts(syncedDrafts);
        const activeDraft = syncedDrafts[editorSlide] ?? [];
        if (activeDraft.length > 0) {
          setLayerPosDraft(activeDraft);
          setDraftSyncRevision((v) => v + 1);
        }
        setLayoutBaseline(mergedLayoutDraftCompareKey(syncedDrafts, templateBgMode));
        setUserTouchedLayout(false);
      } catch (e) {
        setReprintError(e instanceof Error ? e.message : "Reprint failed");
        setReprintMsg(null);
      } finally {
        setReprintBusy(false);
      }
    },
    [
      taskId,
      projectSlug,
      reprintScope,
      reprintTargetSlides,
      editorSlide,
      slideDrafts,
      layerPosDraft,
      persistLayerPositions,
      persistAllSlideDrafts,
      requestTextOverlayReprint,
      persistKeyFor,
      templateBgMode,
    ]
  );

  const applyHighlightToAllSlides = useCallback(() => {
    setLayerPosMsg(
      reprintTextBacking
        ? "Highlight enabled — will apply on every slide when you reprint. Save all slides first, review each slide, then reprint."
        : "Highlight off — will apply on every slide when you reprint. Save all slides first, review each slide, then reprint."
    );
  }, [reprintTextBacking]);

  const applyLogoStampToAllSlides = useCallback(() => {
    setLayerPosMsg(
      logoEnabled
        ? "Brand logo on — will stamp every slide when you reprint. Save all slides first, review each slide, then reprint."
        : "Brand logo off — will apply on every slide when you reprint. Save all slides first, review each slide, then reprint."
    );
  }, [logoEnabled]);

  const applyFrameStampToAllSlides = useCallback(() => {
    setLayerPosMsg(
      frameEnabled
        ? "Brand frame on — will apply on every slide when you reprint. Save all slides first, review each slide, then reprint."
        : "Brand frame off — will apply on every slide when you reprint. Save all slides first, review each slide, then reprint."
    );
  }, [frameEnabled]);



  async function regenerateSlideImages(
    slideIndices: number[],
    opts?: { slot?: MimicTemplateBgSlot | null; allSlides?: boolean }
  ) {

    if (!taskId.trim() || !projectSlug.trim()) {
      setRegenerateError("Missing task or project — reload the review page and try again.");
      return;
    }
    if (slideIndices.length === 0) {
      setRegenerateError("No slides selected for regeneration.");
      return;
    }

    setRegenerateBusy(true);
    setRegeneratingSlot(opts?.slot ?? null);
    setRegeneratingAllSlides(opts?.allSlides === true);

    setRegenerateError(null);

    setRegenerateMsg(null);

    try {

      const res = await fetch("/api/task/regenerate-carousel-slides", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          task_id: taskId,

          project: projectSlug.trim(),

          slide_indices: slideIndices,

          visual_similarity_pct: regenSimilarityPct,

          image_input_mode: regenUseReference ? "reference_edit" : "analysis_t2i",

          ...(regenNote.trim() ? { regeneration_note: regenNote.trim().slice(0, 400) } : {}),

        }),

      });

      const json = (await res.json()) as { ok?: boolean; accepted?: boolean; message?: string; error?: string };

      if ((!res.ok && res.status !== 202) || !json.ok) {

        throw new Error(json.error ?? json.message ?? `Regenerate failed (${res.status})`);

      }

      void registerReviewBackgroundJob({
        kind: "image_regenerate",
        taskId,
        project: projectSlug.trim(),
        slideIndices,
        startedMessage: "Image regenerate queued — you can leave this page.",
      });
      setRegenerateMsg("Regenerate started — we'll notify you when new images are ready.");
      refreshCarouselAfterReprint();

    } catch (e) {

      setRegenerateError(e instanceof Error ? e.message : "Regenerate failed");

    } finally {

      setRegenerateBusy(false);
      setRegeneratingSlot(null);
      setRegeneratingAllSlides(false);

    }

  }



  async function handleRegenerateSlideImage() {

    await regenerateSlideImages([editorSlide]);

  }

  async function handleRegenerateAllSlides() {
    const indices = Array.from({ length: slideCount }, (_, i) => i + 1);
    await regenerateSlideImages(indices, { allSlides: true });
  }



  async function handleRegenerateTemplateBgSlot(slot: MimicTemplateBgSlot) {

    const indices = templateBgSlideIndicesForSlot(slot, slideCount);

    if (indices.length === 0) {
      setRegenerateError(
        slot === "body"
          ? "This deck has no middle slides to regenerate."
          : "No slides in that slot for this deck."
      );
      return;
    }

    await regenerateSlideImages(indices, { slot });

  }



  if (!job) return null;



  const showEditor = docAiLayerBoxes.length > 0;
  const hasHiddenDraftLayers = layerPosDraft.some((row) => row.hidden);
  const templateBgMiddleSlideCount = templateBgMode
    ? templateBgSlideIndicesForSlot("body", slideCount).length
    : 0;

  const slotRegenButtonLabel = (slot: MimicTemplateBgSlot, base: string): string => {
    if (regeneratingSlot === slot && regenerateBusy) return "Starting…";
    return base;
  };

  return (

    <div className="mimic-layer-editor-panel mimic-layer-editor-panel--three-col">

      <div className="mimic-layer-editor-panel__chrome">

      {showNewVisualWhyPanel ? (
        <NewVisualSlideWhyPanel
          generationPayload={gp}
          mimicV1={mimicV1}
          slideIndex={editorSlide}
          slideCount={slideCount}
          generatedOnScreenText={generatedOnScreenText}
          defaultOpen={false}
        />
      ) : showReferenceWhyPanel ? (
        <MimicSlideWhyPanel
          mimicV1={mimicV1}
          slideIndex={editorSlide}
          taskId={taskId}
          projectSlug={projectSlug}
          defaultOpen={false}
          generatedOnScreenText={generatedOnScreenText}
        />
      ) : null}

      <BvsInfluencePanel
        generationPayload={gp}
        mimicV1={mimicV1}
        projectSlug={projectSlug}
        slideIndex={editorSlide}
        taskId={taskId}
        generatedOnScreenText={generatedOnScreenText}
        brandPalette={brandPalette}
        defaultOpen={false}
      />

      <div className="mimic-layer-editor-panel__slide-row">

        <span className="mimic-layer-editor-panel__slide-counter">Slide {editorSlide} / {slideCount}</span>

        {Array.from({ length: Math.max(slideCount, 1) }, (_, i) => i + 1).map((n) => {

          const active = editorSlide === n;

          const saved = slidesWithSavedLayout.has(n);

          return (

            <button
              key={n}
              type="button"
              className={`mimic-layer-editor-panel__slide-btn ${active ? "btn-primary" : "btn-ghost"}`}
              onClick={() => goToSlide(n)}
            >

              {n}

              {saved ? <span className="mimic-layer-editor-panel__saved-dot" title="Layout saved" /> : null}

            </button>

          );

        })}

        {layoutDirty ? (
          <span className="mimic-layer-editor-panel__slide-row-meta mimic-layer-editor-panel__slide-row-meta--warn">
            Unsaved
          </span>
        ) : null}

        {renderInspectLoading ? (
          <span className="mimic-layer-editor-panel__slide-row-meta">Updating…</span>
        ) : null}

        <span className="mimic-layer-editor-panel__slide-row-spacer" aria-hidden />

        <input
          type="text"
          className="mimic-regen-route__note-input"
          value={regenNote}
          onChange={(e) => setRegenNote(e.target.value.slice(0, 400))}
          placeholder="Regen note (optional)"
          maxLength={400}
          disabled={regenerateBusy}
          title="Short instruction appended to the image prompt for this regenerate"
        />

        <button
          type="button"
          className={`btn-ghost btn-sm${showRegenRoute ? " mimic-regen-route__toggle--open" : ""}`}
          onClick={() => setShowRegenRoute((v) => !v)}
          title="Pick how the image regenerates"
          aria-expanded={showRegenRoute}
        >
          Route ▾
        </button>

        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={regenerateBusy || reprintBusy || layerPosSaving}
          onClick={() => void handleRegenerateSlideImage()}
          title="Run Flux/Qwen again for this slide (billed)"
        >
          {regenerateBusy && !regeneratingAllSlides ? "Regenerating…" : templateBgMode ? "This slide" : "Regenerate"}
        </button>

        {slideCount > 1 ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={regenerateBusy || reprintBusy || layerPosSaving}
            onClick={() => void handleRegenerateAllSlides()}
            title={`Regenerate all ${slideCount} slides (billed)`}
          >
            {regeneratingAllSlides && regenerateBusy
              ? "Regenerating…"
              : `All slides (${slideCount})`}
          </button>
        ) : null}

        {onDeleteSlide && slideCount > 1 ? (
          <button
            type="button"
            className="btn-danger-ghost btn-sm"
            onClick={() => {
              if (window.confirm(`Remove slide ${editorSlide} from this deck?`)) {
                onDeleteSlide(editorSlide);
              }
            }}
            title="Remove this slide from the carousel deck"
          >
            Delete slide
          </button>
        ) : null}

      </div>

      {templateBgMode ? (
        <div className="mimic-regen-route mimic-regen-route--slots">
          <button
            type="button"
            className="mimic-regen-route__collapse btn-ghost btn-sm"
            onClick={() => setRegenPlateOpen((v) => !v)}
            aria-expanded={regenPlateOpen}
          >
            Regen plate {regenPlateOpen ? "▾" : "▸"}
          </button>
          {regenPlateOpen ? (
            <>
          <div className="mimic-regen-route__group">
            <button
              type="button"
              className="btn-secondary btn-sm mimic-slot-regen-btn"
              disabled={regenerateBusy || reprintBusy || layerPosSaving}
              onClick={() => void handleRegenerateTemplateBgSlot("cover")}
              title="Regenerate cover slide background (slide 1) — billed"
            >
              {slotRegenButtonLabel("cover", "Regen cover")}
            </button>
            {templateBgMiddleSlideCount > 0 ? (
              <button
                type="button"
                className="btn-secondary btn-sm mimic-slot-regen-btn"
                disabled={regenerateBusy || reprintBusy || layerPosSaving}
                onClick={() => void handleRegenerateTemplateBgSlot("body")}
                title={`Regenerate shared middle background for slides 2–${slideCount - 1} — billed`}
              >
                {slotRegenButtonLabel("body", `Regen middle (${templateBgMiddleSlideCount})`)}
              </button>
            ) : null}
            {slideCount > 1 ? (
              <button
                type="button"
                className="btn-secondary btn-sm mimic-slot-regen-btn"
                disabled={regenerateBusy || reprintBusy || layerPosSaving}
                onClick={() => void handleRegenerateTemplateBgSlot("cta")}
                title={`Regenerate CTA slide background (slide ${slideCount}) — billed`}
              >
                {slotRegenButtonLabel("cta", "Regen CTA")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary btn-sm mimic-slot-regen-btn"
              disabled={regenerateBusy || reprintBusy || layerPosSaving}
              onClick={() => void handleRegenerateAllSlides()}
              title={`Regenerate every slide in the deck (${slideCount}) — billed`}
            >
              {regeneratingAllSlides && regenerateBusy
                ? "Starting…"
                : `Regen all slides (${slideCount})`}
            </button>
          </div>
          <p className="mimic-regen-route__note">
            Each button starts image regen immediately (2–5 min). Middle slides share one background plate.
          </p>
          {regenerateMsg || regenerateError ? (
            <div className="mimic-slot-regen-feedback">
              {regenerateMsg ? (
                <p className="mimic-layer-editor-panel__status">{regenerateMsg}</p>
              ) : null}
              {regenerateError ? (
                <p className="mimic-layer-editor-panel__error">{regenerateError}</p>
              ) : null}
            </div>
          ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {showRegenRoute ? (
        <div className="mimic-regen-route">
          <div className="mimic-regen-route__group">
            <span className="mimic-regen-route__label">Similarity</span>
            {[
              { pct: 85, label: "Close ~85%" },
              { pct: 60, label: "Variant ~60%" },
              { pct: 25, label: "Bold ~25%" },
            ].map((opt) => (
              <button
                key={opt.pct}
                type="button"
                className={`mimic-regen-route__chip${regenSimilarityPct === opt.pct ? " mimic-regen-route__chip--on" : ""}`}
                onClick={() => setRegenSimilarityPct(opt.pct)}
              >
                {opt.label}
              </button>
            ))}
            <input
              type="number"
              min={0}
              max={100}
              value={regenSimilarityPct}
              onChange={(e) => {
                const n = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                setRegenSimilarityPct(n);
              }}
              className="mimic-regen-route__num"
              title="Visual similarity %"
            />
          </div>
          <div className="mimic-regen-route__group">
            <span className="mimic-regen-route__label">Reference</span>
            <button
              type="button"
              className={`mimic-regen-route__chip${regenUseReference ? " mimic-regen-route__chip--on" : ""}`}
              onClick={() => setRegenUseReference(true)}
            >
              Use reference
            </button>
            <button
              type="button"
              className={`mimic-regen-route__chip${!regenUseReference ? " mimic-regen-route__chip--on" : ""}`}
              onClick={() => setRegenUseReference(false)}
              title="Generate from analysis only (no reference image)"
            >
              No reference
            </button>
          </div>
          <p className="mimic-regen-route__note">
            Text is always added as an editable HTML overlay — image models never bake copy.
          </p>
        </div>
      ) : null}

      {regenerateMsg && !templateBgMode ? (
        <p className="mimic-layer-editor-panel__status">{regenerateMsg}</p>
      ) : null}
      {regenerateError && !templateBgMode ? (
        <p className="mimic-layer-editor-panel__error">{regenerateError}</p>
      ) : null}

      </div>

      {!showEditor && !renderInspectLoading ? (

        <div className="mimic-layer-editor-panel__empty">
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>No text layers on this slide.</p>
          {hasHiddenDraftLayers ? (
            <button type="button" className="btn-secondary btn-sm" onClick={restoreDefaultLayout}>
              Restore default text boxes
            </button>
          ) : null}
        </div>

      ) : !showEditor && renderInspectLoading ? (

        <p className="mimic-layer-editor-panel__empty mimic-layer-editor-panel__status">Loading layout…</p>

      ) : (

          <MimicDocAiLayerPositionEditor
            key={`docai-layout-${editorSlide}-${layoutResetToken}`}

            slideIndex={editorSlide}

            backgroundUrl={getBackgroundUrl?.(editorSlide)}

            layers={editorLayers}

            initialOverrides={initialOverridesForEditor}

            onOverridesChange={handleLayerDraftChange}

            onLayoutInitialized={handleLayoutInitialized}

            textBacking={reprintTextBacking}

            textBackingColor={reprintTextBackingCss}

            projectHandle={instagramHandle}

            suppressReseed={userTouchedLayout}

            activeBlockIndex={activeLayoutBlockIndex}

            onActiveBlockIndexChange={handleActiveLayoutBlockChange}

            fullBleedMode={fullBleedMode}

            templateBgMode={templateBgMode}

            brandPalette={brandPalette}

            logoOverlayUrl={logoOverlayPayload ? brandLogoUrl : ""}

            textBackingEnabled={reprintTextBacking}
            onTextBackingEnabledChange={setReprintTextBacking}
            textBackingColorHex={reprintTextBackingHex}
            onTextBackingColorHexChange={setReprintTextBackingHex}
            logoStampEnabled={logoEnabled}
            onLogoStampEnabledChange={setLogoEnabled}
            brandLogoPreviewUrl={brandLogoUrl}

            frameOverlayUrl={framePreviewUrl}
            frameStampEnabled={frameEnabled}
            onFrameStampEnabledChange={setFrameEnabled}
            brandFrames={brandFrames}
            selectedFrameAssetId={selectedFrame?.assetId ?? ""}
            onSelectedFrameAssetIdChange={setSelectedFrameAssetId}

            slideCount={slideCount}
            deckApplyBusy={layerPosSaving}
            onApplyTypographyToRole={applyTypographyToRole}
            onApplyPlacementToRole={applyPlacementToRole}
            onApplyAllLayoutToDeck={applyAllLayoutSettingsToDeck}
            onSaveAllSlides={() => void handleSaveAllLayerPositions()}
            saveAllBusy={layerPosSaving}
            onApplyHighlightToAllSlides={() => void applyHighlightToAllSlides()}
            onApplyLogoStampToAllSlides={() => void applyLogoStampToAllSlides()}
            onApplyFrameStampToAllSlides={() => void applyFrameStampToAllSlides()}
            overlayApplyBusy={reprintBusy || layerPosSaving}
            draftSyncRevision={draftSyncRevision}
            threeColumnLayout
            inspectorFooter={
              <div className="mimic-layout-footer">
                <div className="mimic-layer-editor-panel__actions">
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={layerPosSaving || docAiLayerBoxes.length === 0}
                    onClick={() => handleSaveLayerPositions()}
                  >
                    {layerPosSaving ? "Saving…" : `Save layout — slide ${editorSlide}`}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={layerPosSaving}
                    onClick={() => void resetSlideLayout()}
                    title="Remove all saved positions and manually-added boxes for this slide"
                  >
                    Reset slide layout
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={layerPosSaving || layerPosDraft.length === 0}
                    onClick={() => dedupeCurrentSlideBoxes()}
                    title="Remove duplicate custom text boxes that repeat the same copy on this slide"
                  >
                    Remove duplicates
                  </button>
                  {slideCount > 1 ? (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={layerPosSaving}
                      onClick={() => void handleSaveAllLayerPositions()}
                      title="Persist layout drafts for every slide you have edited"
                    >
                      {layerPosSaving ? "Saving…" : "Save all slides"}
                    </button>
                  ) : null}
                </div>
                <div className="mimic-layer-editor-panel__reprint">
                  <p className="mimic-layer-editor-panel__reprint-hint">
                    <strong>Workflow:</strong> apply layout (auto-saves) → review every slide →{" "}
                    <strong>Reprint text</strong> when images should match the editor.
                    Layout survives refresh; reprint does not run until you click it.
                  </p>
                  <div className="mimic-layer-editor-panel__reprint-row">
                  <div className="mimic-layer-editor-panel__reprint-options">
                    <label className="mimic-layer-editor-panel__option">
                      <input
                        type="radio"
                        name="mimic-reprint-scope"
                        checked={reprintScope === "all"}
                        onChange={() => setReprintScope("all")}
                      />
                      <span>All slides</span>
                    </label>
                    <label className="mimic-layer-editor-panel__option">
                      <input
                        type="radio"
                        name="mimic-reprint-scope"
                        checked={reprintScope === "current"}
                        onChange={() => setReprintScope("current")}
                      />
                      <span>Slide {editorSlide} only</span>
                    </label>
                    <label className="mimic-layer-editor-panel__option">
                      <input
                        type="radio"
                        name="mimic-reprint-scope"
                        checked={reprintScope === "picked"}
                        onChange={() => {
                          setReprintScope("picked");
                          setReprintPickedSlides((prev) =>
                            prev.size > 0 ? prev : new Set([editorSlide])
                          );
                        }}
                      />
                      <span>
                        Selected slides
                        {reprintScope === "picked" && reprintPickedSlides.size > 0
                          ? ` (${reprintPickedSlides.size})`
                          : ""}
                      </span>
                    </label>
                  </div>
                  {reprintScope === "picked" ? (
                    <div
                      className="mimic-layer-editor-panel__reprint-pick"
                      role="group"
                      aria-label="Slides to reprint"
                    >
                      {Array.from({ length: slideCount }, (_, i) => i + 1).map((slide) => {
                        const picked = reprintPickedSlides.has(slide);
                        return (
                          <button
                            key={slide}
                            type="button"
                            className={`mimic-layer-editor-panel__reprint-pick-btn${
                              picked ? " mimic-layer-editor-panel__reprint-pick-btn--on" : ""
                            }${slide === editorSlide ? " mimic-layer-editor-panel__reprint-pick-btn--current" : ""}`}
                            aria-pressed={picked}
                            title={`${picked ? "Remove" : "Add"} slide ${slide}`}
                            onClick={() => toggleReprintPickedSlide(slide)}
                          >
                            {slide}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="btn-primary btn-sm mimic-layer-editor-panel__reprint-btn"
                    disabled={
                      reprintBusy ||
                      layerPosSaving ||
                      (reprintScope === "picked" && reprintPickedSlides.size === 0)
                    }
                    onClick={() => {
                      setReprintMsg("Saving layout and reprinting…");
                      void runTextOverlayReprint(reprintScope === "all");
                    }}
                    title="Save layout, then bake copy into slide images (use after reviewing all slides)"
                  >
                    {reprintBusy ? "Reprinting…" : "Reprint text"}
                  </button>
                  </div>
                </div>
                {layerPosMsg ? <p className="mimic-layer-editor-panel__status">{layerPosMsg}</p> : null}
                {layerPosError ? <p className="mimic-layer-editor-panel__error">{layerPosError}</p> : null}
                {reprintMsg ? <p className="mimic-layer-editor-panel__status">{reprintMsg}</p> : null}
                {reprintError ? <p className="mimic-layer-editor-panel__error">{reprintError}</p> : null}
              </div>
            }

          />

      )}



    </div>

  );

}


