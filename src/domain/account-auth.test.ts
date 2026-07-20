import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  hashPassword,
  hashToken,
  isAccountAdminRole,
  memberSeesAllAccountProjects,
  normalizeAccountSlug,
  normalizeEmail,
  verifyPassword,
} from "./account-auth.js";

describe("account-auth", () => {
  it("normalizes emails and account slugs", () => {
    expect(normalizeEmail("  Boss@Connectrs.com ")).toBe("boss@connectrs.com");
    expect(normalizeAccountSlug(" My Agency!! ")).toBe("my-agency");
  });

  it("hashes and verifies passwords", () => {
    const { hash, salt } = hashPassword("secret-pass");
    expect(verifyPassword("secret-pass", hash, salt)).toBe(true);
    expect(verifyPassword("wrong", hash, salt)).toBe(false);
  });

  it("hashes session tokens stably", () => {
    const token = createSessionToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
  });

  it("treats owner/admin as account admins with full project visibility", () => {
    expect(isAccountAdminRole("owner")).toBe(true);
    expect(isAccountAdminRole("admin")).toBe(true);
    expect(isAccountAdminRole("member")).toBe(false);
    expect(memberSeesAllAccountProjects("member")).toBe(false);
    expect(memberSeesAllAccountProjects("admin")).toBe(true);
  });
});
