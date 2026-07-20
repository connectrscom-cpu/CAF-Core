import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type AccountType = "agency" | "personal";
export type AccountMemberRole = "owner" | "admin" | "member";
export type ProjectMemberRole = "editor" | "viewer";

export const DEFAULT_PLAN_CAPS: Record<
  AccountType,
  { max_projects: number; max_members: number }
> = {
  personal: { max_projects: 3, max_members: 5 },
  agency: { max_projects: 25, max_members: 50 },
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeAccountSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, useSalt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt: useSalt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const next = scryptSync(password, salt, SCRYPT_KEYLEN);
    const prev = Buffer.from(hash, "hex");
    if (prev.length !== next.length) return false;
    return timingSafeEqual(prev, next);
  } catch {
    return false;
  }
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function isAccountAdminRole(role: AccountMemberRole | string): boolean {
  return role === "owner" || role === "admin";
}

/** Owner/admin see all account projects; members need explicit project assignment. */
export function memberSeesAllAccountProjects(role: AccountMemberRole | string): boolean {
  return isAccountAdminRole(role);
}

export function sessionExpiryDate(days = 30): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function inviteExpiryDate(days = 14): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
