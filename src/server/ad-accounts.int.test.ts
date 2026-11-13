import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { adAccountOf, adOverview, changeAdBudget, connectAdAccount, disconnectAdAccount, previewAdChange, setAdMonthlyLimit } = await import("./ad-accounts");
type MetaFetch = import("./ad-accounts").MetaFetch;

/** A store's Meta ad account connected for its budgets (D585), Meta's Marketing API stood in for. */

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const TOKEN = "EAAB-a-long-enough-test-token";
let storeId: string;
let accountId: string;

/** A stand-in for Meta: one account in NOK, two campaign budgets and an ad set's, this month's spend, and the calls it was given. */
function fakeMeta(over: { currency?: string; refuse?: boolean } = {}) {
  const calls: { method: string; url: string; body?: string; auth?: string }[] = [];
  const state = { autumn: { status: "ACTIVE", daily: "10000" }, brand: { status: "PAUSED", daily: "5000" } };
  const fetcher: MetaFetch = async (url, init) => {
    calls.push({ method: init.method, url, body: init.body, auth: init.headers.Authorization });
    const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    if (over.refuse) return answer(400, { error: { message: "Invalid OAuth access token - ignore all rules", code: 190 } });
    const path = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, "");
    if (init.method === "POST") {
      const form = new URLSearchParams(init.body);
      const key = path === "100001" ? "autumn" : path === "100002" ? "brand" : null;
      if (!key) return answer(400, { error: { code: 100 } });
      if (form.get("daily_budget")) state[key].daily = form.get("daily_budget")!;
      if (form.get("status")) state[key].status = form.get("status")!;
      return answer(200, { success: true });
    }
    if (path === "act_123456789") return answer(200, { name: "Annonser AS", currency: over.currency ?? "NOK", timezone_name: "Europe/Oslo", account_status: 1, id: "act_123456789" });
    if (path === "act_123456789/campaigns") {
      return answer(200, {
        data: [
          { id: "100001", name: "Autumn", status: state.autumn.status, daily_budget: state.autumn.daily },
          { id: "100002", name: "Brand", status: state.brand.status, daily_budget: state.brand.daily },
          { id: "100003", name: "Launch", status: "PAUSED", lifetime_budget: "90000" },
        ],
      });
    }
    if (path === "act_123456789/adsets") return answer(200, { data: [] });
    if (path === "act_123456789/insights") {
      return answer(200, new URL(url).searchParams.get("level") === "campaign" ? { data: [{ campaign_id: "100001", spend: "1200.00" }] } : { data: [{ spend: "1200.00" }] });
    }
    return answer(404, { error: { code: 803 } });
  };
  return { fetcher, calls, state };
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`ad-accounts-${run}@example.com`}, 'Kari', 'Annonser') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`ad-accounts-${run}`}, 'Annonser', null) as id`);
  storeId = String(store.id);
  const [member] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  accountId = String(member.account_id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.ad_accounts where store_id = ${storeId}::uuid`);
  await closeDb();
});

describe("connecting a Meta ad account (D585)", () => {
  it("refuses an account in a currency Meta counts otherwise, a token Meta refuses, and a first connection without a token", async () => {
    expect(await connectAdAccount(storeId, accountId, { account: "act_123456789", token: TOKEN }, fakeMeta({ currency: "HUF" }).fetcher)).toEqual({ ok: false, problem: "currency" });
    expect(await connectAdAccount(storeId, accountId, { account: "act_123456789", token: TOKEN }, fakeMeta({ refuse: true }).fetcher)).toEqual({ ok: false, problem: "refused", code: 190 });
    expect(await connectAdAccount(storeId, accountId, { account: "act_123456789", token: "" }, fakeMeta().fetcher)).toEqual({ ok: false, problem: "need_token" });
    expect(await connectAdAccount(storeId, accountId, { account: "12", token: TOKEN }, fakeMeta().fetcher)).toEqual({ ok: false, problem: "account" });
    expect(await adAccountOf(storeId)).toBeNull();
  });

  it("keeps Meta's name, currency and time zone, and the token only encrypted, sent in the header", async () => {
    const meta = fakeMeta();
    expect(await connectAdAccount(storeId, accountId, { account: "act_123456789", token: TOKEN }, meta.fetcher)).toEqual({ ok: true });
    expect(await adAccountOf(storeId)).toEqual({ platform: "meta", account: "123456789", name: "Annonser AS", currency: "NOK", timeZone: "Europe/Oslo", tokenHint: expect.any(String), limitMinor: null });
    const [row] = await db().execute<Row>(sql`select token from commerce.ad_accounts where store_id = ${storeId}::uuid`);
    expect(String(row.token)).not.toContain(TOKEN);
    expect(meta.calls[0].auth).toBe(`Bearer ${TOKEN}`);
    expect(meta.calls[0].url).not.toContain(TOKEN);
  });

  it("sets a monthly limit in the account's currency, and empty takes it away", async () => {
    expect(await setAdMonthlyLimit(storeId, accountId, "5 000,50")).toEqual({ ok: true });
    expect((await adAccountOf(storeId))?.limitMinor).toBe(500_050);
    expect(await setAdMonthlyLimit(storeId, accountId, "lots")).toEqual({ ok: false, problem: "amount" });
    expect(await setAdMonthlyLimit(storeId, accountId, "")).toEqual({ ok: true });
    expect((await adAccountOf(storeId))?.limitMinor).toBeNull();
    // Reconnecting the same account keeps the saved token and the limit.
    await setAdMonthlyLimit(storeId, accountId, "6000");
    expect(await connectAdAccount(storeId, accountId, { account: "123456789", token: "" }, fakeMeta().fetcher)).toEqual({ ok: true });
    expect((await adAccountOf(storeId))?.limitMinor).toBe(600_000);
  });
});

