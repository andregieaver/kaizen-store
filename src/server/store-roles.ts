import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  collaboratorDays,
  collaboratorExpiry,
  GRANTABLE_PERMISSIONS,
  isGrantable,
  normalisePermissions,
  ROLE_TEMPLATE_KEYS,
  ROLE_TEMPLATES,
  type AreaPermission,
  type RoleTemplateKey,
} from "@/lib/permissions";

import { audit, type Membership } from "./auth";
import { auditChange } from "./audit";
import { memberCan, NO_ACCESS } from "./permissions";

type Row = Record<string, unknown>;

/**
 * A store's roles and who holds them (wave 1, 1f, docs/wave-1-trust.md 2.7): the six templates, the owner's own roles, assigning a
 * role to a member, and collaborators (an agency's account with a role and an expiry). Only an owner changes any of it
 * (`staff:write` is held by the owner role only), and a role can only ever contain the keys a custom role may hold, so a role can
 * never grant the power to invite people, change roles or change the plan. The store always keeps one active owner (the database's
 * rule); a role in use cannot be deleted (the database's restrict key).
 */

export type Result = { ok: true } | { ok: false; problems: string[] };

export type StoreRole = {
  id: string;
  name: string;
  template: RoleTemplateKey | null;
  permissions: AreaPermission[];
  /** Active members holding the role. */
  members: number;
};

const isTemplate = (value: unknown): value is RoleTemplateKey => (ROLE_TEMPLATE_KEYS as readonly unknown[]).includes(value);

function toRole(row: Row): StoreRole {
  return {
    id: String(row.id),
    name: String(row.name),
    template: isTemplate(row.template) ? row.template : null,
    permissions: normalisePermissions(((row.permissions ?? []) as unknown[]).map(String)),
    members: Number(row.members ?? 0),
  };
}

const forbid = (member: Pick<Membership, "role" | "kind" | "permissions">): { ok: false; problems: string[] } | null => (memberCan(member, "staff:write") ? null : { ok: false, problems: [NO_ACCESS] });

function isUniqueViolation(error: unknown): boolean {
  for (let e = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) if ((e as { code?: unknown }).code === "23505") return true;
  return false;
}

/**
 * Makes the six role templates the store has not been offered yet (Orders, Products, Marketing, Content, Analytics, Read-only).
 * Idempotent and safe to run when the Team or roles page loads and before a role is given to a member. A template an owner deleted
 * stays in `stores.role_templates_offered` and is never made again; one that exists (made by an earlier call, or by a racing one)
 * is left as it is, because the template key is unique per store. The owner can edit or delete them like any role.
 */
export async function ensureStoreRoles(storeId: string, createdBy: string | null = null): Promise<void> {
  const [row] = await db().execute<Row>(sql`select role_templates_offered from commerce.stores where id = ${storeId}::uuid`);
  if (!row) return;
  const offered = new Set(((row.role_templates_offered ?? []) as unknown[]).map(String));
  const missing = ROLE_TEMPLATE_KEYS.filter((key) => !offered.has(key));
  if (missing.length === 0) return;
  await db().transaction(async (tx) => {
    for (const key of missing) {
      const template = ROLE_TEMPLATES[key];
      // A name an owner took for their own role first is not taken from them: the template is then made with its name and a suffix.
      await tx.execute(sql`
        insert into commerce.store_roles (store_id, name, template, permissions, created_by)
        values (${storeId}::uuid,
          case when exists (select 1 from commerce.store_roles r where r.store_id = ${storeId}::uuid and lower(r.name) = lower(${template.name}))
            then ${`${template.name} (template)`} else ${template.name} end,
          ${key}, ${sql.raw(`array[${template.permissions.map((p) => `'${p}'`).join(", ")}]::text[]`)}, ${createdBy}::uuid)
        on conflict do nothing
      `);
    }
    await tx.execute(sql`
      update commerce.stores set role_templates_offered = (
        select array(select distinct k from unnest(role_templates_offered || ${sql.raw(`array[${missing.map((k) => `'${k}'`).join(", ")}]::text[]`)}) k order by k)
      ) where id = ${storeId}::uuid
    `);
  });
}

