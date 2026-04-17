"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const STORAGE_KEY = "caf-review-active-project";

export interface ReviewScopePayload {
  multiProject: boolean;
  lockedSlug: string;
  projects: string[];
}

export interface ReviewProjectContextValue {
  ready: boolean;
  multiProject: boolean;
  /** Tenant fixed by env when not multi-project. */
  lockedSlug: string;
  /** Empty string = all projects (multi mode only). */
  activeProjectSlug: string;
  projectOptions: string[];
  setActiveProjectSlug: (slug: string) => void;
  /** Append `project` query when a tenant is pinned (for nav links). */
  navHref: (path: string) => string;
}

const ReviewProjectContext = createContext<ReviewProjectContextValue | null>(null);

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  return path.replace(/\/+$/, "") || "/";
}

/** Paths where we restore `project` from localStorage if the URL has none. */
function shouldOfferRestore(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/publish" || pathname.startsWith("/publish/")) return true;
  if (pathname === "/approved" || pathname.startsWith("/approved/")) return true;
  return (
    pathname.startsWith("/t/") ||
    pathname.startsWith("/content/") ||
    pathname === "/t/open" ||
    pathname === "/content/open"
  );
}

export function ReviewProjectProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [multiProject, setMultiProject] = useState(false);
  const [lockedSlug, setLockedSlug] = useState("");
  const [projectOptions, setProjectOptions] = useState<string[]>([]);

  const projectFromUrl = searchParams.get("project")?.trim() ?? "";
  const restoreAttempted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/review-scope")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ReviewScopePayload | null) => {
        if (cancelled || !j) return;
        setMultiProject(!!j.multiProject);
        setLockedSlug((j.lockedSlug ?? "").trim());
        setProjectOptions(Array.isArray(j.projects) ? j.projects.filter(Boolean) : []);
      })
      .catch(() => {
        if (!cancelled) {
          setMultiProject(false);
          setLockedSlug("");
          setProjectOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setActiveProjectSlug = useCallback(
    (slug: string) => {
      const trimmed = slug.trim();
      const next = new URLSearchParams(searchParams.toString());
      if (!trimmed) next.delete("project");
      else next.set("project", trimmed);
      next.delete("page");
      try {
        if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
        else localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (!ready || !multiProject || restoreAttempted.current) return;
    if (projectFromUrl) {
      restoreAttempted.current = true;
      return;
    }
    if (!shouldOfferRestore(pathname)) {
      restoreAttempted.current = true;
      return;
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY)?.trim();
      if (stored) {
        const next = new URLSearchParams(searchParams.toString());
        next.set("project", stored);
        next.delete("page");
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }
    } catch {
      /* ignore */
    }
    restoreAttempted.current = true;
  }, [ready, multiProject, projectFromUrl, pathname, router, searchParams]);

  const activeProjectSlug = multiProject ? projectFromUrl : "";

  const navHref = useCallback(
    (path: string) => {
      const raw = path.trim() || "/";
      const [p, existingQs] = raw.split("?");
      const base = normalizePath(p);
      const merged = new URLSearchParams(existingQs ?? "");
      if (multiProject && activeProjectSlug) merged.set("project", activeProjectSlug);
      else merged.delete("project");
      const qs = merged.toString();
      return qs ? `${base}?${qs}` : base;
    },
    [multiProject, activeProjectSlug]
  );

  const value = useMemo<ReviewProjectContextValue>(
    () => ({
      ready,
      multiProject,
      lockedSlug,
      activeProjectSlug,
      projectOptions,
      setActiveProjectSlug,
      navHref,
    }),
    [ready, multiProject, lockedSlug, activeProjectSlug, projectOptions, setActiveProjectSlug, navHref]
  );

  return <ReviewProjectContext.Provider value={value}>{children}</ReviewProjectContext.Provider>;
}

export function useReviewProject(): ReviewProjectContextValue {
  const ctx = useContext(ReviewProjectContext);
  if (!ctx) {
    throw new Error("useReviewProject must be used within ReviewProjectProvider");
  }
  return ctx;
}
