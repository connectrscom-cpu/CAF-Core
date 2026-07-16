import { describe, expect, it } from "vitest";
import {
  looksLikePersonalLifeMilestone,
  mergePersonalLifeExcludes,
} from "./content-subject-guards.js";

describe("content-subject-guards", () => {
  it("flags wedding anniversary posts", () => {
    expect(
      looksLikePersonalLifeMilestone(
        "Today I’m 25 years married to this incredible woman! Happy anniversary"
      )
    ).toBe(true);
  });

  it("does not flag food content that merely mentions wedding cake", () => {
    expect(
      looksLikePersonalLifeMilestone("How to bake a wedding cake with Italian buttercream")
    ).toBe(false);
  });

  it("merges default personal-life excludes", () => {
    const merged = mergePersonalLifeExcludes(["pasta", "Wedding Anniversary"]);
    expect(merged.map((x) => x.toLowerCase())).toContain("wedding anniversary");
    expect(merged.map((x) => x.toLowerCase())).toContain("pasta");
  });
});
