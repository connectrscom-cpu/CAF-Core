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
import { usePathname, useRouter } from "next/navigation";
import { mergePreservedNavQuery } from "@/lib/preserved-nav-query";
import { clientSearchParams, useClientSearchQuery } from "@/lib/use-client-search-query";

const STORAGE_KEY = "caf-review-active-project";
const BRAND_ROUTE_RE = /^\/brand\/([^/]+)/;

export interface ReviewScopePayload {
  multiProject: boolean;
  lockedSlug: string;
  projects: string[];
}

export interface ReviewProjectContextValue {
  ready: boolean;
  multiProject: boolean;
  lockedSlug: string;
  /** Slug from `?project=` (legacy) or `/brand/[slug]` path. */
  activeProjectSlug: string;
  /** Same as activeProjectSlug when on a brand route. */
  activeBrandSlug: string;
  projectOptions: string[];
  /** True when pathname is under `/brand/[slug]`. */
  inBrandContext: boolean;
  setActiveProjectSlug: (slug: string) => void;
  /** Navigate to a brand-scoped path, preserving sub-route where possible. */
  switchBrand: (slug: string) => void;
  navHref: (path: string) => string;
  brandHref: (slug: string, subpath?: string) => string;
}

const ReviewProjectContext = createContext<ReviewProjectContextValue | null>(null);

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  return path.replace(/\/+$/, "") || "/";
}

function slugFromBrandPath(pathname: string): string {
  const m = pathname.match(BRAND_ROUTE_RE);
  return m?.[1] ? decodeURIComponent(m[1]) : "";
}

function brandSubpath(pathname: string, slug: string): string {
  const prefix = `/brand/${encodeURIComponent(slug)}`;
  if (!pathname.startsWith(prefix)) return "";
  const rest = pathname.slice(prefix.length);
  return rest || "";
}

/** Paths where we restore `project` from localStorage if the URL has none. */
function shouldOfferRestore(pathname: string): boolean {
  if (pathname === "/" || pathname === "/review") return true;
  if (pathname === "/workspace") return false;
  if (pathname.startsWith("/brand/")) return false;
  if (pathname === "/publish" || pathname.startsWith("/publish/")) return true;
  if (pathname === "/approved" || pathname.startsWith("/approved/")) return true;
  if (pathname === "/pipeline" || pathname.startsWith("/pipeline/")) return true;
  if (pathname === "/learning" || pathname.startsWith("/learning/")) return true;
  return (
    pathname.startsWith("/t/") ||
    pathname.startsWith("/content/") ||
    pathname === "/t/open" ||
    pathname === "/content/open"
  );
}

export function ReviewProjectProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchQuery = useClientSearchQuery();
  const searchParams = useMemo(() => clientSearchParams(searchQuery), [searchQuery]);
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [multiProject, setMultiProject] = useState(false);
  const [lockedSlug, setLockedSlug] = useState("");
  const [projectOptions, setProjectOptions] = useState<string[]>([]);

  const brandSlugFromPath = slugFromBrandPath(pathname);
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

  const activeBrandSlug = brandSlugFromPath;
  const inBrandContext = !!activeBrandSlug;
  const activeProjectSlug = activeBrandSlug || (multiProject ? projectFromUrl : lockedSlug);

  const brandHref = useCallback((slug: string, subpath = "") => {
    const trimmed = subpath.trim();
    const path = trimmed
      ? `/brand/${encodeURIComponent(slug)}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`
      : `/brand/${encodeURIComponent(slug)}`;
    return path;
  }, []);

  const switchBrand = useCallback(
    (slug: string) => {
      const trimmed = slug.trim();
      if (!trimmed) {
        router.push("/workspace");
        return;
      }
      try {
        localStorage.setItem(STORAGE_KEY, trimmed);
      } catch {
        /* ignore */
      }
      if (inBrandContext && activeBrandSlug) {
        const sub = brandSubpath(pathname, activeBrandSlug) || "";
        router.push(brandHref(trimmed, sub));
      } else {
        router.push(brandHref(trimmed));
      }
    },
    [router, inBrandContext, activeBrandSlug, pathname, brandHref]
  );

  const setActiveProjectSlug = useCallback(
    (slug: string) => {
      const trimmed = slug.trim();
      if (inBrandContext) {
        switchBrand(trimmed);
        return;
      }
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
    [inBrandContext, switchBrand, pathname, router, searchParams]
  );

  useEffect(() => {
    if (!ready || !multiProject || restoreAttempted.current) return;
    if (projectFromUrl || inBrandContext) {
      restoreAttempted.current = true;
      return;
    }
    if (!shouldOfferRestore(pathname)) {
      restoreAttempted.current = true;
      return;
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY)?.trim();
      if (stored && stored !== projectFromUrl) {
        const next = new URLSearchParams(searchQuery);
        next.set("project", stored);
        next.delete("page");
        const qs = next.toString();
        const target = qs ? `${pathname}?${qs}` : pathname;
        const current = searchQuery ? `${pathname}?${searchQuery}` : pathname;
        if (target !== current) {
          router.replace(target, { scroll: false });
        }
      }
    } catch {
      /* ignore */
    }
    restoreAttempted.current = true;
  }, [ready, multiProject, projectFromUrl, inBrandContext, pathname, router, searchQuery]);

  const navHref = useCallback(
    (path: string) => {
      const raw = path.trim() || "/";
      const [p, existingQs] = raw.split("?");
      const base = normalizePath(p);
      const merged = new URLSearchParams(existingQs ?? "");
      if (inBrandContext && activeBrandSlug) {
        merged.delete("project");
      } else if (multiProject && activeProjectSlug) {
        merged.set("project", activeProjectSlug);
      } else {
        merged.delete("project");
      }
      mergePreservedNavQuery(merged, searchParams);
      const qs = merged.toString();
      return qs ? `${base}?${qs}` : base;
    },
    [inBrandContext, activeBrandSlug, multiProject, activeProjectSlug, searchQuery]
  );

  const value = useMemo<ReviewProjectContextValue>(
    () => ({
      ready,
      multiProject,
      lockedSlug,
      activeProjectSlug,
      activeBrandSlug,
      projectOptions,
      inBrandContext,
      setActiveProjectSlug,
      switchBrand,
      navHref,
      brandHref,
    }),
    [
      ready,
      multiProject,
      lockedSlug,
      activeProjectSlug,
      activeBrandSlug,
      projectOptions,
      inBrandContext,
      setActiveProjectSlug,
      switchBrand,
      navHref,
      brandHref,
    ]
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
