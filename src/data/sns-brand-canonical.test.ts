import { describe, expect, it } from "vitest";
import { parseBrandBible } from "../domain/brand-bible.js";
import { parseBrandProfile } from "../domain/brand-profile.js";
import { SNS_BRAND_BIBLE_V1, SNS_BRAND_PROFILE_V1 } from "../data/sns-brand-canonical.js";

describe("SNS canonical brand data", () => {
  it("parses as valid brand profile with astrology signals", () => {
    const profile = parseBrandProfile(SNS_BRAND_PROFILE_V1);
    expect(profile).not.toBeNull();
    expect(profile?.brand_name).toBe("Sign And Sound");
    expect(profile?.palette).toContain("#9B5CFF");
    expect(profile?.allowed_motifs.some((m) => /zodiac/i.test(m))).toBe(true);
    expect(profile?.forbidden_motifs.some((m) => /botanical|herb/i.test(m))).toBe(true);
    expect(profile?.symbol_map.length).toBeGreaterThan(3);
  });

  it("parses as valid brand bible with mimic accent policy", () => {
    const bible = parseBrandBible(SNS_BRAND_BIBLE_V1);
    expect(bible).not.toBeNull();
    expect(bible?.visual_mode).toBe("mixed");
    expect(bible?.palette).toEqual(["#0B0B16", "#14142A", "#9B5CFF", "#C9A962", "#F5F5F7"]);
    expect(bible?.application_guide.mimic_policy).toMatch(/ACCENT MODE/i);
    expect(bible?.application_guide.instructions).toMatch(/astrology|@signandsound/i);
    expect(bible?.forbidden_motifs.some((m) => /botanical|herb/i.test(m))).toBe(true);
  });
});
