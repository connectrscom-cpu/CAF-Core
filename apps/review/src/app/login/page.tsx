"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/workspace";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        throw new Error(j.error === "invalid_credentials" ? "Wrong email or password" : "Login failed");
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={onSubmit}>
      <p className="auth-brand">CAF</p>
      <h1>Sign in</h1>
      <p className="auth-lead">Access your agency or personal workspace.</p>
      {error ? <p className="auth-error">{error}</p> : null}
      <label>
        Email
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
      <p className="auth-footer">
        New here? <Link href="/signup">Create a personal or agency account</Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="auth-page">
      <Suspense fallback={<div className="auth-card"><p className="auth-lead">Loading…</p></div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
