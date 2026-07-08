"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandAssetsPanel } from "@/components/BrandAssetsPanel";
import { BrandBibleAssetInspectModal } from "@/components/marketer/BrandBibleAssetInspectModal";
import type { MoodboardAsset } from "@/components/marketer/BrandBibleAssetInspectModal";
import { BrandBibleAssetCategories } from "@/components/marketer/BrandBibleAssetCategories";
import { BrandBibleFluxReferences } from "@/components/marketer/BrandBibleFluxReferences";
import { BrandBibleHeygenPresenters } from "@/components/marketer/BrandBibleHeygenPresenters";
import { BrandBibleHowItApplies } from "@/components/marketer/BrandBibleHowItApplies";
import { BrandBibleInstagramPreview } from "@/components/marketer/BrandBibleInstagramPreview";
import { BrandBibleMoodboardGrid } from "@/components/marketer/BrandBibleMoodboardGrid";
import {
  BRAND_BIBLE_CONTENT_AIMS,
  BRAND_BIBLE_VISUAL_MODES,
  brandBibleIsConfigured,
  emptyBrandBible,
  toBrandBible,
  toBrandBibleJson,
} from "@/lib/marketer/brand-bible-adapters";
import type { BrandBible, BrandBibleAssetRef, BrandBibleAssetRole } from "@/lib/marketer/types";
import { BRAND_BIBLE_ASSET_ROLES } from "@/lib/marketer/brand-bible-adapters";

type BibleView = "moodboard" | "creative" | "instagram" | "guide" | "how";

type BrandAssetRow = MoodboardAsset;

