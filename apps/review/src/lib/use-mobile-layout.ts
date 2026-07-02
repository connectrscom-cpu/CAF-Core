"use client";

import { useEffect, useState } from "react";

/** Matches the review app shell breakpoint in globals.css. */
export const REVIEW_MOBILE_MEDIA_QUERY = "(max-width: 1024px)";

export function useMobileLayout() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(REVIEW_MOBILE_MEDIA_QUERY);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return isMobile;
}
