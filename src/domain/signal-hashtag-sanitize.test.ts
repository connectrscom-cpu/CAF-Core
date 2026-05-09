import { describe, expect, it } from "vitest";
import { bareHashtagToken, filterSignalPackHashtagCandidates, isUsableSignalPackHashtag } from "./signal-hashtag-sanitize.js";

describe("signal-hashtag-sanitize", () => {
  it("strips hash and normalizes", () => {
    expect(bareHashtagToken("#Astrology")).toBe("astrology");
  });

  it("rejects junk leaderboard tokens", () => {
    expect(isUsableSignalPackHashtag("https")).toBe(false);
    expect(isUsableSignalPackHashtag("jpeg")).toBe(false);
    expect(isUsableSignalPackHashtag("preview")).toBe(false);
  });

  it("keeps substantive tags", () => {
    expect(isUsableSignalPackHashtag("astrology")).toBe(true);
    expect(isUsableSignalPackHashtag("relationshippsychology")).toBe(true);
  });

  it("filters and dedupes preserving order", () => {
    const out = filterSignalPackHashtagCandidates(
      ["#astrology", "#https", "#Astrology", "#jpeg", "#zodiacsigns"],
      { max: 10 }
    );
    expect(out).toEqual(["astrology", "zodiacsigns"]);
  });
});
