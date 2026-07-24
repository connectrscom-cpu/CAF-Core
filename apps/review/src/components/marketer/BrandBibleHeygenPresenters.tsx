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

function emptyDraftMeta(): { label: string; voiceId: string; voiceName: string } {
  return { label: "", voiceId: "", voiceName: "" };
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
  const [draftMeta, setDraftMeta] = useState(emptyDraftMeta);
  /** Multi-select for the next batch to add to the project pool. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [avatarFilter, setAvatarFilter] = useState("");
  const [voiceFilter, setVoiceFilter] = useState("");
  const [avatarLimit, setAvatarLimit] = useState(36);
  const [manualAvatarId, setManualAvatarId] = useState("");
  const [manualVoiceId, setManualVoiceId] = useState("");

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

  const alreadyInPool = useMemo(() => new Set(presenters.map((p) => p.avatarId.trim()).filter(Boolean)), [presenters]);

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

  const selectedAvatars = useMemo(
    () =>
      selectedIds
        .map((id) => avatars.find((a) => a.avatar_id === id))
        .filter((a): a is CatalogAvatar => Boolean(a)),
    [avatars, selectedIds]
  );

  const selectedVoice = useMemo(
    () => voices.find((v) => v.voice_id === draftMeta.voiceId) ?? null,
    [voices, draftMeta.voiceId]
  );

  function toggleAvatar(a: CatalogAvatar) {
    setSelectedIds((prev) => {
      if (prev.includes(a.avatar_id)) return prev.filter((id) => id !== a.avatar_id);
      return [...prev, a.avatar_id];
    });
  }

  function selectVoice(v: CatalogVoice) {
    setDraftMeta((prev) => ({ ...prev, voiceId: v.voice_id, voiceName: v.name }));
  }

  function clearSelection() {
    setSelectedIds([]);
    setDraftMeta(emptyDraftMeta());
  }

  function addSelectedPresenters() {
    if (selectedAvatars.length === 0) return;
    const labelPrefix = draftMeta.label.trim();
    const sharedVoiceId = draftMeta.voiceId.trim();
    const sharedVoiceName = draftMeta.voiceName.trim();
    const additions: BrandBibleHeygenPresenter[] = [];
    for (const a of selectedAvatars) {
      if (alreadyInPool.has(a.avatar_id)) continue;
      if (additions.some((x) => x.avatarId === a.avatar_id)) continue;
      const matchedDefault = voices.find((v) => v.voice_id === (a.default_voice_id ?? ""));
      const voiceId = sharedVoiceId || a.default_voice_id || "";
      const voiceName = sharedVoiceId
        ? sharedVoiceName || matchedDefault?.name || ""
        : matchedDefault?.name || "";
      additions.push({
        label: labelPrefix
          ? selectedAvatars.length > 1
            ? `${labelPrefix} · ${a.name}`
            : labelPrefix
          : a.name || "Video presenter",
        avatarId: a.avatar_id,
        avatarName: a.name,
        previewImageUrl: a.preview_image_url ?? "",
        voiceId,
        voiceName,
      });
    }
    if (additions.length === 0) return;
    onChange([...presenters, ...additions]);
    clearSelection();
  }

  function addFromManualIds() {
    const avatarId = manualAvatarId.trim();
    if (!avatarId) return;
    if (alreadyInPool.has(avatarId)) return;
    const fromCatalog = avatars.find((a) => a.avatar_id === avatarId);
    const voiceId = manualVoiceId.trim() || draftMeta.voiceId.trim() || fromCatalog?.default_voice_id || "";
    const matchedVoice = voices.find((v) => v.voice_id === voiceId);
    onChange([
      ...presenters,
      {
        label: draftMeta.label.trim() || fromCatalog?.name || "Video presenter",
        avatarId,
        avatarName: fromCatalog?.name ?? "",
        previewImageUrl: fromCatalog?.preview_image_url ?? "",
        voiceId,
        voiceName: matchedVoice?.name ?? draftMeta.voiceName,
      },
    ]);
    setManualAvatarId("");
    setManualVoiceId("");
    clearSelection();
  }

  function removeAt(index: number) {
    onChange(presenters.filter((_, i) => i !== index));
  }

  const catalogReady = !loading && !catalogError && avatars.length > 0;
  const newCount = selectedAvatars.filter((a) => !alreadyInPool.has(a.avatar_id)).length;

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
          {avatars.length} avatars · {voices.length} voices available · click multiple avatars to build the project pool
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
        <p className="brand-bible-moodboard-empty">No video presenters in this project yet. Select avatars below and add them.</p>
      )}

      <div className="brand-bible-heygen-picker">
        <label className="profile-field profile-field--full">
          <span className="profile-field-label">Optional label prefix</span>
          <input
            className="profile-field-input"
            value={draftMeta.label}
            onChange={(e) => setDraftMeta((p) => ({ ...p, label: e.target.value }))}
            placeholder="e.g. Primary host (applied to each selected avatar)"
          />
        </label>

        {selectedAvatars.length > 0 ? (
          <div className="brand-bible-heygen-selected-batch">
            <div className="brand-bible-heygen-selected-batch__head">
              <strong>
                {selectedAvatars.length} selected
                {newCount < selectedAvatars.length
                  ? ` · ${selectedAvatars.length - newCount} already in pool`
                  : ""}
              </strong>
              <button type="button" className="btn-ghost btn-sm" onClick={clearSelection}>
                Clear
              </button>
            </div>
            <div className="brand-bible-heygen-selected-batch__thumbs">
              {selectedAvatars.map((a) => (
                <button
                  key={a.avatar_id}
                  type="button"
                  className="brand-bible-heygen-selected-chip"
                  onClick={() => toggleAvatar(a)}
                  title="Click to deselect"
                >
                  {a.preview_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.preview_image_url} alt={a.name} />
                  ) : (
                    <span>{a.name.slice(0, 2)}</span>
                  )}
                  <em>{a.name}</em>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={addSelectedPresenters}
              disabled={newCount === 0}
            >
              {newCount === 0
                ? "Already in project pool"
                : `Add ${newCount} presenter${newCount === 1 ? "" : "s"} to project`}
            </button>
            <p className="profile-field-hint" style={{ margin: 0 }}>
              Each avatar keeps its HeyGen default voice unless you pick a shared voice below.
            </p>
          </div>
        ) : null}

        {catalogReady ? (
          <>
            <label className="profile-field profile-field--full">
              <span className="profile-field-label">Pick avatars (multi-select)</span>
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
              {filteredAvatars.map((a) => {
                const selected = selectedIds.includes(a.avatar_id);
                const inPool = alreadyInPool.has(a.avatar_id);
                return (
                  <button
                    key={a.avatar_id}
                    type="button"
                    className={`brand-bible-heygen-avatar-pick ${selected ? "active" : ""} ${inPool ? "in-pool" : ""}`}
                    onClick={() => toggleAvatar(a)}
                    title={inPool ? `${a.avatar_id} (already in project)` : a.avatar_id}
                    aria-pressed={selected}
                  >
                    {a.preview_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.preview_image_url} alt={a.name} loading="lazy" />
                    ) : (
                      <span className="brand-bible-heygen-avatar-pick__fallback">{a.name.slice(0, 2)}</span>
                    )}
                    <span className="brand-bible-heygen-avatar-pick__name">{a.name}</span>
                    {inPool ? <span className="brand-bible-heygen-avatar-pick__badge">In pool</span> : null}
                    {selected ? <span className="brand-bible-heygen-avatar-pick__check" aria-hidden>✓</span> : null}
                  </button>
                );
              })}
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
            <span className="profile-field-label">Or paste avatar ID</span>
            <input
              className="profile-field-input font-mono"
              value={manualAvatarId}
              onChange={(e) => setManualAvatarId(e.target.value)}
              placeholder="HeyGen look id (avatar_id)"
            />
          </label>
          <label className="profile-field">
            <span className="profile-field-label">Voice ID (optional override)</span>
            <input
              className="profile-field-input font-mono"
              value={manualVoiceId || draftMeta.voiceId}
              onChange={(e) => {
                setManualVoiceId(e.target.value);
                setDraftMeta((p) => ({ ...p, voiceId: e.target.value, voiceName: "" }));
              }}
              placeholder="HeyGen voice_id — blank = avatar default"
            />
          </label>
        </div>
        {manualAvatarId.trim() ? (
          <button type="button" className="btn-primary btn-sm" onClick={addFromManualIds}>
            Add pasted avatar to project
          </button>
        ) : null}

        {catalogReady && voices.length > 0 ? (
          <div className="brand-bible-heygen-voice-list">
            <label className="profile-field profile-field--full">
              <span className="profile-field-label">
                Shared voice for selected (optional — otherwise each avatar keeps its default)
              </span>
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
                  Shared voice: <strong>{selectedVoice.name}</strong>
                </span>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio controls preload="none" src={selectedVoice.preview_audio_url} />
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => setDraftMeta((p) => ({ ...p, voiceId: "", voiceName: "" }))}
                >
                  Use avatar defaults
                </button>
              </div>
            ) : null}
            <ul>
              {filteredVoices.map((v) => (
                <li key={v.voice_id}>
                  <button
                    type="button"
                    className={`brand-bible-heygen-voice-pick ${draftMeta.voiceId === v.voice_id ? "active" : ""}`}
                    onClick={() => selectVoice(v)}
                  >
                    <span>{v.name}</span>
                    <span className="workspace-muted">{[v.language, v.gender].filter(Boolean).join(" · ")}</span>
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
      </div>
    </section>
  );
}
