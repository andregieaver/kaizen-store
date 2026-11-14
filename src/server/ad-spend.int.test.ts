import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { dailySpendRows } from "@/lib/ad-budgets";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { connectAdAccount, syncAdSpend, syncAllAdSpend, META_SPEND_NOTE } = await import("./ad-accounts");
type MetaFetch = import("./ad-accounts").MetaFetch;

/**
 * The Meta ad account's daily spend into the books (`docs/100-day-challenge.md` D2): Meta's rows per campaign and day written as marketing
 * spend in the store's main currency, read again (Meta corrects them), a campaign that spent nothing after all losing its row, and a person's
 * own rows never touched.
 */

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const TOKEN = "EAAB-a-long-enough-test-token";
const NOW = new Date("2026-11-14T12:00:00Z");
let storeId: string;
let accountId: string;
let days: { date_start: string; campaign_id: string; campaign_name: string; spend: string }[] = [];

const fetcher: MetaFetch = async (url) => {
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
  const path = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, "");
  if (path === "act_123456789") return answer(200, { name: "Annonser AS", currency: "NOK", timezone_name: "Europe/Oslo", account_status: 1, id: "act_123456789" });
  if (path === "act_123456789/insights" && new URL(url).searchParams.get("time_increment") === "1") return answer(200, { data: days });
  return answer(404, { error: { code: 803 } });
};

const spend = async () =>
  db().execute<Row>(sql`select day::text as day, channel, campaign, amount_minor::int as amount, note from commerce.marketing_spend where store_id = ${storeId}::uuid order by day, campaign`);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`ad-spend-${run}@example.com`}, 'Kari', 'Annonser') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`ad-spend-${run}`}, 'Annonser', null) as id`);
  storeId = String(store.id);
  const [member] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  accountId = String(member.account_id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.marketing_spend where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.ad_accounts where store_id = ${storeId}::uuid`);
  await closeDb();
});

describe("Meta's spend in the books", () => {
  it("reads Meta's daily rows: per campaign and day, nothing spent left out, a bad figure never guessed", () => {
    expect(
      dailySpendRows(
        [
          { date_start: "2026-11-13", campaign_id: "1", campaign_name: "Autumn", spend: "120.50" },
          { date_start: "2026-11-13", campaign_id: "2", campaign_name: "", spend: "0.00" },
          { date_start: "2026-11-14", campaign_id: "3", spend: "9.99" },
          { date_start: "2026-11-14", campaign_id: "4", campaign_name: "Odd", spend: "lots" },
        ],
        "NOK",
      ),
    ).toEqual([
      { day: "2026-11-13", campaign: "Autumn", amountMinor: 12050 },
      { day: "2026-11-14", campaign: "Campaign 3", amountMinor: 999 },
    ]);
  });

  it("writes them as marketing spend, corrects them on the next read, and leaves a person's own rows alone", async () => {
    expect(await syncAdSpend(storeId, fetcher, NOW)).toEqual({ problem: "not_connected" });
    expect(await connectAdAccount(storeId, accountId, { account: "act_123456789", token: TOKEN }, fetcher)).toEqual({ ok: true });
    await db().execute(sql`
      insert into commerce.marketing_spend (store_id, day, channel, campaign, amount_minor, note) values (${storeId}::uuid, '2026-11-13', 'paid_social', 'Typed by hand', 5000, 'mine')
    `);
    days = [
      { date_start: "2026-11-13", campaign_id: "1", campaign_name: "Autumn", spend: "120.50" },
      { date_start: "2026-11-14", campaign_id: "2", campaign_name: "Brand", spend: "40.00" },
    ];
    expect(await syncAdSpend(storeId, fetcher, NOW)).toEqual({ written: 2, unconverted: 0 });
    expect(await spend()).toEqual([
      { day: "2026-11-13", channel: "paid_social", campaign: "Autumn", amount: 12050, note: META_SPEND_NOTE },
      { day: "2026-11-13", channel: "paid_social", campaign: "Typed by hand", amount: 5000, note: "mine" },
      { day: "2026-11-14", channel: "paid_social", campaign: "Brand", amount: 4000, note: META_SPEND_NOTE },
    ]);
    // Meta corrects a day and the Brand campaign turns out to have spent nothing.
    days = [{ date_start: "2026-11-13", campaign_id: "1", campaign_name: "Autumn", spend: "130.00" }];
    expect(await syncAdSpend(storeId, fetcher, NOW)).toEqual({ written: 1, unconverted: 0 });
    expect((await spend()).map((r) => `${r.day} ${r.campaign} ${r.amount}`)).toEqual(["2026-11-13 Autumn 13000", "2026-11-13 Typed by hand 5000"]);
  });

  it("reads each account again only after six hours", async () => {
    expect(await syncAllAdSpend(fetcher, new Date())).toBe(0);
    expect(await syncAllAdSpend(fetcher, new Date(Date.now() + 7 * 3_600_000))).toBeGreaterThanOrEqual(1);
  });
});
