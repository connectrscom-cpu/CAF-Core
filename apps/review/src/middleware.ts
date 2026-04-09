import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Keep in sync with `lib/task-links.ts` LONG_TASK_ID_PATH_THRESHOLD (inline for Edge bundle). */
const LONG_TASK_ID_PATH_THRESHOLD = 72;

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

export function middleware(request: NextRequest) {
  return redirectLongTaskSegment(request) ?? NextResponse.next();
}

export const config = {
  matcher: ["/t/:path*", "/content/:path*"],
};