/** The store's roles with how many active members hold each, templates first in their own order, then the owner's by name. */
export async function listStoreRoles(storeId: string): Promise<StoreRole[]> {
  const rows = await db().execute<Row>(sql`
    select r.id, r.name, r.template, r.permissions,
      (select count(*)::int from commerce.store_members m where m.store_id = r.store_id and m.role_id = r.id and m.disabled_at is null) as members
    from commerce.store_roles r where r.store_id = ${storeId}::uuid
    order by r.template is null, array_position(${sql.raw(`array[${ROLE_TEMPLATE_KEYS.map((k) => `'${k}'`).join(", ")}]::text[]`)}, r.template), lower(r.name)
  `);
  return rows.map(toRole);
}

/** Who holds a role (active members), for the refusal to delete it and for the roles page. */
export async function roleHolders(storeId: string, roleId: string): Promise<{ accountId: string; email: string }[]> {
  const rows = await db().execute<Row>(sql`
    select a.id, a.email from commerce.store_members m join commerce.accounts a on a.id = m.account_id
    where m.store_id = ${storeId}::uuid and m.role_id = ${roleId}::uuid and m.disabled_at is null order by lower(a.email)
  `);
  return rows.map((row) => ({ accountId: String(row.id), email: String(row.email) }));
}

type RoleInput = { name: string; permissions: readonly string[] };

/** What a role asks for, held to the rules: a name of 1 to 60 characters, and only keys a custom role may hold. */
export function roleProblems(input: RoleInput): { problems: string[]; name: string; permissions: AreaPermission[] } {
  const name = input.name.replace(/\s+/g, " ").trim();
  const problems: string[] = [];
  if (name.length < 1 || name.length > 60) problems.push("Give the role a name of 1 to 60 characters.");
  const refused = input.permissions.filter((key) => !isGrantable(key));
  if (refused.length > 0) problems.push(`A role cannot hold ${refused.join(", ")}: only an owner can change the team or the plan.`);
  return { problems, name, permissions: normalisePermissions(input.permissions.filter(isGrantable)) };
}

