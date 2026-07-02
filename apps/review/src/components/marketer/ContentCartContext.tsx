"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { normalizeCartItemFlow } from "@/lib/marketer/cart-flow-resolve";
import {
  readActiveBriefPackId,
  readBriefCart,
  writeActiveBriefPackId,
  writeBriefCart,
} from "@/lib/marketer/cart-storage";
import type { ContentCartItem } from "@/lib/marketer/types";

interface ContentCartContextValue {
  items: ContentCartItem[];
  count: number;
  briefPackId: string | null;
  setBriefPackId: (packId: string | null) => void;
  addIdea: (item: Omit<ContentCartItem, "kind">) => void;
  addTopPerformer: (item: Omit<ContentCartItem, "kind"> & { mimicMode?: ContentCartItem["mimicMode"]; renderMode?: ContentCartItem["renderMode"] }) => void;
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
      setItems(readBriefCart(slug, storedPack).map(normalizeCartItemFlow));
    }
  }, [slug]);

  const setBriefPackId = useCallback(
    (packId: string | null) => {
      const next = packId && packId !== "all" ? packId : null;
      setBriefPackIdState(next);
      if (next) {
        writeActiveBriefPackId(slug, next);
        setItems(readBriefCart(slug, next).map(normalizeCartItemFlow));
      } else {
        setItems([]);
      }
    },
    [slug]
  );

  const persist = useCallback(
    (next: ContentCartItem[], packId = briefPackId) => {
      const normalized = next.map(normalizeCartItemFlow);
      setItems(normalized);
      if (packId) writeBriefCart(slug, packId, normalized);
    },
    [slug, briefPackId]
  );

  const addIdea = useCallback(
    (item: Omit<ContentCartItem, "kind">) => {
      if (!briefPackId) return;
      persist(
        [...items.filter((x) => x.id !== item.id), { ...item, kind: "idea" }],
        briefPackId
      );
      setDrawerOpen(true);
    },
    [items, persist, briefPackId]
  );

  const addTopPerformer = useCallback(
    (item: Omit<ContentCartItem, "kind"> & { mimicMode?: ContentCartItem["mimicMode"]; renderMode?: ContentCartItem["renderMode"] }) => {
      if (!briefPackId) return;
      persist(
        [...items.filter((x) => x.id !== item.id), { ...item, kind: "top_performer" }],
        briefPackId
      );
      setDrawerOpen(true);
    },
    [items, persist, briefPackId]
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

  const clear = useCallback(() => persist([]), [persist]);

  const value = useMemo(
    () => ({
      items,
      count: items.length,
      briefPackId,
      setBriefPackId,
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
    [items, briefPackId, setBriefPackId, addIdea, addTopPerformer, removeItem, updateItem, clear, drawerOpen, reviewOpen]
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
  useEffect(() => {
    if (!cart || !packId || packId === "all") return;
    cart.setBriefPackId(packId);
  }, [cart, packId]);
}
