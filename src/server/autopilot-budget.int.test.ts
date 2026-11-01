import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { makeStore, membershipOf } = await import("./trust-fixtures");
const { saveAutonomy, sendAutopilotBudgetAlerts } = await import("./autopilot-settings");
const { recordUsage } = await import("./ai-usage");
const { actingAs } = await import("./actor");

type Row = Record<string, unknown>;

/** The autopilot's own AI budget told to the owners before it stops (PSI AST-07): once a month at 80 %, once when spent. */

let store: Awaited<ReturnType<typeof makeStore>>;
const model = `budget-alert-${Date.now().toString(36)}`;

const spend = (images: number) =>
  actingAs("autopilot", () =>
    recordUsage({ storeId: store.id, feature: "page_pictures", accountId: store.account.id }, { source: "platform", provider: "autopilot-test", model, kind: "image", amounts: { images } }),
  );
const emails = async (kind: string) =>
  Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where store_id = ${store.id}::uuid and kind = ${kind}`))[0].n);

beforeAll(async () => {
  store = await makeStore("autopilot-budget");
  await db().execute(sql`
    insert into commerce.ai_model_prices (provider, model, input_per_million, output_per_million, per_image, effective_from)
    values ('autopilot-test', ${model}, 0, 0, 1, now() - interval '1 day')
  `);
  const owner = await membershipOf(store.slug, store.account, "owner");
  await saveAutonomy({ account: owner.account, store: owner.store, holder: { role: owner.role, kind: owner.kind, permissions: owner.permissions } }, { budgets: { aiMonthlyUsd: 10 } });
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("the autopilot's AI budget alert", () => {
  it("says nothing under 80 %, tells the owner once at 80 %, and once more when the budget is spent", async () => {
    await spend(7);
    await sendAutopilotBudgetAlerts();
    expect(await emails("autopilot.budget_near")).toBe(0);

    await spend(1);
    expect(await sendAutopilotBudgetAlerts()).toBeGreaterThanOrEqual(1);
    expect(await emails("autopilot.budget_near")).toBe(1);
    // The next run, still near: not again this month.
    await sendAutopilotBudgetAlerts();
    expect(await emails("autopilot.budget_near")).toBe(1);

    await spend(2);
    await sendAutopilotBudgetAlerts();
    expect(await emails("autopilot.budget_reached")).toBe(1);
    expect(await emails("autopilot.budget_near")).toBe(1);
  });
});
