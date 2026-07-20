"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type AuthState = {
  authenticated: boolean;
  user: { email: string; display_name: string | null } | null;
  accounts: Array<{ slug: string; display_name: string; role: string }>;
};

export function AuthAccountMenu() {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) =>
        setAuth({
          authenticated: !!j.authenticated,
          user: j.user ?? null,
          accounts: j.accounts ?? [],
        })
      )
      .catch(() => setAuth({ authenticated: false, user: null, accounts: [] }));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (!auth) return null;

  if (!auth.authenticated) {
    return (
      <div className="auth-menu">
        <Link href="/login" className="auth-menu-link">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="auth-menu">
      <Link href="/account" className="auth-menu-link" title={auth.user?.email}>
        {auth.user?.display_name || auth.user?.email || "Account"}
      </Link>
      <button type="button" className="auth-menu-btn" onClick={logout}>
        Sign out
      </button>
    </div>
  );
}
