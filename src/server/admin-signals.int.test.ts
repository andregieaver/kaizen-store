import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb, db } = await import("@/db/client");
const { addMember, makeAccount, makeStore } = await import("./trust-fixtures");
const signals = await import("./admin-signals");
const { ADMIN_USE_QUESTIONS } = await import("@/lib/admin-signals");

type Row = Record<string, unknown>;

/**
 * Heatmaps and recordings of how owners use the admin (D895 phase 3b): the switch stays shut until a Legal account has answered every
 * question (an admin's own view does not count) and the owner confirms the assessment is signed; only a store's owner is asked, never their
 * staff or a platform admin; every choice is a new row; nothing is kept while the switch is shut.
 */
let before: Row | undefined;
let lawyer = "";
let admin = "";

beforeAll(async () => {
  [before] = await db().execute<Row>(sql`select admin_signals_open from commerce.platform_settings`);
  await db().execute(sql`update commerce.platform_settings set admin_signals_open = false`);
  lawyer = (await makeAccount("lawyer")).id;
  await db().execute(sql`update commerce.accounts set platform_role = 'legal' where id = ${lawyer}::uuid`);
  admin = (await makeAccount("platform-admin", { platformAdmin: true })).id;
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.platform_legal_views where account_id in (${lawyer}::uuid, ${admin}::uuid)`);
  await db().execute(sql`update commerce.platform_settings set admin_signals_open = ${Boolean(before?.admin_signals_open)}, admin_signals_opened_by = null`);
  await closeDb();
});

const view = (accountId: string, item: string) =>
  db().execute(sql`insert into commerce.platform_legal_views (review, item, view, account_id) values ('admin-use', ${item}, 'A view.', ${accountId}::uuid)`);

describe("the switch", () => {
  it("stays shut while a question waits for a Legal account, whatever an admin wrote", async () => {
    for (const q of ADMIN_USE_QUESTIONS) await view(admin, q);
    const state = await signals.adminSignalsState();
    expect(state.missing).toEqual(ADMIN_USE_QUESTIONS);
    expect(await signals.openAdminSignals(admin, true)).toEqual({ ok: false, problem: "locked" });
    for (const q of ADMIN_USE_QUESTIONS.slice(0, -1)) await view(lawyer, q);
    expect((await signals.adminSignalsState()).missing).toEqual(ADMIN_USE_QUESTIONS.slice(-1));
    expect(await signals.openAdminSignals(admin, true)).toEqual({ ok: false, problem: "locked" });
  });

  it("opens once every question is answered and the owner confirms the assessment is signed", async () => {
    await view(lawyer, ADMIN_USE_QUESTIONS.at(-1)!);
    expect(await signals.openAdminSignals(admin, false)).toEqual({ ok: false, problem: "signed" });
    expect(await signals.openAdminSignals(admin, true)).toEqual({ ok: true });
    expect((await signals.adminSignalsState()).open).toBe(true);
  });
});

describe("who is asked, and their choice", () => {
  it("asks a store's owner about their own use, never their staff or a platform admin, and keeps each choice", async () => {
    const shop = await makeStore("admin-use");
    const staff = await makeAccount("staff");
    await addMember(shop.id, staff.id, "admin");
    expect(await signals.adminSignalsFor(shop.account.id)).toEqual({ eligible: true, choice: null });
    expect((await signals.adminSignalsFor(staff.id)).eligible).toBe(false);
    expect((await signals.adminSignalsFor(admin)).eligible).toBe(false);
    expect(await signals.chooseAdminSignals(staff.id, { heatmaps: true, recordings: true })).toBe(false);

    expect(await signals.chooseAdminSignals(shop.account.id, { heatmaps: true, recordings: true })).toBe(true);
    expect(await signals.chooseAdminSignals(shop.account.id, { heatmaps: false, recordings: true })).toBe(true);
    expect((await signals.adminSignalsFor(shop.account.id)).choice).toEqual({ heatmaps: false, recordings: false });
    const rows = await db().execute<Row>(sql`select heatmaps, recordings, notice from commerce.platform_admin_signal_choices where account_id = ${shop.account.id}::uuid order by chosen_at, id`);
    expect(rows.map((r) => [r.heatmaps, r.recordings])).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  it("keeps no choice and asks no one while the switch is shut", async () => {
    await signals.closeAdminSignals(admin);
    const shop = await makeStore("admin-use-shut");
    expect(await signals.adminSignalsFor(shop.account.id)).toEqual({ eligible: false, choice: null });
    expect(await signals.chooseAdminSignals(shop.account.id, { heatmaps: true, recordings: false })).toBe(false);
  });
});
