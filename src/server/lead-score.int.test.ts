import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const { customerLeadScore } = await import("./lead-score");
const { applySegmentFacts, readSegmentFacts } = await import("./segment-facts");
const { holds, segmentNeeds } = await import("@/lib/segments");

type Row = Record<string, unknown>;

/**
 * A business customer's lead score against a real database (email plan M2.8, D865): only a customer who buys for a company has one; their
 * presses on links in the store's emails count by their address, this month's apart from earlier ones; another store's presses never count.
 */

const run = Date.now().toString(36);
let storeId: string;
let otherStoreId: string;

async function newStore(name: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${name}-${run}@example.com`}, 'Kari', 'Lead') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${name}-${run}`}, 'Lead', null) as id`);
  return String(store.id);
}

async function customer(store: string, email: string, company: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, locale, company_name) values (${store}::uuid, ${email}, 'nb-NO', ${company}) returning id`);
  return String(row.id);
}

async function pressed(store: string, email: string, daysAgo: number[]): Promise<void> {
  const [sub] = await db().execute<Row>(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, token)
    values (${store}::uuid, ${email}, 'nb-NO', 'NO', 'subscribed', 'account', 'Ja takk', now() - interval '200 days', ${randomBytes(32).toString("base64url")})
    returning id`);
  const [flow] = await db().execute<Row>(sql`insert into commerce.flows (store_id, name, trigger) values (${store}::uuid, 'Velkommen', 'order.paid') returning id`);
  for (const days of daysAgo) {
    await db().execute(sql`
      insert into commerce.email_clicks (store_id, subscriber_id, flow_id, step_id, link, clicked_at)
      values (${store}::uuid, ${String(sub.id)}::uuid, ${String(flow.id)}::uuid, 'e1', 'nb.0', now() - make_interval(days => ${days}))`);
  }
}

beforeAll(async () => {
  storeId = await newStore("lead");
  otherStoreId = await newStore("lead-other");
});

afterAll(async () => {
  await closeDb();
});

describe("a business customer's lead score (D865)", () => {
  it("is null for a customer who buys for no company", async () => {
    const email = `privat-${run}@example.com`;
    const id = await customer(storeId, email, "");
    expect(await customerLeadScore(storeId, id, true)).toBeNull();
  });

  it("counts this month's presses apart from earlier ones, by their address, in their own store only", async () => {
    const email = `innkjop-${run}@example.com`;
    const id = await customer(storeId, email, "Bedrift AS");
    expect(await customerLeadScore(storeId, id, true)).toEqual({ score: 0, points: [] });
    await pressed(storeId, email, [60]);
    expect(await customerLeadScore(storeId, id, true)).toEqual({
      score: 5,
      points: [{ reason: "pressedEarlier", count: 1, points: 5 }],
    });
    await pressed(otherStoreId, email, [1, 2, 3]);
    await db().execute(sql`
      insert into commerce.email_clicks (store_id, subscriber_id, flow_id, step_id, link)
      select s.store_id, s.id, f.id, 'e1', 'nb.1' from commerce.marketing_subscribers s join commerce.flows f on f.store_id = s.store_id
       where s.store_id = ${storeId}::uuid and s.email = ${email} limit 1`);
    expect(await customerLeadScore(storeId, id, true)).toEqual({ score: 10, points: [{ reason: "pressed", count: 1, points: 10 }] });
  });

  it("is a segment condition: the business customer at 10 points holds 'at least 10', not 'at least 11', and the private one never", async () => {
    const rules = { match: "all" as const, conditions: [{ kind: "leadScore" as const, min: 10 }] };
    const needs = segmentNeeds([rules]);
    expect(needs.leads).toBe(true);
    const facts = await readSegmentFacts(storeId, needs, null);
    const people = [`innkjop-${run}@example.com`, `privat-${run}@example.com`].map((email) => ({ email }) as Parameters<typeof holds>[1]);
    applySegmentFacts(people, facts);
    expect(people.map((p) => p.leadScore)).toEqual([10, null]);
    const today = new Date();
    expect(people.map((p) => holds({ kind: "leadScore", min: 10 }, p, today))).toEqual([true, false]);
    expect(holds({ kind: "leadScore", min: 11 }, people[0], today)).toBe(false);
  });
});
