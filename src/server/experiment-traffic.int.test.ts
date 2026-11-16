import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { eligiblePerDay, goalEstimate } from "@/lib/experiment-traffic";

import type { TestableTarget } from "./experiment-admin";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const { experimentTraffic } = await import("./experiment-traffic");

/**
 * A/B tests at the store's own traffic (D148 phase 13, D658), on a store of its own at noon on 20 October 2026: ten days of visits, five a
 * day beginning on the front page, two on /om-oss and three on a product page (two of which reach checkout), and 25 cookie choices of which 15
 * accepted statistics.
 */

const run = Date.now().toString(36);
const hex = Date.now().toString(16).slice(-8);
const NOW = new Date("2026-10-20T10:00:00Z");
let store: Store;
let quiet: Store;

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}
const storeOf = (id: string, slug: string, counting: boolean) => ({ id, slug, timeZone: "Europe/Oslo", visitCounting: counting }) as Partial<Store> as Store;

const targets: TestableTarget[] = [
  { id: "front", slug: "forside", title: "Forside", kind: "role", role: "front" },
  { id: "about", slug: "om-oss", title: "Om oss", kind: "page" },
  { id: "never", slug: "aldri", title: "Aldri", kind: "page" },
  { id: "header", slug: "header", title: "Header", kind: "header" },
  { id: "layout", slug: "layout", title: "Layout", kind: "layout" },
  { id: "account", slug: "konto", title: "Konto", kind: "role", role: "account" },
];

beforeAll(async () => {
  const slug = `traffic-${run}`;
  store = storeOf(await makeStore(slug), slug, true);
  quiet = storeOf(await makeStore(`${slug}-q`), `${slug}-q`, false);
  for (let d = 1; d <= 10; d += 1) {
    const day = `2026-10-${String(d + 8).padStart(2, "0")}`;
    const rows: [string, number, boolean][] = [
      ...Array.from({ length: 5 }, () => ["/no", 0, false] as [string, number, boolean]),
      ["/no/om-oss", 0, false],
      ["/no/om-oss", 0, false],
      ["/no/p/kopp", 1, true],
      ["/no/p/kopp", 2, true],
      ["/no/p/kopp", 1, false],
    ];
    let i = 0;
    for (const [landing, products, checkout] of rows) {
      i += 1;
      await db().execute(sql`
        insert into commerce.visits (store_id, day, visitor, market_code, device, channel, landing_path, product_views, checkout_at)
        values (${store.id}::uuid, ${day}::date, ${`${hex}${(d * 100 + i).toString(16).padStart(16, "0")}`}, 'NO', 'mobile', 'direct', ${landing}, ${products},
          ${checkout ? sql`${`${day}T12:00:00Z`}::timestamptz` : sql`null`})`);
    }
  }
  for (let i = 0; i < 25; i += 1) {
    await db().execute(sql`
      insert into commerce.consents (store_id, visitor, choices, version)
      values (${store.id}::uuid, gen_random_uuid(), ${JSON.stringify({ necessary: true, statistics: i < 15 })}::jsonb, '1')`);
  }
});

afterAll(async () => {
  await closeDb();
});

describe("experimentTraffic", () => {
  it("counts each target's visits a day from where they began, and who accepts statistics cookies", async () => {
    const facts = await experimentTraffic(store, targets, NOW);
    expect(facts).toMatchObject({ counting: true, days: 10, consentShare: 0.6 });
    expect(facts.targets.front).toEqual({ visitsPerDay: 5, basis: "landing" });
    expect(facts.targets.about).toEqual({ visitsPerDay: 2, basis: "landing" });
    expect(facts.targets.never).toEqual({ visitsPerDay: 0, basis: "landing" });
    expect(facts.targets.header).toEqual({ visitsPerDay: 10, basis: "site" });
    expect(facts.targets.layout).toEqual({ visitsPerDay: 3, basis: "product_viewers" });
    expect(facts.targets.account).toEqual({ visitsPerDay: null, basis: null });
    // Two visits in ten reached checkout; no cart or paid order was made.
    expect(facts.baselines).toEqual({ orders: null, cart: null, checkout: 0.2 });
    expect(eligiblePerDay(facts, "header")).toBeCloseTo(6);
    const estimate = goalEstimate({ facts, targetId: "header", goal: "checkout", trafficShare: 1, versions: 2 });
    expect(estimate?.days).toBeGreaterThan(14);
    expect(goalEstimate({ facts, targetId: "header", goal: "orders", trafficShare: 1, versions: 2 })).toBeNull();
  });

  it("knows nothing about traffic while a store does not count visits, but still the cookie choices", async () => {
    const facts = await experimentTraffic(quiet, targets, NOW);
    expect(facts.counting).toBe(false);
    expect(facts.consentShare).toBeNull();
    expect(facts.targets.front).toEqual({ visitsPerDay: null, basis: null });
  });
});
