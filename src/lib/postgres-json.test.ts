import { describe, expect, it } from "vitest";
import { sanitizeForPostgresJson, sanitizeStringForPostgresJson, stringifyForPostgresJson } from "./postgres-json.js";

describe("postgres-json", () => {
  it("strips null bytes from strings", () => {
    expect(sanitizeStringForPostgresJson("hello\u0000world")).toBe("helloworld");
  });

  it("strips lone surrogates from strings", () => {
    expect(sanitizeStringForPostgresJson("a\uD800b")).toBe("ab");
  });

  it("sanitizes nested objects for jsonb insert", () => {
    const input = {
      caption: "LinkedIn post\u0000",
      nested: { hook: "hook\uD800text" },
      tags: ["ok", "bad\u0000"],
      score: Number.NaN,
    };
    const out = sanitizeForPostgresJson(input);
    expect(out.caption).toBe("LinkedIn post");
    expect(out.nested.hook).toBe("hooktext");
    expect(out.tags).toEqual(["ok", "bad"]);
    expect(out.score).toBeNull();
    expect(() => JSON.parse(stringifyForPostgresJson(input))).not.toThrow();
  });

  it("produces parseable JSON without forbidden chars", () => {
    const raw = stringifyForPostgresJson({ text: "x\u0000y" });
    expect(raw).not.toContain("\u0000");
    expect(JSON.parse(raw)).toEqual({ text: "xy" });
  });
});
