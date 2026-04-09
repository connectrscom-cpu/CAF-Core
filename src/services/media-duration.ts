/**
 * Best-effort MP4 duration probe. Without ffprobe bindings, return null so callers fall back to planner defaults.
 */
export async function probeMediaDurationSec(_buf: Buffer): Promise<number | null> {
  return null;
}
