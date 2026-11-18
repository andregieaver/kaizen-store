import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { Officer, OfficerChoice, ResolvedOfficer } from "@/lib/privacy-officer";

import { audit } from "./auth";
import { owned } from "./owned";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The data protection officer (D763, `src/lib/privacy-officer.ts`): an account's (its `commerce.organisations` row) for all its stores, and
 * a store's own instead. A person on the team is read from their account each time, so a new name or address follows; one who is no longer on
 * the account's team names nobody. The account's owner sets the account's; a store's owner sets the store's.
 */

const ROW = z.object({
  account_id: col.uuid.nullable(),
  name: col.textOrNull,
  email: col.textOrNull,
  phone: col.textOrNull,
  firm: col.textOrNull,
  staff_name: col.textOrNull,
  staff_email: col.textOrNull,
  on_team: col.bool,
});

/** The people on an account's team: its members, and everyone with a role in one of its stores (a collaborator whose time ran out is not). */
const teamOf = (organisationId: string) => sql`
  select account_id from commerce.organisation_members where organisation_id = ${organisationId}::uuid
  union
  select m.account_id from commerce.store_members m join commerce.stores s on s.id = m.store_id
  where s.organisation_id = ${organisationId}::uuid and (m.expires_at is null or m.expires_at > now())`;

const asOfficer = (row: z.output<typeof ROW>): Officer | null => {
  if (row.account_id) {
    if (!row.on_team || !row.staff_email) return null;
    return { name: row.staff_name, email: row.staff_email, phone: null, firm: null, staff: true };
  }
  return row.email ? { name: row.name, email: row.email, phone: row.phone, firm: row.firm, staff: false } : null;
};

/** The row an account (no store) or a store keeps, as an officer; `undefined` when there is no row at all. */
async function rowOf(organisationId: string, storeId: string | null): Promise<Officer | null | undefined> {
  const row = await typedRow(
    ROW,
    sql`select o.account_id, o.name, o.email, o.phone, o.firm, a.name as staff_name, a.email as staff_email,
          (o.account_id is not null and o.account_id in (${teamOf(organisationId)})) as on_team
        from commerce.privacy_officers o left join commerce.accounts a on a.id = o.account_id
        where o.organisation_id = ${organisationId}::uuid and ${owned(storeId, sql`o.store_id`)}`,
  );
  return row ? asOfficer(row) : undefined;
}

/** An account's own officer, for every store that names none of its own. */
export async function accountOfficer(organisationId: string): Promise<Officer | null> {
  return (await rowOf(organisationId, null)) ?? null;
}

/** A store's officer: its own row when it has one, else its account's. */
export async function officerForStore(store: { id: string; organisationId: string | null }): Promise<ResolvedOfficer> {
  if (!store.organisationId) return { source: "none", officer: null };
  const own = await rowOf(store.organisationId, store.id);
  if (own) return { source: "store", officer: own };
  const account = await accountOfficer(store.organisationId);
  return account ? { source: "account", officer: account } : { source: "none", officer: null };
}

/** The account's choice as its form shows it again. */
export async function storedChoice(organisationId: string, storeId: string | null): Promise<OfficerChoice> {
  const row = await typedRow(
    z.object({ account_id: col.uuid.nullable(), name: col.textOrNull, email: col.textOrNull, phone: col.textOrNull, firm: col.textOrNull }),
    sql`select account_id, name, email, phone, firm from commerce.privacy_officers where organisation_id = ${organisationId}::uuid and ${owned(storeId)}`,
  );
  if (!row) return storeId ? { kind: "account" } : { kind: "none" };
  if (row.account_id) return { kind: "staff", accountId: row.account_id };
  if (row.email) return { kind: "person", name: row.name ?? "", email: row.email, phone: row.phone, firm: row.firm };
  return { kind: "none" };
}

export type TeamPerson = { accountId: string; name: string | null; email: string };

/** The people who may be chosen: the account's team, or a store's own people for a store. */
export async function officerCandidates(organisationId: string, storeId: string | null): Promise<TeamPerson[]> {
  const people = storeId
    ? sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid and (expires_at is null or expires_at > now())`
    : teamOf(organisationId);
  const rows = await typedRows(
    z.object({ id: col.uuid, name: col.textOrNull, email: col.text }),
    sql`select a.id, a.name, a.email from commerce.accounts a where a.id in (${people}) and a.email <> '' order by coalesce(a.name, a.email), a.email`,
  );
  return rows.map((r) => ({ accountId: r.id, name: r.name, email: r.email }));
}

/** The account a person owns (not Kaizena Flow's own), whose officer they may set; null when they own none. */
export async function ownedAccount(accountId: string): Promise<{ id: string; name: string } | null> {
  return typedRow(
    z.object({ id: col.uuid, name: col.text }),
    sql`select o.id, o.name from commerce.organisation_members m join commerce.organisations o on o.id = m.organisation_id
        where m.account_id = ${accountId}::uuid and m.role = 'owner' and not o.platform order by o.created_at limit 1`,
  );
}

/** Kaizena Flow's own account, whose officer the platform names (the house store and the platform's legal pages). */
export async function platformAccountId(): Promise<string | null> {
  const row = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.organisations where platform limit 1`);
  return row?.id ?? null;
}

export type OfficerResult = { ok: true } | { ok: false; problems: string[] };

/**
 * Keeps a choice for an account (`storeId` null) or a store. `account` (a store only) removes the store's row, so it follows its account;
 * `none` (an account only) removes the account's. A person on the team must be on it.
 */
export async function setOfficer(actorId: string, organisationId: string, storeId: string | null, choice: OfficerChoice): Promise<OfficerResult> {
  if (choice.kind === "staff") {
    const team = await officerCandidates(organisationId, storeId);
    if (!team.some((p) => p.accountId === choice.accountId)) return { ok: false, problems: ["Choose someone on the team, or write in someone else."] };
  }
  await db().transaction(async (tx) => {
    await tx.execute(sql`delete from commerce.privacy_officers where organisation_id = ${organisationId}::uuid and ${owned(storeId)}`);
    // Following the account, or naming nobody (the account's choice only), keeps no row.
    if (choice.kind === "account" || choice.kind === "none") return;
    const person = choice.kind === "person" ? choice : null;
    await tx.execute(sql`
      insert into commerce.privacy_officers (organisation_id, store_id, account_id, name, email, phone, firm, updated_by)
      values (${organisationId}::uuid, ${storeId}::uuid, ${choice.kind === "staff" ? choice.accountId : null}::uuid,
        ${person?.name ?? null}, ${person?.email ?? null}, ${person?.phone ?? null}, ${person?.firm ?? null}, ${actorId}::uuid)`);
  });
  await audit(actorId, storeId, "privacy.officer", { level: storeId ? "store" : "account", kind: choice.kind });
  return { ok: true };
}
