/**
 * Client-side job-role chips for LinkedIn intelligence (topics + voices).
 */
import { extractLinkedInJobRoleLabel } from "../../../../../src/domain/linkedin-intelligence";

export const extractJobRoleLabel = extractLinkedInJobRoleLabel;

export function roleMatchesFilter(
  roleOrHeadline: string | null | undefined,
  selectedRoles: readonly string[]
): boolean {
  if (!selectedRoles.length) return true;
  const label = extractJobRoleLabel(roleOrHeadline);
  const hay = `${roleOrHeadline ?? ""} ${label ?? ""}`.toLowerCase();
  if (!hay.trim()) return false;
  return selectedRoles.some((role) => {
    const needle = role.trim().toLowerCase();
    if (!needle) return false;
    return hay.includes(needle);
  });
}

export interface LinkedInRoleChip {
  label: string;
  count: number;
}

/** Distinct primary role labels from headlines, sorted by frequency. */
export function collectLinkedInRoleChips(
  headlines: Array<string | null | undefined>,
  limit = 12
): LinkedInRoleChip[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const h of headlines) {
    const label = extractJobRoleLabel(h);
    if (!label) continue;
    const key = label.toLowerCase();
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export function toggleRoleSelection(selected: readonly string[], role: string): string[] {
  const needle = role.trim();
  if (!needle) return [...selected];
  const key = needle.toLowerCase();
  if (selected.some((r) => r.toLowerCase() === key)) {
    return selected.filter((r) => r.toLowerCase() !== key);
  }
  return [...selected, needle];
}
