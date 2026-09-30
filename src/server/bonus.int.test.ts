import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { BONUS_DEFAULTS } from "@/lib/bonus";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));

const {
  adjustBonus,
  bonusOverview,
  customerBonus,
  expiringReminders,
  getBonusSettings,
  runBonusJobs,
  saveBonusSettings,
} = await import("./bonus");
const { deleteCustomer } = await import("./customers");

/**
 * The bonus program's engine on a real database (D130): settings, who may change what, the ledger's history and
 * overview, the five-minute job (expiry, reminders, releasing held credits) and a customer's deletion. What checkout does
 * with credits is held in `checkout-kinds.int.test.ts`.
 */

const run = Date.now().toString(36);
let storeId: string;
let owner: Account;
let admin: Account;
let stranger: Account;

const account = async (role: "owner" | "admin" | null, label: string): Promise<Account> => {
  const email = `${label}-${run}@example.com`;
  const [row] = await db().execute<Row>(
    sql`insert into commerce.accounts (email, name) values (${email}, ${label}) returning id`,
  );
  const id = String(row.id);
  if (role)
    await db().execute(
      sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}::uuid, ${id}::uuid, ${role})`,
    );
  return { id, email, name: label, platformAdmin: false };
};

const customer = async (label: string, over: { optedOut?: boolean } = {}) => {
  const email = `${label}-${run}@example.com`;
  const [row] = await db().execute<Row>(
    sql`insert into commerce.customers (store_id, email, name) values (${storeId}::uuid, ${email}, ${label}) returning id`,
  );
  if (over.optedOut)
    await db().execute(
      sql`insert into commerce.email_opt_outs (store_id, email, source) values (${storeId}::uuid, ${email}, 'unsubscribe')`,
    );
  return { id: String(row.id), email };
};

const grant = (
  customerId: string,
  amount: number,
  over: { availableDays?: number; expiresDays?: number | null } = {},
) =>
  db().execute(sql`
    select commerce.bonus_grant(${storeId}::uuid, ${customerId}::uuid, 'adjust', ${amount}, null, null,
      now() + make_interval(days => ${over.availableDays ?? 0}),
      ${over.expiresDays === undefined || over.expiresDays === null ? sql`null` : sql`now() + make_interval(days => ${over.expiresDays})`},
      'test', null, ${`grant-${customerId}-${Math.random()}`})
  `);

const balance = async (customerId: string) => {
  const [row] = await db().execute<Row>(
    sql`select * from commerce.bonus_balance(${storeId}::uuid, ${customerId}::uuid)`,
  );
  return { available: Number(row.available_minor), pending: Number(row.pending_minor) };
};

/** Moves a customer's ledger back in time: the ledger is immutable, but a test may pull the trigger. */
async function age(customerId: string, days: number) {
  await db().execute(sql`alter table commerce.bonus_entries disable trigger bonus_entries_immutable`);
  await db().execute(sql`
    update commerce.bonus_entries set created_at = created_at - make_interval(days => ${days}), available_at = available_at - make_interval(days => ${days}),
      expires_at = expires_at - make_interval(days => ${days}) where customer_id = ${customerId}::uuid
  `);
  await db().execute(sql`alter table commerce.bonus_entries enable trigger bonus_entries_immutable`);
}

const settings = (over: Record<string, unknown> = {}) => ({ ...BONUS_DEFAULTS, enabled: true, ...over });

beforeAll(async () => {
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`bonus-${run}@example.com`}, 'Test', 'Test') returning id`,
  );
  const [store] = await db().execute<Row>(
    sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`bonus-${run}`}, 'Bonus test', null) as id`,
  );
  storeId = String(store.id);
  // A store's main currency is its own country's: Norway's, here.
  await db().execute(sql`update commerce.stores set country = 'NO' where id = ${storeId}::uuid`);
  owner = await account("owner", "owner");
  admin = await account("admin", "admin");
  stranger = await account(null, "stranger");
});

afterAll(async () => {
  await closeDb();
});

describe("the bonus program's settings", () => {
  it("starts off, with the defaults, for a store that has never chosen", async () => {
    expect(await getBonusSettings(storeId)).toEqual(BONUS_DEFAULTS);
    expect(BONUS_DEFAULTS.enabled).toBe(false);
  });

  it("is changed by owners only, checked again on the server, and audited", async () => {
    expect(await saveBonusSettings(admin, storeId, settings())).toEqual({
      ok: false,
      problems: ["Only an owner can change the bonus program."],
    });
    expect(await saveBonusSettings(stranger, storeId, settings())).toMatchObject({ ok: false });
    expect(await saveBonusSettings(owner, storeId, settings({ earnBps: 9_000 }))).toMatchObject({
      ok: false,
      problems: [expect.stringContaining("50%")],
    });
    expect(await saveBonusSettings(owner, storeId, { enabled: true })).toMatchObject({ ok: false });
    expect(await getBonusSettings(storeId)).toEqual(BONUS_DEFAULTS);

    expect(
      await saveBonusSettings(
        owner,
        storeId,
        settings({ earnBps: 750, pendingDays: 7, maxRedeemPercent: 40, minRedeemMinor: 2_000, expiresMonths: 12 }),
      ),
    ).toEqual({ ok: true });
    expect(await getBonusSettings(storeId)).toEqual({
      enabled: true,
      earnBps: 750,
      pendingDays: 7,
      maxRedeemPercent: 40,
      minRedeemMinor: 2_000,
      expiresMonths: 12,
    });
    const [logged] = await db().execute<Row>(sql`
      select details from commerce.audit_log where store_id = ${storeId}::uuid and action = 'store.bonus_settings' order by id desc limit 1
    `);
    expect(logged.details).toMatchObject({ before: { enabled: false }, after: { earnBps: 750, enabled: true } });
    // The credits' currency is pinned to the store's main currency when first saved, and stays.
    const [row] = await db().execute<Row>(
      sql`select currency from commerce.bonus_settings where store_id = ${storeId}::uuid`,
    );
    expect(String(row.currency).trim()).toBe("NOK");
    await saveBonusSettings(owner, storeId, settings());
    const [again] = await db().execute<Row>(
      sql`select currency from commerce.bonus_settings where store_id = ${storeId}::uuid`,
    );
    expect(String(again.currency).trim()).toBe("NOK");
  });

  it("keeps what customers earned when the program is turned off, and stops earning and using", async () => {
    await saveBonusSettings(owner, storeId, settings({ enabled: false }));
    expect((await getBonusSettings(storeId)).enabled).toBe(false);
    const c = await customer("off");
    await grant(c.id, 1_000);
    await expect(
      db().execute(sql`select commerce.bonus_redeem(${storeId}::uuid, ${c.id}::uuid, null, 100, 'redeem:off')`),
    ).rejects.toThrow();
    expect((await balance(c.id)).available).toBe(1_000);
    await saveBonusSettings(owner, storeId, settings());
  });
});

describe("staff adjusting a customer's credits", () => {
  it("lets owners and admins add and take away credits with a reason, never below zero, audited", async () => {
    const c = await customer("adjusted");
    expect(await adjustBonus(admin, storeId, c.id, 2_500, "A gift for the trouble")).toEqual({ ok: true });
    expect((await balance(c.id)).available).toBe(2_500);
    expect(await adjustBonus(owner, storeId, c.id, -1_000, "Wrongly added")).toEqual({ ok: true });
    expect((await balance(c.id)).available).toBe(1_500);
    expect(await adjustBonus(owner, storeId, c.id, -1_501, "Too much")).toEqual({
      ok: false,
      problems: ["The customer has fewer credits than that to take away."],
    });
    expect((await balance(c.id)).available).toBe(1_500);
    const history = (await customerBonus(storeId, c.id)).entries;
    expect(history.map((e) => [e.kind, e.amountMinor, e.note])).toEqual([
      ["adjust", -1_000, "Wrongly added"],
      ["adjust", 2_500, "A gift for the trouble"],
    ]);
    const [logged] = await db().execute<Row>(sql`
      select details, account_id from commerce.audit_log where store_id = ${storeId}::uuid and action = 'customer.bonus_adjusted' order by id desc limit 1
    `);
    expect(logged.details).toMatchObject({ customerId: c.id, amountMinor: -1_000, note: "Wrongly added" });
    expect(String(logged.account_id)).toBe(owner.id);
  });

  it("refuses a missing reason, a zero or fractional amount, a stranger and a customer of another store", async () => {
    const c = await customer("refused");
    expect(await adjustBonus(owner, storeId, c.id, 100, "  ")).toMatchObject({ ok: false });
    expect(await adjustBonus(owner, storeId, c.id, 100, "ab")).toMatchObject({ ok: false });
    expect(await adjustBonus(owner, storeId, c.id, 100, "x".repeat(201))).toMatchObject({ ok: false });
    expect(await adjustBonus(owner, storeId, c.id, 0, "nothing")).toMatchObject({ ok: false });
    expect(await adjustBonus(owner, storeId, c.id, 1.5, "a half")).toMatchObject({ ok: false });
    expect(await adjustBonus(owner, storeId, c.id, 10 ** 9, "far too many")).toMatchObject({ ok: false });
    expect(await adjustBonus(stranger, storeId, c.id, 100, "not mine")).toMatchObject({ ok: false });
    expect(await adjustBonus(owner, storeId, "00000000-0000-4000-8000-000000000000", 100, "nobody")).toMatchObject({
      ok: false,
    });
    expect((await balance(c.id)).available).toBe(0);
    // A positive adjustment follows the store's expiry.
    await saveBonusSettings(owner, storeId, settings({ expiresMonths: 6 }));
    await adjustBonus(owner, storeId, c.id, 100, "with expiry");
    const [lot] = await db().execute<Row>(
      sql`select expires_at from commerce.bonus_entries where customer_id = ${c.id}::uuid`,
    );
    expect(new Date(String(lot.expires_at)).getTime()).toBeGreaterThan(Date.now() + 150 * 86_400_000);
    await saveBonusSettings(owner, storeId, settings());
  });
});

describe("a customer's history and the program's overview", () => {
  it("lists the newest 200 entries, newest first", async () => {
    const c = await customer("busy");
    for (let i = 1; i <= 205; i++) await grant(c.id, i);
    const { entries, balance: b } = await customerBonus(storeId, c.id);
    expect(entries).toHaveLength(200);
    expect(entries[0].amountMinor).toBe(205);
    expect(entries.at(-1)!.amountMinor).toBe(6);
    expect(b).toMatchObject({ currency: "NOK", availableMinor: (205 * 206) / 2, pendingMinor: 0 });
  });

  it("adds up what the store owes, what is pending and what happened in the last 30 days", async () => {
    const before = await bonusOverview(storeId);
    const a = await customer("owed-a");
    const b = await customer("owed-b");
    await grant(a.id, 10_000);
    await grant(b.id, 4_000, { availableDays: 5 });
    await db().execute(
      sql`select commerce.bonus_take(${storeId}::uuid, ${a.id}::uuid, 'redeem', 3_000, 'available', null, null, null, '', null, ${`spent-${run}`})`,
    );
    const after = await bonusOverview(storeId);
    expect(after.currency).toBe("NOK");
    expect(after.outstandingMinor - before.outstandingMinor).toBe(7_000);
    expect(after.pendingMinor - before.pendingMinor).toBe(4_000);
    expect(after.redeemed30dMinor - before.redeemed30dMinor).toBe(3_000);
    expect(after.customersWithCredits - before.customersWithCredits).toBe(2);
  });
});

describe("the five-minute job", () => {
  it("writes off credits past their expiry, once, oldest first", async () => {
    const c = await customer("expiring");
    await grant(c.id, 1_000, { expiresDays: 10 });
    await grant(c.id, 2_000, { expiresDays: 100 });
    await age(c.id, 11);
    const first = await runBonusJobs();
    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect((await balance(c.id)).available).toBe(2_000);
    const again = await runBonusJobs();
    expect(again.expired).toBe(0);
    const kinds = (await customerBonus(storeId, c.id)).entries.map((e) => [e.kind, e.amountMinor]);
    expect(kinds).toContainEqual(["expire", -1_000]);
  });

  it("reminds a customer once per expiry date, in their language, and leaves out those who opted out", async () => {
    await saveBonusSettings(owner, storeId, settings({ expiresMonths: 12 }));
    const c = await customer("reminded");
    const quiet = await customer("quiet", { optedOut: true });
    await grant(c.id, 5_000, { expiresDays: 6 });
    await grant(c.id, 1_000, { expiresDays: 9 });
    await grant(quiet.id, 5_000, { expiresDays: 6 });
    const soon = (await expiringReminders()).filter((r) => r.customerId === c.id);
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatchObject({ amountMinor: 6_000, currency: "NOK" });
    const first = await runBonusJobs();
    expect(first.reminded).toBe(1);
    const mails = await db().execute<Row>(sql`
      select to_address, subject, html from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'bonus.expiry_reminder'
    `);
    expect(mails).toHaveLength(1);
    expect(String(mails[0].to_address)).toBe(c.email);
    expect(String(mails[0].html)).toContain("/account/bonus");
    // The same date is not reminded again, however often the job runs.
    expect((await runBonusJobs()).reminded).toBe(0);
    // Credits that expire later than the window are no news.
    const later = await customer("later");
    await grant(later.id, 5_000, { expiresDays: 200 });
    expect((await expiringReminders()).some((r) => r.customerId === later.id)).toBe(false);
    // While the program is off nobody is reminded.
    const off = await customer("off-reminder");
    await grant(off.id, 5_000, { expiresDays: 3 });
    await saveBonusSettings(owner, storeId, settings({ enabled: false }));
    expect((await expiringReminders()).some((r) => r.customerId === off.id)).toBe(false);
    await saveBonusSettings(owner, storeId, settings());
  });
});

describe("a customer deleting their account", () => {
  it("takes their credits and history with it, and leaves their orders", async () => {
    const c = await customer("leaving");
    await grant(c.id, 1_000);
    await db().execute(
      sql`select commerce.bonus_take(${storeId}::uuid, ${c.id}::uuid, 'redeem', 400, 'available', null, null, null, '', null, ${`leaving-${run}`})`,
    );
    await deleteCustomer(storeId, c.id);
    const [left] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.bonus_entries where customer_id = ${c.id}::uuid`,
    );
    expect(Number(left.n)).toBe(0);
    const [orphans] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.bonus_allocations a where not exists (select 1 from commerce.bonus_entries e where e.id = a.entry_id)
    `);
    expect(Number(orphans.n)).toBe(0);
  });
});
