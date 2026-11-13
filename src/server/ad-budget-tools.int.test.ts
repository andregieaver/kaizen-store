import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { connectAdAccount, setAdMonthlyLimit } = await import("./ad-accounts");
const { adBudgetApprovalWords, adBudgetAutopilotProblem, listAdBudgetsTool, preflightSetAdBudget, setAdBudgetTool } = await import("./ad-budget-tools");
const { getStore } = await import("./stores");
type Store = import("./stores").Store;
type Account = import("./auth").Account;

/** The AI manager's ad budget tools (D585 step 1b), Meta stood in for by a stub of `fetch`. */

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let store: Store;
let actor: Account;
const posts: string[] = [];

/** One account in EUR: a campaign at 100.00 a day that spent 1 000.00, and a paused one at 50.00. */
const meta = async (url: string, init?: RequestInit) => {
  const path = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, "");
  const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (init?.method === "POST") {
    posts.push(`${path} ${String(init.body)}`);
    return answer({ success: true });
  }
  if (path === "act_555666777") return answer({ name: "Butikk Ads", currency: "EUR", timezone_name: "Europe/Oslo", account_status: 1 });
  if (path.endsWith("/campaigns")) {
    return answer({
      data: [
        { id: "300001", name: "Autumn", status: "ACTIVE", daily_budget: "10000" },
        { id: "300002", name: "Brand", status: "PAUSED", daily_budget: "5000" },
      ],
    });
  }
  if (path.endsWith("/adsets")) return answer({ data: [] });
  if (path.endsWith("/insights")) return answer({ data: [{ campaign_id: "300001", spend: "1000.00" }] });
  return new Response("{}", { status: 404 });
};

beforeAll(async () => {
  vi.stubGlobal("fetch", meta);
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`ad-tools-${run}@example.com`}, 'Kari', 'Butikk') returning id
  `);
  const [row] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`ad-tools-${run}`}, 'Butikk', null) as id`);
  store = (await getStore(`ad-tools-${run}`))!;
  expect(store.id).toBe(String(row.id));
  const [member] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${store.id}::uuid limit 1`);
  actor = { id: String(member.account_id) } as Account;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db().execute(sql`delete from commerce.ad_accounts where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("the ad budget tools (D585)", () => {
  it("says the account is not connected, in words", async () => {
    await expect(listAdBudgetsTool({ account: actor, store })).rejects.toThrow(/no Meta ad account connected/);
  });

  it("lists the month and the budgets, written by code in the account's currency", async () => {
    expect(await connectAdAccount(store.id, actor.id, { account: "act_555666777", token: "EAAB-a-long-enough-test-token" })).toEqual({ ok: true });
    const listed = await listAdBudgetsTool({ account: actor, store });
    expect(listed.currency).toBe("EUR");
    expect(listed.spent_this_month).toBe("€1,000.00");
    expect(listed.budgets.map((b) => [b.id, b.state, b.daily_budget])).toEqual([
      ["300001", "on", "€100.00"],
      ["300002", "paused", "€50.00"],
    ]);
    expect(listed.ai_monthly_limit).toMatch(/^none/);
  });

  it("refuses a change before it is kept, and words the approval from Meta's figures", async () => {
    await expect(preflightSetAdBudget({ account: actor, store }, { budget: "999999", on: false })).rejects.toThrow(/not in the ad account/);
    await expect(preflightSetAdBudget({ account: actor, store }, { budget: "300001", daily: "lots" })).rejects.toThrow(/amount in EUR/);
    expect(await adBudgetApprovalWords(store, { budget: "300001", daily: "120" })).toBe('Set the daily budget of the campaign "Autumn" from €100.00 to €120.00.');
  });

  it("lets the autopilot lower or pause, and raise only within the owner's limit and largest raise", async () => {
    expect(await adBudgetAutopilotProblem(store, { budget: "300001", on: false }, 20)).toBeNull();
    expect(await adBudgetAutopilotProblem(store, { budget: "300001", daily: "110" }, 20)).toMatch(/No monthly limit/);
    await setAdMonthlyLimit(store.id, actor.id, "5000");
    expect(await adBudgetAutopilotProblem(store, { budget: "300001", daily: "110" }, 20)).toBeNull();
    expect(await adBudgetAutopilotProblem(store, { budget: "300001", daily: "150" }, 20)).toBe("It raises a daily budget by 50 %, more than your limit of 20 %.");
    await setAdMonthlyLimit(store.id, actor.id, "1500");
    expect(await adBudgetAutopilotProblem(store, { budget: "300002", on: true }, 20)).toMatch(/more than your limit of €1,500.00/);
  });

  it("changes the budget in Meta on a yes", async () => {
    const done = await setAdBudgetTool({ account: actor, store }, { budget: "300002", on: true, daily: "60" });
    expect(done.done).toBe('Set the daily budget of the campaign "Brand" from €50.00 to €60.00 and switch it on.');
    expect(posts).toEqual(["300002 daily_budget=6000&status=ACTIVE"]);
  });
});
