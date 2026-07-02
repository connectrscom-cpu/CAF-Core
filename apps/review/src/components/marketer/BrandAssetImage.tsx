"use client";

import { useMemo, useState } from "react";
import { brandAssetProxyUrl, resolveBrandAssetImageUrl } from "@/lib/brand-asset-url";

type Props = {
  slug: string;
  asset: { id?: string; public_url?: string | null };
  className?: string;
  alt?: string;
  loading?: "lazy" | "eager";
};

function imageCandidates(slug: string, asset: { id?: string; public_url?: string | null }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (url: string) => {
    const t = url.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  add(resolveBrandAssetImageUrl(slug, asset));
  add(brandAssetProxyUrl(slug, asset));
  const pub = typeof asset.public_url === "string" ? asset.public_url.trim() : "";
  if (pub && /^https?:\/\//i.test(pub)) add(pub);
  return out;
}

/** Image with automatic fallback when public URL or proxy fails. */
export function BrandAssetImage({ slug, asset, className, alt = "", loading }: Props) {
  const candidates = useMemo(() => imageCandidates(slug, asset), [slug, asset]);
  const [index, setIndex] = useState(0);
  const src = candidates[index] ?? "";

  if (!src || index >= candidates.length) {
    return <div className={`brand-asset-image-fallback ${className ?? ""}`.trim()} aria-hidden />;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      onError={() => setIndex((i) => i + 1)}
    />
  );
}
