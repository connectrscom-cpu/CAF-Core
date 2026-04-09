/**
 * Merge per-clip probes with planner defaults; scale to merged video length when individual probes are missing.
 */
export function mergeProbedClipDurations(
  scenes: Record<string, unknown>[],
  defaultClipSec: number,
  sceneClipProbeSec: (number | null)[],
  T_video_probe: number | null
): number[] {
  const n = scenes.length;
  const def = Math.max(0.5, Number(defaultClipSec) || 4);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = sceneClipProbeSec[i];
    out.push(p != null && p > 0.15 ? p : def);
  }
  const probedCount = sceneClipProbeSec.filter((x) => x != null && x > 0.15).length;
  if (T_video_probe != null && T_video_probe > 0.2 && probedCount === 0 && n > 0) {
    const each = T_video_probe / n;
    return scenes.map(() => each);
  }
  return out;
}
