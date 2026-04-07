import { describe, expect, it } from "vitest";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";

describe("parseJsonObjectFromLlmText", () => {
  it("parses bare JSON object", () => {
    expect(parseJsonObjectFromLlmText(`  {"a":1}  `)).toEqual({ a: 1 });
  });

  it("parses fenced json", () => {
    const t = "Here you go:\n```json\n{ \"x\": \"y\" }\n```\nThanks";
    expect(parseJsonObjectFromLlmText(t)).toEqual({ x: "y" });
  });

  it("extracts object from prose", () => {
    const t = 'Sure! {"ok":true,"n":2} hope this helps';
    expect(parseJsonObjectFromLlmText(t)).toEqual({ ok: true, n: 2 });
  });

  it("returns null for no object", () => {
    expect(parseJsonObjectFromLlmText("just text")).toBeNull();
    expect(parseJsonObjectFromLlmText("[1,2]")).toBeNull();
  });
});
