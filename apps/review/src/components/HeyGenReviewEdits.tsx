"use client";

export interface HeyGenReviewEditsProps {
  editedScript: string;
  onEditedScriptChange: (v: string) => void;
  heygenAvatarId: string;
  onHeygenAvatarIdChange: (v: string) => void;
  heygenVoiceId: string;
  onHeygenVoiceIdChange: (v: string) => void;
  heygenForceRerender: boolean;
  onHeygenForceRerenderChange: (v: boolean) => void;
}

export function HeyGenReviewEdits({
  editedScript,
  onEditedScriptChange,
  heygenAvatarId,
  onHeygenAvatarIdChange,
  heygenVoiceId,
  onHeygenVoiceIdChange,
  heygenForceRerender,
  onHeygenForceRerenderChange,
}: HeyGenReviewEditsProps) {
  return (
    <div className="card">
      <div className="card-header">HeyGen video — edits for rework</div>
      <p style={{ fontSize: 12, color: "var(--fg-secondary)", marginBottom: 12, lineHeight: 1.45 }}>
        Full spoken script (fed to HeyGen as <span className="font-mono">spoken_script</span>). Pair with{" "}
        <strong>Needs Edit</strong> — values are stored on the review row and applied on the next rework run (override
        path re-renders HeyGen when the script changes, or when you set avatar/voice ids / force re-render).
      </p>

      <div style={{ marginBottom: 12 }}>
        <label className="filter-label">Spoken script</label>
        <textarea
          value={editedScript}
          onChange={(e) => onEditedScriptChange(e.target.value)}
          rows={12}
          placeholder="Voiceover / narration script…"
          style={{ width: "100%", minHeight: 200, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 13 }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label className="filter-label">Avatar ID (optional)</label>
          <input
            type="text"
            value={heygenAvatarId}
            onChange={(e) => onHeygenAvatarIdChange(e.target.value)}
            placeholder="HeyGen avatar_id"
            className="font-mono"
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label className="filter-label">Voice ID (optional)</label>
          <input
            type="text"
            value={heygenVoiceId}
            onChange={(e) => onHeygenVoiceIdChange(e.target.value)}
            placeholder="HeyGen voice_id"
            className="font-mono"
            style={{ width: "100%" }}
          />
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13 }}>
        <input
          type="checkbox"
          checked={heygenForceRerender}
          onChange={(e) => onHeygenForceRerenderChange(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <strong>Re-render video (HeyGen)</strong> even if the script text is unchanged — use after avatar/voice-only
          tweaks or when you need a fresh encode.
        </span>
      </label>
    </div>
  );
}
