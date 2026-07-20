import type { Pool, PoolClient } from "pg";
import { q, qOne } from "../db/queries.js";
import {
  type AccountMemberRole,
  type AccountType,
  type ProjectMemberRole,
  createInviteToken,
  createSessionToken,
  hashPassword,
  hashToken,
  inviteExpiryDate,
  isAccountAdminRole,
  memberSeesAllAccountProjects,
  normalizeAccountSlug,
  normalizeEmail,
  sessionExpiryDate,
  verifyPassword,
  DEFAULT_PLAN_CAPS,
} from "../domain/account-auth.js";

type Db = Pool | PoolClient;

export interface UserRow {
  id: string;
  email: string;
  email_normalized: string;
  display_name: string | null;
  password_hash: string;
  password_salt: string;
  active: boolean;
}

export interface AccountRow {
  id: string;
  slug: string;
  display_name: string;
  account_type: AccountType;
  max_projects: number;
  max_members: number;
  plan_json: Record<string, unknown>;
  billing_json: Record<string, unknown>;
  active: boolean;
}

export interface AccountMemberRow {
  account_id: string;
  user_id: string;
  role: AccountMemberRole;
  status: string;
  email?: string;
  display_name?: string | null;
}

export interface AuthSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface AllowedProjectRow {
  id: string;
  slug: string;
  display_name: string | null;
  active: boolean;
  color: string | null;
  account_id: string;
  account_slug: string;
  access: "account_admin" | "project_member";
}

export interface InviteRow {
  id: string;
  account_id: string;
  email: string;
  email_normalized: string;
  role: "admin" | "member";
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  account_slug?: string;
  account_display_name?: string;
}

export async function getUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  return qOne<UserRow>(
    db,
    `SELECT id, email, email_normalized, display_name, password_hash, password_salt, active
     FROM caf_core.users WHERE email_normalized = $1`,
    [normalizeEmail(email)]
  );
}

export async function getUserById(db: Db, userId: string): Promise<UserRow | null> {
  return qOne<UserRow>(
    db,
    `SELECT id, email, email_normalized, display_name, password_hash, password_salt, active
     FROM caf_core.users WHERE id = $1`,
    [userId]
  );
}

export async function createUser(
  db: Db,
  input: { email: string; password: string; displayName?: string | null }
): Promise<UserRow> {
  const email = input.email.trim();
  const emailNorm = normalizeEmail(email);
  const { hash, salt } = hashPassword(input.password);
  const row = await qOne<UserRow>(
    db,
    `INSERT INTO caf_core.users (email, email_normalized, display_name, password_hash, password_salt)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, email_normalized, display_name, password_hash, password_salt, active`,
    [email, emailNorm, input.displayName?.trim() || null, hash, salt]
  );
  if (!row) throw new Error("Failed to create user");
  return row;
}

export async function getAccountBySlug(db: Db, slug: string): Promise<AccountRow | null> {
  return qOne<AccountRow>(
    db,
    `SELECT id, slug, display_name, account_type, max_projects, max_members,
            plan_json, billing_json, active
     FROM caf_core.accounts WHERE slug = $1`,
    [normalizeAccountSlug(slug)]
  );
}

export async function getAccountById(db: Db, accountId: string): Promise<AccountRow | null> {
  return qOne<AccountRow>(
    db,
    `SELECT id, slug, display_name, account_type, max_projects, max_members,
            plan_json, billing_json, active
     FROM caf_core.accounts WHERE id = $1`,
    [accountId]
  );
}

export async function createAccount(
  db: Db,
  input: {
    slug: string;
    displayName: string;
    accountType: AccountType;
    maxProjects?: number;
    maxMembers?: number;
  }
): Promise<AccountRow> {
  const caps = DEFAULT_PLAN_CAPS[input.accountType];
  const slug = normalizeAccountSlug(input.slug);
  if (!slug || slug.length < 2) throw new Error("invalid_account_slug");
  const row = await qOne<AccountRow>(
    db,
    `INSERT INTO caf_core.accounts
       (slug, display_name, account_type, max_projects, max_members, plan_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id, slug, display_name, account_type, max_projects, max_members,
               plan_json, billing_json, active`,
    [
      slug,
      input.displayName.trim() || slug,
      input.accountType,
      input.maxProjects ?? caps.max_projects,
      input.maxMembers ?? caps.max_members,
      JSON.stringify({ tier: input.accountType === "personal" ? "personal" : "agency" }),
    ]
  );
  if (!row) throw new Error("Failed to create account");
  return row;
}

