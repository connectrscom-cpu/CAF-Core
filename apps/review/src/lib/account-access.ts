import { cookies } from "next/headers";
import { CAF_CORE_TOKEN, CAF_CORE_URL } from "./env";
import { CAF_SESSION_COOKIE } from "./auth-session";

function coreHeaders(sessionToken?: string | null, withJson = true): Record<string, string> {
  const h: Record<string, string> = withJson
    ? { "Content-Type": "application/json", Accept: "application/json" }
    : { Accept: "application/json" };
  if (CAF_CORE_TOKEN) h["x-caf-core-token"] = CAF_CORE_TOKEN;
  if (sessionToken) h["x-caf-session-token"] = sessionToken;
  return h;
}

export async function getSessionTokenFromCookies(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(CAF_SESSION_COOKIE)?.value ?? null;
}

export async function coreAuthFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown; sessionToken?: string | null }
): Promise<{ status: number; json: T }> {
  const sessionToken = init?.sessionToken ?? (await getSessionTokenFromCookies());
  const method = init?.method ?? "GET";
  const res = await fetch(`${CAF_CORE_URL.replace(/\/$/, "")}${path}`, {
    method,
    headers: coreHeaders(sessionToken, method !== "GET" && method !== "DELETE"),
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, json };
}

export type AuthMeResponse = {
  ok: boolean;
  auth_enforced?: boolean;
  user?: { id: string; email: string; display_name: string | null };
  accounts?: Array<{
    id: string;
    slug: string;
    display_name: string;
    account_type: string;
    role: string;
  }>;
  projects?: Array<{
    slug: string;
    display_name: string | null;
    account_slug: string;
    access: string;
  }>;
  project_slugs?: string[];
  error?: string;
};

export async function fetchAuthMe(sessionToken?: string | null): Promise<AuthMeResponse | null> {
  const { status, json } = await coreAuthFetch<AuthMeResponse>("/v1/auth/me", { sessionToken });
  if (status === 401) return null;
  if (!json.ok) return null;
  return json;
}

export async function fetchAuthStatus(): Promise<{
  auth_enforced: boolean;
  signup_enabled: boolean;
}> {
  const { json } = await coreAuthFetch<{
    ok: boolean;
    auth_enforced?: boolean;
    signup_enabled?: boolean;
  }>("/v1/auth/status");
  return {
    auth_enforced: !!json.auth_enforced,
    signup_enabled: json.signup_enabled !== false,
  };
}

export async function assertProjectAccess(projectSlug: string): Promise<{
  allowed: boolean;
  enforced: boolean;
  status: number;
}> {
  const { status, json } = await coreAuthFetch<{
    ok?: boolean;
    allowed?: boolean;
    enforced?: boolean;
    error?: string;
  }>(`/v1/auth/access/${encodeURIComponent(projectSlug)}`);
  return {
    allowed: status < 400 && json.allowed !== false,
    enforced: !!json.enforced,
    status,
  };
}
