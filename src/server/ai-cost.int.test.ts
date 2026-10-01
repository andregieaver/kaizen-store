import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { costMicros, matchPrice } from "@/lib/ai-cost";
import { summarizeUsage, totalOf } from "@/lib/ai-usage";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const usage = await import("./ai-usage");
const prices = await import("./ai-prices");
const recommend = await import("./recommend-settings");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const provider = `costp-${run}`;
let admin: Account;
let storeId: string;

/** One recorded call `daysAgo` days back (Kaizen's own unless a store is given). */
async function call(model: string, daysAgo: number, input: number, output: number, over: { store?: boolean; feature?: string } = {}) {
  await db().execute(sql`
    insert into commerce.ai_usage (created_at, store_id, source, provider, model, kind, feature, input_tokens, output_tokens)
    values (now() - make_interval(days => ${daysAgo}), ${over.store ? storeId : null}::uuid, 'platform', ${provider}, ${model}, 'text', ${over.feature ?? "other"}, ${input}, ${output})
  `);
}

const mine = async (days = 90) => (await usage.usageRows({ days })).filter((r) => r.provider === provider);
const priceAt = (model: string, daysAgo: number, input: number, output: number) =>
  db().execute(sql`
    insert into commerce.ai_model_prices (provider, model, input_per_million, output_per_million, effective_from)
    values (${provider}, ${model}, ${input}, ${output}, now() - make_interval(days => ${daysAgo}))
  `);

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`cost-${run}@example.com`}, 'Cost Admin', true) returning id
  `);
  admin = { id: String(account.id), email: `cost-${run}@example.com`, name: "Cost Admin", platformAdmin: true };
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`cost-store-${run}@example.com`}, 'S', 'S') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`cost-${run}`}, 'Cost', null) as id`);
  storeId = String(store.id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.ai_usage where provider = ${provider}`);
  await db().execute(sql`delete from commerce.ai_model_prices where provider = ${provider}`);
  await closeDb();
});

describe("what the AI costs (D145)", () => {
  it("prices each call with the price in force the day it was made, so a new price does not rewrite the past", async () => {
    await priceAt("gpt-c", 40, 1, 2);
    await priceAt("gpt-c", 5, 3, 6);
    await call("gpt-c", 10, 1_000_000, 500_000);
    await call("gpt-c", 1, 1_000_000, 500_000);
    const rows = await mine();
    // One row per combination: both calls are the same model, so they sum: (1+1) + (3+3) dollars = $8.
    expect(totalOf(rows).costMicros).toBe(costMicros(1_000_000, 500_000, { inputPerMillion: 1, outputPerMillion: 2 }) + costMicros(1_000_000, 500_000, { inputPerMillion: 3, outputPerMillion: 6 }));
    expect(totalOf(rows).costMicros).toBe(8_000_000);
    expect(totalOf(rows).unpricedRequests).toBe(0);
    // The daily chart carries each day's own cost.
    const days = await usage.usageByDay({ days: 90 });
    const total = days.reduce((sum, d) => sum + d.costMicros, 0);
    expect(total).toBeGreaterThanOrEqual(8_000_000);
  });

  it("prices a dated version by its model's price, the most specific model first, and leaves a model with no price out, saying so", async () => {
    await priceAt("gpt-c-mini", 40, 0.1, 0.2);
    await call("gpt-c-2026-05-01", 2, 1_000_000, 0);
    await call("gpt-c-mini-2026-05-01", 2, 1_000_000, 0);
    await call("nameless", 2, 1_000_000, 1_000_000);
    const rows = await mine();
    const of = (model: string) => rows.find((r) => r.model === model)!;
    expect(of("gpt-c-2026-05-01").costMicros).toBe(3_000_000);
    expect(of("gpt-c-mini-2026-05-01").costMicros).toBe(100_000);
    expect(of("nameless")).toMatchObject({ costMicros: 0, unpricedRequests: 1 });
    expect(totalOf(rows).unpricedRequests).toBe(1);
    // The same rule in code.
    const list = [{ provider, model: "gpt-c", inputPerMillion: 3, outputPerMillion: 6, effectiveFrom: new Date(Date.now() - 5 * 86_400_000) }];
    expect(matchPrice(list, provider, "gpt-c-2026-05-01", new Date())?.inputPerMillion).toBe(3);
  });

  it("lists models used without a price, and prices them from the beginning when a price is first set, but later ones only from now", async () => {
    expect((await prices.unpricedModels()).filter((m) => m.provider === provider).map((m) => m.model)).toEqual(["nameless"]);
    const form = (entries: Record<string, string>) => ({ get: (name: string) => entries[name] ?? null });
    expect(await prices.setPrice(admin, form({ provider, model: "nameless", input: "2", output: "4", note: "test" }))).toEqual({ ok: true, first: true });
    // The call from two days ago is priced, and the model is no longer listed.
    expect((await mine()).find((r) => r.model === "nameless")).toMatchObject({ costMicros: 6_000_000, unpricedRequests: 0 });
    expect((await prices.unpricedModels()).filter((m) => m.provider === provider)).toEqual([]);
    // A second price counts from now: the earlier call keeps its price.
    expect(await prices.setPrice(admin, form({ provider, model: "nameless", input: "20", output: "40", note: "" }))).toEqual({ ok: true, first: false });
    expect((await mine()).find((r) => r.model === "nameless")?.costMicros).toBe(6_000_000);
    await call("nameless", 0, 1_000_000, 0);
    expect((await mine()).find((r) => r.model === "nameless")?.costMicros).toBe(26_000_000);
    const lines = (await prices.listPrices()).filter((p) => p.provider === provider && p.model === "nameless");
    expect(lines.map((l) => [l.inputPerMillion, l.current])).toEqual([[20, true], [2, false]]);
    expect(await prices.setPrice(admin, form({ provider, model: "", input: "x", output: "1" }))).toMatchObject({ ok: false });
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where action = 'platform.ai_price_set' and account_id = ${admin.id}::uuid`);
    expect(Number(audited.n)).toBe(2);
  });

  it("gives the AI manager the cost worked out here, and what a store's recommendations used this month", async () => {
    const summary = summarizeUsage(await mine());
    expect(summary.total.estimated_cost_usd).toBeGreaterThan(8);
    expect(JSON.stringify(summary)).not.toContain("Money is not shown");
    await call("gpt-c", 0, 2_000_000, 1_000_000, { store: true, feature: "recommendations" });
    const month = await recommend.usedThisMonth(storeId);
    expect(month).toMatchObject({ tokens: 3_000_000, unpriced: false });
    // gpt-c has been $3 in and $6 out for five days: 2 * 3 + 1 * 6.
    expect(month.costMicros).toBe(12_000_000);
    expect(await recommend.tokensUsedThisMonth(storeId)).toBe(3_000_000);
  });
});
