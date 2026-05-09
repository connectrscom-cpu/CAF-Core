/**
 * Rough USD estimates for admin / observability — configure rates via `CAF_COST_*` env vars.
 * Carousel: allocates Fly (or host) machine hourly rate × HTTP wall time for one slide render.
 * HeyGen: blended $/minute × reported output duration when available.
 */

/** `(latency_ms / 3_600_000) * usdPerMachineHour` — serial Puppeteer worker assumption. */
export function estimateCarouselSlideFlyUsd(latencyMs: number, usdPerMachineHour: number): number | null {
  if (!Number.isFinite(latencyMs) || latencyMs <= 0) return null;
  if (!Number.isFinite(usdPerMachineHour) || usdPerMachineHour <= 0) return null;
  return roundUsd((latencyMs / 3_600_000) * usdPerMachineHour);
}

/** `(duration_sec / 60) * usdPerMinute` — set USD/min from HeyGen pricing / credits. */
export function estimateHeyGenVideoUsd(durationSec: number | null | undefined, usdPerMinute: number): number | null {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  if (!Number.isFinite(usdPerMinute) || usdPerMinute <= 0) return null;
  return roundUsd((durationSec / 60) * usdPerMinute);
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
