import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";

import { makeCapacityStore } from "./capacity-test-support";
import { forgetTrafficFacts } from "./usage-traffic";

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const SECRET = "drain-test-secret";
let store: Awaited<ReturnType<typeof makeCapacityStore>>;
const day = "2026-10-23";

const line = (requestId: string, host: string, path: string, statusCode = 200) => ({
  requestId,
  environment: "production",
  proxy: { host, path, statusCode, timestamp: Date.UTC(2026, 9, 23, 10), clientIp: "203.0.113.9" },
});

const post = async (body: string, signature?: string) => {
  const { POST } = await import("@/app/api/usage/drain/route");
  return POST(new Request("https://kaizenaflow.com/api/usage/drain", { method: "POST", body, headers: { "x-vercel-signature": signature ?? createHmac("sha1", SECRET).update(body).digest("hex") } }));
};

const count = async (metric: string, storeId: string) => {
  const [row] = await db().execute<Row>(sql`select value from commerce.store_usage_daily where store_id = ${storeId}::uuid and day = ${day}::date and metric = ${metric}`);
  return row ? Number(row.value) : undefined;
};

beforeAll(async () => {
  process.env.USAGE_DRAIN_SECRET = SECRET;
  process.env.SITE_URL = "https://kaizenaflow.com";
  store = await makeCapacityStore("drain", run);
  forgetTrafficFacts();
});

afterAll(async () => {
  delete process.env.USAGE_DRAIN_SECRET;
  await db().execute(sql`delete from commerce.store_usage_daily where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.store_usage_daily where store_id is null and day = ${day}::date`);
  await closeDb();
});

describe("the drain route", () => {
  it("refuses a body without the right signature", async () => {
    const response = await post("[]", "nope");
    expect(response.status).toBe(403);
  });

  it("adds requests and server errors to the store's day, and keeps adding", async () => {
    const body = JSON.stringify([
      line("a", "kaizenaflow.com", `/s/${store.slug}/no`),
      line("a", "kaizenaflow.com", `/s/${store.slug}/no`),
      line("b", "kaizenaflow.com", `/s/${store.slug}/no/cart`, 502),
      line("c", "unknown.example", "/"),
    ]);
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ unknownHosts: 1 });
    expect(await count("requests", store.id)).toBe(2);
    expect(await count("server_errors", store.id)).toBe(1);
    await post(JSON.stringify([line("d", "kaizenaflow.com", `/s/${store.slug}/no`)]));
    expect(await count("requests", store.id)).toBe(3);
  });

  it("is off without a secret", async () => {
    delete process.env.USAGE_DRAIN_SECRET;
    expect((await post("[]")).status).toBe(404);
    process.env.USAGE_DRAIN_SECRET = SECRET;
  });
});
