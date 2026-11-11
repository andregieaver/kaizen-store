import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const sms = await import("./sms");
const { newStore, pay, place } = await import("./inventory-test-support");

type Row = Record<string, unknown>;
type Call = { method: string; path: string; form: Record<string, string> };

/**
 * A stand-in for 46elks (D565), answering as its documentation shows: the account, the numbers, a dry run's estimate, a sent text's id
 * and cost. A text to `+4790000666` fails, as one to a number 46elks refuses would.
 */
function elks() {
  const calls: Call[] = [];
  let n = 0;
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace("https://api.46elks.com/a1", "");
    const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    calls.push({ method: init?.method ?? "GET", path, form });
    if (auth !== `Basic ${Buffer.from("u_test:p_test").toString("base64")}`) return new Response("Unauthorized", { status: 401 });
    if (path === "/me") return Response.json({ id: "u1", currency: "SEK", displayname: "Test", balance: 1 });
    if (path === "/numbers") return Response.json({ data: [{ id: "n1", number: "+46766861217", capabilities: ["sms"], active: "yes" }] });
    if (path === "/numbers/n1") return Response.json({ id: "n1", number: "+46766861217", sms_url: form.sms_url });
    if (path === "/sms" && form.dryrun === "yes") return Response.json({ estimated_cost: form.to.startsWith("+46") ? 3500 : 5000, parts: 1, to: form.to });
    if (path === "/sms") {
      if (form.to === "+4790000666") return new Response("Bad number", { status: 403 });
      return Response.json({ id: `s${++n}${randomBytes(6).toString("hex")}`, status: "created", to: form.to, cost: form.to.startsWith("+46") ? 3500 : 5000, parts: 1 });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
}

let store: Awaited<ReturnType<typeof newStore>>;

beforeAll(async () => {
  store = await newStore("sms");
});

afterAll(async () => {
  await closeDb();
});

const subscriber = async (phone: string) =>
  (await db().execute<Row>(sql`select id, status, source, consent_text, token, unsubscribe_source from commerce.sms_subscribers where store_id = ${store.storeId}::uuid and phone = ${phone}`))[0];

/** A number subscribed straight from a paid order, as checkout's box leaves one. */
async function subscribed(phone: string, country = "NO"): Promise<void> {
  const order = await place(store.storeId, [["DEMO-TOTE", 1]]);
  expect(await sms.keepCheckoutSms({ storeId: store.storeId, orderId: order.orderId, typed: phone, country, locale: "nb-NO", marketCode: "NO", email: null, customerId: null, consentText: "Send meg tilbud på SMS." })).toBe(true);
  await pay(store.storeId, order, store.account);
  await sms.confirmPaidSmsConsents({ storeId: store.storeId });
}

describe("SMS marketing (D565)", () => {
  const stand = elks();

  it("connects the owner's 46elks account, checking it, and keeps the password only encrypted", async () => {
    expect(await sms.connectSms(store.member, { username: "u_test", password: "wrong", sender: "Nordlys" }, stand.fetcher)).toEqual({ ok: false, problem: "46elks did not accept the username and password." });
    expect(await sms.connectSms(store.member, { username: "u_test", password: "p_test", sender: "Nordlys AS" }, stand.fetcher)).toMatchObject({ ok: false });
    expect(await sms.connectSms(store.member, { username: "u_test", password: "p_test", sender: "Nordlys", replyNumber: "+46766861217", monthlyCap: 1 }, stand.fetcher)).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select api_password_encrypted, currency, inbound_key from commerce.sms_settings where store_id = ${store.storeId}::uuid`);
    expect(String(row.api_password_encrypted)).not.toContain("p_test");
    expect(row.currency).toBe("SEK");
    // The reply number's incoming texts point at the store's own inbound address.
    expect(stand.calls.find((c) => c.path === "/numbers/n1")?.form.sms_url).toBe(sms.inboundUrl(String(row.inbound_key)));
    expect(await sms.getSmsSettings(store.storeId)).toMatchObject({ connected: true, currency: "SEK", sender: "Nordlys", replyNumber: "+46766861217", monthlyCap: 1 });
  });

  it("keeps checkout's consent waiting until its order is paid, with the words and the order", async () => {
    const order = await place(store.storeId, [["DEMO-TOTE", 1]]);
    expect(await sms.keepCheckoutSms({ storeId: store.storeId, orderId: order.orderId, typed: "nope", country: "NO", locale: "nb-NO", marketCode: "NO", email: null, customerId: null, consentText: "x" })).toBe(false);
    expect(await sms.keepCheckoutSms({ storeId: store.storeId, orderId: order.orderId, typed: "912 34 567", country: "NO", locale: "nb-NO", marketCode: "NO", email: "Kari@Example.com", customerId: null, consentText: "Send meg tilbud på SMS." })).toBe(true);
    expect(await subscriber("+4791234567")).toMatchObject({ status: "pending", source: "checkout", consent_text: "Send meg tilbud på SMS." });
    await sms.confirmPaidSmsConsents({ storeId: store.storeId });
    expect((await subscriber("+4791234567")).status).toBe("pending");
    await pay(store.storeId, order, store.account);
    expect(await sms.confirmPaidSmsConsents({ storeId: store.storeId })).toMatchObject({ subscribed: 1 });
    expect((await subscriber("+4791234567")).status).toBe("subscribed");
    const events = await db().execute<Row>(sql`
      select e.kind from commerce.sms_consent_events e join commerce.sms_subscribers s on s.id = e.subscriber_id where s.store_id = ${store.storeId}::uuid and s.phone = '+4791234567' order by e.id`);
    expect(events.map((e) => e.kind)).toEqual(["requested", "subscribed"]);
  });

  it("never makes a text for a number that did not agree (the database refuses it)", async () => {
    const [pending] = await db().execute<Row>(sql`
      insert into commerce.sms_subscribers (store_id, phone, country, locale, status, source, consent_text, consented_at, token)
      values (${store.storeId}::uuid, '+4791111111', 'NO', 'nb-NO', 'pending', 'checkout', 'x', now(), ${randomBytes(16).toString("base64url")}) returning id`);
    const [draft] = await db().execute<Row>(sql`insert into commerce.sms_campaigns (store_id, title, text) values (${store.storeId}::uuid, 'Probe', 'Hei') returning id`);
    await expect(
      db().execute(sql`insert into commerce.sms_messages (store_id, campaign_id, subscriber_id, send_after) values (${store.storeId}::uuid, ${String(draft.id)}::uuid, ${String(pending.id)}::uuid, now())`),
    ).rejects.toThrow();
    await db().execute(sql`delete from commerce.sms_campaigns where id = ${String(draft.id)}::uuid`);
  });

  it("prices a campaign with 46elks's own dry run and refuses one past the month's cap", async () => {
    await subscribed("+46701234567", "SE");
    const saved = await sms.saveSmsCampaign(store.member, null, { title: "Black Friday", text: "20 % på alt i dag.", segmentId: null });
    if (!saved.ok) throw new Error(saved.problem);
    const preview = await sms.previewSmsCampaign(store.member, saved.id, stand.fetcher);
    // Norway 0.50 SEK and Sweden 0.35 SEK, one text each.
    expect(preview).toMatchObject({ ok: true, recipients: 2, parts: 1, estimate: 0.85, currency: "SEK", cap: 1, withinCap: true });
    expect(stand.calls.filter((c) => c.form.dryrun === "yes").every((c) => c.form.message.startsWith("Test: 20 % på alt i dag.\nAvmeld: "))).toBe(true);
    await db().execute(sql`update commerce.sms_settings set monthly_cap_units = 8000 where store_id = ${store.storeId}::uuid`);
    expect(await sms.startSmsCampaign(store.member, saved.id, stand.fetcher)).toMatchObject({ ok: false });
    await db().execute(sql`update commerce.sms_settings set monthly_cap_units = 100000 where store_id = ${store.storeId}::uuid`);
  });

  it("sends each text in its recipient's hours, with the store's name and the stop link, and records 46elks's id and cost", async () => {
    const [draft] = await db().execute<Row>(sql`select id from commerce.sms_campaigns where store_id = ${store.storeId}::uuid and title = 'Black Friday'`);
    const id = String(draft.id);
    // Started at 22:30 in Oslo: nothing goes tonight.
    const night = new Date("2026-11-11T21:30:00Z");
    expect(await sms.startSmsCampaign(store.member, id, stand.fetcher, night)).toEqual({ ok: true, recipients: 2 });
    const sendAfter = await db().execute<Row>(sql`select send_after from commerce.sms_messages where campaign_id = ${id}::uuid order by send_after`);
    // 09:00 the next morning in Oslo and Stockholm alike: 08:00 UTC.
    expect(sendAfter.map((r) => new Date(String(r.send_after)).toISOString())).toEqual(["2026-11-12T08:00:00.000Z", "2026-11-12T08:00:00.000Z"]);
    expect(await sms.runSms({ storeId: store.storeId, fetcher: stand.fetcher, now: night })).toMatchObject({ sent: 0 });
    const run = await sms.runSms({ storeId: store.storeId, fetcher: stand.fetcher, now: new Date("2026-11-12T08:05:00Z") });
    expect(run).toMatchObject({ sent: 2, failed: 0, finished: 1 });
    const sent = stand.calls.filter((c) => c.path === "/sms" && !c.form.dryrun);
    // From the reply number, so a STOP reply comes back; the delivery report to the store's own address.
    expect(sent.every((c) => c.form.from === "+46766861217" && c.form.whendelivered.endsWith("/delivered"))).toBe(true);
    expect(sent[0].form.message).toMatch(/^Test: 20 % på alt i dag\.\nAvmeld: http.+\/sms\/[A-Za-z0-9_-]{22}$/);
    expect(await sms.getSmsCampaign(store.storeId, id)).toMatchObject({ status: "sent", counts: { sent: 2 }, cost: 0.85 });
    expect((await sms.getSmsSettings(store.storeId)).spentThisMonth).toBeGreaterThanOrEqual(0.85);
  });

  it("stops a number at once on a STOP reply, and a second campaign skips it", async () => {
    const [settings] = await db().execute<Row>(sql`select inbound_key from commerce.sms_settings where store_id = ${store.storeId}::uuid`);
    const key = String(settings.inbound_key);
    expect(await sms.receiveSms("x".repeat(43), "+4791234567", "STOP")).toBe("unknown");
    expect(await sms.receiveSms(key, "+4791234567", "Takk!")).toBe("ignored");
    expect(await sms.receiveSms(key, "+4791234567", "Stopp")).toBe("stopped");
    expect(await subscriber("+4791234567")).toMatchObject({ status: "unsubscribed", unsubscribe_source: "reply" });
    const saved = await sms.saveSmsCampaign(store.member, null, { title: "Second", text: "Siste sjanse.", segmentId: null });
    if (!saved.ok) throw new Error(saved.problem);
    expect(await sms.startSmsCampaign(store.member, saved.id, stand.fetcher, new Date("2026-11-12T10:00:00Z"))).toEqual({ ok: true, recipients: 1 });
  });

  it("stops a number by its link too, and skips a text it was waiting for", async () => {
    await subscribed("+4790000777");
    const saved = await sms.saveSmsCampaign(store.member, null, { title: "Third", text: "Hei igjen.", segmentId: null });
    if (!saved.ok) throw new Error(saved.problem);
    expect(await sms.startSmsCampaign(store.member, saved.id, stand.fetcher, new Date("2026-11-12T21:00:00Z"))).toMatchObject({ ok: true });
    const token = String((await subscriber("+4790000777")).token);
    expect(await sms.smsTokenView(token)).toMatchObject({ status: "subscribed", phone: "+47 ••• 777" });
    expect(await sms.stopByToken(token)).toBe(true);
    expect(await subscriber("+4790000777")).toMatchObject({ status: "unsubscribed", unsubscribe_source: "link" });
    const [message] = await db().execute<Row>(sql`
      select m.status, m.error from commerce.sms_messages m join commerce.sms_subscribers s on s.id = m.subscriber_id where m.campaign_id = ${saved.id}::uuid and s.phone = '+4790000777'`);
    expect(message).toMatchObject({ status: "skipped", error: "stopped" });
  });

  it("keeps a failure as 46elks's status key, and takes delivery reports for the store's own messages", async () => {
    await subscribed("+4790000666");
    const saved = await sms.saveSmsCampaign(store.member, null, { title: "Fourth", text: "Hei.", segmentId: null });
    if (!saved.ok) throw new Error(saved.problem);
    await sms.startSmsCampaign(store.member, saved.id, stand.fetcher, new Date("2026-11-12T10:00:00Z"));
    const run = await sms.runSms({ storeId: store.storeId, fetcher: stand.fetcher, now: new Date("2026-11-12T10:00:00Z") });
    expect(run.failed).toBeGreaterThanOrEqual(1);
    const [failed] = await db().execute<Row>(sql`
      select m.error from commerce.sms_messages m join commerce.sms_subscribers s on s.id = m.subscriber_id where m.campaign_id = ${saved.id}::uuid and s.phone = '+4790000666'`);
    expect(failed.error).toBe("http_403");
    const [one] = await db().execute<Row>(sql`select provider_id from commerce.sms_messages where store_id = ${store.storeId}::uuid and status = 'sent' limit 1`);
    const [settings] = await db().execute<Row>(sql`select inbound_key from commerce.sms_settings where store_id = ${store.storeId}::uuid`);
    expect(await sms.recordDelivery(String(settings.inbound_key), String(one.provider_id), "delivered")).toBe(true);
    const [after] = await db().execute<Row>(sql`select status, delivered_at from commerce.sms_messages where provider_id = ${String(one.provider_id)}`);
    expect(after.status).toBe("delivered");
    expect(after.delivered_at).not.toBeNull();
  });

  it("stops a campaign when the month's real cost reaches the cap", async () => {
    await subscribed("+4790000888");
    const saved = await sms.saveSmsCampaign(store.member, null, { title: "Fifth", text: "Hei.", segmentId: null });
    if (!saved.ok) throw new Error(saved.problem);
    expect(await sms.startSmsCampaign(store.member, saved.id, stand.fetcher, new Date("2026-11-12T10:00:00Z"))).toMatchObject({ ok: true });
    // The cap lowered to what was spent already: the job sends nothing more and stops the campaign.
    await db().execute(sql`update commerce.sms_settings set monthly_cap_units = 1 where store_id = ${store.storeId}::uuid`);
    const run = await sms.runSms({ storeId: store.storeId, fetcher: stand.fetcher, now: new Date("2026-11-12T10:00:00Z") });
    expect(run).toMatchObject({ sent: 0, capped: 1 });
    expect(await sms.getSmsCampaign(store.storeId, saved.id)).toMatchObject({ status: "stopped", stopReason: "cap" });
  });

  it("is the owner's to connect and disconnect, and the marketers' to write", async () => {
    const reader = { ...store.member, role: "read_only" as never, permissions: [] as never };
    expect(await sms.connectSms(reader as never, { username: "u_test", password: "p_test", sender: "X" }, stand.fetcher)).toMatchObject({ ok: false });
    expect(await sms.saveSmsCampaign(reader as never, null, { title: "x", text: "y", segmentId: null })).toMatchObject({ ok: false });
    expect(await sms.disconnectSms(store.member)).toEqual({ ok: true });
    expect(await sms.smsOffered(store.storeId)).toBe(false);
  });
});

describe("My account's switch (D565)", () => {
  const stand = elks();

  it("is offered only with SMS on, and a signed-in customer's number agrees at once and stops with one press", async () => {
    const [customer] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name) values (${store.storeId}::uuid, 'ola@example.com', 'Ola') returning id`);
    const id = String(customer.id);
    const input = { storeId: store.storeId, customerId: id, email: "Ola@Example.com", country: "NO", locale: "nb-NO", marketCode: "NO", consentText: "Send meg tilbud på SMS." };
    expect(await sms.accountSms(store.storeId, id)).toEqual({ offered: false, status: null, phone: null });
    expect(await sms.connectSms(store.member, { username: "u_test", password: "p_test", sender: "Nordlys" }, stand.fetcher)).toEqual({ ok: true });
    expect(await sms.setAccountSms({ ...input, on: true, typed: "nope" })).toBe(false);
    expect(await sms.setAccountSms({ ...input, on: true, typed: "912 00 333" })).toBe(true);
    expect(await sms.accountSms(store.storeId, id)).toEqual({ offered: true, status: "subscribed", phone: "+47 ••• 333" });
    expect(await subscriber("+4791200333")).toMatchObject({ status: "subscribed", source: "account", consent_text: "Send meg tilbud på SMS." });
    expect(await sms.setAccountSms({ ...input, on: false, typed: "" })).toBe(true);
    expect(await subscriber("+4791200333")).toMatchObject({ status: "unsubscribed", unsubscribe_source: "account" });
  });
});
