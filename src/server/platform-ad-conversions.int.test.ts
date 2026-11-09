import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { saveAdConnection, removeAdConnection } = await import("./ad-connections");
const { createAccessRequest } = await import("./platform");
const { houseStoreId } = await import("./house-customers");
const ads = await import("./platform-ad-conversions");

/**
 * Kaizena Flow's sign-ups and first paid plans as ad conversions (C2, D523) against a real database, the platforms stubbed: only a request
 * made with marketing consent queues, each event once per connection of Kaizena Flow's store; the plan only once its store paid, net of VAT;
 * at the Enhanced level only the email's hash leaves; and after 90 days nothing more is sent.
 */

type Row = Record<string, unknown>;
type Call = { url: string; body: string };

const run = Date.now().toString(36);
let house: string;
let accountId: string;

afterAll(async () => {
  if (house && accountId) await removeAdConnection(house, accountId, "meta");
  await db().execute(sql`delete from commerce.platform_sales where stripe_invoice_id = ${`in_ads_${run}`}`);
  await closeDb();
});

const stub = (calls: Call[]) => async (url: string, init: { body: string }) => {
  calls.push({ url, body: init.body });
  return { ok: true, status: 200 };
};
const eventsOf = (calls: Call[], eventId: string) =>
  calls.map((c) => JSON.parse(c.body).data[0]).filter((d: { event_id: string }) => d.event_id === eventId);

describe("Kaizena Flow's sign-ups and paid plans as ad conversions (D523)", () => {
  it("sends a consented sign-up and its first paid plan once, through Kaizena Flow's store, with only a hash of the email", async () => {
    house = (await houseStoreId())!;
    expect(house).toBeTruthy();
    const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`ads-admin-${run}@example.com`}, 'Ada') returning id`);
    accountId = String(account.id);
    expect(await saveAdConnection(house, accountId, { platform: "meta", accountId: "1234567", token: "EAAB-secret-1", dataLevel: "enhanced", testCode: "", on: true })).toEqual({ ok: true });

    const yes = `ads-yes-${run}@example.com`;
    const no = `ads-no-${run}@example.com`;
    await createAccessRequest({ name: "Ja", email: yes, storeName: "Ja", message: "", adSignals: { fbp: "fb.1.1760000000000.123456" } }, { quiet: true });
    await createAccessRequest({ name: "Nei", email: no, storeName: "Nei", message: "" }, { quiet: true });
    const [kept] = await db().execute<Row>(sql`select id, ad_consent_at is not null as consent, ad_signals from commerce.access_requests where email = ${yes}`);
    const [none] = await db().execute<Row>(sql`select id, ad_consent_at, ad_signals from commerce.access_requests where email = ${no}`);
    expect(kept).toMatchObject({ consent: true, ad_signals: { fbp: "fb.1.1760000000000.123456" } });
    expect(none).toMatchObject({ ad_consent_at: null, ad_signals: null });
    const requestId = String(kept.id);

    // Queued once for the connection; never for the request without consent.
    await ads.queuePlatformAdConversions();
    await ads.queuePlatformAdConversions();
    const queued = await db().execute<Row>(sql`select request_id, platform, event from commerce.platform_ad_conversions where request_id in (${requestId}::uuid, ${String(none.id)}::uuid)`);
    expect(queued).toEqual([{ request_id: requestId, platform: "meta", event: "sign_up" }]);

    const calls: Call[] = [];
    await ads.sendPlatformAdConversions({ fetcher: stub(calls), deadline: Date.now() + 10_000 });
    const [signUp] = eventsOf(calls, requestId);
    expect(signUp).toMatchObject({
      event_name: "CompleteRegistration",
      user_data: { fbp: "fb.1.1760000000000.123456", em: [createHash("sha256").update(yes).digest("hex")] },
    });
    expect(calls.every((c) => new URL(c.url).host === "graph.facebook.com")).toBe(true);
    expect(calls.some((c) => c.body.includes(yes))).toBe(false);

    // The store it made pays its first plan: sent as a subscription, net of VAT, its sale the event id.
    await db().execute(sql`select commerce.approve_access_request(${requestId}::uuid, ${`ads-${run}`}, 'Ja', null)`);
    const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${`ads-${run}`}`);
    const [sale] = await db().execute<Row>(sql`
      insert into commerce.platform_sales (mode, stripe_invoice_id, buyer_store_id, kind, paid_at, currency, net_minor, vat_minor, total_minor)
      values ('live', ${`in_ads_${run}`}, ${String(store.id)}::uuid, 'plan', now(), 'NOK', 39_900, 9_975, 49_875) returning id
    `);
    await ads.queuePlatformAdConversions();
    await ads.sendPlatformAdConversions({ fetcher: stub(calls), deadline: Date.now() + 10_000 });
    const [plan] = eventsOf(calls, String(sale.id));
    expect(plan).toMatchObject({ event_name: "Subscribe", custom_data: { currency: "NOK", value: 399, order_id: String(sale.id) } });
    const counts = await ads.platformAdConversionCounts();
    expect(counts.find((c) => c.platform === "meta" && c.event === "plan_paid" && c.status === "sent")?.n).toBeGreaterThanOrEqual(1);
    expect(await ads.platformAdConnections()).toMatchObject({ on: ["meta"] });

    // 90 days on, the consent and the ids are gone.
    await db().execute(sql`update commerce.access_requests set created_at = now() - interval '91 days' where id = ${requestId}::uuid`);
    expect(await ads.prunePlatformAdSignals()).toBeGreaterThanOrEqual(1);
    const [pruned] = await db().execute<Row>(sql`select ad_consent_at, ad_signals from commerce.access_requests where id = ${requestId}::uuid`);
    expect(pruned).toEqual({ ad_consent_at: null, ad_signals: null });

    // The database refuses ids without consent.
    await expect(db().execute(sql`update commerce.access_requests set ad_signals = '{"fbp":"x"}'::jsonb where id = ${requestId}::uuid`)).rejects.toMatchObject({
      cause: { message: expect.stringContaining("access_requests_ad_signals") },
    });
  });
});
