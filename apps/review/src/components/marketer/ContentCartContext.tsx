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
import { normalizeCartItemFlow } from "@/lib/marketer/cart-flow-resolve";
import {
  clearActiveBriefPackId,
  readActiveBriefPackId,
  readBriefCart,
  readPendingCart,
  writeActiveBriefPackId,
  writeBriefCart,
  writePendingCart,
} from "@/lib/marketer/cart-storage";
import type { ContentCartItem } from "@/lib/marketer/types";

interface ContentCartContextValue {
  items: ContentCartItem[];
  count: number;
  briefPackId: string | null;
  /** @deprecated Prefer attachBriefPackId / detachBriefPackId */
  setBriefPackId: (packId: string | null) => void;
  attachBriefPackId: (packId: string, opts?: { keepItems?: boolean }) => void;
  detachBriefPackId: () => void;
  addIdea: (item: Omit<ContentCartItem, "kind">, opts?: { packId?: string }) => boolean;
  addTopPerformer: (item: Omit<ContentCartItem, "kind"> & { mimicMode?: ContentCartItem["mimicMode"]; renderMode?: ContentCartItem["renderMode"] }, opts?: { packId?: string }) => boolean;
  removeItem: (id: string) => void;
  updateItem: (id: string, patch: Partial<ContentCartItem>) => void;
  clear: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  reviewOpen: boolean;
  setReviewOpen: (open: boolean) => void;
}

const ContentCartContext = createContext<ContentCartContextValue | null>(null);

export function ContentCartProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [briefPackId, setBriefPackIdState] = useState<string | null>(null);
  const [items, setItems] = useState<ContentCartItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    const storedPack = readActiveBriefPackId(slug);
    if (storedPack) {
      setBriefPackIdState(storedPack);
      const saved = readBriefCart(slug, storedPack).map(normalizeCartItemFlow);
      setItems(saved.length ? saved : readPendingCart(slug).map(normalizeCartItemFlow));
    } else {
      setItems(readPendingCart(slug).map(normalizeCartItemFlow));
    }
  }, [slug]);

  const persist = useCallback(
    (next: ContentCartItem[], packId = briefPackId) => {
      const normalized = next.map(normalizeCartItemFlow);
      setItems(normalized);
      if (packId) writeBriefCart(slug, packId, normalized);
      else writePendingCart(slug, normalized);
    },
    [slug, briefPackId]
  );

  const detachBriefPackId = useCallback(() => {
    clearActiveBriefPackId(slug);
    setBriefPackIdState(null);
    setItems((current) => {
      writePendingCart(slug, current);
      return current;
    });
  }, [slug]);

  const attachBriefPackId = useCallback(
    (packId: string, opts?: { keepItems?: boolean }) => {
      const next = packId && packId !== "all" ? packId : null;
      if (!next) {
        detachBriefPackId();
        return;
      }
      setBriefPackIdState(next);
      writeActiveBriefPackId(slug, next);
      setItems((current) => {
        const loaded = readBriefCart(slug, next).map(normalizeCartItemFlow);
        const resolved = opts?.keepItems ? current : loaded.length ? loaded : current;
        writeBriefCart(slug, next, resolved);
        return resolved;
      });
    },
    [slug, detachBriefPackId]
  );

  const setBriefPackId = useCallback(
    (packId: string | null) => {
      if (packId && packId !== "all") attachBriefPackId(packId);
      else detachBriefPackId();
    },
    [attachBriefPackId, detachBriefPackId]
  );

  const addIdea = useCallback(
    (item: Omit<ContentCartItem, "kind">, opts?: { packId?: string }) => {
      const targetPackId =
        opts?.packId && opts.packId !== "all" ? opts.packId : briefPackId;
      if (!targetPackId) return false;

      const row = normalizeCartItemFlow({ ...item, kind: "idea" });
      const next = [...items.filter((x) => x.id !== row.id), row];

      if (targetPackId !== briefPackId) {
        const loaded = readBriefCart(slug, targetPackId).map(normalizeCartItemFlow);
        const merged = loaded.length
          ? [...loaded.filter((x) => x.id !== row.id), row]
          : next;
        setBriefPackIdState(targetPackId);
        writeActiveBriefPackId(slug, targetPackId);
        writeBriefCart(slug, targetPackId, merged);
        writePendingCart(slug, []);
        setItems(merged);
      } else {
        persist(next, targetPackId);
      }
      setDrawerOpen(true);
      return true;
    },
    [slug, briefPackId, items, persist]
  );

  const addTopPerformer = useCallback(
    (item: Omit<ContentCartItem, "kind"> & { mimicMode?: ContentCartItem["mimicMode"]; renderMode?: ContentCartItem["renderMode"] }, opts?: { packId?: string }) => {
      const targetPackId =
        opts?.packId && opts.packId !== "all" ? opts.packId : briefPackId;
      if (!targetPackId) return false;

      const row = normalizeCartItemFlow({ ...item, kind: "top_performer" });
      const next = [...items.filter((x) => x.id !== row.id), row];

      if (targetPackId !== briefPackId) {
        const loaded = readBriefCart(slug, targetPackId).map(normalizeCartItemFlow);
        const merged = loaded.length
          ? [...loaded.filter((x) => x.id !== row.id), row]
          : next;
        setBriefPackIdState(targetPackId);
        writeActiveBriefPackId(slug, targetPackId);
        writeBriefCart(slug, targetPackId, merged);
        writePendingCart(slug, []);
        setItems(merged);
      } else {
        persist(next, targetPackId);
      }
      setDrawerOpen(true);
      return true;
    },
    [slug, briefPackId, items, persist]
  );

  const removeItem = useCallback(
    (id: string) => {
      persist(items.filter((x) => x.id !== id));
    },
    [items, persist]
  );

  const updateItem = useCallback(
    (id: string, patch: Partial<ContentCartItem>) => {
      persist(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    },
    [items, persist]
  );

  const clear = useCallback(() => {
    writePendingCart(slug, []);
    persist([]);
  }, [persist, slug]);

  const value = useMemo(
    () => ({
      items,
      count: items.length,
      briefPackId,
      setBriefPackId,
      attachBriefPackId,
      detachBriefPackId,
      addIdea,
      addTopPerformer,
      removeItem,
      updateItem,
      clear,
      drawerOpen,
      setDrawerOpen,
      reviewOpen,
      setReviewOpen,
    }),
    [items, briefPackId, setBriefPackId, attachBriefPackId, detachBriefPackId, addIdea, addTopPerformer, removeItem, updateItem, clear, drawerOpen, reviewOpen]
  );

  return <ContentCartContext.Provider value={value}>{children}</ContentCartContext.Provider>;
}

export function useContentCart(): ContentCartContextValue {
  const ctx = useContext(ContentCartContext);
  if (!ctx) {
    throw new Error("useContentCart must be used within ContentCartProvider");
  }
  return ctx;
}

export function useContentCartOptional(): ContentCartContextValue | null {
  return useContext(ContentCartContext);
}

/** Keep cart scoped to the active research brief / idea list. */
export function useSyncCartBriefPack(packId: string | null | undefined) {
  const cart = useContentCartOptional();
  const syncedKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!cart || !packId || packId === "all") return;
    if (packId === syncedKey.current) return;
    syncedKey.current = packId;
    cart.attachBriefPackId(packId);
  }, [cart, packId]);
}
