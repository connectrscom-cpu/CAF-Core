"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

export type CafMenuItem = {
  id: string;
  label: string;
  onClick?: () => void;
  href?: string;
  destructive?: boolean;
};

type Props = {
  items: CafMenuItem[];
  label?: string;
};

/** Compact overflow menu for secondary actions (Profile, Debug, Copy, etc.). */
export function CafOptionsMenu({ items, label = "Options" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="caf-options-menu" ref={rootRef}>
      <button
        type="button"
        className="btn-ghost caf-options-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯ {label}
      </button>
      {open ? (
        <div className="caf-options-dropdown" role="menu">
          {items.map((item) => {
            const cls = item.destructive ? "caf-options-item caf-options-item--danger" : "caf-options-item";
            if (item.href) {
              return (
                <a key={item.id} className={cls} href={item.href} role="menuitem" onClick={() => setOpen(false)}>
                  {item.label}
                </a>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                className={cls}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function CafPageHeader({
  title,
  chips,
  actions,
}: {
  title: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="caf-page-header page-header">
      <div className="caf-page-header-left">
        <h2>{title}</h2>
        {chips ? <div className="caf-stat-chips">{chips}</div> : null}
      </div>
      {actions ? <div className="caf-page-header-actions">{actions}</div> : null}
    </div>
  );
}
