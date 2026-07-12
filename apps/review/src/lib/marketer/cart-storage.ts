import type { ContentCartItem } from "./types";

export interface BriefCartSnapshot {
  packId: string;
  items: ContentCartItem[];
  updatedAt: string;
}

const activeBriefKey = (slug: string) => `caf-review-active-brief-pack-${slug}`;
const cartKey = (slug: string, packId: string) => `caf-review-content-cart-${slug}--${packId}`;
const pendingCartKey = (slug: string) => `caf-review-content-cart-pending-${slug}`;
const legacyCartKey = (slug: string) => `caf-review-content-cart-${slug}`;

export function readActiveBriefPackId(slug: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(activeBriefKey(slug));
  } catch {
    return null;
  }
}

export function writeActiveBriefPackId(slug: string, packId: string) {
  try {
    localStorage.setItem(activeBriefKey(slug), packId);
  } catch {
    /* ignore */
  }
}

export function clearActiveBriefPackId(slug: string) {
  try {
    localStorage.removeItem(activeBriefKey(slug));
  } catch {
    /* ignore */
  }
}

export function readBriefCart(slug: string, packId: string): ContentCartItem[] {
  if (typeof window === "undefined" || !packId) return [];
  try {
    const raw = localStorage.getItem(cartKey(slug, packId));
    if (raw) {
      const parsed = JSON.parse(raw) as BriefCartSnapshot | ContentCartItem[];
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
    }
    const legacy = localStorage.getItem(legacyCartKey(slug));
    if (legacy) {
      const items = JSON.parse(legacy) as ContentCartItem[];
      if (Array.isArray(items) && items.length) {
        writeBriefCart(slug, packId, items);
        localStorage.removeItem(legacyCartKey(slug));
        return items;
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function writeBriefCart(slug: string, packId: string, items: ContentCartItem[]) {
  if (!packId) return;
  try {
    const snapshot: BriefCartSnapshot = {
      packId,
      items,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(cartKey(slug, packId), JSON.stringify(snapshot));
    if (items.length) localStorage.removeItem(pendingCartKey(slug));
  } catch {
    /* ignore */
  }
}

export function readPendingCart(slug: string): ContentCartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(pendingCartKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BriefCartSnapshot | ContentCartItem[];
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
  } catch {
    /* ignore */
  }
  return [];
}

export function writePendingCart(slug: string, items: ContentCartItem[]) {
  try {
    if (!items.length) {
      localStorage.removeItem(pendingCartKey(slug));
      return;
    }
    const snapshot: BriefCartSnapshot = {
      packId: "",
      items,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(pendingCartKey(slug), JSON.stringify(snapshot));
  } catch {
    /* ignore */
  }
}
