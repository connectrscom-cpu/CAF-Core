/**
 * Validates LLM JSON output against flow output_schemas rows.
 */
import type { OutputSchemaRow } from "../repositories/flow-engine.js";

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

function getNested(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function validateType(key: string, value: unknown, expected: string): string | null {
  switch (expected) {
    case "string":
      return typeof value === "string" ? null : `${key}: expected string`;
    case "number":
      return typeof value === "number" ? null : `${key}: expected number`;
    case "boolean":
      return typeof value === "boolean" ? null : `${key}: expected boolean`;
    case "array":
      return Array.isArray(value) ? null : `${key}: expected array`;
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value) ? null : `${key}: expected object`;
    default:
      return null;
  }
}

/**
 * Validate `data` against an output_schemas row.
 * Uses `required_keys` (semicolon-separated dot paths) and a shallow JSON-Schema-like `schema_json`.
 */
export function validateAgainstOutputSchema(
  data: Record<string, unknown>,
  schemaRow: OutputSchemaRow | null
): SchemaValidationResult {
  const errors: string[] = [];
  if (!schemaRow) return { valid: true, errors: [] };

  if (schemaRow.required_keys) {
    const paths = schemaRow.required_keys.split(";").map((s) => s.trim()).filter(Boolean);
    for (const p of paths) {
      const v = getNested(data, p);
      if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
        errors.push(`missing required field: ${p}`);
      }
    }
  }

  const sj = schemaRow.schema_json;
  if (sj && typeof sj === "object" && sj !== null && !Array.isArray(sj)) {
    const root = sj as {
      required?: string[];
      properties?: Record<string, { type?: string }>;
    };
    if (Array.isArray(root.required)) {
      for (const key of root.required) {
        if (!(key in data) || data[key] === undefined || data[key] === null) {
          errors.push(`missing required key: ${key}`);
        }
      }
    }
    if (root.properties && typeof data === "object") {
      for (const [key, value] of Object.entries(data)) {
        const prop = root.properties[key];
        if (!prop?.type) continue;
        const msg = validateType(key, value, prop.type);
        if (msg) errors.push(msg);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
