/**

 * Browser-side Doc AI shrink-to-fit + highlight shrink-wrap (mirrors services/renderer/mimic-docai-fit.js).

 * Serialized for inline <script> in overlay lab preview HTML.

 */

function fitDocAiTextLayersToBoxesInPage(minFontPx: number, textBackMinFontPx?: number): void {

  const tbMin = Number.isFinite(textBackMinFontPx) && (textBackMinFontPx ?? 0) > 0 ? textBackMinFontPx! : 24;

  const canvasH = 1350;

  const canvasW = 1080;

  const margin = 32;

  const textBackDefaultPx = 50;

  const textBackFontScale = 1.22;

  const overlapGap = 12;

  const subjectGap = 12;

  const slack = 3;

  const subjectZone = {

    left: canvasW * 0.22,

    top: canvasH * 0.26,

    right: canvasW * 0.78,

    bottom: canvasH * 0.74,

  };



  type LayerMeta = {

    el: HTMLElement;

    slotW: number;

    slotH: number;

    origTop: number;

    origLeft: number;

    textAlign: string;

    isTextBack: boolean;

    isSingleLine: boolean;

    currentFs: number;

    fitMaxW: number;

    fitMaxH: number;

    boxW: number;

    boxH: number;

    preserveBox?: boolean;

  };



  function syncMetaPosition(meta: LayerMeta): void {

    const left = parseFloat(meta.el.style.left);

    const top = parseFloat(meta.el.style.top);

    if (Number.isFinite(left)) meta.origLeft = left;

    if (Number.isFinite(top)) meta.origTop = top;

    const r = meta.el.getBoundingClientRect();

    meta.boxW = Math.ceil(r.width);

    meta.boxH = Math.ceil(r.height);

  }



  function cornerBudget(meta: LayerMeta, fs: number): { maxW: number; maxH: number } {

    const { slotW, origLeft, origTop, textAlign } = meta;

    const cornerW = textAlign === "right" ? origLeft + slotW - margin : canvasW - margin - origLeft;

    const cornerH = canvasH - margin - origTop;

    const minWrapW = Math.min(cornerW, Math.max(200, Math.round(fs * 5.5)));

    return { maxW: Math.max(minWrapW, Math.max(48, cornerW)), maxH: Math.max(32, cornerH) };

  }



  function measureTextBackAtWidth(

    el: HTMLElement,

    maxW: number,

    fs: number,

    isSingleLine: boolean

  ): { width: number; height: number } {

    const style = el.style;

    style.overflow = "visible";

    style.textOverflow = "clip";

    style.whiteSpace = isSingleLine ? "nowrap" : "pre-wrap";

    style.fontSize = `${fs}px`;

    style.width = "max-content";

    style.maxWidth = `${maxW}px`;

    style.height = "auto";

    return {

      width: Math.ceil(el.getBoundingClientRect().width),

      height: Math.ceil(el.scrollHeight),

    };

  }



  function remeasureTextBackBox(el: HTMLElement, meta: LayerMeta, fs: number): void {

    if (meta.preserveBox) return;

    const style = el.style;

    const budget = cornerBudget(meta, fs);

    const measured = measureTextBackAtWidth(el, budget.maxW, fs, meta.isSingleLine);

    style.width = `${measured.width}px`;

    style.height = `${measured.height}px`;

    style.maxWidth = "";

    const clamped = Math.max(tbMin, fs);

    style.fontSize = `${clamped}px`;

    meta.currentFs = clamped;

    meta.fitMaxW = budget.maxW;

    meta.fitMaxH = budget.maxH;

    meta.boxW = measured.width;

    meta.boxH = measured.height;

  }



  function applyTextBackHighlightBox(el: HTMLElement, meta: LayerMeta, fs: number): void {

    const style = el.style;

    const { slotW, origLeft, origTop, textAlign, isSingleLine } = meta;

    const budget = cornerBudget(meta, fs);

    const measured = measureTextBackAtWidth(el, budget.maxW, fs, isSingleLine);

    style.width = `${measured.width}px`;

    style.height = `${measured.height}px`;

    style.maxWidth = "";

    style.left = `${origLeft}px`;

    style.top = `${origTop}px`;

    if (textAlign === "center") {

      style.left = `${Math.max(margin, origLeft + (slotW - measured.width) / 2)}px`;

    } else if (textAlign === "right") {

      style.left = `${Math.max(margin, origLeft + (slotW - measured.width))}px`;

    }

    const clamped = Math.max(tbMin, fs);

    style.fontSize = `${clamped}px`;

    meta.currentFs = clamped;

    meta.boxW = measured.width;

    meta.boxH = measured.height;

    meta.fitMaxW = budget.maxW;

    meta.fitMaxH = budget.maxH;

    syncMetaPosition(meta);

  }



  function clampLayerInCanvas(el: HTMLElement, meta: LayerMeta): void {

    let left = parseFloat(el.style.left);

    let top = parseFloat(el.style.top);

    if (!Number.isFinite(left) || !Number.isFinite(top)) return;

    const w = meta.boxW ?? el.getBoundingClientRect().width;

    const h = meta.boxH ?? el.getBoundingClientRect().height;

    if (left + w > canvasW - margin) left = Math.max(margin, canvasW - margin - w);

    if (top + h > canvasH - margin) top = Math.max(margin, canvasH - margin - h);

    if (left < margin) left = margin;

    if (top < margin) top = margin;

    el.style.left = `${left}px`;

    el.style.top = `${top}px`;

    syncMetaPosition(meta);

  }



  function fitTextBackLayerPreservingBox(el: HTMLElement, meta: LayerMeta): void {
    const { slotW, slotH } = meta;
    let fs = parseFloat(el.style.fontSize);
    if (!Number.isFinite(fs) || fs <= 0) fs = tbMin;
    el.style.width = `${slotW}px`;
    el.style.height = `${slotH}px`;
    el.style.maxWidth = "";
    el.style.fontSize = `${Math.max(tbMin, fs)}px`;
    let guard = 0;
    while (guard++ < 140 && fs > tbMin && (el.scrollHeight > slotH + slack || el.scrollWidth > slotW + slack)) {
      fs -= 1;
      el.style.fontSize = `${fs}px`;
    }
    meta.currentFs = Math.max(tbMin, fs);
    meta.boxW = slotW;
    meta.boxH = slotH;
    meta.fitMaxW = slotW;
    meta.fitMaxH = slotH;
    syncMetaPosition(meta);
  }

  function fitTextBackLayer(el: HTMLElement, meta: LayerMeta): void {

    const refFs = Number(el.getAttribute("data-ref-font-size"));

    const styledFs = parseFloat(el.style.fontSize);

    let fs =

      Number.isFinite(styledFs) && styledFs > 0

        ? styledFs

        : Number.isFinite(refFs) && refFs > 0

          ? refFs

          : parseFloat(getComputedStyle(el).fontSize);

    if (!Number.isFinite(fs) || fs <= 0) return;

    const idealFs = Math.max(

      tbMin,

      Math.round((Number.isFinite(refFs) && refFs > 0 ? refFs : textBackDefaultPx) * textBackFontScale)

    );

    const { maxW, maxH } = cornerBudget(meta, idealFs);

    meta.fitMaxW = maxW;

    meta.fitMaxH = maxH;

    fs = Math.max(tbMin, idealFs);

    let guard = 0;

    while (guard++ < 80 && fs > tbMin) {

      const measured = measureTextBackAtWidth(el, maxW, fs, meta.isSingleLine);

      if (measured.width <= maxW + slack && measured.height <= maxH + slack) break;

      fs -= 1;

    }

    let measured = measureTextBackAtWidth(el, maxW, fs, meta.isSingleLine);

    if (

      meta.isSingleLine &&

      fs <= tbMin + 1 &&

      (measured.width > maxW + slack || el.scrollWidth > measured.width + slack)

    ) {

      meta.isSingleLine = false;

      el.classList.remove("mimic-docai-layer--single-line");

      el.classList.add("mimic-docai-layer--multi-line");

      el.style.whiteSpace = "pre-wrap";

      el.style.display = "inline-block";

      fs = Math.max(tbMin, idealFs);

      guard = 0;

      while (guard++ < 80 && fs > tbMin) {

        measured = measureTextBackAtWidth(el, maxW, fs, false);

        if (measured.width <= maxW + slack && measured.height <= maxH + slack) break;

        fs -= 1;

      }

    }

    applyTextBackHighlightBox(el, meta, fs);

    clampLayerInCanvas(el, meta);

  }



  function layerRect(el: HTMLElement, slideRect: DOMRect) {

    const r = el.getBoundingClientRect();

    return { left: r.left - slideRect.left, top: r.top - slideRect.top, width: r.width, height: r.height };

  }



  function overlapAmount(

    a: { left: number; top: number; width: number; height: number },

    b: { left: number; top: number; width: number; height: number },

    gap: number

  ): { area: number; ox: number; oy: number } {

    const ox = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left) + gap;

    const oy = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) + gap;

    if (ox <= 0 || oy <= 0) return { area: 0, ox: 0, oy: 0 };

    return { area: ox * oy, ox, oy };

  }



  function canPlace(meta: LayerMeta, left: number, top: number): boolean {

    const w = meta.boxW ?? 0;

    const h = meta.boxH ?? 0;

    return left >= margin && top >= margin && left + w <= canvasW - margin && top + h <= canvasH - margin;

  }



  function tryMoveMeta(meta: LayerMeta, dLeft: number, dTop: number): boolean {

    const curLeft = parseFloat(meta.el.style.left);

    const curTop = parseFloat(meta.el.style.top);

    if (!Number.isFinite(curLeft) || !Number.isFinite(curTop)) return false;

    const nextLeft = curLeft + dLeft;

    const nextTop = curTop + dTop;

    if (!canPlace(meta, nextLeft, nextTop)) return false;

    meta.el.style.left = `${nextLeft}px`;

    meta.el.style.top = `${nextTop}px`;

    syncMetaPosition(meta);

    return true;

  }



  function separateOverlappingPair(

    metaA: LayerMeta,

    metaB: LayerMeta,

    a: { left: number; top: number; width: number; height: number },

    b: { left: number; top: number; width: number; height: number }

  ): boolean {

    const { ox, oy, area } = overlapAmount(a, b, overlapGap);

    if (area <= 0) return false;

    const candidates = [

      { meta: metaB, dLeft: 0, dTop: oy },

      { meta: metaA, dLeft: 0, dTop: -oy },

      { meta: metaB, dLeft: ox, dTop: 0 },

      { meta: metaA, dLeft: -ox, dTop: 0 },

      { meta: metaB, dLeft: ox, dTop: oy },

      { meta: metaA, dLeft: -ox, dTop: -oy },

    ];

    for (const c of candidates) {

      if (tryMoveMeta(c.meta, c.dLeft, c.dTop)) return true;

    }

    return false;

  }



  function isMovableTextBack(meta: LayerMeta): boolean {

    return meta.isTextBack && meta.el.getAttribute("data-skip-center-avoid") !== "1";

  }



  function isObstacleMeta(meta: LayerMeta): boolean {

    if (!meta.isTextBack) return true;

    return meta.el.getAttribute("data-skip-center-avoid") === "1";

  }



  function resolveTextBackOverlaps(slideEl: Element, metas: LayerMeta[]): void {

    const slideRect = slideEl.getBoundingClientRect();

    const movable = metas.filter(isMovableTextBack);

    if (movable.length === 0) return;



    for (let pass = 0; pass < 64; pass++) {

      let moved = false;

      for (let i = 0; i < movable.length; i++) {

        for (let j = i + 1; j < movable.length; j++) {

          const a = layerRect(movable[i]!.el, slideRect);

          const b = layerRect(movable[j]!.el, slideRect);

          if (separateOverlappingPair(movable[i]!, movable[j]!, a, b)) moved = true;

        }

      }

      const obstacles = metas.filter(isObstacleMeta);

      for (const meta of movable) {

        const a = layerRect(meta.el, slideRect);

        for (const obs of obstacles) {

          const b = layerRect(obs.el, slideRect);

          const { ox, oy, area } = overlapAmount(a, b, overlapGap);

          if (area <= 0) continue;

          const nudges = [

            { dLeft: 0, dTop: oy },

            { dLeft: 0, dTop: -oy },

            { dLeft: ox, dTop: 0 },

            { dLeft: -ox, dTop: 0 },

            { dLeft: ox, dTop: oy },

            { dLeft: -ox, dTop: -oy },

          ];

          for (const n of nudges) {

            if (tryMoveMeta(meta, n.dLeft, n.dTop)) {

              moved = true;

              break;

            }

          }

        }

      }

      if (!moved) break;

    }

  }



  function intersectsSubjectZone(rect: { left: number; top: number; width: number; height: number }): boolean {

    return (

      rect.left < subjectZone.right + subjectGap &&

      rect.left + rect.width > subjectZone.left - subjectGap &&

      rect.top < subjectZone.bottom + subjectGap &&

      rect.top + rect.height > subjectZone.top - subjectGap

    );

  }



  function pushLayerOutOfSubjectZone(el: HTMLElement, slideRect: DOMRect, meta: LayerMeta): boolean {

    const r = layerRect(el, slideRect);

    if (!intersectsSubjectZone(r)) return false;

    const cx = r.left + r.width / 2;

    const cy = r.top + r.height / 2;

    const zcx = (subjectZone.left + subjectZone.right) / 2;

    const zcy = (subjectZone.top + subjectZone.bottom) / 2;

    let left = r.left;

    let top = r.top;

    if (cx <= zcx) left = Math.max(margin, subjectZone.left - subjectGap - r.width);

    else left = Math.min(canvasW - margin - r.width, subjectZone.right + subjectGap);

    if (cy <= zcy) top = Math.max(margin, subjectZone.top - subjectGap - r.height);

    else top = Math.min(canvasH - margin - r.height, subjectZone.bottom + subjectGap);

    el.style.left = `${left}px`;

    el.style.top = `${top}px`;

    syncMetaPosition(meta);

    return true;

  }



  function avoidCenterSubject(slideEl: Element, metas: LayerMeta[]): void {

    if (!slideEl.classList.contains("mimic-docai-avoid-center")) return;

    const slideRect = slideEl.getBoundingClientRect();

    for (const meta of metas) {

      if (!isMovableTextBack(meta)) continue;

      pushLayerOutOfSubjectZone(meta.el, slideRect, meta);

      clampLayerInCanvas(meta.el, meta);

    }

    for (let pass = 0; pass < 10; pass++) {

      let moved = false;

      for (const meta of metas) {

        if (!isMovableTextBack(meta)) continue;

        if (pushLayerOutOfSubjectZone(meta.el, slideRect, meta)) moved = true;

        clampLayerInCanvas(meta.el, meta);

      }

      if (!moved) break;

      resolveTextBackOverlaps(slideEl, metas);

    }

  }



  function finalizeTextBackLayers(metas: LayerMeta[]): void {

    for (const meta of metas) {

      if (!meta.isTextBack) continue;

      remeasureTextBackBox(meta.el, meta, meta.currentFs ?? tbMin);

      clampLayerInCanvas(meta.el, meta);

    }

  }



  const slides = document.querySelectorAll(".page.mimic-docai-layers");

  for (const slide of slides) {

    const metas: LayerMeta[] = [];

    for (const el of slide.querySelectorAll(".mimic-docai-layer")) {

      const node = el as HTMLElement;

      const style = node.style;

      const slotW = parseFloat(style.width);

      const slotH = parseFloat(style.height);

      if (!Number.isFinite(slotW) || !Number.isFinite(slotH) || slotW <= 0 || slotH <= 0) continue;

      const origTop = parseFloat(style.top);

      const origLeft = parseFloat(style.left);

      if (!Number.isFinite(origTop) || !Number.isFinite(origLeft)) continue;

      const preserveBox = node.getAttribute("data-preserve-box-size") === "1";

      const meta: LayerMeta = {

        el: node,

        slotW,

        slotH,

        origTop,

        origLeft,

        textAlign: style.textAlign || "left",

        isTextBack: el.classList.contains("mimic-docai-layer--text-back"),

        isSingleLine: el.classList.contains("mimic-docai-layer--single-line"),

        currentFs: parseFloat(style.fontSize) || tbMin,

        fitMaxW: slotW,

        fitMaxH: slotH,

        boxW: slotW,

        boxH: slotH,

        preserveBox,

      };

      metas.push(meta);

      if (meta.isTextBack) {

        if (preserveBox) fitTextBackLayerPreservingBox(node, meta);

        else fitTextBackLayer(node, meta);

        continue;

      }

      const refFs = Number(el.getAttribute("data-ref-font-size"));

      const styledFs = parseFloat(style.fontSize);

      let fs =

        Number.isFinite(styledFs) && styledFs > 0

          ? styledFs

          : Number.isFinite(refFs) && refFs > 0

            ? refFs

            : parseFloat(getComputedStyle(el).fontSize);

      if (!Number.isFinite(fs) || fs <= 0) continue;

      style.fontSize = `${Math.max(minFontPx, fs)}px`;

      fs = Math.max(minFontPx, fs);

      let guard = 0;

      while (

        guard++ < 140 &&

        fs > minFontPx &&

        (node.scrollHeight > slotH + slack || node.scrollWidth > slotW + slack)

      ) {

        fs -= 1;

        style.fontSize = `${fs}px`;

      }

      style.fontSize = `${fs}px`;

      syncMetaPosition(meta);

    }

    resolveTextBackOverlaps(slide, metas);

    avoidCenterSubject(slide, metas);

    resolveTextBackOverlaps(slide, metas);

    finalizeTextBackLayers(metas);

    resolveTextBackOverlaps(slide, metas);

    finalizeTextBackLayers(metas);

  }

}



export function mimicDocAiFitPageFnSource(): string {

  return fitDocAiTextLayersToBoxesInPage.toString();

}


