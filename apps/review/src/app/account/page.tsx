"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type AccountPayload = {
  account: {
    slug: string;
    display_name: string;
    account_type: string;
    max_projects: number;
    max_members: number;
    project_count: number;
    member_count: number;
  };
  me: { role: string };
  members: Array<{ user_id: string; email: string; display_name: string | null; role: string }>;
  invites: Array<{ id: string; email: string; role: string; expires_at: string }>;
};

type MeResponse = {
  authenticated: boolean;
  accounts: Array<{ slug: string; display_name: string; role: string }>;
  projects: Array<{ slug: string; display_name: string | null; account_slug: string }>;
};

export default function AccountPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [accountSlug, setAccountSlug] = useState("");
  const [data, setData] = useState<AccountPayload | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignProject, setAssignProject] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adminAccounts = useMemo(
    () => (me?.accounts ?? []).filter((a) => a.role === "owner" || a.role === "admin"),
    [me]
  );

  function loadMe() {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j: MeResponse & { ok?: boolean }) => {
        setMe(j);
        if (!accountSlug && j.accounts?.[0]?.slug) setAccountSlug(j.accounts[0].slug);
      })
      .catch(() => setMe({ authenticated: false, accounts: [], projects: [] }));
  }

  function loadAccount(slug: string) {
    if (!slug) return;
    fetch(`/api/account?account=${encodeURIComponent(slug)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error ?? "Failed to load account");
        setData(j as AccountPayload);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }

  useEffect(() => {
    loadMe();
  }, []);

  useEffect(() => {
    if (accountSlug) loadAccount(accountSlug);
  }, [accountSlug]);

  const isAdmin = data?.me.role === "owner" || data?.me.role === "admin";
  const accountProjects = (me?.projects ?? []).filter((p) => p.account_slug === accountSlug);

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setInviteLink(null);
    const res = await fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: accountSlug, email: inviteEmail, role: inviteRole }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) {
      setError(j.error === "member_cap_reached" ? "Member seat limit reached" : j.error ?? "Invite failed");
      return;
    }
    const path = j.invite?.accept_path as string | undefined;
    const token = j.invite?.token as string | undefined;
    const link = path ? `${window.location.origin}${path}` : token ? `${window.location.origin}/invite/${token}` : null;
    setInviteLink(link);
    setMessage(`Invite created for ${inviteEmail}. Share the link below (email delivery not wired yet).`);
    setInviteEmail("");
    loadAccount(accountSlug);
  }

  async function assignProjectMember(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const res = await fetch("/api/account/project-members", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: accountSlug,
        project: assignProject,
        user_id: assignUserId,
      }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) {
      setError(j.error ?? "Could not assign project");
      return;
    }
    setMessage("Project assignment saved. Members only see brands they are assigned to.");
  }

  if (me && !me.authenticated) {
    return (
      <div className="workspace-page">
        <header className="workspace-hero">
          <div>
            <h1>Account</h1>
            <p className="workspace-lead">
              <Link href="/login">Sign in</Link> to manage invites and project access.
            </p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="workspace-page account-page">
      <header className="workspace-hero">
        <div>
          <h1>Account access</h1>
          <p className="workspace-lead">
            Invite teammates to Review and assign social managers to specific brands. Connectrs owns existing
            production projects.
          </p>
        </div>
      </header>

      {adminAccounts.length > 1 ? (
        <label className="account-select">
          Account
          <select value={accountSlug} onChange={(e) => setAccountSlug(e.target.value)}>
            {adminAccounts.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.display_name} ({a.role})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {error ? <p className="auth-error">{error}</p> : null}
      {message ? <p className="account-ok">{message}</p> : null}
      {inviteLink ? (
        <p className="account-invite-link">
          Invite link: <code>{inviteLink}</code>
        </p>
      ) : null}

      {data ? (
        <section className="account-panel">
          <h2>{data.account.display_name}</h2>
          <p className="workspace-lead">
            {data.account.account_type} · {data.account.project_count}/{data.account.max_projects} projects ·{" "}
            {data.account.member_count}/{data.account.max_members} members · your role: {data.me.role}
          </p>

          <h3>Members</h3>
          <ul className="account-list">
            {data.members.map((m) => (
              <li key={m.user_id}>
                <span>{m.display_name || m.email}</span>
                <span className="muted">{m.role}</span>
              </li>
            ))}
          </ul>

          {isAdmin ? (
            <>
              <h3>Invite user</h3>
              <form className="account-form" onSubmit={sendInvite}>
                <input
                  type="email"
                  required
                  placeholder="teammate@agency.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}>
                  <option value="member">Member (assigned brands only)</option>
                  <option value="admin">Admin (all account brands)</option>
                </select>
                <button type="submit" className="btn-primary">
                  Create invite
                </button>
              </form>

              {data.invites.length ? (
                <>
                  <h3>Pending invites</h3>
                  <ul className="account-list">
                    {data.invites.map((i) => (
                      <li key={i.id}>
                        <span>{i.email}</span>
                        <span className="muted">{i.role}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              <h3>Assign brand access</h3>
              <form className="account-form" onSubmit={assignProjectMember}>
                <select required value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
                  <option value="">Select member</option>
                  {data.members
                    .filter((m) => m.role === "member")
                    .map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.email}
                      </option>
                    ))}
                </select>
                <select required value={assignProject} onChange={(e) => setAssignProject(e.target.value)}>
                  <option value="">Select brand</option>
                  {accountProjects.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.display_name || p.slug}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn-primary">
                  Assign
                </button>
              </form>
            </>
          ) : (
            <p className="workspace-lead">Ask an account admin to invite users or assign brands.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
