"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { brandAssetProxyUrl } from "@/lib/brand-asset-url";
import { resolveBrandAssetUploadUrl } from "@/lib/brand-asset-upload-url";
import { useReviewProject } from "./ReviewProjectContext";

type BrandAssetKind = "logo" | "reference_image" | "palette" | "font" | "other";
const BRAND_ASSET_KINDS: BrandAssetKind[] = ["logo", "reference_image", "palette", "font", "other"];

const PRESET_GOOGLE_FONTS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Raleway",
  "Playfair Display",
  "Merriweather",
  "Source Sans 3",
  "Nunito",
  "Work Sans",
] as const;

type FontFormMode = "google" | "url" | "upload";

type BrandAsset = {
  id: string;
  kind: BrandAssetKind;
  label: string | null;
  sort_order: number;
  public_url: string | null;
  storage_path: string | null;
  heygen_asset_id: string | null;
  heygen_synced_at: string | null;
  metadata_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

function projectApiSuffix(multiProject: boolean, activeProjectSlug: string): string {
  if (multiProject && activeProjectSlug) return `?project=${encodeURIComponent(activeProjectSlug)}`;
  return "";
}

function resolveApiSuffix(
  projectSlug: string | undefined,
  multiProject: boolean,
  activeProjectSlug: string
): string {
  const slug = (projectSlug ?? activeProjectSlug).trim();
  if (projectSlug) return `?project=${encodeURIComponent(projectSlug)}`;
  return projectApiSuffix(multiProject, slug);
}

export type BrandAssetsPanelProps = {
  /** When set (e.g. on `/brand/[slug]/profile`), scopes API calls to this project. */
  projectSlug?: string;
  /** Marketer profile uses simplified UI; admin settings keeps full table + HeyGen controls. */
  variant?: "admin" | "marketer";
};

function parseHex(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h.toLowerCase()}`;
}

function colorsFromMeta(meta: Record<string, unknown> | undefined): [string, string, string, string, string] {
  const d: [string, string, string, string, string] = ["", "", "", "", ""];
  const c = meta?.colors;
  if (Array.isArray(c)) {
    for (let i = 0; i < 5; i++) {
      const raw = typeof c[i] === "string" ? c[i] : "";
      const v = parseHex(raw);
      if (v) d[i] = v;
    }
  }
  return d;
}

function inferFontMode(meta: Record<string, unknown> | undefined): FontFormMode {
  const src = typeof meta?.font_source === "string" ? meta.font_source : "";
  if (src === "google") return "google";
  if (src === "upload") return "upload";
  return "url";
}

function kindLabel(k: BrandAssetKind): string {
  return ({ logo: "Logo", reference_image: "Reference image", palette: "Color palette", font: "Typography", other: "Other" }[k]);
}

export function BrandAssetsPanel({ projectSlug, variant = "admin" }: BrandAssetsPanelProps) {
  const { multiProject, activeProjectSlug } = useReviewProject();
  const resolvedSlug = (projectSlug ?? activeProjectSlug).trim();
  const qs = resolveApiSuffix(projectSlug, multiProject, activeProjectSlug);
  const isMarketer = variant === "marketer";

  const [assets, setAssets] = useState<BrandAsset[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<BrandAsset> | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const [paletteHex, setPaletteHex] = useState<[string, string, string, string, string]>(["", "", "", "", ""]);
  const [fontMode, setFontMode] = useState<FontFormMode>("google");
  const [googleFamily, setGoogleFamily] = useState<string>(PRESET_GOOGLE_FONTS[0]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [overviewFilter, setOverviewFilter] = useState<"all" | BrandAssetKind>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/project-config/brand-assets${qs}`);
      const json = (await res.json()) as { brand_assets?: BrandAsset[] };
      setAssets(Array.isArray(json.brand_assets) ? json.brand_assets : []);
    } catch {
      setMessage({ text: "Failed to load brand assets", type: "error" });
      setAssets([]);
    }
    setLoading(false);
  }, [qs]);

  useEffect(() => {
    load();
  }, [load]);

  const resetAuxState = () => {
    setPaletteHex(["", "", "", "", ""]);
    setFontMode("google");
    setGoogleFamily(PRESET_GOOGLE_FONTS[0]);
    setPendingFiles([]);
  };

  const startNew = () => {
    startNewWithKind("reference_image");
  };

  const startNewWithKind = (kind: BrandAssetKind) => {
    resetAuxState();
    setEditing({ kind, label: "", public_url: "", sort_order: assets?.length ?? 0 });
    if (kind === "palette") setPaletteHex(["", "", "", "", ""]);
    if (kind === "font") setFontMode("google");
    setMessage(null);
  };

  const startEdit = (row: BrandAsset) => {
    setEditing({ ...row });
    setPaletteHex(colorsFromMeta(row.metadata_json));
    setFontMode(inferFontMode(row.metadata_json));
    const fam = row.metadata_json && typeof row.metadata_json.font_family === "string" ? row.metadata_json.font_family : PRESET_GOOGLE_FONTS[0];
    setGoogleFamily(fam);
    setPendingFiles([]);
    setMessage(null);
  };

  const cancel = () => {
    setEditing(null);
    resetAuxState();
  };

  const uploadFile = async (file: File): Promise<{ public_url: string | null; storage_path: string | null }> => {
    const fd = new FormData();
    fd.append("file", file);
    const uploadUrl = resolveBrandAssetUploadUrl(resolvedSlug);
    const res = await fetch(uploadUrl, { method: "POST", body: fd });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(text.slice(0, 400) || `Upload failed (${res.status})`);
    }
    const json = JSON.parse(text) as { public_url?: string | null; storage_path?: string | null };
    return { public_url: json.public_url ?? null, storage_path: json.storage_path ?? null };
  };

  const saveOne = async (payload: Record<string, unknown>, id?: string) => {
    const isEdit = typeof id === "string" && id.length > 0;
    const res = await fetch(
      isEdit
        ? `/api/project-config/brand-assets/${encodeURIComponent(id!)}${qs}`
        : `/api/project-config/brand-assets${qs}`,
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t.slice(0, 280));
    }
  };

  const submit = async () => {
    if (!editing) return;
    setSaving(true);
    setMessage(null);
    try {
      const kind = editing.kind ?? "other";
      const baseOrder = typeof editing.sort_order === "number" ? editing.sort_order : 0;
      const labelBase = (typeof editing.label === "string" ? editing.label.trim() : "") || "";

      if (kind === "palette") {
        const colors = paletteHex.map((x) => parseHex(x)).filter((x): x is string => x != null);
        if (colors.length === 0) {
          setMessage({ text: "Add at least one valid hex color (e.g. #ff5500).", type: "error" });
          setSaving(false);
          return;
        }
        const payload: Record<string, unknown> = {
          kind: "palette",
          label: labelBase || "Color palette",
          sort_order: baseOrder,
          public_url: null,
          storage_path: null,
          metadata_json: { colors },
        };
        const isEdit = typeof editing.id === "string" && editing.id.length > 0;
        await saveOne(payload, isEdit ? editing.id : undefined);
      } else if (kind === "font") {
        let publicUrl: string | null = typeof editing.public_url === "string" ? editing.public_url.trim() || null : null;
        let storagePath: string | null = typeof editing.storage_path === "string" ? editing.storage_path.trim() || null : null;
        const meta: Record<string, unknown> = {};

        if (fontMode === "google") {
          meta.font_source = "google";
          meta.font_family = googleFamily;
        } else if (fontMode === "url") {
          meta.font_source = "url";
          if (!publicUrl || !/^https?:\/\//i.test(publicUrl)) {
            setMessage({ text: "Enter a valid https URL to a font file.", type: "error" });
            setSaving(false);
            return;
          }
        } else {
          if (pendingFiles.length === 0 && !editing.id) {
            setMessage({ text: "Choose a font file to upload.", type: "error" });
            setSaving(false);
            return;
          }
          if (pendingFiles.length > 0) {
            const up = await uploadFile(pendingFiles[0]!);
            publicUrl = up.public_url;
            storagePath = up.storage_path;
            meta.font_source = "upload";
            meta.original_filename = pendingFiles[0]!.name;
          } else {
            meta.font_source = "upload";
          }
        }

        const payload: Record<string, unknown> = {
          kind: "font",
          label: labelBase || (fontMode === "google" ? googleFamily : "Brand font"),
          sort_order: baseOrder,
          public_url: publicUrl,
          storage_path: storagePath,
          metadata_json: meta,
        };
        const isEdit = typeof editing.id === "string" && editing.id.length > 0;
        await saveOne(payload, isEdit ? editing.id : undefined);
      } else if ((kind === "logo" || kind === "reference_image") && !editing.id && pendingFiles.length > 0) {
        const prefix = labelBase || (kind === "logo" ? "Logo" : "Reference");
        for (let i = 0; i < pendingFiles.length; i++) {
          const up = await uploadFile(pendingFiles[i]!);
          const lbl = pendingFiles.length > 1 ? `${prefix} ${i + 1}` : prefix;
          await saveOne({
            kind,
            label: lbl,
            sort_order: baseOrder + i,
            public_url: up.public_url,
            storage_path: up.storage_path,
            metadata_json: { original_filename: pendingFiles[i]!.name },
          });
        }
      } else {
        let publicUrl: string | null = typeof editing.public_url === "string" ? editing.public_url.trim() || null : null;
        let storagePath: string | null = typeof editing.storage_path === "string" ? editing.storage_path.trim() || null : null;

        if (pendingFiles.length > 0) {
          const up = await uploadFile(pendingFiles[0]!);
          publicUrl = up.public_url;
          storagePath = up.storage_path;
        }

        if ((kind === "logo" || kind === "reference_image" || kind === "other") && !publicUrl) {
          setMessage({ text: "Add a public URL or upload a file.", type: "error" });
          setSaving(false);
          return;
        }

        const payload: Record<string, unknown> = {
          kind,
          label: labelBase || null,
          sort_order: baseOrder,
          public_url: publicUrl,
          storage_path: storagePath,
          metadata_json:
            pendingFiles.length > 0 ? { original_filename: pendingFiles[0]!.name } : editing.metadata_json ?? {},
        };
        const isEdit = typeof editing.id === "string" && editing.id.length > 0;
        await saveOne(payload, isEdit ? editing.id : undefined);
      }

      setMessage({ text: pendingFiles.length > 1 ? `Saved ${pendingFiles.length} assets` : "Saved", type: "success" });
      setEditing(null);
      resetAuxState();
      await load();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Network error", type: "error" });
    }
    setSaving(false);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this brand asset?")) return;
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/project-config/brand-assets/${encodeURIComponent(id)}${qs}`, { method: "DELETE" });
      if (!res.ok) {
        const t = await res.text();
        setMessage({ text: `Delete failed: ${t.slice(0, 240)}`, type: "error" });
      } else {
        await load();
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Network error", type: "error" });
    }
    setBusyId(null);
  };

  const syncHeygen = async (id: string) => {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/project-config/brand-assets/${encodeURIComponent(id)}/sync-heygen${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const t = await res.text();
        setMessage({ text: `HeyGen sync failed: ${t.slice(0, 320)}`, type: "error" });
      } else {
        setMessage({ text: "Uploaded to HeyGen", type: "success" });
        await load();
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Network error", type: "error" });
    }
    setBusyId(null);
  };

  const filteredOverview = useMemo(() => {
    const list = assets ?? [];
    if (overviewFilter === "all") return list;
    return list.filter((a) => a.kind === overviewFilter);
  }, [assets, overviewFilter]);

  const paletteRow = (i: number) => {
    const h = paletteHex[i] ?? "";
    const swatch = parseHex(h) ?? "#000000";
    return (
      <div key={i} className="brand-kit-palette-row">
        {isMarketer && (
          <input
            type="color"
            className="brand-kit-color-picker"
            value={swatch}
            aria-label={`Color ${i + 1}`}
            onChange={(e) => {
              const next = [...paletteHex] as [string, string, string, string, string];
              next[i] = e.target.value.toLowerCase();
              setPaletteHex(next);
            }}
          />
        )}
        <input
          type="text"
          className={isMarketer ? "profile-field-input" : "filter-input"}
          value={h}
          onChange={(e) => {
            const next = [...paletteHex] as [string, string, string, string, string];
            next[i] = e.target.value;
            setPaletteHex(next);
          }}
          placeholder="#RRGGBB"
        />
        {!isMarketer && (
          <span
            aria-hidden
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: parseHex(h) ?? "transparent",
            }}
          />
        )}
        {isMarketer && (
          <span className="brand-kit-palette-swatch" style={{ background: parseHex(h) ?? "transparent" }} aria-hidden />
        )}
      </div>
    );
  };

  const formFieldClass = isMarketer ? "profile-field" : "filter-group";
  const formInputClass = isMarketer ? "brand-kit-input" : "filter-input";

  return (
    <div className={isMarketer ? "brand-kit-panel" : undefined} style={isMarketer ? undefined : { marginTop: 28 }}>
      <div
        className={isMarketer ? "brand-kit-header" : undefined}
        style={
          isMarketer
            ? undefined
            : { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }
        }
      >
        <div>
          {isMarketer ? (
            <>
              <h3 className="profile-section-title">Brand kit</h3>
              <p className="brand-kit-lead">
                Logos, reference images, color palettes, and typography. CAF uses these when generating and rendering
                content for this brand.
              </p>
            </>
          ) : (
            <>
              <h3 style={{ margin: 0, fontSize: 16 }}>Brand Assets</h3>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
                Logos, reference images, palettes, fonts. HeyGen Video Agent flows use entries with a public file URL and{" "}
                <code>heygen_asset_id</code> after sync.
              </div>
            </>
          )}
        </div>
        {!editing && !isMarketer && (
          <button type="button" className="btn-primary" onClick={startNew}>
            + Add brand asset
          </button>
        )}
      </div>

      {isMarketer && !editing && (
        <div className="brand-kit-quick-add">
          <span className="brand-kit-quick-label">Add</span>
          {(
            [
              { kind: "logo" as const, label: "Logo" },
              { kind: "reference_image" as const, label: "Reference image" },
              { kind: "palette" as const, label: "Color palette" },
              { kind: "font" as const, label: "Typography" },
            ] as const
          ).map(({ kind, label }) => (
            <button key={kind} type="button" className="profile-chip" onClick={() => startNewWithKind(kind)}>
              + {label}
            </button>
          ))}
        </div>
      )}

      {message && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 13,
            background: message.type === "success" ? "var(--green-bg)" : "var(--red-bg)",
            color: message.type === "success" ? "var(--green)" : "var(--red)",
          }}
        >
          {message.text}
        </div>
      )}

      {loading && <p style={{ color: "var(--muted)" }}>Loading brand assets…</p>}

      {editing && (
        <div className={isMarketer ? "brand-kit-form" : "card"} style={isMarketer ? undefined : { marginBottom: 16 }}>
          <div className={isMarketer ? "brand-kit-form-title" : "card-header"}>
            {editing.id ? `Edit ${kindLabel(editing.kind ?? "other").toLowerCase()}` : `Add ${kindLabel(editing.kind ?? "other").toLowerCase()}`}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {!isMarketer && (
            <div className={formFieldClass}>
              <label className={isMarketer ? "profile-field-label" : "filter-label"}>Kind</label>
              <select
                className={formInputClass}
                value={editing.kind ?? "other"}
                onChange={(e) => {
                  const k = e.target.value as BrandAssetKind;
                  setEditing((p) => (p ? { ...p, kind: k } : p));
                  resetAuxState();
                  if (k === "palette") setPaletteHex(["", "", "", "", ""]);
                  if (k === "font") setFontMode("google");
                }}
              >
                {BRAND_ASSET_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {kindLabel(k)}
                  </option>
                ))}
              </select>
            </div>
            )}

            {(editing.kind === "logo" || editing.kind === "reference_image") && (
              <>
                <div className={formFieldClass}>
                  <label className={isMarketer ? "profile-field-label" : "filter-label"}>
                    {isMarketer ? "Name (optional)" : "Label (optional prefix for multiple files)"}
                  </label>
                  <input
                    type="text"
                    className={formInputClass}
                    value={editing.label ?? ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, label: e.target.value } : p))}
                    placeholder={editing.kind === "logo" ? "e.g. Primary logo" : "e.g. Moodboard reference"}
                  />
                </div>
                {!editing.id && (
                  <div className={formFieldClass}>
                    <label className={isMarketer ? "profile-field-label" : "filter-label"}>
                      {isMarketer ? "Upload image" : "Upload images (one or many)"}
                    </label>
                    <div className={isMarketer ? "brand-kit-dropzone" : undefined}>
                      <input
                        type="file"
                        className={isMarketer ? "brand-kit-file-input" : formInputClass}
                        accept="image/*,.svg"
                        multiple
                        onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []))}
                      />
                      {isMarketer && (
                        <span className="brand-kit-dropzone-hint">
                          PNG, JPG, SVG — you can upload multiple logos or references at once
                        </span>
                      )}
                    </div>
                    {pendingFiles.length > 0 && (
                      <div className="brand-kit-file-count">
                        {pendingFiles.length} file{pendingFiles.length === 1 ? "" : "s"} selected
                      </div>
                    )}
                  </div>
                )}
                {editing.id && (
                  <div className={formFieldClass}>
                    <label className={isMarketer ? "profile-field-label" : "filter-label"}>Replace file (optional)</label>
                    <input
                      type="file"
                      className={formInputClass}
                      accept="image/*,.svg"
                      onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []).slice(0, 1))}
                    />
                  </div>
                )}
                <div className={formFieldClass}>
                  <label className={isMarketer ? "profile-field-label" : "filter-label"}>
                    {isMarketer ? "Or paste image URL" : "Or public URL"}
                  </label>
                  <input
                    type="text"
                    className={formInputClass}
                    value={editing.public_url ?? ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, public_url: e.target.value } : p))}
                    placeholder="https://…"
                  />
                </div>
                {!isMarketer && (
                  <div className={formFieldClass}>
                    <label className="filter-label">Sort order</label>
                    <input
                      type="number"
                      className={formInputClass}
                      value={editing.sort_order ?? 0}
                      onChange={(e) => setEditing((p) => (p ? { ...p, sort_order: Number(e.target.value) } : p))}
                    />
                  </div>
                )}
              </>
            )}

            {editing.kind === "palette" && (
              <>
                <div className={formFieldClass}>
                  <label className={isMarketer ? "profile-field-label" : "filter-label"}>Palette name</label>
                  <input
                    type="text"
                    className={formInputClass}
                    value={editing.label ?? ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, label: e.target.value } : p))}
                    placeholder="e.g. Primary brand colors"
                  />
                </div>
                <div className={formFieldClass}>
                  <label className={isMarketer ? "profile-field-label" : "filter-label"}>
                    {isMarketer ? "Pick up to 5 colors" : "Colors (hex, up to 5)"}
                  </label>
                  {isMarketer && (
                    <span className="profile-field-hint">Use the color picker or type a hex code like #ff5500</span>
                  )}
                  <div className="brand-kit-palette-list">{paletteHex.map((_, i) => paletteRow(i))}</div>
                </div>
                {!isMarketer && (
                  <div className={formFieldClass}>
                    <label className="filter-label">Sort order</label>
                    <input
                      type="number"
                      className={formInputClass}
                      value={editing.sort_order ?? 0}
                      onChange={(e) => setEditing((p) => (p ? { ...p, sort_order: Number(e.target.value) } : p))}
                    />
                  </div>
                )}
              </>
            )}

            {editing.kind === "font" && (
              <>
                <div className={formFieldClass}>
                  <label className={isMarketer ? "profile-field-label" : "filter-label"}>Label</label>
                  <input
                    type="text"
                    className={formInputClass}
                    value={editing.label ?? ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, label: e.target.value } : p))}
                    placeholder={isMarketer ? "e.g. Headings · body text" : "e.g. Body · brand"}
                  />
                </div>
                <div className={formFieldClass}>
                  <label className={isMarketer ? "profile-field-label" : "filter-label"}>
                    {isMarketer ? "How do you want to add this font?" : "Source"}
                  </label>
                  <select
                    className={formInputClass}
                    value={fontMode}
                    onChange={(e) => setFontMode(e.target.value as FontFormMode)}
                  >
                    <option value="google">{isMarketer ? "Google Font" : "Choose a Google Font (name + optional file URL)"}</option>
                    <option value="url">{isMarketer ? "Link to a font file" : "Font file URL"}</option>
                    <option value="upload">{isMarketer ? "Upload a font file" : "Upload font file"}</option>
                  </select>
                </div>
                {fontMode === "google" && (
                  <>
                    <div className={formFieldClass}>
                      <label className={isMarketer ? "profile-field-label" : "filter-label"}>Font family</label>
                      <select
                        className={formInputClass}
                        value={googleFamily}
                        onChange={(e) => setGoogleFamily(e.target.value)}
                        style={isMarketer ? { fontFamily: googleFamily } : undefined}
                      >
                        {PRESET_GOOGLE_FONTS.map((f) => (
                          <option key={f} value={f} style={{ fontFamily: f }}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>
                    {!isMarketer && (
                      <div className={formFieldClass}>
                        <label className="filter-label">Direct font file URL (for HeyGen sync)</label>
                        <input
                          type="text"
                          className={formInputClass}
                          value={editing.public_url ?? ""}
                          onChange={(e) => setEditing((p) => (p ? { ...p, public_url: e.target.value } : p))}
                          placeholder="https://…/font.woff2"
                        />
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                          HeyGen needs a direct link to a font file. Use Google Fonts helper sites to copy a{" "}
                          <code>.woff2</code> URL, or switch to Upload.
                        </div>
                      </div>
                    )}
                  </>
                )}
                {fontMode === "url" && (
                  <div className={formFieldClass}>
                    <label className={isMarketer ? "profile-field-label" : "filter-label"}>
                      {isMarketer ? "Font file URL" : "Public URL (.woff2, .ttf, …)"}
                    </label>
                    <input
                      type="text"
                      className={formInputClass}
                      value={editing.public_url ?? ""}
                      onChange={(e) => setEditing((p) => (p ? { ...p, public_url: e.target.value } : p))}
                      placeholder="https://…"
                    />
                  </div>
                )}
                {fontMode === "upload" && (
                  <div className={formFieldClass}>
                    <label className={isMarketer ? "profile-field-label" : "filter-label"}>Font file</label>
                    <input
                      type="file"
                      className={formInputClass}
                      accept=".woff2,.woff,.ttf,.otf,font/*"
                      onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []).slice(0, 1))}
                    />
                    {isMarketer && (
                      <span className="profile-field-hint">Supported: .woff2, .woff, .ttf, .otf</span>
                    )}
                  </div>
                )}
                {!isMarketer && (
                  <div className={formFieldClass}>
                    <label className="filter-label">Sort order</label>
                    <input
                      type="number"
                      className={formInputClass}
                      value={editing.sort_order ?? 0}
                      onChange={(e) => setEditing((p) => (p ? { ...p, sort_order: Number(e.target.value) } : p))}
                    />
                  </div>
                )}
              </>
            )}

            {editing.kind === "other" && (
              <>
                <div className="filter-group">
                  <label className="filter-label">Label</label>
                  <input
                    type="text"
                    className="filter-input"
                    value={editing.label ?? ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, label: e.target.value } : p))}
                  />
                </div>
                <div className="filter-group">
                  <label className="filter-label">Upload (optional)</label>
                  <input
                    type="file"
                    className="filter-input"
                    onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []).slice(0, 1))}
                  />
                </div>
                <div className="filter-group">
                  <label className="filter-label">Public URL</label>
                  <input
                    type="text"
                    className="filter-input"
                    value={editing.public_url ?? ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, public_url: e.target.value } : p))}
                    placeholder="https://…"
                  />
                </div>
                <div className="filter-group">
                  <label className="filter-label">Sort order</label>
                  <input
                    type="number"
                    className="filter-input"
                    value={editing.sort_order ?? 0}
                    onChange={(e) => setEditing((p) => (p ? { ...p, sort_order: Number(e.target.value) } : p))}
                  />
                </div>
              </>
            )}
          </div>
          <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn-ghost" onClick={cancel} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={() => void submit()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {!loading && (assets?.length ?? 0) > 0 && (
        <div className={isMarketer ? "brand-kit-grid-wrap" : undefined} style={isMarketer ? undefined : { marginBottom: 20 }}>
          <div
            className={isMarketer ? "brand-kit-grid-header" : undefined}
            style={
              isMarketer
                ? undefined
                : { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }
            }
          >
            <div style={isMarketer ? undefined : { fontSize: 13, fontWeight: 600 }}>
              {isMarketer ? "Your brand kit" : "Overview"}
            </div>
            <div className={isMarketer ? "profile-chip-row" : undefined} style={isMarketer ? undefined : { display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["all", ...BRAND_ASSET_KINDS] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={
                    isMarketer
                      ? `profile-chip ${overviewFilter === f ? "active" : ""}`
                      : overviewFilter === f
                        ? "btn-primary"
                        : "btn-ghost"
                  }
                  style={isMarketer ? undefined : { fontSize: 12, padding: "4px 10px" }}
                  onClick={() => setOverviewFilter(f)}
                >
                  {f === "all" ? "All" : kindLabel(f)}
                </button>
              ))}
            </div>
          </div>
          <div className={isMarketer ? "brand-kit-grid" : undefined} style={isMarketer ? undefined : { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {filteredOverview.map((a) => (
              <OverviewCard
                key={a.id}
                asset={a}
                projectSlug={resolvedSlug}
                isMarketer={isMarketer}
                onEdit={() => startEdit(a)}
                onDelete={() => remove(a.id)}
                onSyncHeygen={() => syncHeygen(a.id)}
                busy={busyId === a.id}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && (assets?.length ?? 0) === 0 && !editing && (
        <div
          className={isMarketer ? "brand-kit-empty" : "card"}
          style={isMarketer ? undefined : { textAlign: "center", color: "var(--muted)", padding: 32, marginBottom: 16 }}
        >
          {isMarketer
            ? "No brand assets yet. Use the buttons above to add your logo, reference images, color palette, or typography."
            : "No brand assets yet. Add logos, reference images, a palette, or fonts for HeyGen and LLM flows."}
        </div>
      )}

      {!isMarketer && !loading && (assets?.length ?? 0) > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>All assets (table)</div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Label</th>
                  <th>Preview / URL</th>
                  <th>HeyGen</th>
                  <th>Order</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(assets ?? []).map((a) => {
                  const hasUrl = typeof a.public_url === "string" && a.public_url.trim().length > 0;
                  const synced = typeof a.heygen_asset_id === "string" && a.heygen_asset_id.length > 0;
                  return (
                    <tr key={a.id}>
                      <td>{a.kind}</td>
                      <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.label ?? "—"}
                      </td>
                      <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.kind === "palette" && Array.isArray(a.metadata_json?.colors) ? (
                          <span style={{ display: "flex", gap: 4 }}>
                            {(a.metadata_json!.colors as unknown[])
                              .filter((c) => typeof c === "string")
                              .slice(0, 5)
                              .map((c, i) => (
                                <span
                                  key={i}
                                  title={String(c)}
                                  style={{
                                    display: "inline-block",
                                    width: 14,
                                    height: 14,
                                    borderRadius: 3,
                                    background: String(c),
                                    border: "1px solid var(--border)",
                                  }}
                                />
                              ))}
                          </span>
                        ) : hasUrl ? (
                          <a href={a.public_url ?? "#"} target="_blank" rel="noreferrer">
                            {a.public_url}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {synced ? (
                          <span title={a.heygen_synced_at ?? undefined} style={{ color: "var(--green)" }}>
                            ✓ {String(a.heygen_asset_id).slice(0, 10)}…
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>not synced</span>
                        )}
                      </td>
                      <td>{a.sort_order}</td>
                      <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className="btn-open-row" onClick={() => startEdit(a)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-open-row"
                          disabled={!hasUrl || busyId === a.id || a.kind === "palette"}
                          title={
                            a.kind === "palette"
                              ? "Palettes are metadata-only for HeyGen"
                              : hasUrl
                                ? "Upload file to HeyGen and store asset_id"
                                : "Set Public URL first"
                          }
                          onClick={() => syncHeygen(a.id)}
                        >
                          {busyId === a.id ? "Syncing…" : synced ? "Re-sync HeyGen" : "Sync HeyGen"}
                        </button>
                        <button type="button" className="btn-open-row" disabled={busyId === a.id} onClick={() => remove(a.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewCard({
  asset: a,
  projectSlug,
  isMarketer,
  onEdit,
  onDelete,
  onSyncHeygen,
  busy,
}: {
  asset: BrandAsset;
  projectSlug: string;
  isMarketer: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSyncHeygen: () => void;
  busy: boolean;
}) {
  const hasUrl = typeof a.public_url === "string" && a.public_url.trim().length > 0;
  const synced = typeof a.heygen_asset_id === "string" && a.heygen_asset_id.length > 0;
  const isImg = a.kind === "logo" || a.kind === "reference_image" || a.kind === "other";
  const imgSrc =
    isImg && a.id && projectSlug
      ? brandAssetProxyUrl(projectSlug, a) || a.public_url || ""
      : a.public_url ?? "";

  return (
    <div
      className={isMarketer ? "brand-kit-card" : "card"}
      style={
        isMarketer
          ? undefined
          : { padding: 12, display: "flex", flexDirection: "column", gap: 8, minHeight: 120 }
      }
    >
      <div
        className={isMarketer ? "brand-kit-card-kind" : undefined}
        style={isMarketer ? undefined : { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)" }}
      >
        {kindLabel(a.kind)}
      </div>
      <div
        className={isMarketer ? "brand-kit-card-title" : undefined}
        style={isMarketer ? undefined : { fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}
      >
        {a.label ?? "—"}
      </div>

      {a.kind === "palette" && Array.isArray(a.metadata_json?.colors) ? (
        <div className={isMarketer ? "brand-kit-palette-preview" : undefined} style={isMarketer ? undefined : { display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(a.metadata_json!.colors as unknown[])
            .filter((c) => typeof c === "string")
            .slice(0, 5)
            .map((c, i) => (
              <span
                key={i}
                title={String(c)}
                className={isMarketer ? "brand-kit-palette-swatch brand-kit-palette-swatch--lg" : undefined}
                style={
                  isMarketer
                    ? { background: String(c) }
                    : { width: 28, height: 28, borderRadius: 6, background: String(c), border: "1px solid var(--border)" }
                }
              />
            ))}
        </div>
      ) : isImg && imgSrc ? (
        <img
          src={imgSrc}
          alt=""
          className={isMarketer ? "brand-kit-card-img" : undefined}
          style={
            isMarketer
              ? undefined
              : { width: "100%", maxHeight: 100, objectFit: "contain", borderRadius: 6, background: "var(--panel)" }
          }
        />
      ) : a.kind === "font" ? (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {typeof a.metadata_json?.font_family === "string" ? (
            <span style={isMarketer ? { fontFamily: String(a.metadata_json.font_family), fontSize: 18 } : undefined}>
              {String(a.metadata_json.font_family)}
              {!isMarketer && typeof a.metadata_json.font_source === "string"
                ? ` · ${String(a.metadata_json.font_source)}`
                : ""}
            </span>
          ) : hasUrl ? (
            <a href={a.public_url ?? "#"} target="_blank" rel="noreferrer">
              Font file
            </a>
          ) : (
            "—"
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--muted)", wordBreak: "break-all" }}>
          {hasUrl ? a.public_url!.slice(0, 80) + (a.public_url!.length > 80 ? "…" : "") : "No URL"}
        </div>
      )}

      <div
        className={isMarketer ? "brand-kit-card-actions" : undefined}
        style={isMarketer ? undefined : { marginTop: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}
      >
        <button type="button" className="btn-open-row" onClick={onEdit}>
          Edit
        </button>
        {!isMarketer && (
          <button
            type="button"
            className="btn-open-row"
            disabled={!hasUrl || busy || a.kind === "palette"}
            onClick={onSyncHeygen}
          >
            {busy ? "…" : synced ? "HeyGen" : "Sync"}
          </button>
        )}
        <button type="button" className="btn-open-row" disabled={busy} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
