import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EXTENSION_IDS, extensionOn, readExtensionFacts } from "@/lib/extensions";

import { createTestDatabase } from "./testing";

/**
 * An account's extension facts and the gate in SQL (D748 step E3), against real Postgres (PGlite): `commerce.store_extension_facts()` is what
 * the store read carries, and `commerce.extension_on()` (for jobs) answers as `extensionOn()` does over those facts, before launch and after,
 * for the platform, a plan's grant, a trial, its grace period, a purchase that ended, and a store nobody owns.
 */

let db: PGlite;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

/** A store its maker owns, so it is placed in the maker's account. */
async function ownedStore(): Promise<{ store: string; organisation: string }> {
  counter += 1;
  const account = (await one<{ id: string }>("insert into commerce.accounts (email, name) values ($1, 'Gate') returning id", [`gate-${counter}@example.com`])).id;
  const store = (await one<{ id: string }>("insert into commerce.stores (slug, name, created_by) values ($1, 'Gate', $2) returning id", [`gate-${counter}`, account])).id;
  await db.query("insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'owner')", [store, account]);
  const organisation = (await one<{ organisation_id: string }>("select organisation_id from commerce.stores where id = $1", [store])).organisation_id;
  return { store, organisation };
}

/** What SQL and TypeScript say for every extension of `store` now. */
async function both(store: string): Promise<{ sql: string[]; ts: string[] }> {
  const sqlOn: string[] = [];
  for (const id of EXTENSION_IDS) {
    if ((await one<{ on: boolean }>("select commerce.extension_on($1, $2) as on", [store, id])).on) sqlOn.push(id);
  }
  const { facts, now } = await one<{ facts: unknown; now: string }>("select commerce.store_extension_facts($1) as facts, now() as now", [store]);
  const at = new Date(now);
  return { sql: sqlOn, ts: EXTENSION_IDS.filter((id) => extensionOn(readExtensionFacts(facts), id, at)) };
}

describe("extension facts and the gate in SQL (D748 E3)", () => {
  it("gives every account every extension before launch, and agrees with TypeScript", async () => {
    const { store } = await ownedStore();
    expect(await both(store)).toEqual({ sql: [...EXTENSION_IDS], ts: [...EXTENSION_IDS] });
  });

  it("after launch: the plan's grants, a trial, a grace period and a live purchase work; read-only and absent do not", async () => {
    const { store, organisation } = await ownedStore();
    const plan = (await one<{ id: string }>("insert into commerce.plans (name) values ('Gate plan') returning id")).id;
    const size = (await one<{ id: string }>("select id from commerce.extension_sizes where extension_id = 'ab_testing' order by position limit 1")).id;
    await db.query("insert into commerce.plan_extension_grants (plan_id, extension_id, size_id) values ($1, 'ab_testing', $2)", [plan, size]);
    await db.query("insert into commerce.store_billing (store_id, plan_id, status) values ($1, $2, 'active')", [store, plan]);
    await db.query(
      `insert into commerce.organisation_extensions (organisation_id, extension_id, source, trial_ends_at, ended_at, grace_ends_at) values
         ($1, 'support_desk', 'trial', now() + interval '3 days', null, null),
         ($1, 'email_automation', 'trial', now() - interval '1 day', null, now() + interval '13 days'),
         ($1, 'work', 'bought', null, now() - interval '20 days', now() - interval '6 days')`,
      [organisation],
    );
    await db.query("update commerce.platform_settings set extensions_launched_at = now() - interval '1 day'");
    try {
      expect(await both(store)).toEqual({ sql: ["ab_testing", "support_desk", "email_automation"], ts: ["ab_testing", "support_desk", "email_automation"] });
      // A purchase still paid for works; the plan's grant ends with the plan.
      await db.query("update commerce.organisation_extensions set ended_at = null, grace_ends_at = null where organisation_id = $1 and extension_id = 'work'", [organisation]);
      await db.query("update commerce.store_billing set status = 'canceled' where store_id = $1", [store]);
      expect(await both(store)).toEqual({ sql: ["support_desk", "email_automation", "work"], ts: ["support_desk", "email_automation", "work"] });
    } finally {
      await db.query("update commerce.platform_settings set extensions_launched_at = null");
    }
  });

  it("gives Kaizena Flow's own stores every extension after launch, and a store nobody owns none", async () => {
    const house = (await one<{ id: string }>("select commerce.house_store() as id")).id;
    counter += 1;
    const lone = (await one<{ id: string }>("insert into commerce.stores (slug, name) values ($1, 'Lone') returning id", [`gate-lone-${counter}`])).id;
    await db.query("update commerce.platform_settings set extensions_launched_at = now() - interval '1 day'");
    try {
      expect(await both(house)).toEqual({ sql: [...EXTENSION_IDS], ts: [...EXTENSION_IDS] });
      expect(await both(lone)).toEqual({ sql: [], ts: [] });
    } finally {
      await db.query("update commerce.platform_settings set extensions_launched_at = null");
    }
  });
});
