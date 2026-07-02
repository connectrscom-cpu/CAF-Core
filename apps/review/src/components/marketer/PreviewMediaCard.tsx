"use client";

import { useState } from "react";
import type { ContentPreview } from "@/lib/marketer/preview-resolver";
import { previewStatusBadgeClass, previewStatusLabel } from "@/lib/marketer/preview-resolver";
import { isVideoUrl } from "@/lib/media-url";

export interface PreviewMediaCardProps {
  preview: ContentPreview;
  alt?: string;
  className?: string;
  /** compact = list row thumb; card = idea/intel tile */
  variant?: "compact" | "card";
  showBadge?: boolean;
}

export function PreviewMediaCard({
  preview,
  alt = "",
  className = "",
  variant = "card",
  showBadge = true,
}: PreviewMediaCardProps) {
  const [broken, setBroken] = useState(false);
  const url = (preview.thumbnailUrl ?? preview.previewUrl ?? "").trim();
  const showMedia = preview.status === "ready" && url && !broken;
  const sizeClass = variant === "compact" ? "preview-media--compact" : "preview-media--card";

  return (
    <div className={`preview-media ${sizeClass} ${className}`.trim()}>
      {showBadge ? (
        <span className={previewStatusBadgeClass(preview.status)} title={previewStatusLabel(preview.status)}>
          {previewStatusLabel(preview.status)}
        </span>
      ) : null}
      <div className="preview-media__frame" aria-label={previewStatusLabel(preview.status)}>
        {showMedia ? (
          isVideoUrl(url) ? (
            <video src={url} muted playsInline preload="metadata" onError={() => setBroken(true)} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
          )
        ) : (
          <PreviewPlaceholder preview={preview} broken={broken} />
        )}
      </div>
    </div>
  );
}

function PreviewPlaceholder({ preview, broken }: { preview: ContentPreview; broken: boolean }) {
  const kind = preview.kind;
  const icon =
    kind === "video"
      ? "▶"
      : kind === "carousel"
        ? "▦"
        : kind === "storyboard"
          ? "◫"
          : kind === "reference"
            ? "◎"
            : "—";

  let message = previewStatusLabel(preview.status);
  if (broken) message = "Preview unavailable";
  else if (preview.status === "failed" && preview.failedReason) {
    message = "Render failed";
  }

  return (
    <div className="preview-media__placeholder">
      <span className="preview-media__placeholder-icon" aria-hidden>
        {icon}
      </span>
      <span className="preview-media__placeholder-text">{message}</span>
    </div>
  );
}
