"use client";

export interface JobHealthBannerProps {
  state?: string | null;
  reasonCode?: string | null;
  message?: string | null;
  suggestedAction?: string | null;
  compact?: boolean;
}

function isAttentionState(state: string): boolean {
  return state === "blocked" || state === "failed" || state === "stuck" || state === "waiting_on_provider";
}

export function JobHealthBanner({
  state,
  reasonCode,
  message,
  suggestedAction,
  compact = false,
}: JobHealthBannerProps) {
  const s = String(state ?? "").trim().toLowerCase();
  if (!s || s === "healthy" || !isAttentionState(s)) return null;
  const msg = String(message ?? "").trim();
  const action = String(suggestedAction ?? "").trim();
  if (!msg && !action) return null;

  const label =
    s === "waiting_on_provider"
      ? "Waiting on provider"
      : s === "stuck"
        ? "Stuck"
        : s === "blocked"
          ? "Blocked"
          : "Failed";

  if (compact) {
    return (
      <span
        className={`job-health-badge job-health-badge--${s}`}
        title={[msg, action].filter(Boolean).join(" — ")}
      >
        {label}
      </span>
    );
  }

  return (
    <div className={`job-health-banner job-health-banner--${s}`} role="status">
      <p className="job-health-banner__label">{label}</p>
      {msg ? <p className="job-health-banner__message">{msg}</p> : null}
      {action ? <p className="job-health-banner__action">{action}</p> : null}
      {reasonCode ? <p className="job-health-banner__code">{reasonCode}</p> : null}
    </div>
  );
}
