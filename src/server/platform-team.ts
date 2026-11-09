import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { normaliseEmail } from "@/lib/email-address";
import { ROLE_TEMPLATES } from "@/lib/permissions";
import { HOUSE_ROLE_TEMPLATE, isMemberRole, isPlatformRole, type MemberRole, type PlatformRole } from "@/lib/platform-access";

import { audit, type Account } from "./auth";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The platform's team (C1 of `docs/platform-parity-plan.md`, D471): who runs Kaizena Flow. A platform admin is an account with
 * `platform_admin`; until now one was made only by SQL. Platform → Settings → Team lists them and adds or removes one; the database makes each
 * an owner of Kaizena Flow's own store and takes that away with them (`house_members_sync()`, D466), and holds every platform admin at the
 * second step of signing in (D158). Adding one asks for a fresh sign-in, as closing a store does. Roles (D510): an owner is a platform admin
 * as before; support, content, finance and read-only are kept in `platform_role`, read everything and change their own area
 * (`src/lib/platform-access.ts`), and work in Kaizena Flow's store as admins in the store role of the same work, set here. Only an owner
 * changes the team; the platform always keeps an owner.
 */

export type PlatformAdmin = { id: string; email: string; name: string | null; role: PlatformRole; twoStep: boolean; since: string; you: boolean };

/** Everyone on the platform's team, owners first. */
export async function listPlatformAdmins(viewer: Account): Promise<PlatformAdmin[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, email: col.text, name: col.textOrNull, platform_admin: col.bool, platform_role: col.textOrNull, two_step: col.bool, since: col.timestamp }),
    sql`
      select a.id, a.email, a.name, a.platform_admin, a.platform_role, a.two_step_since is not null as two_step, a.created_at as since
      from commerce.accounts a where (a.platform_admin or a.platform_role is not null) and a.disabled_at is null
      order by a.platform_admin desc, lower(coalesce(a.name, a.email)), a.id
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.platform_admin ? "owner" : isPlatformRole(r.platform_role) ? r.platform_role : "read_only",
    twoStep: r.two_step,
    since: new Date(r.since).toISOString(),
    you: r.id === viewer.id,
  }));
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * A member's place in Kaizena Flow's own store (D510): an admin in the store role of their work, made from the store's starting role of
 * that name when the store has none yet. An owner's place is the database's (`house_members_sync()`).
 */
async function placeInHouse(tx: Tx, accountId: string, role: MemberRole): Promise<void> {
  const house = await typedRow(z.object({ id: col.uuid.nullable() }), sql`select commerce.house_store() as id`, tx);
  if (!house?.id) return;
  const template = HOUSE_ROLE_TEMPLATE[role];
  const { name, permissions } = ROLE_TEMPLATES[template];
  const find = () =>
    typedRow(
      z.object({ id: col.uuid }),
      sql`select id from commerce.store_roles where store_id = ${house.id}::uuid and (template = ${template} or (template is null and lower(name) = lower(${name})))
           order by template is null limit 1`,
      tx,
    );
  let found = await find();
  if (!found) {
    await tx.execute(sql`
      insert into commerce.store_roles (store_id, name, template, permissions)
      values (${house.id}::uuid, ${name}, ${template}, ${sql`array[${sql.join(permissions.map((k) => sql`${k}`), sql`, `)}]::text[]`})
      on conflict do nothing`);
    found = await find();
  }
  if (!found) return;
  await tx.execute(sql`
    insert into commerce.store_members (store_id, account_id, role, role_id)
    values (${house.id}::uuid, ${accountId}::uuid, 'admin', ${found.id}::uuid)
    on conflict (store_id, account_id) do update set role = 'admin', role_id = excluded.role_id, disabled_at = null, expires_at = null, kind = 'staff'`);
}

export type TeamResult = { ok: true; email: string } | { ok: false; problem: "invalid" | "disabled" | "already" | "self" | "last" | "not_found" };

/** The two columns a role is kept in: an owner is `platform_admin`, any other role `platform_role`. */
const columnsOf = (role: PlatformRole | null) => ({ admin: role !== null && !isMemberRole(role), member: isMemberRole(role) ? role : null });

const emailShape = z.email().max(254);

/** Puts a person on the platform's team in a role (an owner by default): their account if they have one, else a new account they sign in to with this email. */
export async function addPlatformAdmin(actor: Account, rawEmail: string, rawName: string, role: PlatformRole = "owner"): Promise<TeamResult> {
  const email = normaliseEmail(rawEmail);
  if (!actor.platformAdmin || !emailShape.safeParse(email).success || !isPlatformRole(role)) return { ok: false, problem: "invalid" };
  const name = rawName.replace(/\s+/g, " ").trim().slice(0, 120) || null;
  const found = await typedRow(
    z.object({ id: col.uuid, on_team: col.bool, disabled: col.bool }),
    sql`select id, platform_admin or platform_role is not null as on_team, disabled_at is not null as disabled from commerce.accounts where lower(email) = ${email}`,
  );
  if (found?.disabled) return { ok: false, problem: "disabled" };
  if (found?.on_team) return { ok: false, problem: "already" };
  const { admin, member } = columnsOf(role);
  const id = await db().transaction(async (tx) => {
    const made = found
      ? (await tx.execute(sql`update commerce.accounts set platform_admin = ${admin}, platform_role = ${member} where id = ${found.id}::uuid`), found.id)
      : (await typedRow(z.object({ id: col.uuid }), sql`insert into commerce.accounts (email, name, platform_admin, platform_role) values (${email}, ${name}, ${admin}, ${member}) returning id`, tx))!.id;
    if (member) await placeInHouse(tx, made, member);
    return made;
  });
  await audit(actor.id, null, "platform.admin_added", { account: id, made: !found, role }, { target: { type: "account", id } });
  return { ok: true, email };
}

/** Gives someone on the team another role: an owner's alone, never one's own, and never so the platform is left without an owner. */
export async function setPlatformRole(actor: Account, accountId: string, role: PlatformRole): Promise<TeamResult> {
  if (!actor.platformAdmin || !isPlatformRole(role)) return { ok: false, problem: "invalid" };
  if (accountId === actor.id) return { ok: false, problem: "self" };
  const { admin, member } = columnsOf(role);
  const result = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform_team'))`);
    const target = await typedRow(
      z.object({ email: col.text, owner: col.bool, owners: col.int }),
      sql`
        select a.email, a.platform_admin as owner,
               (select count(*)::int from commerce.accounts o where o.platform_admin and o.disabled_at is null and o.id <> a.id) as owners
        from commerce.accounts a where a.id = ${accountId}::uuid and (a.platform_admin or a.platform_role is not null) and a.disabled_at is null
      `,
      tx,
    );
    if (!target) return { ok: false as const, problem: "not_found" as const };
    if (target.owner && !admin && target.owners === 0) return { ok: false as const, problem: "last" as const };
    await tx.execute(sql`update commerce.accounts set platform_admin = ${admin}, platform_role = ${member} where id = ${accountId}::uuid`);
    if (member) await placeInHouse(tx, accountId, member);
    return { ok: true as const, email: target.email };
  });
  if (result.ok) await audit(actor.id, null, "platform.role_changed", { account: accountId, role }, { target: { type: "account", id: accountId } });
  return result;
}

