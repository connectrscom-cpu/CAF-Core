/**
 * Mutable readiness hooks set after Review sidecar boot.
 * Used by /readyz so Fly does not route traffic while the embedded Review app is down.
 */
export type ReadinessState = {
  reviewEnabled: boolean;
  reviewUpstream: string | null;
};

export const readinessState: ReadinessState = {
  reviewEnabled: false,
  reviewUpstream: null,
};
