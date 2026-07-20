import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { ensureProject, getProjectBySlug, updateProjectBySlug } from "../repositories/core.js";
import {
  acceptInvite,
  assignProjectMember,
  attachProjectToAccount,
  authenticateUser,
  bootstrapConnectrsOwner,
  countAccountMembers,
  countAccountProjects,
  createInvite,
  createSession,
  getAccountBySlug,
  getAccountMembership,
  getInviteByRawToken,
  getUserByEmail,
  listAccountMembers,
  listAccountMembershipsForUser,
  listAllowedProjectsForUser,
  listPendingInvites,
  listProjectMembers,
  publicUser,
  removeProjectMember,
  requireAccountAdmin,
  resolveSessionUser,
  revokeSessionByToken,
  signupAccountWithOwner,
  userCanAccessProjectSlug,
} from "../repositories/accounts.js";

function sessionTokenFromRequest(request: { headers: Record<string, unknown> }): string | null {
  const header = request.headers["x-caf-session-token"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const auth = request.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("session ")) {
    return auth.slice(8).trim();
  }
  return null;
}

export async function registerAccountRoutes(
  app: FastifyInstance,
  deps: { db: Pool; config: AppConfig }
) {
  const { db, config } = deps;

  // Optional Connectrs owner bootstrap (env) — never breaks startup.
  if (config.CAF_BOOTSTRAP_OWNER_EMAIL && config.CAF_BOOTSTRAP_OWNER_PASSWORD) {
    try {
      const result = await bootstrapConnectrsOwner(db, {
        email: config.CAF_BOOTSTRAP_OWNER_EMAIL,
        password: config.CAF_BOOTSTRAP_OWNER_PASSWORD,
        displayName: config.CAF_BOOTSTRAP_OWNER_NAME ?? "Connectrs Owner",
      });
      if (result?.created) {
        app.log.info(
          { accountId: result.accountId, userId: result.userId },
          "Bootstrapped Connectrs account owner"
        );
      }
    } catch (err) {
      app.log.warn({ err }, "Connectrs owner bootstrap skipped");
    }
  }

  app.get("/v1/auth/status", async () => {
    return {
      ok: true,
      auth_enforced: config.CAF_ACCOUNT_AUTH_ENFORCED,
      signup_enabled: config.CAF_ACCOUNT_SIGNUP_ENABLED,
    };
  });

  app.post("/v1/auth/signup", async (request, reply) => {
    if (!config.CAF_ACCOUNT_SIGNUP_ENABLED) {
      return reply.code(403).send({ ok: false, error: "signup_disabled" });
    }
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(8).max(200),
        display_name: z.string().max(120).optional(),
        account_name: z.string().min(2).max(120),
        account_slug: z.string().min(2).max(48).optional(),
        account_type: z.enum(["agency", "personal"]).default("personal"),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: body.error.flatten() });
    }
    try {
      const result = await signupAccountWithOwner(db, {
        email: body.data.email,
        password: body.data.password,
        displayName: body.data.display_name,
        accountName: body.data.account_name,
        accountSlug: body.data.account_slug,
        accountType: body.data.account_type,
      });
      return {
        ok: true,
        user: publicUser(result.user),
        account: {
          id: result.account.id,
          slug: result.account.slug,
          display_name: result.account.display_name,
          account_type: result.account.account_type,
          max_projects: result.account.max_projects,
          max_members: result.account.max_members,
        },
        session_token: result.token,
        expires_at: result.expiresAt.toISOString(),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "email_taken") return reply.code(409).send({ ok: false, error: "email_taken" });
      if (msg === "invalid_account_slug") {
        return reply.code(400).send({ ok: false, error: "invalid_account_slug" });
      }
      throw e;
    }
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1).max(200),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: "invalid_body" });

    const user = await authenticateUser(db, body.data.email, body.data.password);
    if (!user) return reply.code(401).send({ ok: false, error: "invalid_credentials" });

    const session = await createSession(db, {
      userId: user.id,
      userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
      ipAddress: request.ip,
    });
    const memberships = await listAccountMembershipsForUser(db, user.id);
    const projects = await listAllowedProjectsForUser(db, user.id);

    return {
      ok: true,
      user: publicUser(user),
      session_token: session.token,
      expires_at: session.expiresAt.toISOString(),
      accounts: memberships.map((m) => ({
        id: m.account_id,
        slug: m.account_slug,
        display_name: m.account_display_name,
        account_type: m.account_type,
        role: m.role,
      })),
      projects: projects.map((p) => ({
        slug: p.slug,
        display_name: p.display_name,
        account_slug: p.account_slug,
        access: p.access,
      })),
    };
  });

  app.post("/v1/auth/logout", async (request) => {
    const token = sessionTokenFromRequest(request);
    if (token) await revokeSessionByToken(db, token);
    return { ok: true };
  });

  app.get("/v1/auth/me", async (request, reply) => {
    const token = sessionTokenFromRequest(request);
    if (!token) return reply.code(401).send({ ok: false, error: "unauthorized" });
    const user = await resolveSessionUser(db, token);
    if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const memberships = await listAccountMembershipsForUser(db, user.id);
    const projects = await listAllowedProjectsForUser(db, user.id);
    return {
      ok: true,
      auth_enforced: config.CAF_ACCOUNT_AUTH_ENFORCED,
      user: publicUser(user),
      accounts: memberships.map((m) => ({
        id: m.account_id,
        slug: m.account_slug,
        display_name: m.account_display_name,
        account_type: m.account_type,
        role: m.role,
      })),
      projects: projects.map((p) => ({
        id: p.id,
        slug: p.slug,
        display_name: p.display_name,
        active: p.active,
        color: p.color,
        account_id: p.account_id,
        account_slug: p.account_slug,
        access: p.access,
      })),
      project_slugs: projects.map((p) => p.slug),
    };
  });

  app.get("/v1/auth/invites/:token", async (request, reply) => {
    const params = z.object({ token: z.string().min(8) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "invalid_params" });
    const invite = await getInviteByRawToken(db, params.data.token);
    if (!invite || invite.accepted_at || invite.revoked_at) {
      return reply.code(404).send({ ok: false, error: "invite_not_found" });
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return reply.code(410).send({ ok: false, error: "invite_expired" });
    }
    return {
      ok: true,
      invite: {
        email: invite.email,
        role: invite.role,
        expires_at: invite.expires_at,
        account_slug: invite.account_slug,
        account_display_name: invite.account_display_name,
      },
    };
  });

  app.post("/v1/auth/accept-invite", async (request, reply) => {
    const body = z
      .object({
        token: z.string().min(8),
        password: z.string().min(8).max(200).optional(),
        display_name: z.string().max(120).optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: "invalid_body" });

    const sessionUser = await (async () => {
      const t = sessionTokenFromRequest(request);
      return t ? resolveSessionUser(db, t) : null;
    })();

    try {
      const result = await acceptInvite(db, {
        rawToken: body.data.token,
        password: body.data.password,
        displayName: body.data.display_name,
        existingUserId: sessionUser?.id,
      });
      const session = await createSession(db, {
        userId: result.user.id,
        userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
        ipAddress: request.ip,
      });
      return {
        ok: true,
        created_user: result.createdUser,
        user: publicUser(result.user),
        account: {
          id: result.account.id,
          slug: result.account.slug,
          display_name: result.account.display_name,
        },
        session_token: session.token,
        expires_at: session.expiresAt.toISOString(),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const map: Record<string, number> = {
        invite_invalid: 404,
        invite_expired: 410,
        account_inactive: 403,
        member_cap_reached: 403,
        password_required: 400,
        invite_email_mismatch: 403,
        user_not_found: 401,
      };
      const code = map[msg];
      if (code) return reply.code(code).send({ ok: false, error: msg });
      throw e;
    }
  });

  app.get("/v1/accounts/:account_slug", async (request, reply) => {
    const user = await requireSession(request, reply, db);
    if (!user) return;
    const params = z.object({ account_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "invalid_params" });

    const account = await getAccountBySlug(db, params.data.account_slug);
    if (!account) return reply.code(404).send({ ok: false, error: "not_found" });
    const membership = await getAccountMembership(db, account.id, user.id);
    if (!membership) return reply.code(403).send({ ok: false, error: "forbidden" });

    const [members, invites, projectCount, memberCount] = await Promise.all([
      listAccountMembers(db, account.id),
      requireAccountAdmin(membership) ? listPendingInvites(db, account.id) : Promise.resolve([]),
      countAccountProjects(db, account.id),
      countAccountMembers(db, account.id),
    ]);

    return {
      ok: true,
      account: {
        id: account.id,
        slug: account.slug,
        display_name: account.display_name,
        account_type: account.account_type,
        max_projects: account.max_projects,
        max_members: account.max_members,
        project_count: projectCount,
        member_count: memberCount,
      },
      me: { role: membership.role },
      members: members.map((m) => ({
        user_id: m.user_id,
        email: m.email,
        display_name: m.display_name,
        role: m.role,
        status: m.status,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expires_at: i.expires_at,
      })),
    };
  });

  app.post("/v1/accounts/:account_slug/invites", async (request, reply) => {
    const user = await requireSession(request, reply, db);
    if (!user) return;
    const params = z.object({ account_slug: z.string() }).safeParse(request.params);
    const body = z
      .object({
        email: z.string().email(),
        role: z.enum(["admin", "member"]).default("member"),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_request" });
    }

    const account = await getAccountBySlug(db, params.data.account_slug);
    if (!account) return reply.code(404).send({ ok: false, error: "not_found" });
    const membership = await getAccountMembership(db, account.id, user.id);
    if (!requireAccountAdmin(membership)) {
      return reply.code(403).send({ ok: false, error: "forbidden" });
    }

    const memberCount = await countAccountMembers(db, account.id);
    const pending = await listPendingInvites(db, account.id);
    if (memberCount + pending.length >= account.max_members) {
      return reply.code(403).send({
        ok: false,
        error: "member_cap_reached",
        max_members: account.max_members,
      });
    }

    const existingUser = await getUserByEmail(db, body.data.email);
    if (existingUser) {
      const already = await getAccountMembership(db, account.id, existingUser.id);
      if (already) {
        return reply.code(409).send({ ok: false, error: "already_member" });
      }
    }

    const { invite, rawToken } = await createInvite(db, {
      accountId: account.id,
      email: body.data.email,
      role: body.data.role,
      invitedByUserId: user.id,
    });

    return {
      ok: true,
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expires_at: invite.expires_at,
        /** Raw token returned once for the inviter to share (no email sender yet). */
        token: rawToken,
        accept_path: `/invite/${rawToken}`,
      },
    };
  });

  app.post("/v1/accounts/:account_slug/projects", async (request, reply) => {
    const user = await requireSession(request, reply, db);
    if (!user) return;
    const params = z.object({ account_slug: z.string() }).safeParse(request.params);
    const body = z
      .object({
        slug: z.string().min(1).max(64),
        display_name: z.string().optional(),
        color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        enabled_content_routes: z.array(z.string()).optional(),
        apply_default_content_routes: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_request" });
    }

    const account = await getAccountBySlug(db, params.data.account_slug);
    if (!account) return reply.code(404).send({ ok: false, error: "not_found" });
    const membership = await getAccountMembership(db, account.id, user.id);
    if (!requireAccountAdmin(membership)) {
      return reply.code(403).send({ ok: false, error: "forbidden" });
    }

    const existing = await getProjectBySlug(db, body.data.slug.trim());
    if (existing) {
      return reply.code(409).send({ ok: false, error: "project_exists" });
    }

    const projectCount = await countAccountProjects(db, account.id);
    if (projectCount >= account.max_projects) {
      return reply.code(403).send({
        ok: false,
        error: "project_cap_reached",
        max_projects: account.max_projects,
      });
    }

    const project = await ensureProject(db, body.data.slug, body.data.display_name);
    await attachProjectToAccount(db, project.id, account.id);
    if (body.data.color) {
      await updateProjectBySlug(db, project.slug, { color: body.data.color });
    }

    if (body.data.enabled_content_routes?.length || body.data.apply_default_content_routes) {
      const { applyContentRoutes } = await import("../services/content-routes-apply.js");
      const lanes =
        body.data.enabled_content_routes ?? ["niche_carousels", "visual_first_carousels"];
      await applyContentRoutes(db, project.id, lanes);
    }

    const refreshed = await getProjectBySlug(db, project.slug);
    return {
      ok: true,
      created: true,
      project: refreshed ?? project,
      account_slug: account.slug,
    };
  });

  app.put("/v1/accounts/:account_slug/projects/:project_slug/members", async (request, reply) => {
    const user = await requireSession(request, reply, db);
    if (!user) return;
    const params = z
      .object({ account_slug: z.string(), project_slug: z.string() })
      .safeParse(request.params);
    const body = z
      .object({
        user_id: z.string().uuid(),
        role: z.enum(["editor", "viewer"]).default("editor"),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_request" });
    }

    const account = await getAccountBySlug(db, params.data.account_slug);
    if (!account) return reply.code(404).send({ ok: false, error: "not_found" });
    const membership = await getAccountMembership(db, account.id, user.id);
    if (!requireAccountAdmin(membership)) {
      return reply.code(403).send({ ok: false, error: "forbidden" });
    }

    const project = await getProjectBySlug(db, params.data.project_slug);
    if (!project) return reply.code(404).send({ ok: false, error: "project_not_found" });

    const projectAccount = await qAccountId(db, project.id);
    if (projectAccount !== account.id) {
      return reply.code(403).send({ ok: false, error: "project_not_in_account" });
    }

    const targetMembership = await getAccountMembership(db, account.id, body.data.user_id);
    if (!targetMembership) {
      return reply.code(400).send({ ok: false, error: "user_not_in_account" });
    }

    await assignProjectMember(db, {
      projectId: project.id,
      userId: body.data.user_id,
      role: body.data.role,
    });
    const members = await listProjectMembers(db, project.id);
    return { ok: true, members };
  });

  app.delete(
    "/v1/accounts/:account_slug/projects/:project_slug/members/:user_id",
    async (request, reply) => {
      const user = await requireSession(request, reply, db);
      if (!user) return;
      const params = z
        .object({
          account_slug: z.string(),
          project_slug: z.string(),
          user_id: z.string().uuid(),
        })
        .safeParse(request.params);
      if (!params.success) return reply.code(400).send({ ok: false, error: "invalid_params" });

      const account = await getAccountBySlug(db, params.data.account_slug);
      if (!account) return reply.code(404).send({ ok: false, error: "not_found" });
      const membership = await getAccountMembership(db, account.id, user.id);
      if (!requireAccountAdmin(membership)) {
        return reply.code(403).send({ ok: false, error: "forbidden" });
      }

      const project = await getProjectBySlug(db, params.data.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project_not_found" });
      await removeProjectMember(db, project.id, params.data.user_id);
      return { ok: true };
    }
  );

  app.get("/v1/accounts/:account_slug/projects/:project_slug/members", async (request, reply) => {
    const user = await requireSession(request, reply, db);
    if (!user) return;
    const params = z
      .object({ account_slug: z.string(), project_slug: z.string() })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "invalid_params" });

    const account = await getAccountBySlug(db, params.data.account_slug);
    if (!account) return reply.code(404).send({ ok: false, error: "not_found" });
    const membership = await getAccountMembership(db, account.id, user.id);
    if (!membership) return reply.code(403).send({ ok: false, error: "forbidden" });

    const project = await getProjectBySlug(db, params.data.project_slug);
    if (!project) return reply.code(404).send({ ok: false, error: "project_not_found" });
    const members = await listProjectMembers(db, project.id);
    return { ok: true, members };
  });

  /** Access check used by Review brand API routes when auth is enforced. */
  app.get("/v1/auth/access/:project_slug", async (request, reply) => {
    const token = sessionTokenFromRequest(request);
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "invalid_params" });

    if (!config.CAF_ACCOUNT_AUTH_ENFORCED) {
      return { ok: true, enforced: false, allowed: true };
    }
    if (!token) return reply.code(401).send({ ok: false, error: "unauthorized", allowed: false });
    const user = await resolveSessionUser(db, token);
    if (!user) return reply.code(401).send({ ok: false, error: "unauthorized", allowed: false });
    const allowed = await userCanAccessProjectSlug(db, user.id, params.data.project_slug);
    if (!allowed) return reply.code(403).send({ ok: false, error: "forbidden", allowed: false });
    return { ok: true, enforced: true, allowed: true };
  });

}

async function requireSession(
  request: { headers: Record<string, unknown> },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  db: Pool
) {
  const token = sessionTokenFromRequest(request);
  if (!token) {
    reply.code(401).send({ ok: false, error: "unauthorized" });
    return null;
  }
  const user = await resolveSessionUser(db, token);
  if (!user) {
    reply.code(401).send({ ok: false, error: "unauthorized" });
    return null;
  }
  return user;
}

async function qAccountId(db: Pool, projectId: string): Promise<string | null> {
  const { qOne } = await import("../db/queries.js");
  const row = await qOne<{ account_id: string | null }>(
    db,
    `SELECT account_id FROM caf_core.projects WHERE id = $1`,
    [projectId]
  );
  return row?.account_id ?? null;
}
