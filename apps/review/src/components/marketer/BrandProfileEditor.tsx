"use client";

import { useEffect, useState } from "react";
import { BrandAssetsPanel } from "@/components/BrandAssetsPanel";
import { BrandProfileHeygenSection } from "@/components/marketer/BrandProfileHeygenSection";
import type { BrandProfile } from "@/lib/marketer/types";

interface BrandProfileEditorProps {
  slug: string;
}

const VOICE_PRESETS = [
  { id: "professional", label: "Professional" },
  { id: "casual", label: "Casual & friendly" },
  { id: "playful", label: "Playful" },
  { id: "authoritative", label: "Authoritative" },
  { id: "custom", label: "Custom" },
];

const CONTENT_GOAL_OPTIONS = [
  { id: "awareness", label: "Awareness" },
  { id: "engagement", label: "Engagement" },
  { id: "leads", label: "Leads" },
  { id: "conversions", label: "Conversions" },
  { id: "education", label: "Education" },
  { id: "community", label: "Community" },
];

const AUDIENCE_TYPES = [
  { id: "b2c", label: "B2C — consumers" },
  { id: "b2b", label: "B2B — businesses" },
  { id: "prosumer", label: "Prosumer — enthusiasts & creators" },
];

const VISUAL_PRESETS = [
  { id: "clean", label: "Clean & minimal" },
  { id: "bold", label: "Bold & colorful" },
  { id: "editorial", label: "Editorial" },
  { id: "playful", label: "Playful" },
  { id: "custom", label: "Custom" },
];

interface EditState {
  description: string;
  voicePreset: string;
  voiceCustom: string;
  audienceType: string;
  audienceDetail: string;
  contentGoals: string[];
  positioning: string;
  bannedWords: string[];
  competitors: string;
  productName: string;
  productUrl: string;
  instagramHandle: string;
  visualPreset: string;
  visualCustom: string;
  colors: string[];
  domainMetaphors: string;
  allowedMotifs: string;
  forbiddenMotifs: string;
  platformFocus: string[];
}

