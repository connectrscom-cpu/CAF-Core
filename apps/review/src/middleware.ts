import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CAF_SESSION_COOKIE } from "@/lib/auth-session";

/** Keep in sync with `lib/task-links.ts` LONG_TASK_ID_PATH_THRESHOLD (inline for Edge bundle). */
const LONG_TASK_ID_PATH_THRESHOLD = 72;

const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/invite",
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/accept-invite",
  "/api/auth/invite-info",
  "/api/auth/me",
  "/api/auth/logout",
  "/api/health",
  "/_next",
  "/favicon",
  "/setup",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function redirectLongTaskSegment(request: NextRequest): NextResponse | null {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname.startsWith("/t/open") || pathname.startsWith("/content/open")) return null;

  const rules: { prefix: string; openPath: string }[] = [
    { prefix: "/t/", openPath: "/t/open" },
    { prefix: "/content/", openPath: "/content/open" },
  ];

  for (const { prefix, openPath } of rules) {
    if (!pathname.startsWith(prefix)) continue;
    const restEncoded = pathname.slice(prefix.length);
    if (!restEncoded) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(restEncoded);
    } catch {
      decoded = restEncoded;
    }
    if (decoded.length < LONG_TASK_ID_PATH_THRESHOLD) continue;

    const q = new URLSearchParams(searchParams);
    q.set("task_id", decoded);
    const url = request.nextUrl.clone();
    url.pathname = openPath;
    url.search = q.toString();
    return NextResponse.redirect(url);
  }

  return null;
}

function authEnforced(): boolean {
  // Default ON when unset (matches Core). Explicit 0/false/no/off disables.
  const raw = (process.env.CAF_ACCOUNT_AUTH_ENFORCED ?? "1").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return true;
}

/** Prefer public Fly host over the embedded Review sidecar (127.0.0.1:3000). */
function publicOrigin(request: NextRequest): string {
  const xfHost = (request.headers.get("x-forwarded-host") || "").split(",")[0]?.trim();
  const host = xfHost || (request.headers.get("host") || "").split(",")[0]?.trim();
  const xfProto = (request.headers.get("x-forwarded-proto") || "").split(",")[0]?.trim();
  const isLoopback =
    !host ||
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.endsWith(":3000");

  if (host && !isLoopback) {
    const proto = xfProto || (host.includes("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.CAF_PUBLIC_URL || "").replace(/\/$/, "");
  if (appUrl && !/localhost:3000|127\.0\.0\.1:3000/i.test(appUrl)) {
    return appUrl;
  }

  // Production fallback for this deploy
  if (process.env.NODE_ENV === "production") {
    return "https://caf-core.fly.dev";
  }

  return request.nextUrl.origin;
}

export function middleware(request: NextRequest) {
  const redirected = redirectLongTaskSegment(request);
  if (redirected) return redirected;

  const { pathname } = request.nextUrl;
  if (pathname === "/publish" || pathname.startsWith("/publish/")) {
    const res = NextResponse.next();
    res.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    // Fall through — still require login when auth is enforced.
  }

  if (authEnforced() && !isPublicPath(pathname)) {
    const session = request.cookies.get(CAF_SESSION_COOKIE)?.value;
    if (!session) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
      const nextPath = pathname === "/" ? "/workspace" : `${pathname}${request.nextUrl.search}`;
      const loginUrl = new URL("/login", publicOrigin(request));
      loginUrl.searchParams.set("next", nextPath);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/workspace",
    "/workspace/:path*",
    "/brand/:path*",
    "/account",
    "/account/:path*",
    "/learning",
    "/learning/:path*",
    "/review",
    "/review/:path*",
    "/runs",
    "/runs/:path*",
    "/pipeline",
    "/pipeline/:path*",
    "/publish",
    "/publish/:path*",
    "/approved",
    "/flow-engine",
    "/settings/:path*",
    "/t/:path*",
    "/content/:path*",
    "/r/:path*",
    "/login",
    "/signup",
    "/invite/:path*",
    "/api/:path*",
  ],
};
