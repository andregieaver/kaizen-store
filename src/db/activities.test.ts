import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PERSONAL_DATA } from "@/lib/personal-data";
import { PURPOSE_OF } from "@/lib/personal-purposes";
import { COPY_RULES } from "@/lib/store-copy-rules";

import { createTestDatabase } from "./testing";

/**
 * Activities (S3, D468): the rules the database holds, against real Postgres (PGlite) with every migration applied. An activity is a call,
 * a meeting or a task with a title; only a meeting has a length; who did it is known only once it is done; its person, company and deal are
 * its own store's; a deal's activities go with it, a person's or a company's lose the link.
 */

let db: PGlite;
let shop: string;
let other: string;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
let counter = 0;

async function store(slug: string): Promise<string> {
  return (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ($1, $1, 'NO') returning id", [slug])).id;
}
async function customer(storeId: string): Promise<string> {
  counter += 1;
  return (await one<{ id: string }>("insert into commerce.customers (store_id, email) values ($1, $2) returning id", [storeId, `act-${counter}@example.com`])).id;
}
async function deal(storeId: string, customerId: string): Promise<string> {
  counter += 1;
  const p = (await one<{ id: string }>("insert into commerce.deal_pipelines (store_id, name) values ($1, $2) returning id", [storeId, `P${counter}`])).id;
  const s = (await one<{ id: string }>("insert into commerce.deal_stages (store_id, pipeline_id, name, position) values ($1, $2, 'New', 0) returning id", [storeId, p])).id;
  return (await one<{ id: string }>(
    "insert into commerce.deals (store_id, title, customer_id, pipeline_id, stage_id, currency) values ($1, 'Deal', $2, $3, $4, 'NOK') returning id",
    [storeId, customerId, p, s],
  )).id;
}
const activity = (storeId: string, over: { kind?: string; customer?: string | null; deal?: string | null; duration?: number | null } = {}) =>
  db.query<{ id: string }>(
    `insert into commerce.activities (store_id, kind, title, due_at, customer_id, deal_id, duration_minutes)
     values ($1, $2, 'Call about the quote', now(), $3, $4, $5) returning id`,
    [storeId, over.kind ?? "call", over.customer ?? null, over.deal ?? null, over.duration ?? null],
  );

beforeAll(async () => {
  db = await createTestDatabase();
  shop = await store("act-shop");
  other = await store("act-other");
});

afterAll(async () => {
  await db.close();
});

describe("an activity", () => {
  it("is a call, a meeting or a task with a title, and only a meeting has a length", async () => {
    const person = await customer(shop);
    await activity(shop, { kind: "meeting", customer: person, duration: 45 });
    await rejects("insert into commerce.activities (store_id, kind, title, due_at) values ($1, 'lunch', 'x', now())", [shop], /activities_kind/);
    await rejects("insert into commerce.activities (store_id, kind, title, due_at) values ($1, 'task', ' x', now())", [shop], /activities_title/);
    await expect(activity(shop, { kind: "call", customer: person, duration: 30 })).rejects.toThrow(/activities_duration/);
    await expect(activity(shop, { kind: "meeting", customer: person, duration: 721 })).rejects.toThrow(/activities_duration/);
  });

  it("says who did it only once it is done", async () => {
    const [account] = (await db.query<{ id: string }>("insert into commerce.accounts (email) values ('doer@example.com') returning id")).rows;
    const { rows } = await activity(shop, { customer: await customer(shop) });
    await rejects("update commerce.activities set done_by = $2 where id = $1", [rows[0].id, account.id], /activities_done/);
    await db.query("update commerce.activities set done_at = now(), done_by = $2 where id = $1", [rows[0].id, account.id]);
    // The doer's account going leaves the activity done.
    await db.query("delete from commerce.accounts where id = $1", [account.id]);
    expect(await one("select done_at is not null as done, done_by from commerce.activities where id = $1", [rows[0].id])).toEqual({ done: true, done_by: null });
  });

  it("is about its own store's person and deal only", async () => {
    await expect(activity(shop, { customer: await customer(other) })).rejects.toThrow(/activities_customer_fk/);
    const theirs = await customer(other);
    await expect(activity(shop, { deal: await deal(other, theirs) })).rejects.toThrow(/activities_deal_fk/);
  });

  it("goes with its deal, and loses its person when the person is deleted", async () => {
    const person = await customer(shop);
    const d = await deal(shop, person);
    const onDeal = (await activity(shop, { deal: d, customer: person })).rows[0].id;
    const onPerson = (await activity(shop, { customer: person })).rows[0].id;
    await db.query("delete from commerce.deals where id = $1", [d]);
    expect(await one("select count(*)::int as n from commerce.activities where id = $1", [onDeal])).toEqual({ n: 0 });
    await db.query("delete from commerce.customers where id = $1", [person]);
    expect(await one("select store_id, customer_id from commerce.activities where id = $1", [onPerson])).toEqual({ store_id: shop, customer_id: null });
  });

  it("is a person's data under the sales purpose, never copied", () => {
    expect(PERSONAL_DATA.some((entry) => entry.table === "activities")).toBe(true);
    expect(PURPOSE_OF.activities).toBe("sales");
    expect(COPY_RULES.activities).toBeDefined();
  });
});
