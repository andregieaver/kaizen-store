import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";
import { utcDay } from "@/lib/usage-metrics";

import { makeCapacityStore, putUsage } from "./capacity-test-support";
import { measureDay, pruneUsageDaily } from "./usage-meter";

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let store: Awaited<ReturnType<typeof makeCapacityStore>>;
const today = utcDay(new Date());

const value = async (metric: string, day = today) => {
  const [row] = await db().execute<Row>(sql`select value from commerce.store_usage_daily where store_id = ${store.id}::uuid and day = ${day}::date and metric = ${metric}`);
  return row ? Number(row.value) : undefined;
};

beforeAll(async () => {
  store = await makeCapacityStore("meter", run);
  // Two library files, three emails today (one a broadcast, one only logged), a traffic count from the drain.
  for (const [n, size] of [[1, 1000], [2, 2500]] as const) {
    await db().execute(sql`
      insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes)
      values (${store.id}::uuid, 'image', ${`https://example.test/${run}-${n}.webp`}, 'product-media', ${`${store.id}/${run}-${n}.webp`}, 'a.webp', 'image/webp', ${size})
    `);
  }
  for (const [kind, status] of [["order.confirmation", "sent"], ["marketing.broadcast", "sent"], ["order.confirmation", "logged"]] as const) {
    await db().execute(sql`
      insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, status)
      values (${store.id}::uuid, ${kind}, 'someone@example.com', 'S', '<p>x</p>', 'x', ${status})
    `);
  }
  await putUsage(store.id, today, "requests", 42);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.store_usage_daily where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("measureDay", () => {
  it("measures the store's files, products, staff and emails", async () => {
    await measureDay(today, true);
    expect(await value("storage_bytes")).toBe(3500);
    const [products] = await db().execute<Row>(sql`select count(*)::int as n from commerce.products where store_id = ${store.id}::uuid and status <> 'archived'`);
    expect(await value("products")).toBe(Number(products.n));
    expect(await value("staff_seats")).toBe(1);
    expect(await value("emails")).toBe(2);
    expect(await value("marketing_emails")).toBe(1);
  });

  it("gives the same rows when run again, and leaves the drain's counts alone", async () => {
    await measureDay(today, true);
    expect(await value("storage_bytes")).toBe(3500);
    expect(await value("emails")).toBe(2);
    expect(await value("requests")).toBe(42);
  });

  it("counts only the day's counters without gauges", async () => {
    const yesterday = utcDay(new Date(), -1);
    await measureDay(yesterday, false);
    expect(await value("storage_bytes", yesterday)).toBeUndefined();
    expect(await value("emails", yesterday)).toBeUndefined();
  });

  it("refuses a day that is not one", async () => {
    await expect(measureDay("yesterday", true)).rejects.toThrow();
  });
});

describe("pruneUsageDaily", () => {
  it("removes rows older than 25 months", async () => {
    await putUsage(store.id, "2020-01-01", "requests", 1);
    expect(await pruneUsageDaily()).toBeGreaterThanOrEqual(1);
    expect(await value("requests", "2020-01-01")).toBeUndefined();
    expect(await value("requests")).toBe(42);
  });
});
