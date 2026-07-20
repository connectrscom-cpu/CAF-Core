"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<"personal" | "agency">("personal");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName || undefined,
          account_name: accountName || (accountType === "personal" ? `${displayName || "My"} workspace` : "My agency"),
          account_type: accountType,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        throw new Error(
          j.error === "email_taken"
            ? "That email is already registered"
            : j.error === "signup_disabled"
              ? "Signup is disabled on this deploy"
              : "Could not create account"
        );
      }
      router.push("/workspace");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <p className="auth-brand">CAF</p>
        <h1>Create account</h1>
        <p className="auth-lead">Personal (few brands) or agency (team + project caps).</p>
        {error ? <p className="auth-error">{error}</p> : null}
        <div className="auth-type-row">
          <button
            type="button"
            className={accountType === "personal" ? "auth-type active" : "auth-type"}
            onClick={() => setAccountType("personal")}
          >
            Personal
          </button>
          <button
            type="button"
            className={accountType === "agency" ? "auth-type active" : "auth-type"}
            onClick={() => setAccountType("agency")}
          >
            Agency
          </button>
        </div>
        <label>
          Your name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label>
          {accountType === "agency" ? "Agency name" : "Workspace name"}
          <input
            required
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder={accountType === "agency" ? "Acme Marketing" : "My brands"}
          />
        </label>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password (min 8)
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Creating…" : "Create account"}
        </button>
        <p className="auth-footer">
          Already have access? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
