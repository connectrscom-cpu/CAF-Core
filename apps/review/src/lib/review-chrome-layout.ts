"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "caf-review-chrome-v1";

export type ReviewChromeLayout = {
  /** CAF Core admin dashboard left nav (`.sb`). */
  hideAdminNav: boolean;
  /** Review app sidebar (operator or marketer). */
  hideReviewSidebar: boolean;
  hideWorkbenchFilters: boolean;
};

const DEFAULT: ReviewChromeLayout = {
  hideAdminNav: false,
  hideReviewSidebar: false,
  hideWorkbenchFilters: false,
};

type LayoutListener = (layout: ReviewChromeLayout) => void;
const layoutListeners = new Set<LayoutListener>();

function readStorage(): ReviewChromeLayout {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<ReviewChromeLayout> & { hideSidebar?: boolean };
    const legacyHide = Boolean(parsed.hideSidebar);
    return {
      hideAdminNav:
        parsed.hideAdminNav !== undefined ? Boolean(parsed.hideAdminNav) : legacyHide,
      hideReviewSidebar:
        parsed.hideReviewSidebar !== undefined ? Boolean(parsed.hideReviewSidebar) : legacyHide,
      hideWorkbenchFilters: Boolean(parsed.hideWorkbenchFilters),
    };
  } catch {
    return DEFAULT;
  }
}

function writeStorage(layout: ReviewChromeLayout) {
  try {
    const payload = {
      hideAdminNav: layout.hideAdminNav,
      hideReviewSidebar: layout.hideReviewSidebar,
      hideWorkbenchFilters: layout.hideWorkbenchFilters,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

function emitLayout(layout: ReviewChromeLayout) {
  for (const listener of layoutListeners) listener(layout);
}

/** Apply layout from admin parent or another hook instance. */
export function applyReviewChromeLayout(patch: Partial<ReviewChromeLayout>) {
  const next = { ...readStorage(), ...patch };
  writeStorage(next);
  emitLayout(next);
  return next;
}

export function useReviewChromeLayout() {
  const [layout, setLayoutState] = useState<ReviewChromeLayout>(DEFAULT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = (next: ReviewChromeLayout) => {
      setLayoutState(next);
      setReady(true);
    };
    sync(readStorage());
    layoutListeners.add(sync);

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) sync(readStorage());
    };
    window.addEventListener("storage", onStorage);

    return () => {
      layoutListeners.delete(sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setLayout = useCallback((patch: Partial<ReviewChromeLayout>) => {
    applyReviewChromeLayout(patch);
    setLayoutState(readStorage());
  }, []);

  const toggleSidebar = useCallback(() => {
    const cur = readStorage();
    setLayout({ hideReviewSidebar: !cur.hideReviewSidebar });
  }, [setLayout]);

  const openSidebar = useCallback(() => {
    setLayout({ hideReviewSidebar: false });
  }, [setLayout]);

  const closeSidebar = useCallback(() => {
    setLayout({ hideReviewSidebar: true });
  }, [setLayout]);

  const toggleWorkbenchFilters = useCallback(() => {
    const cur = readStorage();
    setLayout({ hideWorkbenchFilters: !cur.hideWorkbenchFilters });
  }, [setLayout]);

  const setFocusMode = useCallback(
    (on: boolean) => {
      setLayout({ hideReviewSidebar: on, hideWorkbenchFilters: on });
    },
    [setLayout]
  );

  return {
    layout,
    ready,
    setLayout,
    toggleSidebar,
    openSidebar,
    closeSidebar,
    toggleWorkbenchFilters,
    setFocusMode,
  };
}
