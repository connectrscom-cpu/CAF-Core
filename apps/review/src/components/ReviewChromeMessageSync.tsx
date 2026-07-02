"use client";

import { useEffect } from "react";
import { applyReviewChromeLayout } from "@/lib/review-chrome-layout";
import { clientSearchParams, useClientSearchQuery } from "@/lib/use-client-search-query";

/** Syncs layout toggles from the admin shell (parent window) when embedded in an iframe. */
export function ReviewChromeMessageSync() {
  const embeddedInAdmin = clientSearchParams(useClientSearchQuery()).get("embed") === "admin";

  useEffect(() => {
    if (!embeddedInAdmin) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "caf-review-chrome") return;
      const layout = event.data.layout;
      if (!layout || typeof layout !== "object") return;
      const patch: { hideWorkbenchFilters?: boolean } = {};
      if ("hideWorkbenchFilters" in layout) patch.hideWorkbenchFilters = Boolean(layout.hideWorkbenchFilters);
      if (Object.keys(patch).length > 0) applyReviewChromeLayout(patch);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [embeddedInAdmin]);

  return null;
}
