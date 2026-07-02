"use client";

type ChromePanelToggleProps = {
  /** Panel is currently visible — button collapses it. */
  expanded: boolean;
  onClick: () => void;
  title: string;
  /** `strip` = slim edge tab when panel is collapsed. */
  variant?: "inline" | "strip";
  className?: string;
};

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Small chevron to collapse or expand a side panel. */
export function ChromePanelToggle({
  expanded,
  onClick,
  title,
  variant = "inline",
  className = "",
}: ChromePanelToggleProps) {
  const btnClass =
    variant === "strip"
      ? `chrome-panel-expand ${className}`.trim()
      : `chrome-panel-toggle ${className}`.trim();

  return (
    <button type="button" className={btnClass} onClick={onClick} title={title} aria-label={title}>
      {expanded ? <ChevronLeft /> : <ChevronRight />}
    </button>
  );
}