export async function addAccountMember(
  db: Db,
  input: {
    accountId: string;
    userId: string;
    role: AccountMemberRole;
    invitedAt?: Date | null;
  }
): Promise<AccountMemberRow> {
  const row = await qOne<AccountMemberRow>(
    db,
    `INSERT INTO caf_core.account_members (account_id, user_id, role, invited_at, joined_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (account_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'active',
           updated_at = now()
     RETURNING account_id, user_id, role, status`,
    [input.accountId, input.userId, input.role, input.invitedAt ?? null]
  );
  if (!row) throw new Error("Failed to add account member");
  return row;
}

export async function getAccountMembership(
  db: Db,
  accountId: string,
  userId: string
): Promise<AccountMemberRow | null> {
  return qOne<AccountMemberRow>(
    db,
    `SELECT account_id, user_id, role, status
     FROM caf_core.account_members
     WHERE account_id = $1 AND user_id = $2 AND status = 'active'`,
    [accountId, userId]
  );
}

export async function listAccountMembershipsForUser(
  db: Db,
  userId: string
): Promise<Array<AccountMemberRow & { account_slug: string; account_display_name: string; account_type: AccountType }>> {
  return q(
    db,
    `SELECT m.account_id, m.user_id, m.role, m.status,
            a.slug AS account_slug, a.display_name AS account_display_name, a.account_type
     FROM caf_core.account_members m
     JOIN caf_core.accounts a ON a.id = m.account_id
     WHERE m.user_id = $1 AND m.status = 'active' AND a.active = true
     ORDER BY a.display_name`,
    [userId]
  );
}

export async function listAccountMembers(db: Db, accountId: string): Promise<AccountMemberRow[]> {
  return q<AccountMemberRow>(
    db,
    `SELECT m.account_id, m.user_id, m.role, m.status,
            u.email, u.display_name
     FROM caf_core.account_members m
     JOIN caf_core.users u ON u.id = m.user_id
     WHERE m.account_id = $1
     ORDER BY
       CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
       u.email`,
    [accountId]
  );
}

export async function countAccountMembers(db: Db, accountId: string): Promise<number> {
  const row = await qOne<{ n: number }>(
    db,
    `SELECT COUNT(*)::int AS n FROM caf_core.account_members
     WHERE account_id = $1 AND status = 'active'`,
    [accountId]
  );
  return row?.n ?? 0;
}

export async function countAccountProjects(db: Db, accountId: string): Promise<number> {
  const row = await qOne<{ n: number }>(
    db,
    `SELECT COUNT(*)::int AS n FROM caf_core.projects
     WHERE account_id = $1 AND COALESCE(is_system, false) = false`,
    [accountId]
  );
  return row?.n ?? 0;
}

export async function attachProjectToAccount(
  db: Db,
  projectId: string,
  accountId: string
): Promise<void> {
  await q(
    db,
    `UPDATE caf_core.projects
     SET account_id = $2, updated_at = now()
     WHERE id = $1`,
    [projectId, accountId]
  );
}

export async function createSession(
  db: Db,
  input: { userId: string; userAgent?: string | null; ipAddress?: string | null }
): Promise<{ token: string; expiresAt: Date }> {
  const token = createSessionToken();
  const expiresAt = sessionExpiryDate(30);
  await q(
    db,
    `INSERT INTO caf_core.auth_sessions (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.userId, hashToken(token), expiresAt.toISOString(), input.userAgent ?? null, input.ipAddress ?? null]
  );
  return { token, expiresAt };
}

export async function revokeSessionByToken(db: Db, token: string): Promise<void> {
  await q(
    db,
    `UPDATE caf_core.auth_sessions
     SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)]
  );
}

export async function resolveSessionUser(db: Db, token: string): Promise<UserRow | null> {
  if (!token?.trim()) return null;
  const session = await qOne<AuthSessionRow & { user_active: boolean }>(
    db,
    `SELECT s.id, s.user_id, s.token_hash, s.expires_at::text, s.revoked_at::text,
            u.active AS user_active
     FROM caf_core.auth_sessions s
     JOIN caf_core.users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > now()`,
    [hashToken(token)]
  );
  if (!session || !session.user_active) return null;
  await q(
    db,
    `UPDATE caf_core.auth_sessions SET last_seen_at = now() WHERE id = $1`,
    [session.id]
  );
  return getUserById(db, session.user_id);
}

export async function authenticateUser(
  db: Db,
  email: string,
  password: string
): Promise<UserRow | null> {
  const user = await getUserByEmail(db, email);
  if (!user || !user.active) return null;
  if (!verifyPassword(password, user.password_hash, user.password_salt)) return null;
  return user;
}

