import { describe, expect, it } from "vitest";
import {
  parseEnvBooleanFlag,
  parseMetaAccountSourceMap,
  resolveOutputSchemaValidationMode,
} from "./config.js";

describe("parseEnvBooleanFlag", () => {
  it('treats "0" and "false" as false (unlike z.coerce.boolean)', () => {
    expect(parseEnvBooleanFlag("0", true)).toBe(false);
    expect(parseEnvBooleanFlag("false", true)).toBe(false);
    expect(parseEnvBooleanFlag("1", false)).toBe(true);
    expect(parseEnvBooleanFlag(undefined, false)).toBe(false);
  });
});

describe("parseMetaAccountSourceMap", () => {
  it("parses comma-separated FROM=TO pairs", () => {
    const m = parseMetaAccountSourceMap("CUISINA=SNS, foo=bar ");
    expect(m.get("CUISINA")).toBe("SNS");
    expect(m.get("FOO")).toBe("BAR");
  });
  it("returns empty map when unset", () => {
    expect(parseMetaAccountSourceMap(undefined).size).toBe(0);
  });
});

describe("resolveOutputSchemaValidationMode", () => {
  it("returns the explicit mode when set (wins over legacy flag)", () => {
    expect(
      resolveOutputSchemaValidationMode({
        CAF_OUTPUT_SCHEMA_VALIDATION_MODE: "warn",
        CAF_SKIP_OUTPUT_SCHEMA_VALIDATION: true,
      })
    ).toBe("warn");
    expect(
      resolveOutputSchemaValidationMode({
        CAF_OUTPUT_SCHEMA_VALIDATION_MODE: "enforce",
        CAF_SKIP_OUTPUT_SCHEMA_VALIDATION: true,
      })
    ).toBe("enforce");
    expect(
      resolveOutputSchemaValidationMode({
        CAF_OUTPUT_SCHEMA_VALIDATION_MODE: "skip",
        CAF_SKIP_OUTPUT_SCHEMA_VALIDATION: false,
      })
    ).toBe("skip");
  });

  it("falls back to the legacy flag when the new env is unset (preserves behavior)", () => {
    expect(
      resolveOutputSchemaValidationMode({
        CAF_OUTPUT_SCHEMA_VALIDATION_MODE: undefined,
        CAF_SKIP_OUTPUT_SCHEMA_VALIDATION: true,
      })
    ).toBe("skip");
    expect(
      resolveOutputSchemaValidationMode({
        CAF_OUTPUT_SCHEMA_VALIDATION_MODE: undefined,
        CAF_SKIP_OUTPUT_SCHEMA_VALIDATION: false,
      })
    ).toBe("enforce");
  });
});
