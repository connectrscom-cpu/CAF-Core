/**
 * Brand profile (`brand_profile_v1`) — Layer C of Why Mimic.
 *
 * Describes a brand's execution vocabulary: palette, visual style, tone/register,
 * domain metaphors, allowed/forbidden motifs, and a `symbol_map` that translates
 * abstract connotations (from `slide_intelligence_v1.symbolic_elements`) into
 * brand-appropriate expression. The active profile per project drives Brand
 * Translation; it never changes the *strategic intent* of the reference, only its
 * surface execution.
 *
 * Stored as `profile_json` on the versioned `caf_core.brand_profiles` table.
 */

export const BRAND_PROFILE_SCHEMA = "brand_profile_v1" as const;

export interface BrandSymbolMapping {
  /** Abstract connotation from SIL, e.g. "exclusivity". */
  connotation: string;
  /** Brand-appropriate expression, e.g. "enterprise tier badge". */
  brand_expression: string;
}

export interface BrandProfileV1 {
  schema_version: typeof BRAND_PROFILE_SCHEMA;
  brand_name: string | null;
  /** Hex values or design tokens. */
  palette: string[];
  /** e.g. "clean SaaS, blue, educational". */
  visual_style: string | null;
  /** Copy register, e.g. "confident, plain-spoken, no hype". */
  tone: string | null;
  /** Imagery the brand uses to make abstract ideas concrete (dashboard, growth chart). */
  domain_metaphors: string[];
  allowed_motifs: string[];
  forbidden_motifs: string[];
  /** connotation -> brand expression. */
  symbol_map: BrandSymbolMapping[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown, max = 400): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function strList(v: unknown, max: number, cap = 80): string[] {
  const out: string[] = [];
  for (const x of asArray(v)) {
    const s = str(x, cap);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function parseSymbolMap(raw: unknown): BrandSymbolMapping[] {
  const out: BrandSymbolMapping[] = [];
  // Accept both array-of-pairs and a plain { connotation: expression } object.
  const rec = asRecord(raw);
  if (rec) {
    for (const [k, v] of Object.entries(rec)) {
      const connotation = str(k, 80);
      const brand_expression = str(v, 200);
      if (connotation && brand_expression) out.push({ connotation, brand_expression });
      if (out.length >= 60) break;
    }
    return out;
  }
  for (const item of asArray(raw)) {
    const o = asRecord(item);
    if (!o) continue;
    const connotation = str(o.connotation ?? o.from ?? o.meaning, 80);
    const brand_expression = str(o.brand_expression ?? o.to ?? o.expression, 200);
    if (connotation && brand_expression) out.push({ connotation, brand_expression });
    if (out.length >= 60) break;
  }
  return out;
}

/** Tolerant parser. Returns null when there is no usable brand signal. */
export function parseBrandProfile(raw: unknown): BrandProfileV1 | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const profile: BrandProfileV1 = {
    schema_version: BRAND_PROFILE_SCHEMA,
    brand_name: str(rec.brand_name ?? rec.name, 120),
    palette: strList(rec.palette ?? rec.colors, 16, 40),
    visual_style: str(rec.visual_style ?? rec.style, 300),
    tone: str(rec.tone ?? rec.register ?? rec.voice, 300),
    domain_metaphors: strList(rec.domain_metaphors ?? rec.metaphors, 16, 80),
    allowed_motifs: strList(rec.allowed_motifs ?? rec.allowed, 24, 60),
    forbidden_motifs: strList(rec.forbidden_motifs ?? rec.forbidden ?? rec.banned_motifs, 24, 60),
    symbol_map: parseSymbolMap(rec.symbol_map ?? rec.symbols),
  };

  const hasSignal =
    profile.brand_name ||
    profile.visual_style ||
    profile.tone ||
    profile.palette.length > 0 ||
    profile.domain_metaphors.length > 0 ||
    profile.symbol_map.length > 0 ||
    profile.allowed_motifs.length > 0 ||
    profile.forbidden_motifs.length > 0;

  return hasSignal ? profile : null;
}

/** Look up a connotation in the symbol map (case-insensitive, trimmed). */
export function lookupSymbolExpression(
  profile: BrandProfileV1 | null | undefined,
  connotation: string
): string | null {
  if (!profile) return null;
  const key = connotation.trim().toLowerCase();
  for (const m of profile.symbol_map) {
    if (m.connotation.trim().toLowerCase() === key) return m.brand_expression;
  }
  return null;
}