export async function createRole(member: Membership, input: RoleInput): Promise<{ ok: true; id: string } | { ok: false; problems: string[] }> {
  const refusal = forbid(member);
  if (refusal) return refusal;
  const checked = roleProblems(input);
  if (checked.problems.length > 0) return { ok: false, problems: checked.problems };
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.store_roles (store_id, name, permissions, created_by)
      values (${member.store.id}::uuid, ${checked.name}, ${sql.raw(`array[${checked.permissions.map((p) => `'${p}'`).join(", ")}]::text[]`)}, ${member.account.id}::uuid)
      returning id
    `);
    const id = String(row.id);
    await auditChange(member, "role.created", { type: "role", id, label: checked.name }, null, { name: checked.name, permissions: checked.permissions }, "role");
    return { ok: true, id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problems: [`A role called ${checked.name} already exists.`] };
    throw error;
  }
}

export async function updateRole(member: Membership, roleId: string, input: RoleInput): Promise<Result> {
  const refusal = forbid(member);
  if (refusal) return refusal;
  const checked = roleProblems(input);
  if (checked.problems.length > 0) return { ok: false, problems: checked.problems };
  const [before] = await db().execute<Row>(sql`select name, permissions from commerce.store_roles where store_id = ${member.store.id}::uuid and id = ${roleId}::uuid`);
  if (!before) return { ok: false, problems: ["That role no longer exists."] };
  try {
    await db().execute(sql`
      update commerce.store_roles set name = ${checked.name},
        permissions = ${sql.raw(`array[${checked.permissions.map((p) => `'${p}'`).join(", ")}]::text[]`)}, updated_at = now()
      where store_id = ${member.store.id}::uuid and id = ${roleId}::uuid
    `);
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problems: [`A role called ${checked.name} already exists.`] };
    throw error;
  }
  await auditChange(
    member,
    "role.updated",
    { type: "role", id: roleId, label: checked.name },
    { name: String(before.name), permissions: normalisePermissions(((before.permissions ?? []) as unknown[]).map(String)) },
    { name: checked.name, permissions: checked.permissions },
    "role",
  );
  return { ok: true };
}

/** Deletes a role nobody holds; one in use is refused and says who holds it. */
export async function deleteRole(member: Membership, roleId: string): Promise<Result> {
  const refusal = forbid(member);
  if (refusal) return refusal;
  const holders = await roleHolders(member.store.id, roleId);
  if (holders.length > 0) return { ok: false, problems: [`${holders.map((h) => h.email).join(", ")} ${holders.length === 1 ? "holds" : "hold"} this role. Give them another role first.`] };
  try {
    const rows = await db().execute<Row>(sql`
      delete from commerce.store_roles where store_id = ${member.store.id}::uuid and id = ${roleId}::uuid returning name, permissions
    `);
    if (rows.length === 0) return { ok: false, problems: ["That role no longer exists."] };
    const old = rows[0];
    await auditChange(member, "role.deleted", { type: "role", id: roleId, label: String(old.name) }, { name: String(old.name), permissions: normalisePermissions(((old.permissions ?? []) as unknown[]).map(String)) }, null, "role");
    return { ok: true };
  } catch {
    // A past member (disabled) may still point at it: the database's restrict key says no.
    return { ok: false, problems: ["This role is still held by a past member. Give it another role or remove it from the team page first."] };
  }
}

/** What a member can be given: the owner role, the default admin set, or one of the store's roles. */
export type RoleChoice = { kind: "owner" } | { kind: "admin" } | { kind: "role"; roleId: string };

/**
 * Gives an active member of the store a role. A collaborator is never an owner (the database says so) and the store keeps one active
 * owner (the database says so too: the refusal is turned into a sentence). Audit-logged with the role before and after.
 */
export async function assignRole(member: Membership, accountId: string, choice: RoleChoice): Promise<Result> {
  const refusal = forbid(member);
  if (refusal) return refusal;
  const [current] = await db().execute<Row>(sql`
    select m.role, m.kind, a.email, r.name as role_name
    from commerce.store_members m
    join commerce.accounts a on a.id = m.account_id
    left join commerce.store_roles r on r.store_id = m.store_id and r.id = m.role_id
    where m.store_id = ${member.store.id}::uuid and m.account_id = ${accountId}::uuid and m.disabled_at is null
  `);
  if (!current) return { ok: false, problems: ["That person is not a member of the store."] };
  if (current.kind === "collaborator" && choice.kind === "owner") return { ok: false, problems: ["A collaborator cannot be an owner."] };
  let roleName: string | null = null;
  if (choice.kind === "role") {
    const [role] = await db().execute<Row>(sql`select name from commerce.store_roles where store_id = ${member.store.id}::uuid and id = ${choice.roleId}::uuid`);
    if (!role) return { ok: false, problems: ["That role no longer exists."] };
    roleName = String(role.name);
  }
  const role = choice.kind === "owner" ? "owner" : "admin";
  const roleId = choice.kind === "role" ? choice.roleId : null;
  try {
    await db().execute(sql`
      update commerce.store_members set role = ${role}, role_id = ${roleId}::uuid
      where store_id = ${member.store.id}::uuid and account_id = ${accountId}::uuid and disabled_at is null
    `);
  } catch {
    return { ok: false, problems: ["The store must keep at least one active owner."] };
  }
  await auditChange(
    member,
    "staff.role_assigned",
    { type: "account", id: accountId, label: String(current.email) },
    { email: String(current.email), role: String(current.role), roleName: current.role_name ? String(current.role_name) : null },
    { email: String(current.email), role, roleName },
    "staff",
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Collaborators
// ---------------------------------------------------------------------------

/**
 * Invites an email as a collaborator: an account that can be a member of other stores (an agency's), with a role that is never owner
 * and never holds the team or the plan, and an expiry of 1 to 365 days (30 by default). It shows in the staff list with a badge and
 * the end date and loses access at the expiry. Creates the account if the email has none; a person who already has access cannot be
 * invited again (end it or change their role instead).
 */
export async function inviteCollaborator(member: Membership, email: string, roleId: string | null, days: unknown, now: Date = new Date()): Promise<Result> {
  const refusal = forbid(member);
  if (refusal) return refusal;
  const length = collaboratorDays(days ?? 30);
  if (length === null) return { ok: false, problems: ["Choose between 1 and 365 days."] };
  const expires = collaboratorExpiry(now, length);
  if (roleId) {
    const [role] = await db().execute<Row>(sql`select 1 from commerce.store_roles where store_id = ${member.store.id}::uuid and id = ${roleId}::uuid`);
    if (!role) return { ok: false, problems: ["That role no longer exists."] };
  }
  const result = await db().transaction(async (tx) => {
    const [invitee] = await tx.execute<Row>(sql`
      insert into commerce.accounts (email) values (${email})
      on conflict ((lower(email))) do update set email = commerce.accounts.email
      returning id, disabled_at
    `);
    if (invitee.disabled_at) return "disabled" as const;
    const [existing] = await tx.execute<Row>(sql`
      select disabled_at, expires_at from commerce.store_members where store_id = ${member.store.id}::uuid and account_id = ${String(invitee.id)}::uuid
    `);
    // A collaborator whose time ran out (or who was removed) can be invited again; anyone with access now cannot.
    if (existing && !existing.disabled_at && (!existing.expires_at || new Date(String(existing.expires_at)) > now)) return "member" as const;
    await tx.execute(sql`
      insert into commerce.store_members (store_id, account_id, role, role_id, kind, expires_at, invited_by)
      values (${member.store.id}::uuid, ${String(invitee.id)}::uuid, 'admin', ${roleId}::uuid, 'collaborator', ${expires.toISOString()}::timestamptz, ${member.account.id}::uuid)
      on conflict (store_id, account_id) do update set role = 'admin', role_id = excluded.role_id, kind = 'collaborator',
        expires_at = excluded.expires_at, disabled_at = null, invited_by = excluded.invited_by
    `);
    return String(invitee.id);
  });
  if (result === "member") return { ok: false, problems: [`${email} already has access.`] };
  if (result === "disabled") return { ok: false, problems: [`${email} cannot be invited. Contact support.`] };
  await auditChange(member, "staff.collaborator_invited", { type: "account", id: result, label: email }, null, { email, kind: "collaborator", expiresAt: expires.toISOString() }, "staff");
  return { ok: true };
}

/** Gives a collaborator more time: the access now ends `days` from now; one that had ended is active again. */
export async function extendCollaborator(member: Membership, accountId: string, days: unknown, now: Date = new Date()): Promise<Result> {
  const refusal = forbid(member);
  if (refusal) return refusal;
  const length = collaboratorDays(days);
  if (length === null) return { ok: false, problems: ["Choose between 1 and 365 days."] };
  const expires = collaboratorExpiry(now, length);
  const rows = await db().execute<Row>(sql`
    update commerce.store_members m set expires_at = ${expires.toISOString()}::timestamptz, disabled_at = null
    from commerce.accounts a
    where m.store_id = ${member.store.id}::uuid and m.account_id = ${accountId}::uuid and m.kind = 'collaborator' and a.id = m.account_id
    returning a.email
  `);
  if (rows.length === 0) return { ok: false, problems: ["That person is not a collaborator of the store."] };
  await audit(member.account.id, member.store.id, "staff.collaborator_extended", { email: String(rows[0].email), expiresAt: expires.toISOString() }, { target: { type: "account", id: accountId }, area: "staff" });
  return { ok: true };
}

export { GRANTABLE_PERMISSIONS };
