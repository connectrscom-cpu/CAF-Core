"use client";

import type { BrandSlideFrameOption } from "@/lib/brand-asset-url";
import type { CarouselTypographyPayloadKey } from "@/lib/carousel-slides";

export interface CarouselBrandStylingPanelProps {
  fontScale: string;
  onFontScaleChange: (value: string) => void;
  carouselHeadlineFontPx: string;
  onCarouselHeadlineFontPxChange: (value: string) => void;
  carouselBodyFontPx: string;
  onCarouselBodyFontPxChange: (value: string) => void;
  carouselKickerFontPx: string;
  onCarouselKickerFontPxChange: (value: string) => void;
  carouselCtaFontPx: string;
  onCarouselCtaFontPxChange: (value: string) => void;
  carouselHandleFontPx: string;
  onCarouselHandleFontPxChange: (value: string) => void;
  brandPalette?: string[];
  brandLogoDisplayUrl?: string;
  logoEnabled: boolean;
  onLogoEnabledChange: (enabled: boolean) => void;
  brandFrames?: BrandSlideFrameOption[];
  frameEnabled: boolean;
  onFrameEnabledChange: (enabled: boolean) => void;
  selectedFrameAssetId: string;
  onSelectedFrameAssetIdChange: (assetId: string) => void;
  paperHex: string;
  onPaperHexChange: (hex: string) => void;
  inkHex: string;
  onInkHexChange: (hex: string) => void;
  /** When false, hide px typography grid (e.g. mimic panel already has per-box controls). */
  showTypographyPx?: boolean;
  /** `video` hides typography/palette — logo + frame stamps only. */
  variant?: "carousel" | "video";
  className?: string;
}

const PX_FIELDS: Array<{
  key: CarouselTypographyPayloadKey;
  label: string;
  placeholder: string;
  fullWidth?: boolean;
}> = [
  { key: "carousel_headline_font_px", label: "Headline px", placeholder: "e.g. 72" },
  { key: "carousel_body_font_px", label: "Body px", placeholder: "e.g. 56" },
  { key: "carousel_kicker_font_px", label: "Kicker px", placeholder: "e.g. 18" },
  { key: "carousel_cta_font_px", label: "CTA px", placeholder: "e.g. 72" },
  { key: "carousel_handle_font_px", label: "Handle px", placeholder: "e.g. 42", fullWidth: true },
];

