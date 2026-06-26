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
import { humanizeFlowType } from "@/lib/marketer/language";
import type { ContentCartItem } from "@/lib/marketer/types";

const cartKey = (slug: string) => `caf-review-content-cart-${slug}`;

interface FlowTypeOption {
  id: string;
  label: string;
}

interface ContentCartContextValue {
  items: ContentCartItem[];
  count: number;
  flowTypes: FlowTypeOption[];
  addIdea: (item: Omit<ContentCartItem, "kind">) => void;
  addTopPerformer: (item: Omit<ContentCartItem, "kind"> & { mimicMode?: ContentCartItem["mimicMode"]; renderMode?: ContentCartItem["renderMode"] }) => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, patch: Partial<ContentCartItem>) => void;
  clear: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const ContentCartContext = createContext<ContentCartContextValue | null>(null);

function readCart(slug: string): ContentCartItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(cartKey(slug)) ?? "[]") as ContentCartItem[];
  } catch {
    return [];
  }
}

function writeCart(slug: string, items: ContentCartItem[]) {
  try {
    localStorage.setItem(cartKey(slug), JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

export function ContentCartProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [items, setItems] = useState<ContentCartItem[]>([]);
  const [flowTypes, setFlowTypes] = useState<FlowTypeOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setItems(readCart(slug));
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/project-config/flow-types?project=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.flow_types) return;
        const opts = (j.flow_types as Array<Record<string, unknown>>)
          .map((row) => {
            const id = String(row.flow_type ?? row.id ?? "").trim();
            if (!id) return null;
            const label = String(row.display_name ?? row.label ?? humanizeFlowType(id)).trim();
            return { id, label };
          })
          .filter((x): x is FlowTypeOption => x != null);
        setFlowTypes(opts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const persist = useCallback(
    (next: ContentCartItem[]) => {
      setItems(next);
      writeCart(slug, next);
    },
    [slug]
  );

  const addIdea = useCallback(
    (item: Omit<ContentCartItem, "kind">) => {
      persist([
        ...items.filter((x) => x.id !== item.id),
        { ...item, kind: "idea" },
      ]);
      setDrawerOpen(true);
    },
    [items, persist]
  );

  const addTopPerformer = useCallback(
    (item: Omit<ContentCartItem, "kind"> & { mimicMode?: ContentCartItem["mimicMode"]; renderMode?: ContentCartItem["renderMode"] }) => {
      persist([
        ...items.filter((x) => x.id !== item.id),
        { ...item, kind: "top_performer" },
      ]);
      setDrawerOpen(true);
    },
    [items, persist]
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
      flowTypes,
      addIdea,
      addTopPerformer,
      removeItem,
      updateItem,
      clear,
      drawerOpen,
      setDrawerOpen,
    }),
    [items, flowTypes, addIdea, addTopPerformer, removeItem, updateItem, clear, drawerOpen]
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
