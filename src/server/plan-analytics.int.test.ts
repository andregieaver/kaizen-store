import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db/client";

vi.mock("server-only", () => ({}));

const { planAnalytics } = await import("./plan-analytics");

/**
 * Analytics of Kaizena Flow's plans (D470), against the database: what a running plan brings in a month and its move, kept apart by mode,
 * and the way from an application to a paying store. Other files' stores share the database, so the test reads the change its own make.
 */

const run = Date.now().toString(36);

describe("plan analytics (D470)", () => {
  it("counts a live plan's month, its move and an application that came to pay", async () => {
    const before = await planAnalytics(30);
    const [plan] = await db().execute<{ id: string }>(sql`insert into commerce.plans (name) values (${`Analytics ${run}`}) returning id`);
    const [price] = await db().execute<{ id: string }>(sql`
      insert into commerce.plan_prices (plan_id, currency, interval, amount_minor) values (${plan.id}::uuid, 'SEK', 'year', 120000) returning id
    `);
    const [store] = await db().execute<{ id: string }>(sql`
      insert into commerce.stores (slug, name, setup_completed_at) values (${`analytics-${run}`}, 'Analytics', now()) returning id
    `);
    await db().execute(sql`
      insert into commerce.access_requests (email, name, store_name, status, store_id, decided_at)
      values (${`analytics-${run}@example.com`}, 'Ana', 'Analytics', 'approved', ${store.id}::uuid, now())
    `);
    await db().execute(sql`
      insert into commerce.store_billing (store_id, plan_id, price_id, status, mode) values (${store.id}::uuid, ${plan.id}::uuid, ${price.id}::uuid, 'active', 'live')
    `);
    const after = await planAnalytics(30);
    const sek = (s: typeof after) => s.live.mrr.find((m) => m.currency === "SEK")?.mrrMinor ?? 0;
    expect(sek(after) - sek(before)).toBe(10000);
    expect(after.live.paying - before.live.paying).toBe(1);
    expect(after.live.byPlan.find((p) => p.plan === `Analytics ${run}`)).toMatchObject({ stores: 1 });
    const started = (s: typeof after) => s.moves.live.find((m) => m.kind === "started")?.count ?? 0;
    expect(started(after) - started(before)).toBe(1);
    expect(after.funnel.asked - before.funnel.asked).toBe(1);
    expect(after.funnel.paying - before.funnel.paying).toBe(1);
    expect(after.since).not.toBeNull();
  });
});