export function CarouselBrandStylingPanel({
  fontScale,
  onFontScaleChange,
  carouselHeadlineFontPx,
  onCarouselHeadlineFontPxChange,
  carouselBodyFontPx,
  onCarouselBodyFontPxChange,
  carouselKickerFontPx,
  onCarouselKickerFontPxChange,
  carouselCtaFontPx,
  onCarouselCtaFontPxChange,
  carouselHandleFontPx,
  onCarouselHandleFontPxChange,
  brandPalette = [],
  brandLogoDisplayUrl = "",
  logoEnabled,
  onLogoEnabledChange,
  brandFrames = [],
  frameEnabled,
  onFrameEnabledChange,
  selectedFrameAssetId,
  onSelectedFrameAssetIdChange,
  paperHex,
  onPaperHexChange,
  inkHex,
  onInkHexChange,
  showTypographyPx = true,
  variant = "carousel",
  className,
}: CarouselBrandStylingPanelProps) {
  const pxValues: Record<CarouselTypographyPayloadKey, string> = {
    carousel_headline_font_px: carouselHeadlineFontPx,
    carousel_body_font_px: carouselBodyFontPx,
    carousel_kicker_font_px: carouselKickerFontPx,
    carousel_cta_font_px: carouselCtaFontPx,
    carousel_handle_font_px: carouselHandleFontPx,
  };
  const pxSetters: Record<CarouselTypographyPayloadKey, (v: string) => void> = {
    carousel_headline_font_px: onCarouselHeadlineFontPxChange,
    carousel_body_font_px: onCarouselBodyFontPxChange,
    carousel_kicker_font_px: onCarouselKickerFontPxChange,
    carousel_cta_font_px: onCarouselCtaFontPxChange,
    carousel_handle_font_px: onCarouselHandleFontPxChange,
  };

  return (
    <div className={`card surface-muted carousel-brand-styling${className ? ` ${className}` : ""}`}>
      <div className="card-header">{variant === "video" ? "Brand stamps" : "Typography & brand"}</div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.45 }}>
        {variant === "video"
          ? "Toggle logo and frame overlays, then apply to burn them into the stored MP4 (no HeyGen re-bill)."
          : "Adjust renderer typography and brand stamps — the slide preview updates as you edit copy and styling."}
      </p>

      {variant === "carousel" ? (
      <div style={{ marginBottom: 12 }}>
        <label className="filter-label">Font scale — {Number(fontScale || 1).toFixed(2)}×</label>
        <input
          type="range"
          min="0.75"
          max="1.25"
          step="0.01"
          value={fontScale || "1"}
          onChange={(e) => onFontScaleChange(e.target.value)}
        />
        <input
          type="text"
          value={fontScale}
          onChange={(e) => onFontScaleChange(e.target.value)}
          placeholder="1.00"
          style={{ marginTop: 6 }}
        />
      </div>
      ) : null}

      {variant === "carousel" && showTypographyPx ? (
        <div style={{ marginBottom: 12 }}>
          <label className="filter-label">Typography (px, optional)</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {PX_FIELDS.map((field) => (
              <label key={field.key} style={{ fontSize: 12, gridColumn: field.fullWidth ? "1 / -1" : undefined }}>
                {field.label}
                <input
                  type="text"
                  inputMode="numeric"
                  value={pxValues[field.key]}
                  onChange={(e) => pxSetters[field.key](e.target.value)}
                  placeholder={field.placeholder}
                  style={{ display: "block", width: "100%", marginTop: 4 }}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {variant === "carousel" && brandPalette.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <label className="filter-label">Brand palette</label>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 8px" }}>
            Tap a swatch to set paper (background) or ink (text). Clear with the reset buttons.
          </p>
          <div className="brand-swatches" title="Brand palette">
            {brandPalette.map((hex) => (
              <button
                key={hex}
                type="button"
                className={`brand-swatch${paperHex === hex || inkHex === hex ? " brand-swatch--active" : ""}`}
                style={{ background: hex }}
                title={hex}
                aria-label={`Palette ${hex}`}
                onClick={(e) => {
                  if (e.shiftKey) onInkHexChange(hex);
                  else onPaperHexChange(hex);
                }}
              />
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <label style={{ fontSize: 12 }}>
              Paper / background
              <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                <input type="color" value={paperHex || "#ffffff"} onChange={(e) => onPaperHexChange(e.target.value)} />
                <input
                  type="text"
                  value={paperHex}
                  onChange={(e) => onPaperHexChange(e.target.value)}
                  placeholder="#fffef9"
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn-ghost btn-sm" onClick={() => onPaperHexChange("")}>
                  Clear
                </button>
              </div>
            </label>
            <label style={{ fontSize: 12 }}>
              Ink / text
              <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                <input type="color" value={inkHex || "#111111"} onChange={(e) => onInkHexChange(e.target.value)} />
                <input
                  type="text"
                  value={inkHex}
                  onChange={(e) => onInkHexChange(e.target.value)}
                  placeholder="#1a1a1a"
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn-ghost btn-sm" onClick={() => onInkHexChange("")}>
                  Clear
                </button>
              </div>
            </label>
          </div>
          <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            Click swatch = paper · Shift+click = ink
          </p>
        </div>
      ) : null}

      {brandLogoDisplayUrl.trim() ? (
        <div style={{ marginBottom: 12 }}>
          <label className="mimic-layer-editor-panel__option">
            <input type="checkbox" checked={logoEnabled} onChange={(e) => onLogoEnabledChange(e.target.checked)} />
            <span>Stamp brand logo (lower-right)</span>
          </label>
          {logoEnabled ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandLogoDisplayUrl} alt="Brand logo" className="brand-logo-chip" />
          ) : null}
        </div>
      ) : null}

      {brandFrames.length > 0 ? (
        <div style={{ marginBottom: 4 }}>
          <label className="mimic-layer-editor-panel__option">
            <input type="checkbox" checked={frameEnabled} onChange={(e) => onFrameEnabledChange(e.target.checked)} />
            <span>Brand slide frame</span>
          </label>
          {frameEnabled && brandFrames.length > 1 ? (
            <div className="brand-frame-picker" title="Pick a frame style">
              {brandFrames.map((frame) => {
                const active = frame.assetId === selectedFrameAssetId;
                return (
                  <button
                    key={frame.assetId}
                    type="button"
                    className={`brand-frame-picker__item${active ? " brand-frame-picker__item--active" : ""}`}
                    title={frame.label}
                    aria-label={frame.label}
                    aria-pressed={active}
                    onClick={() => onSelectedFrameAssetIdChange(frame.assetId)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={frame.displayUrl} alt="" />
                    <span>{frame.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {frameEnabled && brandFrames.length === 1 && brandFrames[0]?.displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandFrames[0].displayUrl} alt={brandFrames[0].label} className="brand-frame-chip" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
