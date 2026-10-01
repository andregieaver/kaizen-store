import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

import { closeDb, db } from "@/db/client";
import { planCards } from "@/lib/plan-offer";

import { getPublicPlans } from "./public-plans";

type Row = Record<string, unknown>;

const tag = Date.now().toString(36);
const planIds: string[] = [];
let featureId: string;

beforeAll(async () => {
  const make = async (name: string, active: boolean, position: number) => {
    const [plan] = await db().execute<Row>(sql`
      insert into commerce.plans (name, description, sale_fee_bps, position, active)
      values (${`${name} ${tag}`}, 'A plan', 150, ${position}, ${active}) returning id
    `);
    planIds.push(String(plan.id));
    return String(plan.id);
  };
  const live = await make("Live", true, 9001);
  const hidden = await make("Hidden", false, 9002);
  await db().execute(sql`
    insert into commerce.plan_prices (plan_id, currency, interval, amount_minor, active) values
      (${live}::uuid, 'NOK', 'month', 29900, true), (${live}::uuid, 'NOK', 'year', 299000, true), (${live}::uuid, 'EUR', 'month', 2900, false),
      (${hidden}::uuid, 'NOK', 'month', 100, true)
  `);
  const [feature] = await db().execute<Row>(sql`
    insert into commerce.plan_features (category, name, position) values (${`Public ${tag}`}, ${`Thing ${tag}`}, 90000) returning id
  `);
  featureId = String(feature.id);
  await db().execute(sql`insert into commerce.plan_feature_grants (feature_id, plan_id) values (${featureId}::uuid, ${live}::uuid), (${featureId}::uuid, ${hidden}::uuid)`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.plan_features where id = ${featureId}::uuid`);
  await db().execute(sql`delete from commerce.plan_prices where plan_id in (${sql.join(planIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  await db().execute(sql`delete from commerce.plans where id in (${sql.join(planIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  await closeDb();
});

describe("Kaizen's plans for its pages (D142)", () => {
  it("lists active plans with their active prices and the features each includes, and nothing a visitor should not see", async () => {
    const data = await getPublicPlans();
    const mine = data.plans.filter((p) => p.name.endsWith(tag));
    expect(mine.map((p) => p.name)).toEqual([`Live ${tag}`]);
    expect(mine[0]).toMatchObject({ saleFeeBps: 150, description: "A plan", featureIds: [featureId] });
    // The inactive price is left out, and amounts are minor units.
    expect(mine[0].prices.sort((a, b) => a.interval.localeCompare(b.interval))).toEqual([
      { currency: "NOK", interval: "month", amountMinor: 29900 },
      { currency: "NOK", interval: "year", amountMinor: 299000 },
    ]);
    expect(data.features.find((f) => f.id === featureId)).toMatchObject({ category: `Public ${tag}`, name: `Thing ${tag}` });
    // No Stripe ids or store counts travel with it.
    expect(Object.keys(mine[0]).sort()).toEqual(["description", "featureIds", "id", "name", "position", "prices", "saleFeeBps"]);
  });

  it("makes cards from what the database holds", async () => {
    const { cards } = planCards(await getPublicPlans(), { currency: "NOK" });
    const card = cards.find((c) => c.name === `Live ${tag}`)!;
    expect(card).toMatchObject({ main: { amountMinor: 29900, interval: "month" }, other: { amountMinor: 299000 }, yearlySavingPercent: 17 });
    expect(card.features.map((f) => f.name)).toEqual([`Thing ${tag}`]);
  });
});
