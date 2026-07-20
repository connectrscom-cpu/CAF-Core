"use client";

import { useEffect, useState } from "react";

/** Matches the review app shell breakpoint in globals.css. */
export const REVIEW_MOBILE_MEDIA_QUERY = "(max-width: 1024px)";

/** Phone / small-tablet — denser layout, card queues, 16px inputs. */
export const REVIEW_PHONE_MEDIA_QUERY = "(max-width: 768px)";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);

  return matches;
}

/** True when the review shell should use the drawer navigation (≤1024px). */
export function useMobileLayout() {
  return useMediaQuery(REVIEW_MOBILE_MEDIA_QUERY);
}

/** True on phone-width viewports (≤768px). */
export function usePhoneLayout() {
  return useMediaQuery(REVIEW_PHONE_MEDIA_QUERY);
}