function splitTags(text: string): string[] {
  return text
    .split(/[;,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function detectPreset(value: string, presets: { id: string; label: string }[]): { preset: string; custom: string } {
  const v = value.trim().toLowerCase();
  const match = presets.find((p) => p.id !== "custom" && (p.label.toLowerCase() === v || p.id === v));
  if (match) return { preset: match.id, custom: "" };
  if (!v) return { preset: "custom", custom: "" };
  return { preset: "custom", custom: value };
}

function toEditState(p: BrandProfile): EditState {
  const voice = detectPreset(p.voice.split("·")[0]?.trim() ?? p.voice, VOICE_PRESETS);
  const visual = detectPreset(p.visualStyle, VISUAL_PRESETS);
  const goals = splitTags(p.contentGoals).map((g) => g.toLowerCase());
  const audienceLower = p.audience.toLowerCase();
  let audienceType = "b2c";
  if (/b2b|business|enterprise/.test(audienceLower)) audienceType = "b2b";
  else if (/prosumer|creator|enthusiast/.test(audienceLower)) audienceType = "prosumer";

  return {
    description: p.description,
    voicePreset: voice.preset,
    voiceCustom: voice.custom || (voice.preset === "custom" ? p.voice : ""),
    audienceType,
    audienceDetail: p.audience,
    contentGoals: goals.filter((g) => CONTENT_GOAL_OPTIONS.some((o) => o.id === g)),
    positioning: p.positioning,
    bannedWords: p.bannedWords,
    competitors: p.competitors,
    productName: p.productName,
    productUrl: p.productUrl,
    instagramHandle: p.instagramHandle,
    visualPreset: visual.preset,
    visualCustom: visual.custom || (visual.preset === "custom" ? p.visualStyle : ""),
    colors: splitTags(p.colors),
    domainMetaphors: p.domainMetaphors,
    allowedMotifs: p.allowedMotifs,
    forbiddenMotifs: p.forbiddenMotifs,
    platformFocus: p.platformFocus.length ? p.platformFocus : [...p.platforms],
  };
}

function editToPayload(edit: EditState) {
  const voiceLabel =
    edit.voicePreset === "custom"
      ? edit.voiceCustom.trim()
      : VOICE_PRESETS.find((p) => p.id === edit.voicePreset)?.label ?? edit.voiceCustom;
  const visualLabel =
    edit.visualPreset === "custom"
      ? edit.visualCustom.trim()
      : VISUAL_PRESETS.find((p) => p.id === edit.visualPreset)?.label ?? edit.visualCustom;

  return {
    description: edit.description,
    voice: voiceLabel,
    audience: edit.audienceDetail.trim(),
    contentGoals: edit.contentGoals.join("; "),
    positioning: edit.positioning,
    bannedWords: edit.bannedWords.join("; "),
    competitors: edit.competitors,
    productName: edit.productName,
    productUrl: edit.productUrl,
    instagramHandle: edit.instagramHandle,
    visualStyle: visualLabel,
    colors: edit.colors.join("; "),
    domainMetaphors: edit.domainMetaphors,
    allowedMotifs: edit.allowedMotifs,
    forbiddenMotifs: edit.forbiddenMotifs,
    platformFocus: edit.platformFocus,
  };
}

export function BrandProfileEditor({ slug }: BrandProfileEditorProps) {
  const [profile, setProfile] = useState<BrandProfile | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tagInput, setTagInput] = useState({ colors: "", banned: "" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/brand/${encodeURIComponent(slug)}/profile`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load profile"))))
      .then((j: { profile: BrandProfile }) => {
        if (cancelled) return;
        setProfile(j.profile);
        setEdit(toEditState(j.profile));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function save() {
    if (!edit) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editToPayload(edit)),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Brand profile saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleGoal(id: string) {
    setEdit((prev) => {
      if (!prev) return prev;
      const has = prev.contentGoals.includes(id);
      return {
        ...prev,
        contentGoals: has ? prev.contentGoals.filter((g) => g !== id) : [...prev.contentGoals, id],
      };
    });
  }

  function addTag(field: "colors" | "bannedWords", raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    setEdit((prev) => {
      if (!prev) return prev;
      const list = field === "colors" ? prev.colors : prev.bannedWords;
      if (list.includes(tag)) return prev;
      return { ...prev, [field]: [...list, tag] };
    });
    setTagInput((p) => ({ ...p, [field === "colors" ? "colors" : "banned"]: "" }));
  }

  function togglePlatformFocus(platform: string) {
    setEdit((prev) => {
      if (!prev) return prev;
      const has = prev.platformFocus.includes(platform);
      const next = has
        ? prev.platformFocus.filter((p) => p !== platform)
        : [...prev.platformFocus, platform];
      return { ...prev, platformFocus: next.length ? next : prev.platformFocus };
    });
  }

  if (loading) return <p className="workspace-muted">Loading brand profile…</p>;
  if (error && !edit) return <p className="workspace-error">{error}</p>;
  if (!edit || !profile) return null;

  const advancedUrl = `/settings/project?project=${encodeURIComponent(slug)}&embed=admin`;

  return (
    <div className="profile-editor">
      <div className="profile-editor-top">
        <button type="button" className="btn-ghost" onClick={() => setAdvancedOpen(true)}>
          Advanced settings
        </button>
      </div>

      <section className="profile-section">
        <h3 className="profile-section-title">Voice & strategy</h3>
        <div className="profile-editor-grid">
          <Field
            label="Brand description"
            hint="What this brand offers, in plain language."
            value={edit.description}
            onChange={(v) => setEdit((p) => (p ? { ...p, description: v } : p))}
            textarea
          />
          <label className="profile-field">
            <span className="profile-field-label">Voice & tone</span>
            <select
              value={edit.voicePreset}
              onChange={(e) => setEdit((p) => (p ? { ...p, voicePreset: e.target.value } : p))}
            >
              {VOICE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {edit.voicePreset === "custom" && (
              <input
                value={edit.voiceCustom}
                onChange={(e) => setEdit((p) => (p ? { ...p, voiceCustom: e.target.value } : p))}
                placeholder="Describe your voice…"
              />
            )}
          </label>
          <label className="profile-field">
            <span className="profile-field-label">Audience type</span>
            <select
              value={edit.audienceType}
              onChange={(e) => setEdit((p) => (p ? { ...p, audienceType: e.target.value } : p))}
            >
              {AUDIENCE_TYPES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Audience detail"
            hint="Who you're talking to — demographics, interests, pain points."
            value={edit.audienceDetail}
            onChange={(v) => setEdit((p) => (p ? { ...p, audienceDetail: v } : p))}
            textarea
          />
          <div className="profile-field profile-field--full">
            <span className="profile-field-label">Content goals</span>
            <div className="profile-chip-row">
              {CONTENT_GOAL_OPTIONS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`profile-chip ${edit.contentGoals.includes(g.id) ? "active" : ""}`}
                  onClick={() => toggleGoal(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <Field
            label="Positioning"
            hint="What makes this brand different."
            value={edit.positioning}
            onChange={(v) => setEdit((p) => (p ? { ...p, positioning: v } : p))}
            textarea
          />
        </div>
      </section>

      <section className="profile-section">
        <h3 className="profile-section-title">Product & competitors</h3>
        <div className="profile-editor-grid">
          <Field label="Product name" value={edit.productName} onChange={(v) => setEdit((p) => (p ? { ...p, productName: v } : p))} />
          <Field label="Product URL" value={edit.productUrl} onChange={(v) => setEdit((p) => (p ? { ...p, productUrl: v } : p))} />
          <Field
            label="Instagram handle"
            hint="Used on carousel CTAs and captions."
            value={edit.instagramHandle}
            onChange={(v) => setEdit((p) => (p ? { ...p, instagramHandle: v } : p))}
          />
          <Field
            label="Competitors"
            value={edit.competitors}
            onChange={(v) => setEdit((p) => (p ? { ...p, competitors: v } : p))}
            textarea
          />
        </div>
      </section>

      <section className="profile-section">
        <h3 className="profile-section-title">Visual profile</h3>
        <div className="profile-editor-grid">
          <label className="profile-field">
            <span className="profile-field-label">Visual style</span>
            <select
              value={edit.visualPreset}
              onChange={(e) => setEdit((p) => (p ? { ...p, visualPreset: e.target.value } : p))}
            >
              {VISUAL_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {edit.visualPreset === "custom" && (
              <textarea
                rows={2}
                value={edit.visualCustom}
                onChange={(e) => setEdit((p) => (p ? { ...p, visualCustom: e.target.value } : p))}
              />
            )}
          </label>
          <div className="profile-field">
            <span className="profile-field-label">Brand colors</span>
            <span className="profile-field-hint">Quick text labels for strategy prompts. For carousel/render colors, add a palette in Brand kit below.</span>
            <div className="profile-tag-row">
              {edit.colors.map((c) => (
                <span key={c} className="profile-tag">
                  {c}
                  <button
                    type="button"
                    aria-label={`Remove ${c}`}
                    onClick={() =>
                      setEdit((p) => (p ? { ...p, colors: p.colors.filter((x) => x !== c) } : p))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <input
              value={tagInput.colors}
              placeholder="#hex or color name, press Enter"
              onChange={(e) => setTagInput((p) => ({ ...p, colors: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag("colors", tagInput.colors);
                }
              }}
            />
          </div>
        </div>
      </section>

      <section className="profile-section">
        <BrandAssetsPanel projectSlug={slug} variant="marketer" />
      </section>

      <BrandProfileHeygenSection slug={slug} />

      <section className="profile-section">
        <h3 className="profile-section-title">Brand safety</h3>
        <div className="profile-field">
          <span className="profile-field-label">Banned words</span>
          <div className="profile-tag-row">
            {edit.bannedWords.map((w) => (
              <span key={w} className="profile-tag">
                {w}
                <button
                  type="button"
                  aria-label={`Remove ${w}`}
                  onClick={() =>
                    setEdit((p) => (p ? { ...p, bannedWords: p.bannedWords.filter((x) => x !== w) } : p))
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            value={tagInput.banned}
            placeholder="Type a word and press Enter"
            onChange={(e) => setTagInput((p) => ({ ...p, banned: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag("bannedWords", tagInput.banned);
              }
            }}
          />
        </div>
      </section>

      <section className="profile-section">
        <h3 className="profile-section-title">Platforms</h3>
        {profile.platforms.length === 0 ? (
          <p className="profile-platforms-note">
            No platforms configured — use Advanced settings to enable flows per platform.
          </p>
        ) : (
          <div className="profile-field profile-field--full">
            <span className="profile-field-label">Platforms focus</span>
            <span className="profile-field-hint">Which platforms CAF should prioritize for this brand.</span>
            <div className="profile-chip-row">
              {profile.platforms.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  className={`profile-chip ${edit.platformFocus.includes(platform) ? "active" : ""}`}
                  onClick={() => togglePlatformFocus(platform)}
                >
                  {platform}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="profile-editor-actions">
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save brand profile"}
        </button>
        {message && <span className="profile-editor-ok">{message}</span>}
        {error && <span className="profile-editor-err">{error}</span>}
      </div>

      {advancedOpen && (
        <div className="profile-advanced-overlay" role="presentation" onClick={() => setAdvancedOpen(false)}>
          <div
            className="profile-advanced-modal"
            role="dialog"
            aria-label="Advanced settings"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="profile-advanced-header">
              <div>
                <h3>{profile.displayName} — Advanced settings</h3>
                <p className="profile-advanced-warning">
                  Operator-only controls (flows, limits, integrations). Change these only if you know how they affect
                  content generation.
                </p>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setAdvancedOpen(false)}>
                Close
              </button>
            </header>
            <iframe title="Advanced project settings" src={advancedUrl} className="profile-advanced-iframe" />
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  textarea,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  return (
    <label className="profile-field">
      <span className="profile-field-label">{label}</span>
      {hint && <span className="profile-field-hint">{hint}</span>}
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
