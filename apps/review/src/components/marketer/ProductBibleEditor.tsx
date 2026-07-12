"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandAssetImage } from "@/components/marketer/BrandAssetImage";
import type { MoodboardAsset } from "@/components/marketer/BrandBibleAssetInspectModal";
import {
  emptyProductBible,
  newProductFeature,
  newProductModule,
  productBibleIsConfigured,
  PRODUCT_BIBLE_ASSET_ROLES,
  productModuleSlugKey,
  toProductBible,
  toProductBibleJson,
} from "@/lib/marketer/product-bible-adapters";
import { uploadBrandReferenceImages } from "@/lib/marketer/brand-asset-quick-upload";
import type {
  ProductBible,
  ProductBibleAssetRef,
  ProductBibleAssetRole,
  ProductBibleFeature,
  ProductBibleModule,
} from "@/lib/marketer/types";

type AssetTarget =
  | { scope: "module"; productKey: string }
  | { scope: "feature"; productKey: string; featureKey: string };

export function ProductBibleEditor({ slug, displayName }: { slug: string; displayName?: string }) {
  const brandLabel = (displayName ?? slug).trim() || slug;
  const [bible, setBible] = useState<ProductBible | null>(null);
  const [assets, setAssets] = useState<MoodboardAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const uploadTargetRef = useRef<AssetTarget | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/product-bible`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to load product bible");
      setBible(toProductBible(slug, j.parsed, j.version ?? null));
      setAssets(Array.isArray(j.brandAssets) ? j.brandAssets : []);
      const firstKey = j.parsed?.products?.[0]?.key;
      if (typeof firstKey === "string") setExpandedProduct(firstKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setBible(emptyProductBible(slug));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  function patchBible(patch: Partial<ProductBible>) {
    setBible((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function patchGuide(patch: Partial<ProductBible["applicationGuide"]>) {
    setBible((prev) =>
      prev ? { ...prev, applicationGuide: { ...prev.applicationGuide, ...patch } } : prev
    );
  }

  function updateProduct(productKey: string, patch: Partial<ProductBibleModule>) {
    setBible((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        products: prev.products.map((p) => {
          if (p.key !== productKey) return p;
          const next = { ...p, ...patch };
          if (patch.label && !patch.key) next.key = productModuleSlugKey(patch.label) || p.key;
          return next;
        }),
      };
    });
  }

  function updateFeature(productKey: string, featureKey: string, patch: Partial<ProductBibleFeature>) {
    setBible((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        products: prev.products.map((p) => {
          if (p.key !== productKey) return p;
          return {
            ...p,
            features: p.features.map((f) => {
              if (f.key !== featureKey) return f;
              const next = { ...f, ...patch };
              if (patch.label && !patch.key) next.key = productModuleSlugKey(patch.label) || f.key;
              return next;
            }),
          };
        }),
      };
    });
  }

  function addProduct() {
    const mod = newProductModule(`Product ${(bible?.products.length ?? 0) + 1}`);
    setBible((prev) => (prev ? { ...prev, products: [...prev.products, mod] } : prev));
    setExpandedProduct(mod.key);
  }

  function removeProduct(productKey: string) {
    setBible((prev) =>
      prev ? { ...prev, products: prev.products.filter((p) => p.key !== productKey) } : prev
    );
  }

  function addFeature(productKey: string) {
    setBible((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        products: prev.products.map((p) =>
          p.key === productKey
            ? { ...p, features: [...p.features, newProductFeature(`Feature ${p.features.length + 1}`)] }
            : p
        ),
      };
    });
  }

  function removeFeature(productKey: string, featureKey: string) {
    setBible((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        products: prev.products.map((p) =>
          p.key === productKey
            ? { ...p, features: p.features.filter((f) => f.key !== featureKey) }
            : p
        ),
      };
    });
  }

  function addAssetRef(target: AssetTarget, assetId: string, role: ProductBibleAssetRole = "screenshot") {
    const row = assets.find((a) => a.id === assetId);
    const ref: ProductBibleAssetRef = {
      assetId,
      role,
      label: row?.label ?? "",
      usageNotes: "",
      stepOrder: role === "workflow_step" ? 1 : null,
    };
    if (target.scope === "module") {
      setBible((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          products: prev.products.map((p) =>
            p.key === target.productKey && !p.assetRefs.some((r) => r.assetId === assetId)
              ? { ...p, assetRefs: [...p.assetRefs, ref] }
              : p
          ),
        };
      });
    } else {
      setBible((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          products: prev.products.map((p) => {
            if (p.key !== target.productKey) return p;
            return {
              ...p,
              features: p.features.map((f) =>
                f.key === target.featureKey && !f.assetRefs.some((r) => r.assetId === assetId)
                  ? { ...f, assetRefs: [...f.assetRefs, ref] }
                  : f
              ),
            };
          }),
        };
      });
    }
  }

  function removeAssetRef(target: AssetTarget, assetId: string) {
    if (target.scope === "module") {
      setBible((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          products: prev.products.map((p) =>
            p.key === target.productKey
              ? { ...p, assetRefs: p.assetRefs.filter((r) => r.assetId !== assetId) }
              : p
          ),
        };
      });
    } else {
      setBible((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          products: prev.products.map((p) => {
            if (p.key !== target.productKey) return p;
            return {
              ...p,
              features: p.features.map((f) =>
                f.key === target.featureKey
                  ? { ...f, assetRefs: f.assetRefs.filter((r) => r.assetId !== assetId) }
                  : f
              ),
            };
          }),
        };
      });
    }
  }

  async function save() {
    if (!bible) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/product-bible`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bible_json: toProductBibleJson(bible) }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Save failed");
      setMessage("Product bible saved.");
      setBible(toProductBible(slug, j.parsed, j.version ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function triggerUpload(target: AssetTarget) {
    uploadTargetRef.current = target;
    fileInputRef.current?.click();
  }

  async function onFilesSelected(files: FileList | null) {
    const target = uploadTargetRef.current;
    if (!files?.length || !target || !bible) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadBrandReferenceImages(slug, Array.from(files), {
        labelPrefix: "Product screenshot",
        kind: "reference_image",
      });
      setAssets((prev) => {
        const ids = new Set(prev.map((a) => a.id));
        return [...prev, ...uploaded.filter((a) => !ids.has(a.id))];
      });
      for (const asset of uploaded) {
        addAssetRef(target, asset.id, target.scope === "module" ? "workflow_step" : "screenshot");
      }
      setMessage(`Uploaded ${uploaded.length} screenshot(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      uploadTargetRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const configured = useMemo(() => (bible ? productBibleIsConfigured(bible) : false), [bible]);

  if (loading) {
    return <p className="profile-loading">Loading product bible…</p>;
  }

  if (!bible) return null;

  return (
    <div className="product-bible-editor" data-agent-id="product-bible-editor">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void onFilesSelected(e.target.files)}
      />

      <div className="profile-section-head">
        <div>
          <h2>Product Bible</h2>
          <p className="profile-field-hint">
            Showcase how {brandLabel} works — app screenshots and feature evidence for product videos,
            hygiene content, and visual-first posts. Text copy lives in Brand profile; this is the visual proof.
          </p>
        </div>
        <div className="profile-section-actions">
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save product bible"}
          </button>
        </div>
      </div>

      {error ? <p className="profile-error">{error}</p> : null}
      {message ? <p className="profile-success">{message}</p> : null}
      {!configured ? (
        <p className="profile-field-hint">Add at least one product module or application guide to enable product evidence on jobs.</p>
      ) : null}

      <section className="profile-section">
        <h3>How CAF should use product evidence</h3>
        <label className="profile-field">
          <span>Instructions</span>
          <textarea
            rows={3}
            value={bible.applicationGuide.instructions}
            onChange={(e) => patchGuide({ instructions: e.target.value })}
            placeholder="e.g. Use real app screenshots in walkthrough videos; show workflow steps in order."
          />
        </label>
        <label className="profile-field">
          <span>HeyGen / video policy</span>
          <textarea
            rows={2}
            value={bible.applicationGuide.heygenPolicy}
            onChange={(e) => patchGuide({ heygenPolicy: e.target.value })}
            placeholder="When to show which screenshots in product videos"
          />
        </label>
        <label className="profile-field">
          <span>Flux / image policy</span>
          <textarea
            rows={2}
            value={bible.applicationGuide.fluxPolicy}
            onChange={(e) => patchGuide({ fluxPolicy: e.target.value })}
            placeholder="How image generation should reference product UI"
          />
        </label>
      </section>

      <section className="profile-section">
        <div className="profile-section-head">
          <h3>Product modules</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addProduct}>
            Add product
          </button>
        </div>

        {bible.products.length === 0 ? (
          <p className="profile-field-hint">No products yet — add modules like Weekly Meal Plan, Grocery List, or How It Works.</p>
        ) : null}

        <div className="product-bible-modules">
          {bible.products.map((product) => {
            const open = expandedProduct === product.key;
            return (
              <article key={product.key} className="product-bible-module">
                <header className="product-bible-module__head">
                  <button
                    type="button"
                    className="product-bible-module__toggle"
                    onClick={() => setExpandedProduct(open ? null : product.key)}
                  >
                    {open ? "▾" : "▸"} {product.label || "Untitled product"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => removeProduct(product.key)}
                  >
                    Remove
                  </button>
                </header>

                {open ? (
                  <div className="product-bible-module__body">
                    <label className="profile-field">
                      <span>Label</span>
                      <input
                        value={product.label}
                        onChange={(e) => updateProduct(product.key, { label: e.target.value })}
                      />
                    </label>
                    <label className="profile-field">
                      <span>One-liner</span>
                      <input
                        value={product.oneLiner}
                        onChange={(e) => updateProduct(product.key, { oneLiner: e.target.value })}
                      />
                    </label>
                    <label className="profile-field">
                      <span>Description</span>
                      <textarea
                        rows={2}
                        value={product.description}
                        onChange={(e) => updateProduct(product.key, { description: e.target.value })}
                      />
                    </label>

                    <AssetRefSection
                      slug={slug}
                      title="Module screenshots"
                      refs={product.assetRefs}
                      assets={assets}
                      onUpload={() => triggerUpload({ scope: "module", productKey: product.key })}
                      uploading={uploading}
                      onRemove={(assetId) => removeAssetRef({ scope: "module", productKey: product.key }, assetId)}
                      onAttach={(assetId, role) =>
                        addAssetRef({ scope: "module", productKey: product.key }, assetId, role)
                      }
                      onUpdateRef={(assetId, patch) => {
                        setBible((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            products: prev.products.map((p) =>
                              p.key === product.key
                                ? {
                                    ...p,
                                    assetRefs: p.assetRefs.map((r) =>
                                      r.assetId === assetId ? { ...r, ...patch } : r
                                    ),
                                  }
                                : p
                            ),
                          };
                        });
                      }}
                    />

                    <div className="product-bible-features">
                      <div className="profile-section-head">
                        <h4>Features</h4>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => addFeature(product.key)}>
                          Add feature
                        </button>
                      </div>
                      {product.features.map((feature) => (
                        <div key={feature.key} className="product-bible-feature">
                          <label className="profile-field">
                            <span>Feature label</span>
                            <input
                              value={feature.label}
                              onChange={(e) => updateFeature(product.key, feature.key, { label: e.target.value })}
                            />
                          </label>
                          <label className="profile-field">
                            <span>Feature description</span>
                            <textarea
                              rows={2}
                              value={feature.description}
                              onChange={(e) =>
                                updateFeature(product.key, feature.key, { description: e.target.value })
                              }
                            />
                          </label>
                          <AssetRefSection
                            slug={slug}
                            title="Feature screenshots"
                            refs={feature.assetRefs}
                            assets={assets}
                            onUpload={() =>
                              triggerUpload({
                                scope: "feature",
                                productKey: product.key,
                                featureKey: feature.key,
                              })
                            }
                            uploading={uploading}
                            onRemove={(assetId) =>
                              removeAssetRef(
                                { scope: "feature", productKey: product.key, featureKey: feature.key },
                                assetId
                              )
                            }
                            onAttach={(assetId, role) =>
                              addAssetRef(
                                { scope: "feature", productKey: product.key, featureKey: feature.key },
                                assetId,
                                role
                              )
                            }
                            onUpdateRef={(assetId, patch) => {
                              setBible((prev) => {
                                if (!prev) return prev;
                                return {
                                  ...prev,
                                  products: prev.products.map((p) => {
                                    if (p.key !== product.key) return p;
                                    return {
                                      ...p,
                                      features: p.features.map((f) =>
                                        f.key === feature.key
                                          ? {
                                              ...f,
                                              assetRefs: f.assetRefs.map((r) =>
                                                r.assetId === assetId ? { ...r, ...patch } : r
                                              ),
                                            }
                                          : f
                                      ),
                                    };
                                  }),
                                };
                              });
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => removeFeature(product.key, feature.key)}
                          >
                            Remove feature
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function AssetRefSection({
  slug,
  title,
  refs,
  assets,
  onUpload,
  uploading,
  onRemove,
  onAttach,
  onUpdateRef,
}: {
  slug: string;
  title: string;
  refs: ProductBibleAssetRef[];
  assets: MoodboardAsset[];
  onUpload: () => void;
  uploading: boolean;
  onRemove: (assetId: string) => void;
  onAttach: (assetId: string, role: ProductBibleAssetRole) => void;
  onUpdateRef: (assetId: string, patch: Partial<ProductBibleAssetRef>) => void;
}) {
  const attachedIds = new Set(refs.map((r) => r.assetId));
  const available = assets.filter((a) => a.kind === "reference_image" || a.kind === "other" || a.kind === "logo");

  return (
    <div className="product-bible-assets">
      <div className="profile-section-head">
        <h5>{title}</h5>
        <button type="button" className="btn btn-secondary btn-sm" disabled={uploading} onClick={onUpload}>
          {uploading ? "Uploading…" : "Upload screenshot"}
        </button>
      </div>

      {refs.length === 0 ? (
        <p className="profile-field-hint">No screenshots attached yet.</p>
      ) : (
        <ul className="product-bible-asset-list">
          {refs.map((ref) => {
            const asset = assets.find((a) => a.id === ref.assetId);
            return (
              <li key={ref.assetId} className="product-bible-asset-row">
                <div className="product-bible-asset-row__thumb">
                  {asset ? (
                    <BrandAssetImage slug={slug} asset={asset} className="product-bible-asset-thumb" />
                  ) : (
                    <span className="product-bible-asset-missing">Missing asset</span>
                  )}
                </div>
                <div className="product-bible-asset-row__meta">
                  <select
                    value={ref.role}
                    onChange={(e) =>
                      onUpdateRef(ref.assetId, { role: e.target.value as ProductBibleAssetRole })
                    }
                  >
                    {PRODUCT_BIBLE_ASSET_ROLES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  {ref.role === "workflow_step" ? (
                    <input
                      type="number"
                      min={0}
                      max={99}
                      placeholder="Step"
                      value={ref.stepOrder ?? ""}
                      onChange={(e) =>
                        onUpdateRef(ref.assetId, {
                          stepOrder: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  ) : null}
                  <input
                    placeholder="Label"
                    value={ref.label}
                    onChange={(e) => onUpdateRef(ref.assetId, { label: e.target.value })}
                  />
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove(ref.assetId)}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {available.some((a) => !attachedIds.has(a.id)) ? (
        <details className="product-bible-attach-existing">
          <summary>Attach existing moodboard asset</summary>
          <ul>
            {available
              .filter((a) => !attachedIds.has(a.id))
              .map((a) => (
                <li key={a.id}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAttach(a.id, "screenshot")}>
                    + {a.label ?? a.id.slice(0, 8)}
                  </button>
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
