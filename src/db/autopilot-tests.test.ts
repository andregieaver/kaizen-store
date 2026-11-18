import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * The autopilot tests its page changes first (ecosystem plan E4.1, D729): the rules `commerce.autopilot_tests` holds, against real Postgres
 * (PGlite) with every migration applied. A row is a test of the whole page it names, in its own store; a page has one undecided autopilot test
 * at a time; a row starts undecided, what it started with never changes, and once decided it stays decided (a decision kept for the owner's yes
 * may still end).
 */

let db: PGlite;
let store: string;
let other: string;
let account: string;

beforeAll(async () => {
  db = await createTestDatabase();
  store = (await one<{ id: string }>("insert into commerce.stores (slug, name) values ('aptests-store', 'Tests') returning id")).id;
  other = (await one<{ id: string }>("insert into commerce.stores (slug, name) values ('aptests-other', 'Other') returning id")).id;
  account = (await one<{ id: string }>("insert into commerce.accounts (email) values ('aptests@example.com') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

let n = 0;
const page = async (storeId = store) =>
  (await one<{ id: string }>("insert into commerce.pages (store_id, slug, draft, published, published_at, type) values ($1, $2, '{}', '{}', now(), 'page') returning id", [storeId, `p-${(n += 1)}`])).id;
const experiment = async (pageId: string, storeId = store, part: string | null = null) =>
  (
    await one<{ id: string }>(
      "insert into commerce.experiments (store_id, name, target_page_id, primary_goal, target_part, target_part_kind) values ($1, 'Test', $2, 'cart', $3, $4) returning id",
      [storeId, pageId, part, part ? "row" : null],
    )
  ).id;
const keep = (experimentId: string, pageId: string, storeId = store) =>
  db.query("insert into commerce.autopilot_tests (store_id, experiment_id, page_id, account_id, goal, days) values ($1, $2, $3, $4, 'cart', 14)", [storeId, experimentId, pageId, account]);
const decide = (experimentId: string, outcome: string | null) =>
  db.query(`update commerce.autopilot_tests set outcome = $2, decided_at = ${outcome === null ? "null" : "now()"} where experiment_id = $1`, [experimentId, outcome]);

describe("the autopilot's tests of its page changes (E4.1, D729)", () => {
  it("is a test of the whole page it names, in its own store", async () => {
    const p = await page();
    await expect(keep(await experiment(await page()), p)).rejects.toThrow(/autopilot_tests\.experiment/);
    await expect(keep(await experiment(p, store, "row-1"), p)).rejects.toThrow(/autopilot_tests\.experiment/);
    const theirs = await page(other);
    await expect(keep(await experiment(theirs, other), theirs, other)).resolves.toBeTruthy();
    await expect(keep(await experiment(p), theirs)).rejects.toThrow(/autopilot_tests/);
  });

  it("keeps one undecided test a page, starting undecided", async () => {
    const p = await page();
    const first = await experiment(p);
    await keep(first, p);
    await expect(keep(await experiment(p), p)).rejects.toThrow(/autopilot_tests\.one_per_page/);
    await expect(
      db.query("insert into commerce.autopilot_tests (store_id, experiment_id, page_id, goal, days, outcome, decided_at) values ($1, $2, $3, 'cart', 14, 'applied', now())", [store, await experiment(await page()), p]),
    ).rejects.toThrow(/autopilot_tests/);
    // Waiting for the owner's yes is still undecided for the page; once decided, the next change may be tested.
    await decide(first, "asked");
    await expect(keep(await experiment(p), p)).rejects.toThrow(/autopilot_tests\.one_per_page/);
    await decide(first, "applied");
    await expect(keep(await experiment(p), p)).resolves.toBeTruthy();
  });

  it("never changes what it started with, and stays decided", async () => {
    const p = await page();
    const id = await experiment(p);
    await keep(id, p);
    await expect(db.query("update commerce.autopilot_tests set days = 21 where experiment_id = $1", [id])).rejects.toThrow(/autopilot_tests\.locked/);
    await expect(db.query("update commerce.autopilot_tests set goal = 'orders' where experiment_id = $1", [id])).rejects.toThrow(/autopilot_tests\.locked/);
    await expect(db.query("update commerce.autopilot_tests set outcome = 'kept' where experiment_id = $1", [id])).rejects.toThrow(/autopilot_tests_decided/);
    await decide(id, "kept");
    await expect(decide(id, "applied")).rejects.toThrow(/autopilot_tests\.decided/);
    await expect(decide(id, null)).rejects.toThrow(/autopilot_tests\.decided/);
    // The account goes when the account does (its key sets it to nothing); it never becomes someone else.
    await expect(db.query("update commerce.autopilot_tests set account_id = $2 where experiment_id = $1", [id, other])).rejects.toThrow(/autopilot_tests/);
    await db.query("update commerce.autopilot_tests set account_id = null where experiment_id = $1", [id]);
    expect((await one<{ account_id: string | null }>("select account_id from commerce.autopilot_tests where experiment_id = $1", [id])).account_id).toBeNull();
  });

  it("goes with its test", async () => {
    const p = await page();
    const id = await experiment(p);
    await keep(id, p);
    await db.query("delete from commerce.experiments where id = $1", [id]);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.autopilot_tests where experiment_id = $1", [id])).n).toBe(0);
  });
});

describe("Kaizena Flow's own site tested on its sign-ups (E5.3, D757)", () => {
  const withGoal = async (pageId: string, storeId: string, goal: string) =>
    (await one<{ id: string }>("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'Test', $2, $3) returning id", [storeId, pageId, goal])).id;
  const keepAs = (experimentId: string, pageId: string, storeId: string, goal: string) =>
    db.query("insert into commerce.autopilot_tests (store_id, experiment_id, page_id, account_id, goal, days) values ($1, $2, $3, $4, $5, 14)", [storeId, experimentId, pageId, account, goal]);

  it("counts sign-ups on Kaizena Flow's own store alone", async () => {
    const house = (await one<{ id: string | null }>("select commerce.house_store() as id")).id;
    expect(house).not.toBeNull();
    const own = await page(house!);
    await expect(keepAs(await withGoal(own, house!, "signup"), own, house!, "signup")).resolves.toBeTruthy();
    const theirs = await page();
    await expect(keepAs(await withGoal(theirs, store, "signup"), theirs, store, "signup")).rejects.toThrow(/autopilot_tests\.signup/);
  });

  it("always counts its own test's goal", async () => {
    const p = await page();
    await expect(keepAs(await withGoal(p, store, "checkout"), p, store, "cart")).rejects.toThrow(/autopilot_tests\.goal/);
    await expect(keepAs(await withGoal(p, store, "checkout"), p, store, "checkout")).resolves.toBeTruthy();
  });
});
