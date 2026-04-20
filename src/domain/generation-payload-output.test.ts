import { describe, expect, it } from "vitest";
import {
  hasGeneratedOutput,
  pickGeneratedOutput,
  pickGeneratedOutputOrEmpty,
} from "./generation-payload-output.js";

describe("pickGeneratedOutput", () => {
  it("returns the object when present", () => {
    const gp = { generated_output: { title: "hi", slides: [] } };
    expect(pickGeneratedOutput(gp)).toEqual({ title: "hi", slides: [] });
  });

  it("returns null for missing / null / undefined payloads", () => {
    expect(pickGeneratedOutput(null)).toBeNull();
    expect(pickGeneratedOutput(undefined)).toBeNull();
    expect(pickGeneratedOutput({})).toBeNull();
    expect(pickGeneratedOutput({ generated_output: null })).toBeNull();
  });

  it("rejects arrays and primitives (does NOT coerce to {})", () => {
    expect(pickGeneratedOutput({ generated_output: [] as unknown })).toBeNull();
    expect(pickGeneratedOutput({ generated_output: "text" as unknown })).toBeNull();
    expect(pickGeneratedOutput({ generated_output: 42 as unknown })).toBeNull();
    expect(pickGeneratedOutput({ generated_output: true as unknown })).toBeNull();
  });
});

describe("pickGeneratedOutputOrEmpty", () => {
  it("returns {} on miss, preserving call-site assumptions", () => {
    expect(pickGeneratedOutputOrEmpty(null)).toEqual({});
    expect(pickGeneratedOutputOrEmpty({ generated_output: [] as unknown })).toEqual({});
  });

  it("returns the object when present", () => {
    expect(pickGeneratedOutputOrEmpty({ generated_output: { a: 1 } })).toEqual({ a: 1 });
  });
});

describe("hasGeneratedOutput", () => {
  it("is false for missing / empty / invalid", () => {
    expect(hasGeneratedOutput(null)).toBe(false);
    expect(hasGeneratedOutput({})).toBe(false);
    expect(hasGeneratedOutput({ generated_output: {} })).toBe(false);
    expect(hasGeneratedOutput({ generated_output: [] as unknown })).toBe(false);
  });

  it("is true when any key is set on the object", () => {
    expect(hasGeneratedOutput({ generated_output: { a: 1 } })).toBe(true);
  });
});
