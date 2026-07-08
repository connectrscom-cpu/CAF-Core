"use client";

import { useEffect, useMemo, useState } from "react";
import { BrandAssetImage } from "@/components/marketer/BrandAssetImage";
import {
  buildBvsInfluenceSections,
  bvsPromptWasApplied,
  parseBvsFromGenerationPayload,
  resolveFluxPromptAssetsFromSnapshot,
  roleLabel,
  visualModeLabel,
  type BvsResolvedAsset,
} from "@/lib/bvs-influence";
import type { MimicImageAudit } from "@/lib/caf-core-client";
import { auditForSlide, imageProviderLabel } from "@/lib/mimic-image-audit";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value?.trim()) return null;
  return (
    <div className="bvs-influence-field">
      <span className="bvs-influence-field__label">{label}</span>
      <span className="bvs-influence-field__value">{value}</span>
    </div>
  );
}

function PromptAssetThumb({
  label,
  url,
  slug,
  assetId,
  detail,
}: {
  label: string;
  url: string;
  slug: string;
  assetId?: string;
  detail?: string | null;
}) {
  return (
    <div className="bvs-influence-prompt-asset">
      {assetId ? (
        <BrandAssetImage
          slug={slug}
          asset={{ id: assetId, public_url: url }}
          className="bvs-influence-prompt-asset__img"
          alt=""
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="bvs-influence-prompt-asset__img" loading="lazy" />
      )}
      <span className="bvs-influence-prompt-asset__label">{label}</span>
      {detail ? <span className="bvs-influence-prompt-asset__detail">{detail}</span> : null}
    </div>
  );
}

