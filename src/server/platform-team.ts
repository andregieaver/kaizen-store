import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { normaliseEmail } from "@/lib/email-address";

import { audit, type Account } from "./auth";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The platform's team (C1 of `docs/platform-parity-plan.md`, D471): who runs Kaizena Flow. A platform admin is an account with
 * `platform_admin`; until now one was made only by SQL. Platform → Settings → Team lists them and adds or removes one; the database makes each
 * an owner of Kaizena Flow's own store and takes that away with them (`house_members_sync()`, D466), and holds every platform admin at the
 * second step of signing in (D158). Adding one asks for a fresh sign-in, as closing a store does. One role for now: everything; the store
 * Team's roles (D158) are the next step.
 */

export type PlatformAdmin = { id: string; email: string; name: string | null; twoStep: boolean; since: string; you: boolean };

export async function listPlatformAdmins(viewer: Account): Promise<PlatformAdmin[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, email: col.text, name: col.textOrNull, two_step: col.bool, since: col.timestamp }),
    sql`
      select a.id, a.email, a.name, a.two_step_since is not null as two_step, a.created_at as since
      from commerce.accounts a where a.platform_admin and a.disabled_at is null
      order by lower(coalesce(a.name, a.email)), a.id
    `,
  );
  return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, twoStep: r.two_step, since: new Date(r.since).toISOString(), you: r.id === viewer.id }));
}

export type TeamResult = { ok: true; email: string } | { ok: false; problem: "invalid" | "disabled" | "already" | "self" | "last" | "not_found" };

const emailShape = z.email().max(254);

/** Makes a person a platform admin: their account if they have one, else a new account they sign in to with this email. */
export async function addPlatformAdmin(actor: Account, rawEmail: string, rawName: string): Promise<TeamResult> {
  const email = normaliseEmail(rawEmail);
  if (!actor.platformAdmin || !emailShape.safeParse(email).success) return { ok: false, problem: "invalid" };
  const name = rawName.replace(/\s+/g, " ").trim().slice(0, 120) || null;
  const found = await typedRow(
    z.object({ id: col.uuid, platform_admin: col.bool, disabled: col.bool }),
    sql`select id, platform_admin, disabled_at is not null as disabled from commerce.accounts where lower(email) = ${email}`,
  );
  if (found?.disabled) return { ok: false, problem: "disabled" };
  if (found?.platform_admin) return { ok: false, problem: "already" };
  const id = found
    ? (await db().execute(sql`update commerce.accounts set platform_admin = true where id = ${found.id}::uuid`), found.id)
    : (await typedRow(z.object({ id: col.uuid }), sql`insert into commerce.accounts (email, name, platform_admin) values (${email}, ${name}, true) returning id`))!.id;
  await audit(actor.id, null, "platform.admin_added", { account: id, made: !found }, { target: { type: "account", id } });
  return { ok: true, email };
}

/** Takes a platform admin's rights away: never one's own, and never the last one's. */
export async function removePlatformAdmin(actor: Account, accountId: string): Promise<TeamResult> {
  if (!actor.platformAdmin) return { ok: false, problem: "invalid" };
  if (accountId === actor.id) return { ok: false, problem: "self" };
  return db().transaction(async (tx) => {
    // One change at a time, so two admins removing each other cannot leave the platform with none.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform_team'))`);
    const target = await typedRow(
      z.object({ email: col.text, others: col.int }),
      sql`
        select a.email, (select count(*)::int from commerce.accounts o where o.platform_admin and o.disabled_at is null and o.id <> a.id) as others
        from commerce.accounts a where a.id = ${accountId}::uuid and a.platform_admin
      `,
      tx,
    );
    if (!target) return { ok: false as const, problem: "not_found" as const };
    if (target.others === 0) return { ok: false as const, problem: "last" as const };
    await tx.execute(sql`update commerce.accounts set platform_admin = false where id = ${accountId}::uuid`);
    await audit(actor.id, null, "platform.admin_removed", { account: accountId }, { target: { type: "account", id: accountId } });
    return { ok: true as const, email: target.email };
  });
}
