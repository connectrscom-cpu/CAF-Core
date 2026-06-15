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

/** Collect @handles embedded in a string (deduped, normalized). */
export function collectInstagramHandlesFromText(text: string): string[] {
  const out = new Set<string>();
  const re = /@[\w.]{2,30}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text ?? ""))) !== null) {
    const h = formatInstagramHandleForCta(m[0]);
    if (h) out.add(h);
  }
  return [...out];
}

/**
 * Remove a leading @handle even when glued to the next word (`@sistersvillageDeeply` → `Deeply`).
 * Prefer `knownHandles` from reference layout when available.
 */
export function stripLeadingInstagramHandle(
  text: string,
  knownHandles?: string[]
): { remainder: string; handle: string | null } {
  const t = String(text ?? "").trim();
  if (!t) return { remainder: "", handle: null };

  if (knownHandles?.length) {
    const sorted = [...knownHandles]
      .map((h) => formatInstagramHandleForCta(h))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    const lower = t.toLowerCase();
    for (const norm of sorted) {
      const handleLower = norm.toLowerCase();
      if (lower.startsWith(handleLower)) {
        return { remainder: t.slice(norm.length).trimStart(), handle: norm };
      }
    }
  }

  const glued = /^@([\w.]{2,30})(?=[A-Z])/.exec(t);
  if (glued) {
    const handle = formatInstagramHandleForCta(`@${glued[1]}`);
    return { remainder: t.slice(handle.length).trimStart(), handle };
  }

  const firstToken = t.split(/\s+/)[0] ?? "";
  if (/^@[\w.]{2,30}$/.test(firstToken.replace(/\s+/g, ""))) {
    const handle = formatInstagramHandleForCta(firstToken);
    return { remainder: t.slice(firstToken.length).trimStart(), handle };
  }

  return { remainder: t, handle: null };
}

function pickNonEmptyString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

/** Resolve project Instagram handle from job payload, strategy row, or slug fallback. */
export function resolveProjectInstagramHandle(opts: {
  generationPayload?: Record<string, unknown> | null;
  strategyInstagramHandle?: string | null;
  projectSlug?: string | null;
}): string | null {
  const gp = opts.generationPayload;
  if (gp && typeof gp === "object") {
    const direct = pickNonEmptyString(gp.instagram_handle);
    if (direct) return formatInstagramHandleForCta(direct);
    const strat = gp.strategy;
    if (strat && typeof strat === "object" && !Array.isArray(strat)) {
      const v = pickNonEmptyString((strat as Record<string, unknown>).instagram_handle);
      if (v) return formatInstagramHandleForCta(v);
    }
    const proj = gp.project;
    if (proj && typeof proj === "object" && !Array.isArray(proj)) {
      const v = pickNonEmptyString((proj as Record<string, unknown>).instagram_handle);
      if (v) return formatInstagramHandleForCta(v);
    }
  }
  const strategyIg = pickNonEmptyString(opts.strategyInstagramHandle);
  if (strategyIg) return formatInstagramHandleForCta(strategyIg);
  const slug = pickNonEmptyString(opts.projectSlug);
  if (slug && /^[a-z0-9_.]{2,}$/i.test(slug)) return formatInstagramHandleForCta(slug);
  return null;
}

/** Replace reference creator handles with the project handle (or strip when no project handle). */
export function substituteReferenceHandlesInText(
  text: string,
  referenceHandles: string[],
  projectHandle: string | null
): string {
  let out = String(text ?? "");
  const project = projectHandle ? formatInstagramHandleForCta(projectHandle) : "";
  for (const ref of referenceHandles) {
    const norm = formatInstagramHandleForCta(ref);
    if (!norm) continue;
    const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), project);
  }
  return out.replace(/\s{2,}/g, " ").trim();
}
