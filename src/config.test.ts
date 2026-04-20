import { describe, expect, it } from "vitest";
import { resolveOutputSchemaValidationMode } from "./config.js";

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