export function BrandBibleEditor({ slug, displayName }: { slug: string; displayName?: string }) {
  const brandLabel = (displayName ?? slug).trim() || slug;
  const [bible, setBible] = useState<BrandBible | null>(null);
  const [assets, setAssets] = useState<BrandAssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [paletteInput, setPaletteInput] = useState("");
  const [view, setView] = useState<BibleView>("creative");
  const [inspectAsset, setInspectAsset] = useState<MoodboardAsset | null>(null);
  const [editAssetId, setEditAssetId] = useState<string | null>(null);
  const [openAddKind, setOpenAddKind] = useState<"reference_image" | null>(null);
  const [pendingDefaultRole, setPendingDefaultRole] = useState<BrandBibleAssetRole | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const prevAssetIdsRef = useRef<Set<string>>(new Set());

  const projectQs = `?project=${encodeURIComponent(slug)}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/brand-bible`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to load brand bible");
      setBible(toBrandBible(slug, j.parsed, j.version ?? null));
      const loaded = Array.isArray(j.brandAssets) ? j.brandAssets : [];
      prevAssetIdsRef.current = new Set(loaded.map((a: BrandAssetRow) => a.id));
      setAssets(loaded);
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
    const row = assets.find((a) => a.id === assetId);
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

  async function deleteAsset(asset: MoodboardAsset) {
    const label = asset.label ?? asset.kind;
    if (!confirm(`Delete "${label}" from your moodboard?`)) return;
    setDeletingAssetId(asset.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/project-config/brand-assets/${encodeURIComponent(asset.id)}${projectQs}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.slice(0, 200) || "Delete failed");
      }
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      if (bible) {
        patchBible({
          assetRefs: bible.assetRefs.filter((r) => r.assetId !== asset.id),
          fluxPromptAssetIds: bible.fluxPromptAssetIds.filter((id) => id !== asset.id),
        });
      }
      if (inspectAsset?.id === asset.id) setInspectAsset(null);
      setMessage(`Removed "${label}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingAssetId(null);
    }
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

  const configured = useMemo(() => (bible ? brandBibleIsConfigured(bible) : false), [bible]);

  function handleAssetsChange(next: BrandAssetRow[]) {
    if (pendingDefaultRole && bible) {
      const prev = prevAssetIdsRef.current;
      const added = next.find((a) => !prev.has(a.id));
      if (added) {
        addAssetRef(added.id, pendingDefaultRole);
        setPendingDefaultRole(null);
        setInspectAsset(added);
      }
    }
    prevAssetIdsRef.current = new Set(next.map((a) => a.id));
    setAssets(next);
  }

  function handleCategoryUpload(uploaded: BrandAssetRow[], role: BrandBibleAssetRole) {
    setAssets((prev) => {
      const ids = new Set(prev.map((a) => a.id));
      const merged = [...prev];
      for (const a of uploaded) {
        if (!ids.has(a.id)) merged.push(a);
      }
      prevAssetIdsRef.current = new Set(merged.map((a) => a.id));
      return merged;
    });
    setBible((prev) => {
      if (!prev) return prev;
      const nextRefs = [...prev.assetRefs];
      for (const a of uploaded) {
        if (nextRefs.some((r) => r.assetId === a.id && r.role === role)) continue;
        nextRefs.push({
          assetId: a.id,
          role,
          label: a.label ?? "",
          usageNotes: "",
        });
      }
      return { ...prev, assetRefs: nextRefs };
    });
    if (uploaded.length === 1) setInspectAsset(uploaded[0]!);
    const roleLabel = BRAND_BIBLE_ASSET_ROLES.find((r) => r.id === role)?.label ?? role;
    setMessage(`Added ${uploaded.length} file(s) to ${roleLabel}. Save brand bible when done.`);
  }

  function assignFromMoodboard(role: BrandBibleAssetRole) {
    const roleLabel = BRAND_BIBLE_ASSET_ROLES.find((r) => r.id === role)?.label ?? role;
    setPendingDefaultRole(role);
    setView("moodboard");
    setMessage(`Pick a moodboard asset and assign “${roleLabel}”, or upload in the Brand assets tab.`);
    setTimeout(() => {
      document.getElementById("brand-bible-upload-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function scrollToUpload(defaultRole?: BrandBibleAssetRole) {
    if (defaultRole) setPendingDefaultRole(defaultRole);
    setView("moodboard");
    setOpenAddKind("reference_image");
    setTimeout(() => {
      document.getElementById("brand-bible-upload-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  if (loading) return <p className="workspace-muted">Loading brand moodboard…</p>;
  if (!bible) return <p className="workspace-error">{error ?? "Could not load brand bible."}</p>;

  return (
    <div className="profile-editor brand-bible-editor" data-agent-id="brand-bible-editor">
      <header className="brand-bible-top">
        <div>
          <h2 className="brand-bible-title">Brand Visual System</h2>
          <p className="brand-bible-lead">
            Build a <strong>moodboard</strong> of references, palette, and style rules. CAF applies this when
            &ldquo;Use Brand Visual System&rdquo; is on — keeping your look even when mimicking trends.
          </p>
        </div>
        <div className="brand-bible-top-actions">
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving || !configured}>
            {saving ? "Saving…" : "Save brand bible"}
          </button>
          {bible.version != null && <span className="workspace-muted">v{bible.version}</span>}
        </div>
      </header>

      {message && <p className="profile-save-ok">{message}</p>}
      {error && <p className="workspace-error">{error}</p>}

      <div className="brand-bible-view-toggle workbench-view-toggle">
        <span className="workbench-view-toggle__label">View</span>
        {(
          [
            { id: "moodboard" as const, label: "Moodboard" },
            { id: "creative" as const, label: "Brand assets" },
            { id: "instagram" as const, label: "Instagram preview" },
            { id: "guide" as const, label: "Rules & guide" },
            { id: "how" as const, label: "How it applies" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`btn-ghost btn-sm ${view === tab.id ? "active" : ""}`}
            onClick={() => setView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {view === "moodboard" && (
        <>
          <BrandBibleMoodboardGrid
            slug={slug}
            assets={assets}
            assetRefs={bible.assetRefs}
            palette={bible.palette}
            onInspect={setInspectAsset}
            onAddClick={scrollToUpload}
            onDelete={(asset) => void deleteAsset(asset)}
            deletingId={deletingAssetId}
          />
          <section className="profile-section brand-bible-upload-section">
            <BrandAssetsPanel
              projectSlug={slug}
              variant="marketer"
              hideOverview
              panelId="brand-bible-upload-panel"
              editAssetId={editAssetId}
              onEditAssetConsumed={() => setEditAssetId(null)}
              openAddKind={openAddKind}
              onOpenAddConsumed={() => setOpenAddKind(null)}
              onAssetsChange={handleAssetsChange}
            />
          </section>
        </>
      )}

      {view === "creative" && (
        <>
          <BrandBibleAssetCategories
            slug={slug}
            bible={bible}
            assets={assets}
            onInspect={setInspectAsset}
            onAssetsUploaded={handleCategoryUpload}
            onAssignFromMoodboard={assignFromMoodboard}
          />
          <BrandBibleFluxReferences
            slug={slug}
            bible={bible}
            assets={assets}
            selectedIds={bible.fluxPromptAssetIds}
            onChange={(fluxPromptAssetIds) => patchBible({ fluxPromptAssetIds })}
          />
          <BrandBibleHeygenPresenters
            slug={slug}
            presenters={bible.heygenPresenters}
            onChange={(heygenPresenters) => patchBible({ heygenPresenters })}
          />
          <div className="profile-editor-actions">
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving || !configured}>
              {saving ? "Saving…" : "Save brand bible"}
            </button>
          </div>
        </>
      )}

      {view === "instagram" && (
        <BrandBibleInstagramPreview slug={slug} displayName={brandLabel} bible={bible} assets={assets} />
      )}

      {view === "how" && <BrandBibleHowItApplies bible={bible} slug={slug} />}

      {view === "guide" && (
        <>
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
                    placeholder="e.g. Cosmic editorial illustration"
                  />
                </label>
              )}
              <label className="profile-field profile-field--full">
                <span className="profile-field-label">Brand palette</span>
                <span className="profile-field-hint">Up to 5 hex colors — used on slides when BVS is on.</span>
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
                  placeholder="zodiac glyphs; star fields; deep indigo gradients; orbit rings"
                />
              </label>
              <label className="profile-field profile-field--full">
                <span className="profile-field-label">Forbidden visual motifs</span>
                <textarea
                  className="profile-field-input"
                  rows={2}
                  value={bible.forbiddenMotifs}
                  onChange={(e) => patchBible({ forbiddenMotifs: e.target.value })}
                  placeholder="stock lifestyle photos; neon gradients; unrelated food imagery"
                />
              </label>
            </div>
          </section>

          <section className="profile-section">
            <h3 className="profile-section-title">How CAF should apply this brand</h3>
            <p className="profile-field-hint" style={{ marginBottom: 12 }}>
              Explain your visual goals and how CAF should use your moodboard references.
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
                  placeholder="Always use our cosmic zodiac world — mystical, premium, no stock faces. When mimicking a viral listicle, keep the hook structure but replace visuals with star fields and sign-specific motifs…"
                />
              </label>
              <label className="profile-field profile-field--full">
                <span className="profile-field-label">When mimicking top performers</span>
                <textarea
                  className="profile-field-input"
                  rows={3}
                  value={bible.applicationGuide.mimicPolicy}
                  onChange={(e) => patchGuide({ mimicPolicy: e.target.value })}
                  placeholder="Copy structure and persuasion only — never competitor visuals."
                />
              </label>
              <label className="profile-field profile-field--full">
                <span className="profile-field-label">When creating original content</span>
                <textarea
                  className="profile-field-input"
                  rows={3}
                  value={bible.applicationGuide.originalPolicy}
                  onChange={(e) => patchGuide({ originalPolicy: e.target.value })}
                  placeholder="Lead with zodiac motifs and @signandsound palette on every slide."
                />
              </label>
            </div>
          </section>

          <div className="profile-editor-actions">
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving || !configured}>
              {saving ? "Saving…" : "Save brand bible"}
            </button>
            {!configured && (
              <span className="profile-field-hint">
                Add at least one visual rule, color, asset role, or application note.
              </span>
            )}
          </div>
        </>
      )}

      {inspectAsset && (
        <BrandBibleAssetInspectModal
          slug={slug}
          asset={inspectAsset}
          assetRefs={bible.assetRefs}
          onClose={() => setInspectAsset(null)}
          onEdit={() => {
            setEditAssetId(inspectAsset.id);
            setInspectAsset(null);
            setView("moodboard");
            setTimeout(() => {
              document.getElementById("brand-bible-upload-panel")?.scrollIntoView({ behavior: "smooth" });
            }, 50);
          }}
          onAddRole={(role) => addAssetRef(inspectAsset.id, role)}
          onRemoveRole={(role) => removeAssetRef(inspectAsset.id, role)}
          onUsageNotes={(role, notes) => updateAssetRef(inspectAsset.id, role, { usageNotes: notes })}
          onDelete={() => void deleteAsset(inspectAsset)}
          deleting={deletingAssetId === inspectAsset.id}
        />
      )}
    </div>
  );
}
