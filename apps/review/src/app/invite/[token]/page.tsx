"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type InviteInfo = {
  email: string;
  role: string;
  account_display_name?: string;
  account_slug?: string;
};

export default function AcceptInvitePage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const router = useRouter();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/auth/invite-info?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error ?? "Invite not found");
        setInvite(j.invite);
      })
      .catch((e) => setBootError(e instanceof Error ? e.message : "Invite unavailable"));
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password: password || undefined,
          display_name: displayName || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Could not accept invite");
      router.push("/workspace");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accept failed");
    } finally {
      setLoading(false);
    }
  }

  if (bootError) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="auth-brand">CAF</p>
          <h1>Invite unavailable</h1>
          <p className="auth-lead">{bootError}</p>
          <p className="auth-footer">
            <Link href="/login">Sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="auth-brand">CAF</p>
          <p className="auth-lead">Loading invite…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <p className="auth-brand">CAF</p>
        <h1>Join {invite.account_display_name ?? "workspace"}</h1>
        <p className="auth-lead">
          Invited as <strong>{invite.role}</strong> · {invite.email}
        </p>
        {error ? <p className="auth-error">{error}</p> : null}
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label>
          Set password (if new user)
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Joining…" : "Accept invite"}
        </button>
      </form>
    </div>
  );
}
