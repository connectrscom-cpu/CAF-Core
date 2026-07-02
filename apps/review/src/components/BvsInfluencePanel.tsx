"use client";

import { useEffect, useMemo, useState } from "react";
import { BrandAssetImage } from "@/components/marketer/BrandAssetImage";
import {
  buildBvsInfluenceSections,
  bvsPromptWasApplied,
  parseBvsFromGenerationPayload,
  roleLabel,
  visualModeLabel,
} from "@/lib/bvs-influence";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value?.trim()) return null;
  return (
    <div className="bvs-influence-field">
      <span className="bvs-influence-field__label">{label}</span>
      <span className="bvs-influence-field__value">{value}</span>
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
    if (!taskId || !ctx.enabled) {
      setImagePromptApplied(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const qs = projectSlug.trim() ? `?project=${encodeURIComponent(projectSlug.trim())}` : "";
        const res = await fetch(`/api/task/${encodeURIComponent(taskId)}/mimic-image-audits${qs}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { audits?: Array<{ step?: string; prompt?: string | null }> };
        if (cancelled) return;
        const step = `mimic_slide_gen_${slideIndex}`;
        const audit =
          json.audits?.find((a) => a.step === step) ??
          json.audits?.find((a) => a.step === (slideIndex === 1 ? "mimic_bg_extract" : `mimic_bg_extract_${slideIndex}`));
        setImagePromptApplied(bvsPromptWasApplied(audit?.prompt));
      } catch {
        if (!cancelled) setImagePromptApplied(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, projectSlug, slideIndex, ctx.enabled]);

  const snap = ctx.snapshot;
  const styleAssets = snap?.resolved_assets.filter((a) => a.public_url) ?? [];

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

          {styleAssets.length > 0 ? (
            <div className="bvs-influence-assets">
              <h4>Moodboard references used</h4>
              <div className="bvs-influence-assets__grid">
                {styleAssets.slice(0, 6).map((asset) => (
                  <div key={asset.asset_id} className="bvs-influence-asset">
                    <BrandAssetImage
                      slug={projectSlug}
                      asset={{ id: asset.asset_id, public_url: asset.public_url }}
                      className="bvs-influence-asset__img"
                      alt=""
                    />
                    <span>{roleLabel(asset.role)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : ctx.enabled ? (
            <Field
              label="Tip"
              value="Assign style-reference or character roles on moodboard assets in Profile → Brand Visual System to include them in the snapshot."
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default BvsInfluencePanel;
