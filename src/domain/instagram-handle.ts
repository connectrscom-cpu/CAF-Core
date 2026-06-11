/** Normalize handle for carousel overlays (always leading @ when non-empty). */
export function formatInstagramHandleForCta(raw: string | null | undefined): string {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (!s) return "";
  const m = s.match(/instagram\.com\/([^/?#]+)/i);
  if (m?.[1]) s = m[1]!;
  s = s.replace(/^@+/, "").replace(/\s+/g, "");
  if (!s) return "";
  return `@${s}`;
}

export function looksLikeInstagramHandleText(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (/^@[\w.]{2,30}$/.test(t.replace(/\s+/g, ""))) return true;
  if (/instagram\.com\/[\w.]+/i.test(t)) return true;
  return /^@[\w.]{2,30}$/.test(t.split(/\s+/).pop() ?? "");
}

export function isHandleTextBlock(role: string | null, referenceText: string): boolean {
  const r = (role ?? "").trim().toLowerCase();
  if (/handle|watermark|username|@/.test(r)) return true;
  return looksLikeInstagramHandleText(referenceText);
}
