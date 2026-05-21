"use client";

import type { ReactNode } from "react";
import { useId, useState } from "react";
import { type CafGlossaryKey, glossaryText } from "@/lib/caf-glossary";

type Props = {
  term: CafGlossaryKey;
  children: ReactNode;
  className?: string;
};

/** Inline label with hover/focus tooltip explaining a CAF concept. */
export function CafTerm({ term, children, className = "" }: Props) {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const text = glossaryText(term);

  return (
    <span
      className={`caf-term ${className}`.trim()}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span className="caf-term-label" tabIndex={0} aria-describedby={open ? tipId : undefined}>
        {children}
        <span className="caf-term-icon" aria-hidden="true">
          ?
        </span>
      </span>
      {open ? (
        <span id={tipId} role="tooltip" className="caf-tooltip">
          {text}
        </span>
      ) : null}
    </span>
  );
}