function MoodboardAssetGrid({
  title,
  hint,
  assets,
  slug,
}: {
  title: string;
  hint?: string;
  assets: BvsResolvedAsset[];
  slug: string;
}) {
  if (!assets.length) return null;
  return (
    <div className="bvs-influence-assets">
      <h4>{title}</h4>
      {hint ? <p className="bvs-influence-collapsible__hint">{hint}</p> : null}
      <div className="bvs-influence-assets__grid">
        {assets.slice(0, 8).map((asset) => (
          <div key={asset.asset_id} className="bvs-influence-asset">
            <BrandAssetImage
              slug={slug}
              asset={{ id: asset.asset_id, public_url: asset.public_url }}
              className="bvs-influence-asset__img"
              alt=""
            />
            <span>{roleLabel(asset.role)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BvsInfluencePanel({
  generationPayload,
  mimicV1,
  projectSlug,
  slideIndex = 1,
  generatedOnScreenText,
  brandPalette,
  taskId,
  defaultOpen = false,
}: {
  generationPayload: Record<string, unknown> | null | undefined;
  mimicV1?: Record<string, unknown> | null;
  projectSlug: string;
  slideIndex?: number;
  generatedOnScreenText?: string | null;
  brandPalette?: string[];
  taskId?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [slideAudit, setSlideAudit] = useState<MimicImageAudit | null>(null);
  const [auditsLoading, setAuditsLoading] = useState(false);
  const [auditsError, setAuditsError] = useState<string | null>(null);
  const [imagePromptApplied, setImagePromptApplied] = useState<boolean | undefined>(undefined);

  const ctx = useMemo(
    () => parseBvsFromGenerationPayload(generationPayload, mimicV1),
    [generationPayload, mimicV1]
  );

  const sections = useMemo(
    () =>
      buildBvsInfluenceSections(ctx, {
        slideIndex,
        generatedCopy: generatedOnScreenText,
        renderPalette: brandPalette,
        imagePromptApplied,
      }),
    [ctx, slideIndex, generatedOnScreenText, brandPalette, imagePromptApplied]
  );

  useEffect(() => {
    if (!taskId?.trim()) {
      setSlideAudit(null);
      setImagePromptApplied(undefined);
      setAuditsError(null);
      return;
    }
    let cancelled = false;
    setAuditsLoading(true);
    setAuditsError(null);
    (async () => {
      try {
        const qs = projectSlug.trim() ? `?project=${encodeURIComponent(projectSlug.trim())}` : "";
        const res = await fetch(`/api/task/${encodeURIComponent(taskId)}/mimic-image-audits${qs}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { audits?: MimicImageAudit[] };
        if (cancelled) return;
        const audit = auditForSlide(json.audits ?? [], slideIndex);
        setSlideAudit(audit);
        setImagePromptApplied(bvsPromptWasApplied(audit?.prompt));
      } catch (e) {
        if (!cancelled) {
          setSlideAudit(null);
          setImagePromptApplied(undefined);
          setAuditsError(e instanceof Error ? e.message : "Failed to load image audits");
        }
      } finally {
        if (!cancelled) setAuditsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, projectSlug, slideIndex]);

  const snap = ctx.snapshot;
  const fluxPromptAssets = useMemo(() => resolveFluxPromptAssetsFromSnapshot(snap), [snap]);
  const moodboardAssets = snap?.resolved_assets.filter((a) => a.public_url) ?? [];
  const promptTextAssets = fluxPromptAssets.length > 0 ? fluxPromptAssets : moodboardAssets;
  const providerLabel = imageProviderLabel(slideAudit);

  return (
    <div className="bvs-influence-panel">
      <button
        type="button"
        className="bvs-influence-panel__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="bvs-influence-panel__title">Brand bible influence</span>
        <span className="bvs-influence-panel__meta">
          {ctx.enabled || ctx.mimicEnabled ? "BVS on" : "BVS off"}
          {ctx.bible_version != null ? ` · v${ctx.bible_version}` : ""}
          {visualModeLabel(snap) ? ` · ${visualModeLabel(snap)}` : ""}
        </span>
        <span className="bvs-influence-panel__chevron">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="bvs-influence-panel__body">
          <p className="bvs-influence-panel__lead">
            Your Brand Visual System moodboard and rules — how they shaped this generated piece alongside the
            reference strategy in <strong>Why this works</strong>.
          </p>

          {snap?.palette.length ? (
            <div className="bvs-influence-palette" aria-label="Bible palette">
              {snap.palette.map((c) => (
                <span key={c} className="bvs-influence-palette__chip" style={{ background: c }} title={c} />
              ))}
            </div>
          ) : null}

          {sections.map((section) => (
            <div key={section.title} className="bvs-influence-section">
              <h4>{section.title}</h4>
              {section.lines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          ))}

          <details className="bvs-influence-collapsible">
            <summary>
              Image generation prompt
              <span className="bvs-influence-collapsible__meta">
                slide {slideIndex}
                {slideAudit ? ` · ${providerLabel}` : ""}
              </span>
            </summary>
            <div className="bvs-influence-collapsible__body">
              {auditsLoading ? (
                <p className="bvs-influence-collapsible__hint">Loading image generation audit…</p>
              ) : auditsError ? (
                <p className="bvs-influence-collapsible__hint bvs-influence-collapsible__hint--warn">
                  Could not load audit: {auditsError}
                </p>
              ) : slideAudit?.prompt ? (
                <>
                  <div className="bvs-influence-collapsible__meta-row">
                    <span>
                      step <code>{slideAudit.step}</code>
                    </span>
                    <span>
                      {slideAudit.provider}
                      {slideAudit.model ? ` / ${slideAudit.model}` : ""}
                    </span>
                    {slideAudit.size ? <span>{slideAudit.size}</span> : null}
                    {slideAudit.latency_ms != null ? <span>{slideAudit.latency_ms}ms</span> : null}
                    {!slideAudit.ok ? <span className="bvs-influence-collapsible__hint--warn">FAILED</span> : null}
                  </div>
                  {slideAudit.error_message ? (
                    <p className="bvs-influence-collapsible__hint bvs-influence-collapsible__hint--warn">
                      {slideAudit.error_message}
                    </p>
                  ) : null}
                  <pre className="bvs-influence-prompt-block">{slideAudit.prompt}</pre>
                </>
              ) : (
                <p className="bvs-influence-collapsible__hint">
                  No stored prompt for slide {slideIndex} yet. Re-render or regenerate the slide — CAF logs the exact
                  Flux / Qwen / BFL prompt in <code>api_call_audit</code> at render time.
                </p>
              )}
            </div>
          </details>

          <details className="bvs-influence-collapsible">
            <summary>
              Assets sent in the image prompt
              <span className="bvs-influence-collapsible__meta">
                {slideAudit?.reference_url ? "reference frame" : ""}
                {fluxPromptAssets.length
                  ? `${fluxPromptAssets.length} flux refs`
                  : moodboardAssets.length
                    ? `${moodboardAssets.length} moodboard`
                    : ""}
              </span>
            </summary>
            <div className="bvs-influence-collapsible__body">
              {slideAudit?.reference_url ? (
                <div className="bvs-influence-prompt-assets">
                  <p className="bvs-influence-collapsible__hint">
                    Reference frame uploaded to the image model as <code>input_image</code> / reference edit (top
                    performer slide — structure only, not pixel copy when BVS is on).
                  </p>
                  <PromptAssetThumb
                    label="Reference frame"
                    url={slideAudit.reference_url}
                    slug={projectSlug}
                    detail={slideAudit.reference_url.length > 72 ? slideAudit.reference_url : null}
                  />
                </div>
              ) : (
                <p className="bvs-influence-collapsible__hint">
                  {auditsLoading
                    ? "Loading…"
                    : "No reference image URL stored for this slide — may be text-to-image mode or audit not written yet."}
                </p>
              )}

              <MoodboardAssetGrid
                title={
                  fluxPromptAssets.length > 0
                    ? "Flux prompt references (selected in brand bible)"
                    : "Brand bible assets referenced in prompt text"
                }
                hint={
                  fluxPromptAssets.length > 0
                    ? "These are the assets you picked under Profile → Brand Visual System → Flux prompt references. Their roles, labels, and usage notes appear line-by-line in the BVS block inside the Flux prompt above."
                    : "These moodboard images are described in the Brand Visual System block inside the prompt above when aggregate role counts are used — pick specific Flux references on the brand profile to control which assets appear."
                }
                assets={promptTextAssets}
                slug={projectSlug}
              />

              {!slideAudit?.reference_url && moodboardAssets.length === 0 && !auditsLoading ? (
                <Field
                  label="Tip"
                  value="Assign style-reference or character roles on moodboard assets in Profile → Brand Visual System to include them in the snapshot."
                />
              ) : null}
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

export default BvsInfluencePanel;
