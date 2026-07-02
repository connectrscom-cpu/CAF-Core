/**

 * Shrink-to-fit + shrink-wrap for mimic Document AI text layers.

 * Runs inside Puppeteer via page.evaluate (self-contained).

 */



const MIMIC_DOCAI_MIN_FONT_PX = 32;

const MIMIC_DOCAI_TEXT_BACK_MIN_FONT_PX = 32;



/** @param {import('puppeteer').Page} page */

async function fitDocAiTextLayersToBoxes(page) {

  await page.evaluate(

    fitDocAiTextLayersToBoxesInPage,

    MIMIC_DOCAI_MIN_FONT_PX,

    MIMIC_DOCAI_TEXT_BACK_MIN_FONT_PX

  );

}



/**

 * Runs in the browser via page.evaluate — keep constants inside this function

 * (Puppeteer serializes the function body; module scope is not available).

 */

function fitDocAiTextLayersToBoxesInPage(minFontPx, textBackMinFontPx) {

  const tbMin = Number.isFinite(textBackMinFontPx) && textBackMinFontPx > 0 ? textBackMinFontPx : 32;

  const textBackDefaultPx = 50;

  const textBackFontScale = 1.22;

  const canvasH = 1350;

  const canvasW = 1080;

  const margin = 48;

  const overlapGap = 18;

  const subjectGap = 12;

  const slack = 3;

  const subjectZone = {

    left: canvasW * 0.22,

    top: canvasH * 0.26,

    right: canvasW * 0.78,

    bottom: canvasH * 0.74,

  };



  function syncMetaPosition(meta) {

    const left = parseFloat(meta.el.style.left);

    const top = parseFloat(meta.el.style.top);

    if (Number.isFinite(left)) meta.origLeft = left;

    if (Number.isFinite(top)) meta.origTop = top;

    const r = meta.el.getBoundingClientRect();

    meta.boxW = Math.ceil(r.width);

    meta.boxH = Math.ceil(r.height);

  }



  function cornerBudget(meta, fs) {

    const { slotW, origLeft, origTop, textAlign } = meta;

    let cornerW = textAlign === "right" ? origLeft + slotW - margin : canvasW - margin - origLeft;

    let cornerH = canvasH - margin - origTop;

    // Full-bleed: keep trait copy in the side column beside the center subject so it
    // wraps (and the font shrinks to fit) instead of stretching across the artwork.

    if (meta.fullBleed && !meta.skipCenter) {

      if (origLeft < subjectZone.left) {

        const leftColW = subjectZone.left - subjectGap - Math.max(margin, origLeft);

        if (leftColW > 96) cornerW = Math.min(cornerW, leftColW);

      } else {

        const colLeft = Math.max(origLeft, subjectZone.right + subjectGap);

        const rightColW = canvasW - margin - colLeft;

        if (rightColW > 96) cornerW = Math.min(cornerW, rightColW);

      }

      cornerH = Math.min(cornerH, Math.round(canvasH * 0.32));

    }

    const minWrapW = Math.min(cornerW, Math.max(200, Math.round((fs || tbMin) * 5.5)));

    return {

      maxW: Math.max(minWrapW, Math.max(48, cornerW)),

      maxH: Math.max(32, cornerH),

      minWrapW,

    };

  }



  function measureTextBackAtWidth(el, maxW, fs, isSingleLine) {

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



  /** Resize highlight to content; preserve current left/top (never snap back to OCR slot). */

  function remeasureTextBackBox(el, meta, fs) {

    if (meta.preserveBox) return;

    const style = el.style;

    const { isSingleLine } = meta;

    const budget = cornerBudget(meta, fs);

    const measured = measureTextBackAtWidth(el, budget.maxW, fs, isSingleLine);



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



  function applyTextBackHighlightBox(el, meta, fs) {

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



  function clampLayerInCanvas(el, meta) {

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



  function fitTextBackLayerPreservingBox(el, meta) {
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

  function fitTextBackLayer(el, meta) {

    const { origTop, origLeft, isSingleLine } = meta;

    if (!Number.isFinite(origTop) || !Number.isFinite(origLeft)) return;



    const refFs = Number(el.getAttribute("data-ref-font-size"));

    const styledFs = parseFloat(el.style.fontSize);

    let fs =

      Number.isFinite(styledFs) && styledFs > 0

        ? styledFs

        : Number.isFinite(refFs) && refFs > 0

          ? refFs

          : parseFloat(getComputedStyle(el).fontSize);

    if (!Number.isFinite(fs) || fs <= 0) return;



    const refBase = Number.isFinite(refFs) && refFs > 0 ? refFs : textBackDefaultPx;

    const idealFs = Math.max(tbMin, Math.round(refBase * textBackFontScale));

    const { maxW, maxH } = cornerBudget(meta, idealFs);

    meta.fitMaxW = maxW;

    meta.fitMaxH = maxH;



    fs = Math.max(tbMin, idealFs);

    let guard = 0;

    while (guard++ < 80 && fs > tbMin) {

      const measured = measureTextBackAtWidth(el, maxW, fs, isSingleLine);

      if (measured.width <= maxW + slack && measured.height <= maxH + slack) break;

      fs -= 1;

    }



    let measured = measureTextBackAtWidth(el, maxW, fs, isSingleLine);

    if (

      isSingleLine &&

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



  function layerRect(el, slideRect) {

    const r = el.getBoundingClientRect();

    return {

      el,

      left: r.left - slideRect.left,

      top: r.top - slideRect.top,

      width: r.width,

      height: r.height,

    };

  }



  function overlapAmount(a, b, gap) {

    const ox = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left) + gap;

    const oy = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) + gap;

    if (ox <= 0 || oy <= 0) return { area: 0, ox: 0, oy: 0 };

    return { area: ox * oy, ox, oy };

  }



  function canPlace(meta, left, top) {

    const w = meta.boxW ?? 0;

    const h = meta.boxH ?? 0;

    return left >= margin && top >= margin && left + w <= canvasW - margin && top + h <= canvasH - margin;

  }



  function tryMoveMeta(meta, dLeft, dTop) {

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



  function separateOverlappingPair(metaA, metaB, a, b) {

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



  function isMovableTextBack(meta) {

    return meta.isTextBack && meta.el.getAttribute("data-skip-center-avoid") !== "1";

  }



  function isObstacleMeta(meta) {

    if (!meta.isTextBack) return true;

    return meta.el.getAttribute("data-skip-center-avoid") === "1";

  }



  function resolveTextBackOverlaps(slideEl, metas) {

    const slideRect = slideEl.getBoundingClientRect();

    const movable = metas.filter(isMovableTextBack);

    if (movable.length === 0) return;



    for (let pass = 0; pass < 64; pass++) {

      let moved = false;



      for (let i = 0; i < movable.length; i++) {

        for (let j = i + 1; j < movable.length; j++) {

          const a = layerRect(movable[i].el, slideRect);

          const b = layerRect(movable[j].el, slideRect);

          if (separateOverlappingPair(movable[i], movable[j], a, b)) moved = true;

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



  function intersectsSubjectZone(rect) {

    return (

      rect.left < subjectZone.right + subjectGap &&

      rect.left + rect.width > subjectZone.left - subjectGap &&

      rect.top < subjectZone.bottom + subjectGap &&

      rect.top + rect.height > subjectZone.top - subjectGap

    );

  }



  function pushLayerOutOfSubjectZone(el, slideRect, meta) {

    const r = layerRect(el, slideRect);

    if (!intersectsSubjectZone(r)) return false;



    const cx = r.left + r.width / 2;

    const cy = r.top + r.height / 2;

    const zcx = (subjectZone.left + subjectZone.right) / 2;

    const zcy = (subjectZone.top + subjectZone.bottom) / 2;

    let left = r.left;

    let top = r.top;



    if (cx <= zcx) {

      left = Math.max(margin, subjectZone.left - subjectGap - r.width);

    } else {

      left = Math.min(canvasW - margin - r.width, subjectZone.right + subjectGap);

    }

    if (cy <= zcy) {

      top = Math.max(margin, subjectZone.top - subjectGap - r.height);

    } else {

      top = Math.min(canvasH - margin - r.height, subjectZone.bottom + subjectGap);

    }



    el.style.left = `${left}px`;

    el.style.top = `${top}px`;

    syncMetaPosition(meta);

    return true;

  }



  function avoidCenterSubject(slideEl, metas) {

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



  function finalizeTextBackLayers(metas) {

    for (const meta of metas) {

      if (!meta.isTextBack) continue;

      remeasureTextBackBox(meta.el, meta, meta.currentFs ?? tbMin);

      clampLayerInCanvas(meta.el, meta);

    }

  }



  const slides = document.querySelectorAll(".page.mimic-docai-layers");

  for (const slide of slides) {

    const metas = [];

    const slideIsFullBleed = slide.classList.contains("mimic-docai-fullbleed");

    const layers = slide.querySelectorAll(".mimic-docai-layer");



    for (const el of layers) {

      const style = el.style;

      const slotW = parseFloat(style.width);

      const slotH = parseFloat(style.height);

      if (!Number.isFinite(slotW) || !Number.isFinite(slotH) || slotW <= 0 || slotH <= 0) continue;



      const origTop = parseFloat(style.top);

      const origLeft = parseFloat(style.left);

      if (!Number.isFinite(origTop) || !Number.isFinite(origLeft)) continue;



      const preserveBox = el.getAttribute("data-preserve-box-size") === "1";

      const meta = {

        el,

        slotW,

        slotH,

        origTop,

        origLeft,

        textAlign: style.textAlign || "left",

        isTextBack: el.classList.contains("mimic-docai-layer--text-back"),

        isSingleLine: el.classList.contains("mimic-docai-layer--single-line"),

        fullBleed: slideIsFullBleed,

        skipCenter: el.getAttribute("data-skip-center-avoid") === "1",

        currentFs: parseFloat(style.fontSize) || tbMin,

        fitMaxW: slotW,

        fitMaxH: slotH,

        boxW: slotW,

        boxH: slotH,

        preserveBox,

      };

      metas.push(meta);



      if (meta.isTextBack) {

        if (preserveBox) fitTextBackLayerPreservingBox(el, meta);

        else fitTextBackLayer(el, meta);

        continue;

      }



      if (preserveBox) {

        fitTextBackLayerPreservingBox(el, meta);

        continue;

      }



      const styledFs = parseFloat(style.fontSize);

      const refFs = Number(el.getAttribute("data-ref-font-size"));

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

      while (guard++ < 140 && fs > minFontPx && (el.scrollHeight > slotH + slack || el.scrollWidth > slotW + slack)) {

        fs -= 1;

        style.fontSize = `${fs}px`;

      }

      fs = Math.max(minFontPx, fs);

      style.fontSize = `${fs}px`;



      if (el.scrollWidth > slotW + slack) {

        const growW = Math.min(el.scrollWidth - slotW + slack, canvasW - margin - (origLeft + slotW));

        if (growW > 0) style.width = `${slotW + growW}px`;

      }

      if (el.scrollHeight > slotH + slack) {

        const growH = Math.min(el.scrollHeight - slotH + slack, canvasH - margin - (origTop + slotH));

        if (growH > 0) style.height = `${slotH + growH}px`;

      }

      style.fontSize = `${Math.max(minFontPx, fs)}px`;

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



module.exports = {

  fitDocAiTextLayersToBoxes,

  fitDocAiTextLayersToBoxesInPage,

  MIMIC_DOCAI_MIN_FONT_PX,

  MIMIC_DOCAI_TEXT_BACK_MIN_FONT_PX,

};