export async function listAllowedProjectsForUser(db: Db, userId: string): Promise<AllowedProjectRow[]> {
  const memberships = await listAccountMembershipsForUser(db, userId);
  if (memberships.length === 0) return [];

  const out: AllowedProjectRow[] = [];
  const seen = new Set<string>();

  for (const m of memberships) {
    if (memberSeesAllAccountProjects(m.role)) {
      const rows = await q<AllowedProjectRow>(
        db,
        `SELECT p.id, p.slug, p.display_name, p.active, p.color, p.account_id,
                a.slug AS account_slug, 'account_admin'::text AS access
         FROM caf_core.projects p
         JOIN caf_core.accounts a ON a.id = p.account_id
         WHERE p.account_id = $1
           AND COALESCE(p.is_system, false) = false
           AND p.slug <> 'caf-global'
         ORDER BY p.slug`,
        [m.account_id]
      );
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
    } else {
      const rows = await q<AllowedProjectRow>(
        db,
        `SELECT p.id, p.slug, p.display_name, p.active, p.color, p.account_id,
                a.slug AS account_slug, 'project_member'::text AS access
         FROM caf_core.project_members pm
         JOIN caf_core.projects p ON p.id = pm.project_id
         JOIN caf_core.accounts a ON a.id = p.account_id
         WHERE pm.user_id = $1
           AND p.account_id = $2
           AND COALESCE(p.is_system, false) = false
           AND p.slug <> 'caf-global'
         ORDER BY p.slug`,
        [userId, m.account_id]
      );
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
    }
  }

  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

export async function userCanAccessProjectSlug(
  db: Db,
  userId: string,
  projectSlug: string
): Promise<boolean> {
  const allowed = await listAllowedProjectsForUser(db, userId);
  return allowed.some((p) => p.slug === projectSlug);
}

export async function assignProjectMember(
  db: Db,
  input: { projectId: string; userId: string; role?: ProjectMemberRole }
): Promise<void> {
  await q(
    db,
    `INSERT INTO caf_core.project_members (project_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE
       SET role = EXCLUDED.role, updated_at = now()`,
    [input.projectId, input.userId, input.role ?? "editor"]
  );
}

export async function removeProjectMember(db: Db, projectId: string, userId: string): Promise<void> {
  await q(
    db,
    `DELETE FROM caf_core.project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId]
  );
}

export async function listProjectMembers(
  db: Db,
  projectId: string
): Promise<Array<{ user_id: string; role: string; email: string; display_name: string | null }>> {
  return q(
    db,
    `SELECT pm.user_id, pm.role, u.email, u.display_name
     FROM caf_core.project_members pm
     JOIN caf_core.users u ON u.id = pm.user_id
     WHERE pm.project_id = $1
     ORDER BY u.email`,
    [projectId]
  );
}

export async function createInvite(
  db: Db,
  input: {
    accountId: string;
    email: string;
    role: "admin" | "member";
    invitedByUserId?: string | null;
  }
): Promise<{ invite: InviteRow; rawToken: string }> {
  const email = input.email.trim();
  const emailNorm = normalizeEmail(email);
  const rawToken = createInviteToken();
  const expiresAt = inviteExpiryDate(14);
  const invite = await qOne<InviteRow>(
    db,
    `INSERT INTO caf_core.account_invites
       (account_id, email, email_normalized, role, token_hash, invited_by_user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, account_id, email, email_normalized, role, token_hash,
               expires_at::text, accepted_at::text, revoked_at::text`,
    [
      input.accountId,
      email,
      emailNorm,
      input.role,
      hashToken(rawToken),
      input.invitedByUserId ?? null,
      expiresAt.toISOString(),
    ]
  );
  if (!invite) throw new Error("Failed to create invite");
  return { invite, rawToken };
}

export async function listPendingInvites(db: Db, accountId: string): Promise<InviteRow[]> {
  return q<InviteRow>(
    db,
    `SELECT id, account_id, email, email_normalized, role, token_hash,
            expires_at::text, accepted_at::text, revoked_at::text
     FROM caf_core.account_invites
     WHERE account_id = $1
       AND accepted_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > now()
     ORDER BY created_at DESC`,
    [accountId]
  );
}

export async function getInviteByRawToken(db: Db, rawToken: string): Promise<InviteRow | null> {
  return qOne<InviteRow>(
    db,
    `SELECT i.id, i.account_id, i.email, i.email_normalized, i.role, i.token_hash,
            i.expires_at::text, i.accepted_at::text, i.revoked_at::text,
            a.slug AS account_slug, a.display_name AS account_display_name
     FROM caf_core.account_invites i
     JOIN caf_core.accounts a ON a.id = i.account_id
     WHERE i.token_hash = $1`,
    [hashToken(rawToken)]
  );
}

export async function acceptInvite(
  db: Pool,
  input: {
    rawToken: string;
    password?: string;
    displayName?: string | null;
    existingUserId?: string | null;
  }
): Promise<{ user: UserRow; account: AccountRow; createdUser: boolean }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const invite = await getInviteByRawToken(client, input.rawToken);
    if (!invite || invite.accepted_at || invite.revoked_at) {
      throw new Error("invite_invalid");
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      throw new Error("invite_expired");
    }

    const account = await getAccountById(client, invite.account_id);
    if (!account || !account.active) throw new Error("account_inactive");

    const memberCount = await countAccountMembers(client, account.id);
    if (memberCount >= account.max_members) throw new Error("member_cap_reached");

    let user: UserRow | null = null;
    let createdUser = false;

    if (input.existingUserId) {
      user = await getUserById(client, input.existingUserId);
      if (!user) throw new Error("user_not_found");
      if (normalizeEmail(user.email) !== invite.email_normalized) {
        throw new Error("invite_email_mismatch");
      }
    } else {
      user = await getUserByEmail(client, invite.email);
      if (!user) {
        if (!input.password || input.password.length < 8) throw new Error("password_required");
        user = await createUser(client, {
          email: invite.email,
          password: input.password,
          displayName: input.displayName,
        });
        createdUser = true;
      }
    }

    await addAccountMember(client, {
      accountId: account.id,
      userId: user.id,
      role: invite.role,
      invitedAt: new Date(),
    });

    await q(
      client,
      `UPDATE caf_core.account_invites
       SET accepted_at = now()
       WHERE id = $1`,
      [invite.id]
    );

    await client.query("COMMIT");
    return { user, account, createdUser };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function signupAccountWithOwner(
  db: Pool,
  input: {
    email: string;
    password: string;
    displayName?: string | null;
    accountName: string;
    accountSlug?: string;
    accountType: AccountType;
  }
): Promise<{ user: UserRow; account: AccountRow; token: string; expiresAt: Date }> {
  const existing = await getUserByEmail(db, input.email);
  if (existing) throw new Error("email_taken");

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const user = await createUser(client, {
      email: input.email,
      password: input.password,
      displayName: input.displayName,
    });
    const account = await createAccount(client, {
      slug: input.accountSlug || input.accountName,
      displayName: input.accountName,
      accountType: input.accountType,
    });
    await addAccountMember(client, {
      accountId: account.id,
      userId: user.id,
      role: "owner",
    });
    const session = await createSession(client, { userId: user.id });
    await client.query("COMMIT");
    return { user, account, token: session.token, expiresAt: session.expiresAt };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Ensure Connectrs has an owner user when bootstrap env is set.
 * Safe to call on every startup — no-op if owner already exists or env unset.
 */
export async function updateUserPassword(
  db: Db,
  userId: string,
  password: string
): Promise<void> {
  const { hash, salt } = hashPassword(password);
  await q(
    db,
    `UPDATE caf_core.users
     SET password_hash = $2, password_salt = $3, updated_at = now()
     WHERE id = $1`,
    [userId, hash, salt]
  );
}

/**
 * Ensure Connectrs has the platform owner user (create / password sync / owner role).
 * Safe to call on every startup.
 */
export async function bootstrapConnectrsOwner(
  db: Pool,
  input: { email: string; password: string; displayName?: string | null }
): Promise<{ created: boolean; userId: string; accountId: string } | null> {
  const account = await getAccountBySlug(db, "connectrs");
  if (!account) return null;

  let created = false;
  let user = await getUserByEmail(db, input.email);
  if (!user) {
    user = await createUser(db, {
      email: input.email,
      password: input.password,
      displayName: input.displayName ?? "Connectrs",
    });
    created = true;
  } else {
    // Keep bootstrap password in sync so the known Connectrs login always works.
    await updateUserPassword(db, user.id, input.password);
    if (input.displayName) {
      await q(
        db,
        `UPDATE caf_core.users SET display_name = $2, updated_at = now() WHERE id = $1`,
        [user.id, input.displayName]
      );
    }
  }

  await addAccountMember(db, {
    accountId: account.id,
    userId: user.id,
    role: "owner",
  });

  // Owners see all account projects — no need to assign each brand.
  return { created, userId: user.id, accountId: account.id };
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
  };
}

export function requireAccountAdmin(membership: AccountMemberRow | null): membership is AccountMemberRow {
  return !!membership && membership.status === "active" && isAccountAdminRole(membership.role);
}
