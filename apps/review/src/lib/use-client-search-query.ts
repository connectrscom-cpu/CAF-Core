"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

function readSearchQuery(): string {
  if (typeof window === "undefined") return "";
  return window.location.search.replace(/^\?/, "");
}

let searchQuerySnapshot = "";
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return searchQuerySnapshot;
}

function getServerSnapshot() {
  return "";
}

let navigationHookInstalled = false;

function ensureNavigationHook() {
  if (navigationHookInstalled || typeof window === "undefined") return;
  navigationHookInstalled = true;
  searchQuerySnapshot = readSearchQuery();
  window.addEventListener("popstate", () => {
    searchQuerySnapshot = readSearchQuery();
    emit();
  });
}

function syncSearchQueryFromWindow() {
  const next = readSearchQuery();
  if (next === searchQuerySnapshot) return;
  searchQuerySnapshot = next;
  emit();
}

/**
 * Browser search string (no leading `?`) synced after route changes.
 * Do not use `useSearchParams()` in app shells — it suspends layout during transitions.
 * Never patch `history.pushState` here; multiple mounts broke Next.js Link navigation.
 */
export function useClientSearchQuery(): string {
  const pathname = usePathname();
  ensureNavigationHook();

  useEffect(() => {
    syncSearchQueryFromWindow();
  }, [pathname]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function clientSearchParams(searchQuery: string): URLSearchParams {
  return new URLSearchParams(searchQuery);
}
