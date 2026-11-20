import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";
import { OwnerToolError } from "./owner-tool-error";

/**
 * The AI tunes Kaizena Flow's prices (D748 E9 part two, D854): nothing while off, every change waiting for a yes while it proposes, on its own
 * only within the range of the price a person last set, a new price row each time (the old one kept for those paying it), never at or below
 * a founding price, and every change kept with its reasons.
 */

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const tuning = await import("./price-tuning");

const run = Date.now().toString(36);
let admin: Account;
let planId: string;
let sizeId: string;
let before: { level: string; range: number };

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(OwnerToolError);
  return (error as Error).message;
};

const setTuning = (level: string, range = 20) => db().execute(sql`update commerce.platform_settings set price_tuning = ${level}, price_tuning_range_percent = ${range}`);

const sizePrices = async () =>
  db().execute<Row>(sql`select amount_minor::int as amount, founding_minor::int as founding, active from commerce.extension_prices where size_id = ${sizeId}::uuid and currency = 'NOK' and interval = 'month' order by created_at`);

const call = (price: string, over: Record<string, unknown> = {}) => ({
  target: "extension",
  id: sizeId,
  currency: "NOK",
  interval: "month",
  price,
  reasons: "Trials convert well and nobody cancelled in 90 days.",
  ...over,
});

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`tuning-${run}@example.com`}, 'Tuning', true) returning id, email`);
  admin = { id: String(a.id), email: String(a.email), name: "Tuning", platformAdmin: true };
  const [s] = await db().execute<Row>(sql`select price_tuning as level, price_tuning_range_percent as range from commerce.platform_settings`);
  before = { level: String(s.level), range: Number(s.range) };
  const [p] = await db().execute<Row>(sql`insert into commerce.plans (name, sale_fee_bps, active) values (${`Tuning ${run}`}, 100, true) returning id`);
  planId = String(p.id);
  await db().execute(sql`insert into commerce.plan_prices (plan_id, currency, interval, amount_minor) values (${planId}::uuid, 'NOK', 'month', 30000)`);
  const [z] = await db().execute<Row>(sql`insert into commerce.extension_sizes (extension_id, label, allowances, position, active) values ('deals', ${`Tuning ${run}`}, '{}'::jsonb, 99, true) returning id`);
  sizeId = String(z.id);
  await db().execute(sql`insert into commerce.extension_prices (size_id, currency, interval, amount_minor, founding_minor) values (${sizeId}::uuid, 'NOK', 'month', 20000, 15000)`);
});

afterAll(async () => {
  await setTuning(before.level, before.range);
  await db().execute(sql`update commerce.extension_sizes set active = false where id = ${sizeId}::uuid`);
  await db().execute(sql`update commerce.extension_prices set active = false where size_id = ${sizeId}::uuid`);
  await db().execute(sql`update commerce.plans set active = false where id = ${planId}::uuid`);
  await closeDb();
});

describe("the AI's price tuning (D854)", () => {
  it("changes nothing while off, and says where it is turned on", async () => {
    await setTuning("off");
    expect(await refusal(tuning.preflightPlatformPrice(call("220")))).toMatch(/Platform → Plans/);
    expect(await tuning.platformPriceGateNeeded(call("220"))).toBe(true);
    expect(await refusal(tuning.setPlatformPriceTool({ account: admin }, call("220")))).toMatch(/off/);
  });

  it("asks for every change while it proposes, then makes it a new price row with the founding price kept", async () => {
    await setTuning("propose");
    await tuning.preflightPlatformPrice(call("220"));
    expect(await tuning.platformPriceGateNeeded(call("220"))).toBe(true);
    expect(await tuning.platformPriceApprovalWords(call("220"))).toMatch(/^Change Deals[^,]*, Tuning \S+ from NOK\s?200\.00 to NOK\s?220\.00 a month \(\+10 %\)\. Accounts paying today keep their price\. Why: Trials convert/);
    // The owner said yes.
    const done = await tuning.setPlatformPriceTool({ account: admin }, call("220"));
    expect(done.done).toMatch(/was NOK\s?200\.00, \+10 %/);
    expect(await sizePrices()).toEqual([
      { amount: 20000, founding: 15000, active: false },
      { amount: 22000, founding: 15000, active: true },
    ]);
    const [kept] = await db().execute<Row>(sql`select from_minor::int as f, to_minor::int as t, anchor_minor::int as a, decided from commerce.platform_price_changes where size_id = ${sizeId}::uuid`);
    expect(kept).toEqual({ f: 20000, t: 22000, a: 20000, decided: "approved" });
  });

  it("changes a price on its own within the range of the price a person last set, and asks beyond it", async () => {
    await setTuning("auto", 20);
    // 230 is 15 % from the person's 200: on its own.
    expect(await tuning.platformPriceGateNeeded(call("230"))).toBe(false);
    await tuning.setPlatformPriceTool({ account: admin }, call("230"));
    const [last] = await db().execute<Row>(sql`select anchor_minor::int as a, decided from commerce.platform_price_changes where size_id = ${sizeId}::uuid order by created_at desc limit 1`);
    expect(last).toEqual({ a: 20000, decided: "auto" });
    // 250 is under 10 % from 230 but 25 % from 200: it asks.
    expect(await tuning.platformPriceGateNeeded(call("250"))).toBe(true);
    // A person sets 250 on the editor: 250 is the new anchor, and 290 (16 %) runs on its own again.
    await db().execute(sql`update commerce.extension_prices set active = false where size_id = ${sizeId}::uuid and active`);
    await db().execute(sql`insert into commerce.extension_prices (size_id, currency, interval, amount_minor, founding_minor) values (${sizeId}::uuid, 'NOK', 'month', 25000, 15000)`);
    expect(await tuning.platformPriceGateNeeded(call("290"))).toBe(false);
  });

  it("refuses a price at or below the founding price, a price it cannot read and a price nobody offers", async () => {
    expect(await refusal(tuning.preflightPlatformPrice(call("150")))).toMatch(/founding price/);
    expect(await refusal(tuning.preflightPlatformPrice(call("lots")))).toMatch(/could not be read/);
    expect(await refusal(tuning.preflightPlatformPrice(call("250", { currency: "SEK" })))).toMatch(/no price in SEK a month/);
  });

  it("changes a plan's price through the plan editor's writer, so stores on the old price keep it", async () => {
    await tuning.setPlatformPriceTool({ account: admin }, call("330", { target: "plan", id: planId }));
    const rows = await db().execute<Row>(sql`select amount_minor::int as amount, active from commerce.plan_prices where plan_id = ${planId}::uuid order by created_at`);
    expect(rows).toEqual([
      { amount: 30000, active: false },
      { amount: 33000, active: true },
    ]);
  });

  it("gives the facts with ids, the setting in words and its own changes with their reasons", async () => {
    const facts = await tuning.platformPricingFacts({ days: 90 });
    expect(facts.setting).toMatch(/within 20 %/);
    expect(facts.plans.find((p) => p.id === planId)?.prices).toEqual([{ currency: "NOK", interval: "month", price: expect.stringMatching(/330\.00 a month$/), stores: 0 }]);
    const deals = facts.extensions.find((e) => e.extension === "deals");
    expect(deals?.sizes.find((s) => s.id === sizeId)?.prices[0]).toMatchObject({ founding: expect.stringMatching(/150\.00$/) });
    // The newest first: the plan's change ran on its own (10 % from a person's 300), the size's first change was approved.
    expect(facts.recent_ai_changes[0]).toMatchObject({ decided: "on its own", change: expect.stringMatching(/300\.00 to NOK\s?330\.00 a month$/) });
    expect(facts.recent_ai_changes.find((c) => c.decided === "approved")).toMatchObject({ reasons: "Trials convert well and nobody cancelled in 90 days." });
  });

  it("is a platform owner's alone", async () => {
    expect(await refusal(tuning.setPlatformPriceTool({ account: { ...admin, platformAdmin: false } }, call("260")))).toMatch(/platform owners/);
  });
});
