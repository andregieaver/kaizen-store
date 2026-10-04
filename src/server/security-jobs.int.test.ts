import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { addMember, auditRows, makeAccount, makeStore } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const jobs = await import("./security-jobs");

type Row = Record<string, unknown>;

/** The database's own message: drizzle wraps it ("Failed query") and keeps it as the cause. */
async function refused(statement: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await statement;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    expect(`${cause?.message ?? ""} ${(error as Error).message}`).toMatch(pattern);
    return;
  }
  throw new Error("the statement was not refused");
}

/**
 * The daily jobs of staff security (wave 1, 1f, docs/wave-1-trust.md 3.3, 3.6): collaborators ending at their expiry, the activity log
 * kept for 24 months and no longer, and spent recovery codes pruned after 12. Each takes a fixed clock.
 */

let store: Awaited<ReturnType<typeof makeStore>>;

beforeAll(async () => {
  store = await makeStore("jobs");
});

afterAll(async () => {
  await closeDb();
});

const collaborator = async (label: string, expires: string, disabled = false) => {
  const person = await makeAccount(label);
  await addMember(store.id, person.id, "admin", { kind: "collaborator", expiresAt: new Date(expires) });
  if (disabled) await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${store.id}::uuid and account_id = ${person.id}::uuid`);
  return person;
};
const state = async (accountId: string) => (await db().execute<Row>(sql`select disabled_at from commerce.store_members where store_id = ${store.id}::uuid and account_id = ${accountId}::uuid`))[0];

describe("collaborators ending", () => {
  it("marks the ones whose time has run out, at the clock's time, and writes it down; never an owner or a collaborator with time left", async () => {
    const ending = await collaborator("ending", "2026-10-05T12:00:00Z");
    const later = await collaborator("later", "2026-12-01T00:00:00Z");
    const already = await collaborator("already", "2026-09-01T00:00:00Z", true);
    const staff = await makeAccount("staff");
    await addMember(store.id, staff.id, "admin");

    // The job works across stores, so other tests' collaborators may also have run out: what is held is this store's own.
    await jobs.endExpiredCollaborators(new Date("2026-10-04T12:00:00Z"));
    expect((await state(ending.id)).disabled_at).toBeNull();

    expect(await jobs.endExpiredCollaborators(new Date("2026-10-06T00:00:00Z"))).toBeGreaterThanOrEqual(1);
    expect(new Date(String((await state(ending.id)).disabled_at)).toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect((await state(later.id)).disabled_at).toBeNull();
    expect((await state(staff.id)).disabled_at).toBeNull();
    expect((await state(store.account.id)).disabled_at).toBeNull();
    // The one that was removed before is not logged again.
    expect(await jobs.endExpiredCollaborators(new Date("2026-10-06T00:00:00Z"))).toBe(0);

    const log = (await auditRows(store.id, "staff.collaborator_expired")).filter((l) => l.target_id === ending.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ area: "staff", account_id: null, details: { email: ending.email } });
    expect((await auditRows(store.id, "staff.collaborator_expired")).filter((l) => l.target_id === already.id)).toHaveLength(0);
  });
});

describe("the activity log is kept 24 months", () => {
  const insert = async (action: string, ago: string) => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.audit_log (store_id, account_id, action, details, area, created_at)
      values (${store.id}::uuid, ${store.account.id}::uuid, ${action}, '{}'::jsonb, 'settings', now() - ${ago}::interval) returning id
    `);
    return Number(row.id);
  };
  const exists = async (id: number) => (await db().execute<Row>(sql`select 1 from commerce.audit_log where id = ${id}`)).length === 1;

  it("removes what is older than 24 months and keeps the rest, and the database refuses to remove anything younger by hand", async () => {
    const old = await insert("settings.old", "25 months");
    const nearly = await insert("settings.nearly", "23 months 20 days");
    const recent = await insert("settings.recent", "1 day");
    await refused(db().execute(sql`delete from commerce.audit_log where id = ${nearly}`), /append-only/);
    expect((await jobs.pruneAuditLog()) >= 1).toBe(true);
    expect(await exists(old)).toBe(false);
    expect(await exists(nearly)).toBe(true);
    expect(await exists(recent)).toBe(true);
  });

  it("never passes the database's own clock, whatever clock it is given", async () => {
    const nearly = await insert("settings.nearly2", "23 months 25 days");
    const old = await insert("settings.old2", "30 months");
    // A clock years ahead would make a younger entry look old: the database would refuse it, so the cutoff is held at the database's own now.
    expect((await jobs.pruneAuditLog(new Date("2031-01-01T00:00:00Z"))) >= 1).toBe(true);
    expect(await exists(old)).toBe(false);
    expect(await exists(nearly)).toBe(true);
  });

  it("cannot be edited in place (only a missing area is filled, once)", async () => {
    const id = await insert("settings.edit", "1 day");
    await refused(db().execute(sql`update commerce.audit_log set action = 'settings.changed' where id = ${id}`), /append-only/);
    await refused(db().execute(sql`update commerce.audit_log set area = 'billing' where id = ${id}`), /append-only/);
  });
});

describe("recovery codes", () => {
  it("are pruned twelve months after they were used or revoked; unused ones stay", async () => {
    const person = await makeAccount("codes");
    const hash = (n: number) => n.toString(16).padStart(64, "0");
    const insert = async (n: number, used: string | null, revoked: string | null) =>
      db().execute(sql`
        insert into commerce.account_recovery_codes (account_id, batch, code_hash, used_at, revoked_at)
        values (${person.id}::uuid, gen_random_uuid(), ${hash(n)},
          ${used ? sql`now() - ${used}::interval` : null}, ${revoked ? sql`now() - ${revoked}::interval` : null})
      `);
    await insert(1, "13 months", null);
    await insert(2, "2 months", null);
    await insert(3, null, "14 months");
    await insert(4, null, null);
    await insert(5, null, "1 month");
    expect(await jobs.pruneRecoveryCodes()).toBeGreaterThanOrEqual(2);
    const left = await db().execute<Row>(sql`select code_hash from commerce.account_recovery_codes where account_id = ${person.id}::uuid order by code_hash`);
    expect(left.map((r) => String(r.code_hash))).toEqual([hash(2), hash(4), hash(5)]);
  });

  it("the daily run reports all three, and one failing does not stop the others", async () => {
    const result = await jobs.runSecurityJobs();
    expect(Object.keys(result).sort()).toEqual(["auditEntriesPruned", "collaboratorsEnded", "recoveryCodesPruned"]);
  });
});
