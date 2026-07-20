import { describe, expect, it } from "vitest";
import {
  collectLinkedInRoleChips,
  extractJobRoleLabel,
  roleMatchesFilter,
  toggleRoleSelection,
} from "./linkedin-role-filter";

describe("linkedin-role-filter", () => {
  it("extracts a short primary title from long headlines", () => {
    expect(extractJobRoleLabel("CTO, AI, Neuro Symbolic AI")).toBe("CTO");
    expect(extractJobRoleLabel("Head of Security | VaultLM")).toBe("Head of Security");
    expect(extractJobRoleLabel("VP of Engineering at Acme")).toBe("VP of Engineering");
    expect(extractJobRoleLabel("3rd+")).toBeNull();
  });

  it("matches selected roles against full headlines", () => {
    expect(roleMatchesFilter("CTO, AI, Neuro Symbolic AI", ["CTO"])).toBe(true);
    expect(roleMatchesFilter("Head of Security", ["CTO"])).toBe(false);
    expect(roleMatchesFilter("CISO", [])).toBe(true);
  });

  it("collects chips by frequency", () => {
    const chips = collectLinkedInRoleChips([
      "CTO, AI",
      "CTO, Product",
      "CISO",
      "Head of Security | X",
      null,
    ]);
    expect(chips[0]).toEqual({ label: "CTO", count: 2 });
    expect(chips.map((c) => c.label)).toEqual(expect.arrayContaining(["CISO", "Head of Security"]));
  });

  it("toggles multi-select role chips", () => {
    expect(toggleRoleSelection([], "CTO")).toEqual(["CTO"]);
    expect(toggleRoleSelection(["CTO"], "CISO")).toEqual(["CTO", "CISO"]);
    expect(toggleRoleSelection(["CTO", "CISO"], "cto")).toEqual(["CISO"]);
  });
});
