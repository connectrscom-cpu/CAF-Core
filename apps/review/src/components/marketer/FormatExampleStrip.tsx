"use client";

import { useState } from "react";
import type { FormatGroupExample } from "@/lib/marketer/market-intelligence-adapters";

export function FormatExampleStrip({
  examples,
  onSelect,
  horizontal = false,
}: {
  examples: FormatGroupExample[];
  onSelect: (example: FormatGroupExample) => void;
  horizontal?: boolean;
}) {
  const [broken, setBroken] = useState<Set<string>>(new Set());

  if (!examples.length) return null;

  return (
    <div className="intel-format-examples">
      <span className="intel-format-examples-label">Examples from research</span>
      <div className={`intel-format-examples-row${horizontal ? " intel-format-examples-row--horizontal" : ""}`}>
        {examples.map((ex) => {
          const showThumb = ex.thumbnailUrl && !broken.has(ex.insightsId);
          return (
            <button
              key={ex.insightsId}
              type="button"
              className={`intel-format-example${horizontal ? " intel-format-example--wide" : ""}`}
              onClick={() => onSelect(ex)}
              title={ex.title}
            >
              <div className="intel-format-example-media">
                {showThumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ex.thumbnailUrl!}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() =>
                      setBroken((prev) => {
                        const next = new Set(prev);
                        next.add(ex.insightsId);
                        return next;
                      })
                    }
                  />
                ) : (
                  <span className="intel-format-example-fallback">{ex.title.slice(0, 1)}</span>
                )}
                {ex.isVideo ? <span className="intel-format-example-play" aria-hidden>▶</span> : null}
              </div>
              <span className="intel-format-example-caption">
                {ex.platform}
                {ex.isVideo ? " · Video" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