/** Takes someone off the platform's team: never oneself, and never the last owner. */
export async function removePlatformAdmin(actor: Account, accountId: string): Promise<TeamResult> {
  if (!actor.platformAdmin) return { ok: false, problem: "invalid" };
  if (accountId === actor.id) return { ok: false, problem: "self" };
  return db().transaction(async (tx) => {
    // One change at a time, so two admins removing each other cannot leave the platform with none.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform_team'))`);
    const target = await typedRow(
      z.object({ email: col.text, owner: col.bool, others: col.int }),
      sql`
        select a.email, a.platform_admin as owner,
               (select count(*)::int from commerce.accounts o where o.platform_admin and o.disabled_at is null and o.id <> a.id) as others
        from commerce.accounts a where a.id = ${accountId}::uuid and (a.platform_admin or a.platform_role is not null)
      `,
      tx,
    );
    if (!target) return { ok: false as const, problem: "not_found" as const };
    if (target.owner && target.others === 0) return { ok: false as const, problem: "last" as const };
    await tx.execute(sql`update commerce.accounts set platform_admin = false, platform_role = null where id = ${accountId}::uuid`);
    await audit(actor.id, null, "platform.admin_removed", { account: accountId }, { target: { type: "account", id: accountId } });
    return { ok: true as const, email: target.email };
  });
}
