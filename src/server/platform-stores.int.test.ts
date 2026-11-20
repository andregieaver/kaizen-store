import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { closeDb, db } from "@/db/client";
import { storeListFilter } from "@/lib/platform-stores";

import { col, typedRow } from "./typed-rows";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const { storeBillingPage, storeListFacts } = await import("./billing");

/**
 * The platform's Stores list (code review step 2.10, D847): a search by the store's name or address, an owner's name or email and its
 * domains; the store's state, its plan and its subscription; closed stores listed; a hundred a page with how many match. Five stores of
 * this run, each named with the run's tag, so a search for the tag holds only them on a database other tests share.
 */

const run = Date.now().toString(36);
const tag = `Zq${run}`;
const ids: Record<string, string> = {};
let planId = "";

const one = async <T extends z.ZodType>(shape: T, query: ReturnType<typeof sql>) => {
  const row = await typedRow(shape, query);
  if (!row) throw new Error("no row");
  return row;
};
const account = async (who: string, name: string) =>
  (await one(z.object({ id: col.uuid }), sql`insert into commerce.accounts (email, name) values (${`d847-${who}-${run}@example.com`}, ${name}) returning id`)).id;

beforeAll(async () => {
  planId = (await one(z.object({ id: col.uuid }), sql`insert into commerce.plans (name, position) values (${`D847 Plan ${run}`}, 99) returning id`)).id;
  const ada = await account("ada", `Ada Owner ${run}`);
  const bob = await account("bob", "Bob Owner");
  const staff = await account("staff", "Sam Staff");
  for (const name of ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]) {
    const slug = `d847-${name.toLowerCase()}-${run}`;
    ids[name] = (await one(z.object({ id: col.uuid }), sql`insert into commerce.stores (slug, name) values (${slug}, ${`${name} ${tag}`}) returning id`)).id;
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${ids[name]}::uuid, ${name === "Bravo" ? bob : ada}::uuid, 'owner')`);
  }
  // Someone who works in Alpha but does not own it: the search is by owner.
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${ids.Alpha}::uuid, ${staff}::uuid, 'admin')`);
  // Alpha serves its own domain; Bravo has one Kaizena Flow registered for it, not yet connected.
  await db().execute(sql`insert into commerce.store_domains (store_id, hostname, token, status) values (${ids.Alpha}::uuid, ${`alpha-${run}.example.com`}, ${`t-${run}`}, 'active')`);
  await db().execute(sql`insert into commerce.domain_registrations (store_id, apex, registrar) values (${ids.Bravo}::uuid, ${`bravo-${run}.example.org`}, 'vercel')`);
  // The plans: Alpha on a trial, Charlie overdue, Delta paying and ending, Echo cancelled; Bravo has none.
  const billing = async (name: string, status: string, cancelling = false) =>
    db().execute(sql`insert into commerce.store_billing (store_id, plan_id, status, cancel_at_period_end) values (${ids[name]}::uuid, ${planId}::uuid, ${status}, ${cancelling})`);
  await billing("Alpha", "trialing");
  await billing("Charlie", "past_due");
  await billing("Delta", "active", true);
  await billing("Echo", "canceled");
  await db().execute(sql`update commerce.stores set status = 'suspended', status_reason = 'Unpaid' where id = ${ids.Bravo}::uuid`);
  await db().execute(sql`update commerce.stores set status = 'closed', status_reason = 'Asked to close' where id = ${ids.Charlie}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

/** The names of this run's stores a search and filters find, in the list's order. */
const found = async (filter: Parameters<typeof storeBillingPage>[0]) => (await storeBillingPage(filter)).rows.map((row) => row.name.replace(` ${tag}`, ""));

describe("the platform's Stores list (D847)", () => {
  it("finds a store by its name or address, case-insensitively, and lists closed ones", async () => {
    expect(await found({ q: `alpha ${tag.toUpperCase()}` })).toEqual(["Alpha"]);
    expect(await found({ q: `D847-BRAVO-${run}` })).toEqual(["Bravo"]);
    expect(await found({ q: tag })).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
  });

  it("finds a store by its owner's email or name, not by someone who only works there", async () => {
    expect(await found({ q: `D847-BOB-${run}@EXAMPLE.com` })).toEqual(["Bravo"]);
    expect(await found({ q: `ada owner ${run}` })).toEqual(["Alpha", "Charlie", "Delta", "Echo"]);
    expect(await found({ q: `d847-staff-${run}` })).toEqual([]);
  });

  it("finds a store by a domain it serves or one registered for it", async () => {
    expect(await found({ q: `ALPHA-${run}.example.com` })).toEqual(["Alpha"]);
    expect(await found({ q: `bravo-${run}.example` })).toEqual(["Bravo"]);
  });

  it("reads % and _ in a search as themselves", async () => {
    expect(await found({ q: `Alpha_${tag}` })).toEqual([]);
    expect(await found({ q: `%${tag}` })).toEqual([]);
  });

  it("filters by the store's own state", async () => {
    expect(await found({ q: tag, state: "active" })).toEqual(["Alpha", "Delta", "Echo"]);
    expect(await found({ q: tag, state: "suspended" })).toEqual(["Bravo"]);
    expect(await found({ q: tag, state: "closed" })).toEqual(["Charlie"]);
  });

  it("filters by plan, or by having none", async () => {
    expect(await found({ q: tag, plan: planId })).toEqual(["Alpha", "Charlie", "Delta", "Echo"]);
    expect(await found({ q: tag, plan: "none" })).toEqual(["Bravo"]);
    expect(await found({ plan: planId })).toEqual(["Alpha", "Charlie", "Delta", "Echo"]);
  });

  it("filters by the subscription as the rows say it", async () => {
    expect(await found({ q: tag, billing: "trialing" })).toEqual(["Alpha"]);
    expect(await found({ q: tag, billing: "paying" })).toEqual(["Delta"]);
    expect(await found({ q: tag, billing: "overdue" })).toEqual(["Charlie"]);
    expect(await found({ q: tag, billing: "cancelling" })).toEqual(["Delta"]);
    expect(await found({ q: tag, billing: "cancelled" })).toEqual(["Echo"]);
    // Filters narrow together: an open store on the plan that is paying.
    expect(await found({ q: tag, state: "active", plan: planId, billing: "paying" })).toEqual(["Delta"]);
    expect(await found({ q: tag, state: "closed", billing: "trialing" })).toEqual([]);
  });

  it("reads the filters from the page's address", async () => {
    const filter = storeListFilter({ q: ` ${tag} `, state: ["active", "closed"], plan: planId.toUpperCase(), billing: "overdue" });
    expect(filter).toMatchObject({ q: tag, state: "closed", plan: planId, billing: "overdue", page: 1 });
    expect(await found(filter)).toEqual(["Charlie"]);
  });

  it("pages what matches, counting every match on each page, in an order that ends on the store's id", async () => {
    const first = await storeBillingPage({ q: tag, limit: 2 });
    expect(first.total).toBe(5);
    expect(first.rows.map((row) => row.storeId)).toEqual([ids.Alpha, ids.Bravo]);
    const second = await storeBillingPage({ q: tag, limit: 2, offset: 2 });
    expect(second).toMatchObject({ total: 5 });
    expect(second.rows.map((row) => row.storeId)).toEqual([ids.Charlie, ids.Delta]);
    const last = await storeBillingPage({ q: tag, limit: 2, offset: 4 });
    expect(last.rows.map((row) => row.storeId)).toEqual([ids.Echo]);
    // Each row is the list's: the owner, the plan and the store's own state.
    expect(first.rows[1]).toMatchObject({ ownerEmail: `d847-bob-${run}@example.com`, planName: null, storeStatus: "suspended" });
    expect(second.rows[0]).toMatchObject({ planName: `D847 Plan ${run}`, status: "past_due", storeStatus: "closed" });
    expect(await storeBillingPage({ q: tag, limit: 2, offset: 6 })).toEqual({ rows: [], total: 0 });
  });

  it("counts the stores in each state and lists the plans to filter by", async () => {
    const facts = await storeListFacts();
    expect(facts.counts.all).toBe((await storeBillingPage({ limit: 1 })).total);
    expect(facts.counts.all).toBe(facts.counts.active + facts.counts.suspended + facts.counts.closed);
    expect(facts.counts.suspended).toBeGreaterThanOrEqual(1);
    expect(facts.counts.closed).toBe((await storeBillingPage({ state: "closed", limit: 1 })).total);
    expect(facts.plans).toContainEqual({ id: planId, name: `D847 Plan ${run}` });
  });
});
