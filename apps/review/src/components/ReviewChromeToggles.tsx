"use client";

import { useReviewChromeLayout } from "@/lib/review-chrome-layout";

export type ReviewChromeTogglesProps = {
  showSidebarToggle?: boolean;
  showFiltersToggle?: boolean;
  className?: string;
};

export function ReviewChromeToggles({
  showSidebarToggle = true,
  showFiltersToggle = false,
  className = "",
}: ReviewChromeTogglesProps) {
  const { layout, toggleSidebar, toggleWorkbenchFilters, setFocusMode } = useReviewChromeLayout();

  return (
    <div className={`review-chrome-toggles ${className}`.trim()} role="toolbar" aria-label="Layout">
      {showSidebarToggle ? (
        <button
          type="button"
          className={`btn-ghost btn-sm review-chrome-toggles__btn${layout.hideReviewSidebar ? " review-chrome-toggles__btn--active" : ""}`}
          onClick={toggleSidebar}
          title={layout.hideReviewSidebar ? "Show navigation sidebar" : "Hide navigation sidebar"}
        >
          {layout.hideReviewSidebar ? "Show nav" : "Hide nav"}
        </button>
      ) : null}
      {showFiltersToggle ? (
        <button
          type="button"
          className={`btn-ghost btn-sm review-chrome-toggles__btn${layout.hideWorkbenchFilters ? " review-chrome-toggles__btn--active" : ""}`}
          onClick={toggleWorkbenchFilters}
          title={layout.hideWorkbenchFilters ? "Show queue filters" : "Hide queue filters"}
        >
          {layout.hideWorkbenchFilters ? "Show filters" : "Hide filters"}
        </button>
      ) : null}
      {showSidebarToggle || showFiltersToggle ? (
        <button
          type="button"
          className={`btn-ghost btn-sm review-chrome-toggles__btn${
            layout.hideReviewSidebar && (!showFiltersToggle || layout.hideWorkbenchFilters)
              ? " review-chrome-toggles__btn--active"
              : ""
          }`}
          onClick={() =>
            setFocusMode(!(layout.hideReviewSidebar && (!showFiltersToggle || layout.hideWorkbenchFilters)))
          }
          title="Maximize content area (hide side panels)"
        >
          Focus
        </button>
      ) : null}
    </div>
  );
}
