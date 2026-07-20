"use client";

import { useCallback, useState } from "react";
import { CarouselBrandStylingPanel } from "@/components/CarouselBrandStylingPanel";
import type {
  BrandLogoPosition,
  BrandSlideFrameOption,
  BrandSlideLogoOption,
} from "@/lib/brand-asset-url";

export interface VideoBrandStampControlsProps {
  taskId: string;
  projectSlug: string;
  brandLogoDisplayUrl?: string;
  brandLogos?: BrandSlideLogoOption[];
  logoEnabled: boolean;
  onLogoEnabledChange: (enabled: boolean) => void;
  selectedLogoAssetId?: string;
  onSelectedLogoAssetIdChange?: (assetId: string) => void;
  logoPosition?: BrandLogoPosition;
  onLogoPositionChange?: (position: BrandLogoPosition) => void;
  brandFrames?: BrandSlideFrameOption[];
  frameEnabled: boolean;
  onFrameEnabledChange: (enabled: boolean) => void;
  selectedFrameAssetId: string;
  onSelectedFrameAssetIdChange: (assetId: string) => void;
  onApplied?: () => void;
}

export function VideoBrandStampControls({
  taskId,
  projectSlug,
  brandLogoDisplayUrl = "",
  brandLogos = [],
  logoEnabled,
  onLogoEnabledChange,
  selectedLogoAssetId = "",
  onSelectedLogoAssetIdChange,
  logoPosition = "br",
  onLogoPositionChange,
  brandFrames = [],
  frameEnabled,
  onFrameEnabledChange,
  selectedFrameAssetId,
  onSelectedFrameAssetIdChange,
  onApplied,
}: VideoBrandStampControlsProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyStamps = useCallback(async () => {
    const tid = taskId.trim();
    const slug = projectSlug.trim();
    if (!tid || !slug) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const logo =
        logoEnabled && brandLogos.length > 0
          ? brandLogos.find((l) => l.assetId === selectedLogoAssetId) ?? brandLogos[0]
          : undefined;
      const logoUrl = logo?.reprintUrl?.trim() || (logoEnabled ? brandLogoDisplayUrl.trim() : "");
      const frame =
        frameEnabled && brandFrames.length > 0
          ? brandFrames.find((f) => f.assetId === selectedFrameAssetId) ?? brandFrames[0]
          : undefined;
      const res = await fetch("/api/task/reprint-video-brand-overlays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: tid,
          project: slug,
          logo_enabled: logoEnabled,
          frame_enabled: frameEnabled,
          ...(logoEnabled && logoUrl
            ? {
                logo_overlay: {
                  url: logoUrl,
                  position: logoPosition,
                  ...(logo?.assetId ? { asset_id: logo.assetId } : {}),
                },
              }
            : {}),
          ...(frameEnabled && frame?.reprintUrl?.trim()
            ? { frame_overlay: { url: frame.reprintUrl.trim(), asset_id: frame.assetId } }
            : {}),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? json.message ?? `Request failed (${res.status})`);
        return;
      }
      setMessage(json.message ?? "Brand stamp started — refresh preview in about a minute.");
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [
    taskId,
    projectSlug,
    logoEnabled,
    frameEnabled,
    brandLogoDisplayUrl,
    brandLogos,
    selectedLogoAssetId,
    logoPosition,
    brandFrames,
    selectedFrameAssetId,
    onApplied,
  ]);

  const hasStampOption =
    ((brandLogos.length > 0 || brandLogoDisplayUrl.trim()) && logoEnabled) ||
    (frameEnabled && brandFrames.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <CarouselBrandStylingPanel
        variant="video"
        showTypographyPx={false}
        fontScale="1"
        onFontScaleChange={() => {}}
        carouselHeadlineFontPx=""
        onCarouselHeadlineFontPxChange={() => {}}
        carouselBodyFontPx=""
        onCarouselBodyFontPxChange={() => {}}
        carouselKickerFontPx=""
        onCarouselKickerFontPxChange={() => {}}
        carouselCtaFontPx=""
        onCarouselCtaFontPxChange={() => {}}
        carouselHandleFontPx=""
        onCarouselHandleFontPxChange={() => {}}
        brandLogos={brandLogos}
        brandLogoDisplayUrl={brandLogoDisplayUrl}
        logoEnabled={logoEnabled}
        onLogoEnabledChange={onLogoEnabledChange}
        selectedLogoAssetId={selectedLogoAssetId}
        onSelectedLogoAssetIdChange={onSelectedLogoAssetIdChange}
        logoPosition={logoPosition}
        onLogoPositionChange={onLogoPositionChange}
        brandFrames={brandFrames}
        frameEnabled={frameEnabled}
        onFrameEnabledChange={onFrameEnabledChange}
        selectedFrameAssetId={selectedFrameAssetId}
        onSelectedFrameAssetIdChange={onSelectedFrameAssetIdChange}
        paperHex=""
        onPaperHexChange={() => {}}
        inkHex=""
        onInkHexChange={() => {}}
      />
      <div>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void applyStamps()}
          style={{ width: "100%" }}
        >
          {busy ? "Applying…" : hasStampOption ? "Apply brand stamps to video" : "Remove brand stamps from video"}
        </button>
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0", lineHeight: 1.45 }}>
          Preview shows overlays live; click apply to burn into the MP4. Uncheck both to restore the original render.
        </p>
        {message ? (
          <p style={{ fontSize: 12, color: "var(--green, #1a7f4b)", margin: "8px 0 0" }}>{message}</p>
        ) : null}
        {error ? (
          <p style={{ fontSize: 12, color: "var(--red)", margin: "8px 0 0" }}>{error}</p>
        ) : null}
      </div>
    </div>
  );
}
