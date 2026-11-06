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

describe("AI on Kaizena Flow's key, in euros (D474)", () => {
  // Days far from any rate another test stores; the rates table is append-only, so these stay, harmless, in 2019.
  const friday = "2019-03-01";
  const sunday = "2019-03-03";
  const provider = `euro-${run}`;

  beforeAll(async () => {
    await db().execute(sql`insert into commerce.ecb_reference_rates (rate_date, currency, rate) values (${friday}::date, 'USD', 1.25) on conflict do nothing`);
    // A dollar per million tokens is a millionth of a dollar a token.
    await db().execute(sql`
      insert into commerce.ai_model_prices (provider, model, input_per_million, output_per_million, effective_from)
      values (${provider}, 'm', 1, 0, '2019-01-01T00:00:00Z')
    `);
    for (const [at, tokens] of [[`${friday}T12:00:00Z`, 2_500_000], [`${sunday}T09:00:00Z`, 1_250_000]] as const) {
      await db().execute(sql`
        insert into commerce.ai_usage (created_at, store_id, source, provider, model, kind, feature, input_tokens, output_tokens)
        values (${at}::timestamptz, ${store.id}::uuid, 'platform', ${provider}, 'm', 'text', 'other', ${tokens}, 0)
      `);
    }
  });

  afterAll(async () => {
    await db().execute(sql`delete from commerce.ai_usage where provider = ${provider}`);
    await db().execute(sql`delete from commerce.ai_model_prices where provider = ${provider}`);
  });

  it("counts each day's dollars in euros at that day's ECB rate, a weekend at the Friday's", async () => {
    const [rate] = await db().execute<Row>(sql`select commerce.usd_per_euro(${friday}::date)::float8 as friday, commerce.usd_per_euro(${sunday}::date)::float8 as sunday`);
    expect(Number(rate.friday)).toBe(1.25);
    expect(Number(rate.sunday)).toBe(1.25);
    await measureDay(friday, false);
    await measureDay(sunday, false);
    // $2.50 is €2.00, $1.25 is €1.00.
    expect(await value("ai_cost_micros", friday)).toBe(2_000_000);
    expect(await value("ai_cost_micros", sunday)).toBe(1_000_000);
  });

  it("counts a month the same way live, as the check before an AI call reads it", async () => {
    const { aiCostSql } = await import("./usage-sql");
    const [row] = await db().execute<Row>(aiCostSql(new Date(`${friday}T00:00:00Z`), new Date("2019-04-01T00:00:00Z"), store.id));
    expect(Number(row.value)).toBe(3_000_000);
  });

  it("writes it in another currency at the ECB's latest rate, and in euros where a currency has none", async () => {
    const { aiMoneyIn } = await import("./usage");
    const [latest] = await db().execute<Row>(sql`select rate::float8 as rate from commerce.ecb_reference_rates where currency = 'USD' order by rate_date desc limit 1`);
    expect(await aiMoneyIn("USD")).toEqual({ currency: "USD", perEuro: Number(latest.rate) });
    expect(await aiMoneyIn("EUR")).toEqual({ currency: "EUR", perEuro: 1 });
    expect(await aiMoneyIn("XTS")).toEqual({ currency: "EUR", perEuro: 1 });
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
