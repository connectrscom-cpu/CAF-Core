/** Mirror of Core `task-id.ts` — carousel jobs plan for Instagram/Facebook only. */

export function isCarouselAllowedPlatform(platform: string): boolean {
  const p = platform.trim().toLowerCase();
  if (!p) return false;
  if (p === "ig" || p === "fb") return true;
  if (p.includes("instagram")) return true;
  if (p.includes("facebook")) return true;
  return false;
}

export function normalizeCarouselIdeaPlatform(platform: string, alternateIndex = 0): string {
  if (isCarouselAllowedPlatform(platform)) {
    const p = platform.trim().toLowerCase();
    if (p.includes("facebook") || p === "fb") return "Facebook";
    return "Instagram";
  }
  return alternateIndex % 2 === 0 ? "Instagram" : "Facebook";
}
