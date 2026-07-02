"use client";

import { BrandAssetImage } from "@/components/marketer/BrandAssetImage";
import type { BrandBible } from "@/lib/marketer/types";
import type { MoodboardAsset } from "./BrandBibleAssetInspectModal";

type Props = {
  slug: string;
  displayName: string;
  bible: BrandBible;
  assets: MoodboardAsset[];
};

function postAssets(assets: MoodboardAsset[]): MoodboardAsset[] {
  return assets.filter(
    (a) => (a.kind === "logo" || a.kind === "reference_image" || a.kind === "other") && a.public_url
  );
}

function profileAvatarAsset(assets: MoodboardAsset[]): MoodboardAsset | null {
  const logo = assets.find((a) => a.kind === "logo" && a.public_url);
  if (logo) return logo;
  const ref = assets.find((a) => a.kind === "reference_image" && a.public_url);
  return ref ?? null;
}

function bioText(bible: BrandBible): string {
  const guide = bible.applicationGuide.instructions.trim();
  if (guide) return guide.length > 150 ? `${guide.slice(0, 147)}…` : guide;
  const motifs = bible.allowedMotifs.trim();
  if (motifs) return motifs.length > 150 ? `${motifs.slice(0, 147)}…` : motifs;
  return "Your brand visual system — references, palette, and style rules for CAF.";
}

function gradientFromPalette(palette: string[], index: number): string {
  if (palette.length === 0) return "linear-gradient(135deg, #2a2a2a, #1a1a1a)";
  const a = palette[index % palette.length]!;
  const b = palette[(index + 1) % palette.length] ?? a;
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function BrandBibleInstagramPreview({ slug, displayName, bible, assets }: Props) {
  const avatarAsset = profileAvatarAsset(assets);
  const posts = postAssets(assets);
  const gridSlots = 9;
  const slots: Array<{ type: "asset"; asset: MoodboardAsset } | { type: "gradient"; css: string }> = [];

  for (let i = 0; i < gridSlots; i++) {
    if (posts[i]) slots.push({ type: "asset", asset: posts[i]! });
    else slots.push({ type: "gradient", css: gradientFromPalette(bible.palette, i) });
  }

  const highlights: Array<
    | { id: string; label: string; color: string; asset?: undefined }
    | { id: string; label: string; asset: MoodboardAsset; color?: undefined }
  > = [
    ...bible.palette.slice(0, 3).map((c, i) => ({ id: `color-${i}`, label: "Palette", color: c })),
    ...assets
      .filter((a) => a.kind === "reference_image")
      .slice(0, 3)
      .map((a) => ({
        id: a.id,
        label: (a.label ?? "Style").slice(0, 12),
        asset: a,
      })),
  ].slice(0, 5);

  const visualModeLabel =
    bible.visualMode === "custom" && bible.visualModeCustom
      ? bible.visualModeCustom
      : bible.visualMode.replace(/_/g, " ");

  return (
    <div className="brand-bible-ig-wrap">
      <p className="brand-bible-ig-lead">
        Preview how your references and palette could read on a social profile — a quick gut-check before CAF
        generates content.
      </p>

      <div className="brand-bible-ig-phone">
        <div className="brand-bible-ig-statusbar">
          <span>9:41</span>
          <span>Instagram</span>
          <span>▮▮▮</span>
        </div>

        <header className="brand-bible-ig-profile-header">
          <div className="brand-bible-ig-avatar-wrap">
            {avatarAsset ? (
              <BrandAssetImage slug={slug} asset={avatarAsset} className="brand-bible-ig-avatar" />
            ) : (
              <div className="brand-bible-ig-avatar brand-bible-ig-avatar--empty">{displayName.slice(0, 1)}</div>
            )}
          </div>
          <div className="brand-bible-ig-stats">
            <div>
              <strong>{posts.length}</strong>
              <span>posts</span>
            </div>
            <div>
              <strong>—</strong>
              <span>followers</span>
            </div>
            <div>
              <strong>—</strong>
              <span>following</span>
            </div>
          </div>
        </header>

        <div className="brand-bible-ig-identity">
          <h4>{displayName}</h4>
          <p className="brand-bible-ig-handle">@{slug.toLowerCase().replace(/[^a-z0-9._]/g, "")}</p>
          <p className="brand-bible-ig-bio">{bioText(bible)}</p>
          {visualModeLabel && <p className="brand-bible-ig-tag">{visualModeLabel}</p>}
        </div>

        {highlights.length > 0 && (
          <div className="brand-bible-ig-highlights">
            {highlights.map((h) => (
              <div key={h.id} className="brand-bible-ig-highlight">
                <div
                  className="brand-bible-ig-highlight-ring"
                  style={h.color ? { background: h.color } : undefined}
                >
                  {h.asset ? <BrandAssetImage slug={slug} asset={h.asset} alt="" /> : null}
                </div>
                <span>{h.label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="brand-bible-ig-tabs">
          <span className="active">▦</span>
          <span>◎</span>
          <span>▶</span>
        </div>

        <div className="brand-bible-ig-grid">
          {slots.map((slot, i) => (
            <div key={i} className="brand-bible-ig-post">
              {slot.type === "asset" ? (
                <BrandAssetImage slug={slug} asset={slot.asset} alt="" loading="lazy" />
              ) : (
                <div className="brand-bible-ig-post-fallback" style={{ background: slot.css }} />
              )}
            </div>
          ))}
        </div>

        <div className="brand-bible-ig-nav">
          <span>⌂</span>
          <span>⌕</span>
          <span>＋</span>
          <span>♡</span>
          <span>☺</span>
        </div>
      </div>

      {posts.length === 0 && (
        <p className="brand-bible-ig-hint">
          Add reference images to your moodboard to populate the post grid. Empty slots use your bible palette.
        </p>
      )}
    </div>
  );
}
