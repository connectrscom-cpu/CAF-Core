"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BrandBibleHeygenPresenter } from "@/lib/marketer/types";

type CatalogAvatar = {
  avatar_id: string;
  name: string;
  preview_image_url: string | null;
  preview_video_url?: string | null;
  gender: string | null;
  default_voice_id: string | null;
};

type CatalogVoice = {
  voice_id: string;
  name: string;
  language: string | null;
  gender: string | null;
  preview_audio_url: string | null;
};

type Props = {
  slug: string;
  presenters: BrandBibleHeygenPresenter[];
  onChange: (next: BrandBibleHeygenPresenter[]) => void;
  /** Hide section title when parent already provides a header (e.g. Brand profile tab). */
  embedded?: boolean;
  title?: string;
  description?: string;
};

function emptyPresenter(): BrandBibleHeygenPresenter {
  return {
    label: "",
    avatarId: "",
    voiceId: "",
    avatarName: "",
    voiceName: "",
    previewImageUrl: "",
  };
}

export function BrandBibleHeygenPresenters({
  slug,
  presenters,
  onChange,
  embedded = false,
  title = "HeyGen video presenters",
  description = "Approved avatar + voice pairs for brand talking-head videos. Synced into HeyGen config on save.",
}: Props) {
  const [avatars, setAvatars] = useState<CatalogAvatar[]>([]);
  const [voices, setVoices] = useState<CatalogVoice[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<BrandBibleHeygenPresenter>(() => emptyPresenter());
  const [avatarFilter, setAvatarFilter] = useState("");
  const [voiceFilter, setVoiceFilter] = useState("");
  const [avatarLimit, setAvatarLimit] = useState(36);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setCatalogError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/heygen-catalog`, { cache: "no-store" });
      const j = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        avatars?: CatalogAvatar[];
        voices?: CatalogVoice[];
      };
      if (!res.ok || j.ok === false) {
        throw new Error(j.message ?? j.error ?? "Could not load HeyGen catalog");
      }
      setAvatars(Array.isArray(j.avatars) ? j.avatars : []);
      setVoices(Array.isArray(j.voices) ? j.voices : []);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : "Could not load HeyGen catalog");
      setAvatars([]);
      setVoices([]);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const filteredAvatars = useMemo(() => {
    const q = avatarFilter.trim().toLowerCase();
    const list = q
      ? avatars.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            a.avatar_id.toLowerCase().includes(q) ||
            (a.gender ?? "").toLowerCase().includes(q)
        )
      : avatars;
    return list.slice(0, avatarLimit);
  }, [avatars, avatarFilter, avatarLimit]);

  const filteredVoices = useMemo(() => {
    const q = voiceFilter.trim().toLowerCase();
    const list = q
      ? voices.filter(
          (v) =>
            v.name.toLowerCase().includes(q) ||
            v.voice_id.toLowerCase().includes(q) ||
            (v.language ?? "").toLowerCase().includes(q)
        )
      : voices;
    return list.slice(0, 24);
  }, [voices, voiceFilter]);

  const selectedAvatar = useMemo(
    () => avatars.find((a) => a.avatar_id === draft.avatarId) ?? null,
    [avatars, draft.avatarId]
  );

  const selectedVoice = useMemo(
    () => voices.find((v) => v.voice_id === draft.voiceId) ?? null,
    [voices, draft.voiceId]
  );

  function selectAvatar(a: CatalogAvatar) {
    const matchedVoice = voices.find((v) => v.voice_id === (a.default_voice_id ?? ""));
    setDraft((prev) => ({
      ...prev,
      avatarId: a.avatar_id,
      avatarName: a.name,
      previewImageUrl: a.preview_image_url ?? "",
      voiceId: prev.voiceId || a.default_voice_id || "",
      voiceName: prev.voiceId ? prev.voiceName : matchedVoice?.name ?? prev.voiceName,
    }));
  }

  function selectVoice(v: CatalogVoice) {
    setDraft((prev) => ({ ...prev, voiceId: v.voice_id, voiceName: v.name }));
  }

  function addPresenter() {
    if (!draft.avatarId.trim()) return;
    onChange([
      ...presenters,
      {
        ...draft,
        label: draft.label.trim() || draft.avatarName || "Video presenter",
      },
    ]);
    setDraft(emptyPresenter());
  }

  function removeAt(index: number) {
    onChange(presenters.filter((_, i) => i !== index));
  }

  const catalogReady = !loading && !catalogError && avatars.length > 0;

  return (
    <section
      className={`profile-section brand-bible-heygen-section ${embedded ? "brand-bible-heygen-section--embedded" : ""}`}
    >
      {embedded ? (
        <div className="brand-bible-heygen-section__head brand-bible-heygen-section__head--compact">
          <button type="button" className="btn-ghost btn-sm" onClick={() => void loadCatalog()} disabled={loading}>
            {loading ? "Loading catalog…" : "Refresh HeyGen catalog"}
          </button>
        </div>
      ) : (
        <div className="brand-bible-heygen-section__head">
          <div>
            <h3 className="profile-section-title">{title}</h3>
            <p className="profile-field-hint" style={{ marginBottom: 0 }}>
              {description}
            </p>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={() => void loadCatalog()} disabled={loading}>
            {loading ? "Loading…" : "Refresh catalog"}
          </button>
        </div>
      )}

      {!embedded && loading ? <p className="workspace-muted">Loading HeyGen avatars and voices…</p> : null}
      {catalogError ? (
        <p className="workspace-error">
          {catalogError}. Paste IDs manually below, or set a valid <code>HEYGEN_API_KEY</code> on Core (Fly secrets).
        </p>
      ) : null}
      {catalogReady ? (
        <p className="workspace-muted brand-bible-heygen-catalog-meta">
          {avatars.length} avatars · {voices.length} voices available
        </p>
      ) : null}

      {presenters.length > 0 ? (
        <ul className="brand-bible-heygen-combo-list">
          {presenters.map((p, i) => (
            <li key={`${p.avatarId}-${p.voiceId}-${i}`} className="brand-bible-heygen-combo-card">
              {p.previewImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.previewImageUrl} alt="" className="brand-bible-heygen-combo-card__thumb" />
              ) : (
                <span className="brand-bible-heygen-combo-card__thumb brand-bible-heygen-combo-card__thumb--empty">▶</span>
              )}
              <div className="brand-bible-heygen-combo-card__meta">
                <strong>{p.label || p.avatarName || "Presenter"}</strong>
                <span className="workspace-muted">
                  {p.avatarName || p.avatarId}
                  {p.voiceName || p.voiceId ? ` · ${p.voiceName || p.voiceId}` : ""}
                </span>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => removeAt(i)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="brand-bible-moodboard-empty">No video presenter combos yet.</p>
      )}

      <div className="brand-bible-heygen-picker">
        <label className="profile-field profile-field--full">
          <span className="profile-field-label">Combo label</span>
          <input
            className="profile-field-input"
            value={draft.label}
            onChange={(e) => setDraft((p) => ({ ...p, label: e.target.value }))}
            placeholder="e.g. Primary cosmic host"
          />
        </label>

        {selectedAvatar ? (
          <div className="brand-bible-heygen-selected-preview">
            {selectedAvatar.preview_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedAvatar.preview_image_url} alt={selectedAvatar.name} />
            ) : null}
            <div>
              <strong>{selectedAvatar.name}</strong>
              <span className="workspace-muted">{selectedAvatar.avatar_id}</span>
              {selectedAvatar.preview_video_url ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video controls preload="metadata" src={selectedAvatar.preview_video_url} />
              ) : null}
            </div>
          </div>
        ) : null}

        {catalogReady ? (
          <>
            <label className="profile-field profile-field--full">
              <span className="profile-field-label">Pick avatar (preview)</span>
              <input
                className="profile-field-input"
                value={avatarFilter}
                onChange={(e) => {
                  setAvatarFilter(e.target.value);
                  setAvatarLimit(36);
                }}
                placeholder="Filter by name, id, or gender…"
              />
            </label>
            <div className="brand-bible-heygen-avatar-grid">
              {filteredAvatars.map((a) => (
                <button
                  key={a.avatar_id}
                  type="button"
                  className={`brand-bible-heygen-avatar-pick ${draft.avatarId === a.avatar_id ? "active" : ""}`}
                  onClick={() => selectAvatar(a)}
                  title={a.avatar_id}
                >
                  {a.preview_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.preview_image_url} alt={a.name} loading="lazy" />
                  ) : (
                    <span className="brand-bible-heygen-avatar-pick__fallback">{a.name.slice(0, 2)}</span>
                  )}
                  <span className="brand-bible-heygen-avatar-pick__name">{a.name}</span>
                </button>
              ))}
            </div>
            {filteredAvatars.length < avatars.length && avatarLimit < avatars.length ? (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setAvatarLimit((n) => n + 36)}>
                Show more avatars
              </button>
            ) : null}
          </>
        ) : null}

        <div className="profile-editor-grid">
          <label className="profile-field">
            <span className="profile-field-label">Avatar ID</span>
            <input
              className="profile-field-input font-mono"
              value={draft.avatarId}
              onChange={(e) => setDraft((p) => ({ ...p, avatarId: e.target.value }))}
              placeholder="HeyGen look id (avatar_id)"
            />
          </label>
          <label className="profile-field">
            <span className="profile-field-label">Voice ID</span>
            <input
              className="profile-field-input font-mono"
              value={draft.voiceId}
              onChange={(e) => setDraft((p) => ({ ...p, voiceId: e.target.value }))}
              placeholder="HeyGen voice_id"
            />
          </label>
        </div>

        {catalogReady && voices.length > 0 ? (
          <div className="brand-bible-heygen-voice-list">
            <label className="profile-field profile-field--full">
              <span className="profile-field-label">Pick voice (preview audio)</span>
              <input
                className="profile-field-input"
                value={voiceFilter}
                onChange={(e) => setVoiceFilter(e.target.value)}
                placeholder="Filter voices…"
              />
            </label>
            {selectedVoice?.preview_audio_url ? (
              <div className="brand-bible-heygen-selected-voice">
                <span>
                  Selected: <strong>{selectedVoice.name}</strong>
                </span>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio controls preload="none" src={selectedVoice.preview_audio_url} />
              </div>
            ) : null}
            <ul>
              {filteredVoices.map((v) => (
                <li key={v.voice_id}>
                  <button
                    type="button"
                    className={`brand-bible-heygen-voice-pick ${draft.voiceId === v.voice_id ? "active" : ""}`}
                    onClick={() => selectVoice(v)}
                  >
                    <span>{v.name}</span>
                    <span className="workspace-muted">
                      {[v.language, v.gender].filter(Boolean).join(" · ")}
                    </span>
                    {v.preview_audio_url ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <audio controls preload="none" src={v.preview_audio_url} onClick={(e) => e.stopPropagation()} />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <button type="button" className="btn-primary btn-sm" onClick={addPresenter} disabled={!draft.avatarId.trim()}>
          Add presenter combo
        </button>
      </div>
    </section>
  );
}