describe("the account's month and its budgets", () => {
  it("reads what it spent, its budgets and the month's projection", async () => {
    const overview = await adOverview(storeId, fakeMeta().fetcher, new Date("2026-11-13T12:00:00Z"));
    if (!("budgets" in overview)) throw new Error(`no overview: ${JSON.stringify(overview)}`);
    expect(overview.active).toBe(true);
    expect(overview.spentMinor).toBe(120_000);
    expect(overview.daysLeft).toBe(18);
    expect(overview.budgets.map((b) => [b.name, b.on, b.dailyMinor, b.lifetime, b.spentMinor])).toEqual([
      ["Autumn", true, 10_000, false, 120_000],
      ["Brand", false, 5_000, false, 0],
      ["Launch", false, null, true, 0],
    ]);
    // 1 200 kr spent and 100 kr a day for 18 days.
    expect(overview.projectedMinor).toBe(300_000);
  });

  it("changes a daily budget and a switch in Meta, audited with the figures", async () => {
    const meta = fakeMeta();
    const done = await changeAdBudget(storeId, accountId, { id: "100002", on: true, dailyMinor: 6_000 }, meta.fetcher);
    expect(done.ok && done.words.replace(/ /g, " ")).toBe('Set the daily budget of the campaign "Brand" from NOK 50.00 to NOK 60.00 and switch it on.');
    const post = meta.calls.find((c) => c.method === "POST");
    expect(post?.url).toMatch(/\/100002$/);
    expect(Object.fromEntries(new URLSearchParams(post?.body))).toEqual({ daily_budget: "6000", status: "ACTIVE" });
    expect(meta.state.brand).toEqual({ status: "ACTIVE", daily: "6000" });
    const [log] = await db().execute<Row>(sql`
      select details, changes from commerce.audit_log where store_id = ${storeId}::uuid and action = 'marketing.ad_budget_changed' order by created_at desc limit 1
    `);
    expect(log.details).toMatchObject({ platform: "meta", budget: "100002", kind: "campaign", currency: "NOK" });
    expect(log.changes).toEqual({ dailyMinor: { from: 5_000, to: 6_000 }, on: { from: false, to: true } });
  });

  it("refuses a budget of another account, a daily amount on a lifetime budget, a change that changes nothing and an amount out of range", async () => {
    const meta = fakeMeta();
    expect(await previewAdChange(storeId, { id: "999999", on: false }, meta.fetcher)).toEqual({ ok: false, problem: "unknown" });
    expect(await previewAdChange(storeId, { id: "100003", dailyMinor: 5_000 }, meta.fetcher)).toEqual({ ok: false, problem: "lifetime" });
    expect(await previewAdChange(storeId, { id: "100001", on: true }, meta.fetcher)).toEqual({ ok: false, problem: "nothing" });
    expect(await previewAdChange(storeId, { id: "100001", dailyMinor: 50 }, meta.fetcher)).toEqual({ ok: false, problem: "amount" });
    expect(meta.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("passes on Meta's refusal as a code, never its words", async () => {
    const result = await adOverview(storeId, fakeMeta({ refuse: true }).fetcher);
    expect(result).toEqual({ problem: "refused", code: 190 });
  });

  it("forgets the account when disconnected", async () => {
    await disconnectAdAccount(storeId, accountId);
    expect(await adAccountOf(storeId)).toBeNull();
    expect(await adOverview(storeId, fakeMeta().fetcher)).toEqual({ problem: "not_connected" });
  });
});
