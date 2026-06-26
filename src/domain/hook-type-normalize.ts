/** Strip format-placeholder hook labels the broad LLM copies from prompt examples. */

const GENERIC_HOOK_TYPES = new Set([
  "hook in first seconds",
  "hook in first second",
  "hook in first few seconds",
  "slide arc",
  "cover slide",
  "title/body tension",
  "title body tension",
]);

export function normalizeHookType(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (GENERIC_HOOK_TYPES.has(lower)) return null;
  if (/^hook in first/i.test(lower)) return null;
  if (/^slide arc$/i.test(lower)) return null;
  if (/^cover slide$/i.test(lower)) return null;
  return t;
}

export function hookTypeForStorage(
  hookType: string | null | undefined,
  hookText: string | null | undefined
): string | null {
  const normalized = normalizeHookType(hookType);
  if (normalized) return normalized;
  const hook = typeof hookText === "string" ? hookText.trim() : "";
  if (hook.length >= 8) {
    const words = hook.split(/\s+/).slice(0, 4).join(" ");
    return words.length >= 8 ? words.slice(0, 48) : null;
  }
  return null;
}
