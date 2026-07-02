"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandAssetsPanel } from "@/components/BrandAssetsPanel";
import { brandAssetProxyUrl } from "@/lib/brand-asset-url";
import {
  BRAND_BIBLE_ASSET_ROLES,
  BRAND_BIBLE_CONTENT_AIMS,
  BRAND_BIBLE_VISUAL_MODES,
  brandBibleIsConfigured,
  emptyBrandBible,
  toBrandBible,
  toBrandBibleJson,
} from "@/lib/marketer/brand-bible-adapters";
import type { BrandBible, BrandBibleAssetRef, BrandBibleAssetRole } from "@/lib/marketer/types";

interface BrandAssetRow {
  id: string;
  kind: string;
  label: string | null;
  public_url: string | null;
}

export function BrandBibleEditor({ slug }: { slug: string }) {
  const [bible, setBible] = useState<BrandBible | null>(null);
  const [assets, setAssets] = useState<BrandAssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [paletteInput, setPaletteInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/brand-bible`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to load brand bible");
      setBible(toBrandBible(slug, j.parsed, j.version ?? null));
      setAssets(Array.isArray(j.brandAssets) ? j.brandAssets : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setBible(emptyBrandBible(slug));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const imageAssets = useMemo(
    () => assets.filter((a) => (a.kind === "logo" || a.kind === "reference_image" || a.kind === "other") && a.public_url),
    [assets]
  );

  function patchBible(patch: Partial<BrandBible>) {
    setBible((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function patchGuide(patch: Partial<BrandBible["applicationGuide"]>) {
    setBible((prev) =>
      prev ? { ...prev, applicationGuide: { ...prev.applicationGuide, ...patch } } : prev
    );
  }

  function toggleAim(id: string) {
    setBible((prev) => {
      if (!prev) return prev;
      const has = prev.applicationGuide.contentAims.includes(id);
      const next = has
        ? prev.applicationGuide.contentAims.filter((a) => a !== id)
        : [...prev.applicationGuide.contentAims, id];
      return { ...prev, applicationGuide: { ...prev.applicationGuide, contentAims: next } };
    });
  }

  function addPaletteColor(hex: string) {
    const v = hex.trim();
    if (!v || !bible) return;
    if (bible.palette.includes(v)) return;
    patchBible({ palette: [...bible.palette, v].slice(0, 5) });
    setPaletteInput("");
  }

  function addAssetRef(assetId: string, role: BrandBibleAssetRole) {
    if (!bible) return;
    if (bible.assetRefs.some((r) => r.assetId === assetId && r.role === role)) return;
    const row = imageAssets.find((a) => a.id === assetId);
    const ref: BrandBibleAssetRef = {
      assetId,
      role,
      label: row?.label ?? "",
      usageNotes: "",
    };
    patchBible({ assetRefs: [...bible.assetRefs, ref] });
  }

  function updateAssetRef(assetId: string, role: BrandBibleAssetRole, patch: Partial<BrandBibleAssetRef>) {
    if (!bible) return;
    patchBible({
      assetRefs: bible.assetRefs.map((r) =>
        r.assetId === assetId && r.role === role ? { ...r, ...patch } : r
      ),
    });
  }

  function removeAssetRef(assetId: string, role: BrandBibleAssetRole) {
    if (!bible) return;
    patchBible({
      assetRefs: bible.assetRefs.filter((r) => !(r.assetId === assetId && r.role === role)),
    });
  }

  async function save() {
    if (!bible) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/brand-bible`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bible_json: toBrandBibleJson(bible) }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Save failed");
      setMessage("Brand bible saved.");
      setBible(toBrandBible(slug, j.parsed, j.version ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="workspace-muted">Loading brand bible…</p>;
  if (!bible) return <p className="workspace-error">{error ?? "Could not load brand bible."}</p>;

  const configured = brandBibleIsConfigured(bible);

  return (
    <div className="profile-editor brand-bible-editor" data-agent-id="brand-bible-editor">
      <p className="brand-bible-lead">
        Your <strong>Brand Visual System</strong> tells CAF how every piece of content should look — not just
        logos, but illustration style, characters, palette, and how to apply them when creating or mimicking
        content.
      </p>

      {message && <p className="profile-save-ok">{message}</p>}
      {error && <p className="workspace-error">{error}</p>}

      <section className="profile-section">
        <h3 className="profile-section-title">Visual identity</h3>
        <div className="profile-editor-grid">
          <label className="profile-field">
            <span className="profile-field-label">Visual mode</span>
            <select
              value={bible.visualMode}
              onChange={(e) => patchBible({ visualMode: e.target.value as BrandBible["visualMode"] })}
            >
              <option value="">— Select —</option>
              {BRAND_BIBLE_VISUAL_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {(bible.visualMode === "custom" || bible.visualModeCustom) && (
            <label className="profile-field profile-field--full">
              <span className="profile-field-label">Custom visual style label</span>
              <input
                value={bible.visualModeCustom}
                onChange={(e) => patchBible({ visualModeCustom: e.target.value })}
                placeholder="e.g. Misty botanical editorial"
              />
            </label>
          )}
          <label className="profile-field profile-field--full">
            <span className="profile-field-label">Brand palette</span>
            <span className="profile-field-hint">Up to 5 hex colors — used on slides and overlays when BVS is on.</span>
            <div className="brand-kit-palette-list">
              {bible.palette.map((c, i) => (
                <div key={`${c}-${i}`} className="brand-kit-palette-row">
                  <span className="brand-kit-palette-swatch" style={{ background: c }} aria-hidden />
                  <span>{c}</span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => patchBible({ palette: bible.palette.filter((_, j) => j !== i) })}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            {bible.palette.length < 5 && (
              <div className="brand-kit-palette-row" style={{ marginTop: 8 }}>
                <input
                  type="color"
                  className="brand-kit-color-picker"
                  value={paletteInput.match(/^#[0-9a-fA-F]{6}$/) ? paletteInput : "#88b04b"}
                  onChange={(e) => setPaletteInput(e.target.value)}
                  aria-label="Pick palette color"
                />
                <input
                  className="profile-field-input"
                  value={paletteInput}
                  onChange={(e) => setPaletteInput(e.target.value)}
                  placeholder="#88b04b"
                />
                <button type="button" className="btn-ghost btn-sm" onClick={() => addPaletteColor(paletteInput)}>
                  Add color
                </button>
              </div>
            )}
          </label>
          <label className="profile-field profile-field--full">
            <span className="profile-field-label">Allowed visual motifs</span>
            <textarea
              className="profile-field-input"
              rows={2}
              value={bible.allowedMotifs}
              onChange={(e) => patchBible({ allowedMotifs: e.target.value })}
              placeholder="botanical line art; olive branches; misty gradients"
            />
          </label>
          <label className="profile-field profile-field--full">
            <span className="profile-field-label">Forbidden visual motifs</span>
            <textarea
              className="profile-field-input"
              rows={2}
              value={bible.forbiddenMotifs}
              onChange={(e) => patchBible({ forbiddenMotifs: e.target.value })}
              placeholder="stock food photos; faces; neon colors"
            />
          </label>
        </div>
      </section>

      <section className="profile-section">
        <h3 className="profile-section-title">How CAF should apply this brand</h3>
        <p className="profile-field-hint" style={{ marginBottom: 12 }}>
          Explain your visual goals and how CAF should use your references — especially when mimicking trending
          formats vs creating original posts.
        </p>
        <div className="profile-editor-grid">
          <div className="profile-field profile-field--full">
            <span className="profile-field-label">Content aims</span>
            <div className="profile-chip-row">
              {BRAND_BIBLE_CONTENT_AIMS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`profile-chip ${bible.applicationGuide.contentAims.includes(a.id) ? "active" : ""}`}
                  onClick={() => toggleAim(a.id)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <label className="profile-field profile-field--full">
            <span className="profile-field-label">Application guide</span>
            <textarea
              className="profile-field-input"
              rows={6}
              value={bible.applicationGuide.instructions}
              onChange={(e) => patchGuide({ instructions: e.target.value })}
              placeholder="Always use our botanical world — calm, premium, no faces. When mimicking a viral listicle, keep the hook structure but replace all visuals with our herb-garden aesthetic and palette…"
            />
          </label>
          <label className="profile-field profile-field--full">
            <span className="profile-field-label">When mimicking top performers</span>
            <textarea
              className="profile-field-input"
              rows={3}
              value={bible.applicationGuide.mimicPolicy}
              onChange={(e) => patchGuide({ mimicPolicy: e.target.value })}
              placeholder="Copy structure and persuasion only — never competitor visuals. All slides must match our Brand Bible."
            />
          </label>
          <label className="profile-field profile-field--full">
            <span className="profile-field-label">When creating original content</span>
            <textarea
              className="profile-field-input"
              rows={3}
              value={bible.applicationGuide.originalPolicy}
              onChange={(e) => patchGuide({ originalPolicy: e.target.value })}
              placeholder="Lead with botanical motifs on every slide; keep backgrounds minimal and misty."
            />
          </label>
        </div>
      </section>

      <section className="profile-section">
        <h3 className="profile-section-title">Brand kit</h3>
        <p className="profile-field-hint" style={{ marginBottom: 12 }}>
          Upload logos and reference images here, then assign roles below so CAF knows how to use each asset.
        </p>
        <BrandAssetsPanel projectSlug={slug} variant="marketer" />
      </section>

      <section className="profile-section">
        <h3 className="profile-section-title">Asset roles in this bible</h3>
        {imageAssets.length === 0 ? (
          <p className="workspace-muted">Upload reference images in the brand kit above, then assign roles.</p>
        ) : (
          <>
            <div className="brand-bible-asset-pick" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {imageAssets.map((a) => (
                <div key={a.id} className="brand-kit-card" style={{ maxWidth: 140 }}>
                  {a.public_url && (
                    <img
                      src={brandAssetProxyUrl(slug, { id: a.id, public_url: a.public_url }) || a.public_url}
                      alt=""
                      className="brand-kit-card-img"
                    />
                  )}
                  <div className="brand-kit-card-title">{a.label ?? a.kind}</div>
                  <select
                    className="profile-field-input"
                    defaultValue=""
                    onChange={(e) => {
                      const role = e.target.value as BrandBibleAssetRole;
                      if (role) addAssetRef(a.id, role);
                      e.target.value = "";
                    }}
                  >
                    <option value="">+ Add role…</option>
                    {BRAND_BIBLE_ASSET_ROLES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {bible.assetRefs.length > 0 && (
              <ul className="brand-bible-ref-list">
                {bible.assetRefs.map((ref) => {
                  const asset = imageAssets.find((a) => a.id === ref.assetId);
                  return (
                    <li key={`${ref.assetId}-${ref.role}`} className="brand-bible-ref-row">
                      <span className="profile-chip">{BRAND_BIBLE_ASSET_ROLES.find((r) => r.id === ref.role)?.label ?? ref.role}</span>
                      <span>{asset?.label ?? ref.assetId}</span>
                      <input
                        className="profile-field-input"
                        value={ref.usageNotes}
                        onChange={(e) => updateAssetRef(ref.assetId, ref.role, { usageNotes: e.target.value })}
                        placeholder="Usage notes (optional)"
                      />
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => removeAssetRef(ref.assetId, ref.role)}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>

      <div className="profile-editor-actions">
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving || !configured}>
          {saving ? "Saving…" : "Save brand bible"}
        </button>
        {!configured && (
          <span className="profile-field-hint">Add at least one visual rule, color, asset role, or application note.</span>
        )}
        {bible.version != null && (
          <span className="workspace-muted" style={{ marginLeft: 12 }}>
            Version {bible.version}
          </span>
        )}
      </div>
    </div>
  );
}
