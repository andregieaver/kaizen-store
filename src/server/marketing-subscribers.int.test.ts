import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

// Email is only kept (`logged`), never sent, without Resend's settings.
delete process.env.RESEND_API_KEY;

const subs = await import("./marketing-subscribers");
const { exportCustomerData } = await import("./privacy-export");
const { eraseSubject } = await import("./privacy-erasure");

type Row = Record<string, unknown>;

/**
 * The subscriber list (wave 5 unit A, D295, `docs/wave-5-marketing.md` 3.6): checkout as a guest waits for its link and as a verified customer
 * subscribes at once; My account on and off; the unsubscribe token from the page and the one-click button; one store never reaches another's list;
 * coming back gives consent again; the list, the export and the pruning.
 */

const run = Date.now().toString(36);
let storeId: string;
let otherStoreId: string;
let verified: string;
let unverified: string;
let account: string;

async function newStore(name: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${name}-${run}@example.com`}, 'Kari', 'Nyheter') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`${name}-${run}`}, 'Nyheter', null) as id
  `);
  return String(store.id);
}

async function customer(email: string, verifiedEmail: boolean): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, locale, email_verified_at) values (${storeId}::uuid, ${email}, 'nb-NO', ${verifiedEmail ? new Date().toISOString() : null}::timestamptz)
    returning id
  `);
  return String(row.id);
}

beforeAll(async () => {
  storeId = await newStore("news");
  otherStoreId = await newStore("news-other");
  verified = await customer(`kunde-${run}@example.com`, true);
  unverified = await customer(`ukjent-${run}@example.com`, false);
  const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  account = String(owner.account_id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.marketing_subscribers where store_id in (${storeId}::uuid, ${otherStoreId}::uuid)`);
  await closeDb();
});

const row = async (email: string, store = storeId) =>
  (
    await db().execute<Row>(sql`
      select id, status, source, source_ref, customer_id, token, confirmed_at is not null as confirmed, unsubscribe_source, consent_text
      from commerce.marketing_subscribers where store_id = ${store}::uuid and email = ${email}
    `)
  )[0];

const history = async (id: string) =>
  (await db().execute<Row>(sql`select kind, source from commerce.marketing_consent_events where subscriber_id = ${id}::uuid order by id`)).map((e) => `${e.kind}:${e.source}`);

const emails = (to: string) => db().execute<Row>(sql`select kind, subject, text from commerce.email_messages where to_address = ${to} order by created_at`);

const consent = "Send meg nyheter og tilbud fra Nyheter på e-post. Jeg kan melde meg av når som helst.";

describe("joining the list (D295)", () => {
  it("as a guest at checkout: waits for the emailed link, which the confirm button takes once", async () => {
    const to = `gjest-${run}@example.com`;
    const joined = await subs.joinList({
      storeId,
      email: to.toUpperCase(),
      locale: "nb-NO",
      marketCode: "NO",
      source: "checkout",
      sourceRef: "00000000-0000-0000-0000-000000000001",
      consentText: consent,
      proof: "link",
    });
    expect(joined).toMatchObject({ status: "pending", email: "logged" });
    expect(await row(to)).toMatchObject({ status: "pending", source: "checkout", customer_id: null });
    const [mail] = await emails(to);
    expect(mail).toMatchObject({ kind: "marketing.confirm", subject: "Bekreft e-post fra Nyheter" });
    const token = String(mail.text).match(/\/account\/news\/([A-Za-z0-9_-]{43})/)![1];
    expect(await subs.confirmationWaiting(otherStoreId, token)).toBe(false);
    expect(await subs.confirmSubscription(otherStoreId, token)).toBe(false);
    expect(await subs.confirmationWaiting(storeId, token)).toBe(true);
    expect(await subs.confirmSubscription(storeId, token)).toBe(true);
    expect(await subs.confirmSubscription(storeId, token)).toBe(false);
    const done = await row(to);
    expect(done).toMatchObject({ status: "subscribed", confirmed: true });
    expect(await history(String(done.id))).toEqual(["requested:checkout", "subscribed:checkout"]);
  });

  it("a link opened too late subscribes no one", async () => {
    const to = `sen-${run}@example.com`;
    await subs.joinList({ storeId, email: to, locale: "nb-NO", marketCode: "NO", source: "checkout", consentText: consent, proof: "link" });
    const token = String((await emails(to))[0].text).match(/\/account\/news\/([A-Za-z0-9_-]{43})/)![1];
    await db().execute(sql`update commerce.marketing_subscribers set confirm_until = now() - interval '1 minute' where email = ${to}`);
    expect(await subs.confirmSubscription(storeId, token)).toBe(false);
    expect((await row(to)).status).toBe("pending");
    // Pruned 30 days after its link ran out, with its history.
    await db().execute(sql`update commerce.marketing_subscribers set confirm_until = now() - interval '31 days' where email = ${to}`);
    expect(await subs.pruneSubscribers()).toBeGreaterThanOrEqual(1);
    expect(await row(to)).toBeUndefined();
  });

  it("from My account: a verified customer at once, an unverified one by the link, and off at once", async () => {
    const text = { text: consent, locale: "nb-NO", marketCode: "NO" };
    expect(await subs.accountSubscription(storeId, verified)).toBeNull();
    expect(await subs.setAccountSubscription(storeId, verified, true, text)).toBe("subscribed");
    expect(await row(`kunde-${run}@example.com`)).toMatchObject({ status: "subscribed", source: "account", customer_id: verified, confirmed: false });
    expect(await subs.accountSubscription(storeId, verified)).toBe("subscribed");
    expect(await emails(`kunde-${run}@example.com`)).toHaveLength(0);

    expect(await subs.setAccountSubscription(storeId, unverified, true, text)).toBe("pending");
    expect(await row(`ukjent-${run}@example.com`)).toMatchObject({ status: "pending" });
    expect((await emails(`ukjent-${run}@example.com`))[0]).toMatchObject({ kind: "marketing.confirm" });

    expect(await subs.setAccountSubscription(storeId, verified, false, text)).toBe("unsubscribed");
    expect(await row(`kunde-${run}@example.com`)).toMatchObject({ status: "unsubscribed", unsubscribe_source: "account" });
    // Coming back is a new consent.
    expect(await subs.setAccountSubscription(storeId, verified, true, text)).toBe("subscribed");
    const back = await row(`kunde-${run}@example.com`);
    expect(await history(String(back.id))).toEqual(["subscribed:account", "unsubscribed:account", "subscribed:account"]);
  });

  it("never tells an unverified customer that an address is subscribed already, and never links it to them", async () => {
    const to = `annen-${run}@example.com`;
    await subs.joinList({ storeId, email: to, locale: "nb-NO", marketCode: "NO", source: "form", consentText: consent, proof: "confirmed" });
    const someone = await customer(to, false);
    expect(await subs.setAccountSubscription(storeId, someone, true, { text: consent, locale: "nb-NO", marketCode: "NO" })).toBe("pending");
    expect(await row(to)).toMatchObject({ status: "subscribed", customer_id: null });
    expect(await subs.accountSubscription(storeId, someone)).toBeNull();
  });

  it("does nothing new for an address already subscribed, and keeps one row per address", async () => {
    const to = `gjest-${run}@example.com`;
    const again = await subs.joinList({ storeId, email: to, locale: "nb-NO", marketCode: "NO", source: "form", consentText: "Other words", proof: "confirmed" });
    expect(again).toMatchObject({ status: "already", email: null });
    expect(await row(to)).toMatchObject({ source: "checkout", consent_text: consent });
  });
});

describe("leaving the list", () => {
  it("by the email's token from the page or the one-click button, once, for its own store only", async () => {
    const to = `gjest-${run}@example.com`;
    const { token, id } = await row(to);
    expect(await subs.isSubscriberToken(otherStoreId, String(token))).toBe(false);
    expect(await subs.isSubscriberToken(storeId, String(token))).toBe(true);
    expect(await subs.unsubscribeByToken(String(token), "one_click")).toEqual({ storeId });
    expect(await row(to)).toMatchObject({ status: "unsubscribed", unsubscribe_source: "one_click" });
    // A second press changes nothing.
    expect(await subs.unsubscribeByToken(String(token), "link")).toEqual({ storeId });
    expect(await row(to)).toMatchObject({ unsubscribe_source: "one_click" });
    expect(await subs.unsubscribeByToken("x".repeat(43), "link")).toBeNull();
    expect((await history(String(id))).at(-1)).toBe("unsubscribed:one_click");
  });

  it("by staff for a person who asked, audited with the id only", async () => {
    const to = `stab-${run}@example.com`;
    await subs.joinList({ storeId, email: to, locale: "nb-NO", marketCode: "NO", source: "form", consentText: consent, proof: "confirmed" });
    const { id } = await row(to);
    expect(await subs.unsubscribeByStaff(otherStoreId, account, String(id))).toBe(false);
    expect(await subs.unsubscribeByStaff(storeId, account, String(id))).toBe(true);
    expect(await row(to)).toMatchObject({ status: "unsubscribed", unsubscribe_source: "staff" });
    const [entry] = await db().execute<Row>(sql`
      select details, area from commerce.audit_log where store_id = ${storeId}::uuid and action = 'subscribers.unsubscribed' order by created_at desc limit 1
    `);
    expect(entry).toEqual({ details: { subscriber: String(id) }, area: "marketing" });
  });

  it("when the address bounced or was marked as spam", async () => {
    const to = `retur-${run}@example.com`;
    await subs.joinList({ storeId, email: to, locale: "nb-NO", marketCode: "NO", source: "form", consentText: consent, proof: "confirmed" });
    expect(await subs.unsubscribeAddress(otherStoreId, to, "bounce")).toBe(false);
    expect(await subs.unsubscribeAddress(storeId, to.toUpperCase(), "bounce")).toBe(true);
    expect(await row(to)).toMatchObject({ status: "unsubscribed", unsubscribe_source: "bounce" });
  });
});

describe("the admin's list", () => {
  it("counts, lists, searches and opens a store's own subscribers only", async () => {
    await subs.joinList({ storeId: otherStoreId, email: `fremmed-${run}@example.com`, locale: "nb-NO", marketCode: "NO", source: "form", consentText: consent, proof: "confirmed" });
    const counts = await subs.subscriberCounts(storeId);
    expect(counts.subscribed).toBeGreaterThanOrEqual(2);
    expect(counts.unsubscribed).toBeGreaterThanOrEqual(3);
    const all = await subs.listSubscribers(storeId);
    expect(all.rows.some((r) => r.email.startsWith("fremmed-"))).toBe(false);
    const found = await subs.listSubscribers(storeId, { query: `retur-${run}` });
    expect(found.rows.map((r) => r.email)).toEqual([`retur-${run}@example.com`]);
    const left = await subs.listSubscribers(storeId, { status: "unsubscribed" });
    expect(left.rows.every((r) => r.status === "unsubscribed")).toBe(true);
    // A search's wildcard is a character, not a pattern.
    expect((await subs.listSubscribers(storeId, { query: "%" })).rows).toEqual([]);
    const detail = await subs.subscriberDetail(storeId, found.rows[0].id);
    expect(detail).toMatchObject({ consentText: consent, unsubscribeSource: "bounce" });
    expect(detail!.history.map((h) => h.kind)).toEqual(["subscribed", "unsubscribed"]);
    expect(await subs.subscriberDetail(otherStoreId, found.rows[0].id)).toBeNull();
  });

  it("exports every row with its consent facts, audited with the count only", async () => {
    const { csv, count } = await subs.subscribersCsv(storeId, account);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("email,name,status,language,market,source,consent_text,consented_at,confirmed_at,unsubscribed_at,unsubscribe_source,customer,created_at");
    expect(lines).toHaveLength(count + 1);
    expect(csv).not.toContain("fremmed-");
    const [entry] = await db().execute<Row>(sql`
      select details from commerce.audit_log where store_id = ${storeId}::uuid and action = 'subscribers.exported' order by created_at desc limit 1
    `);
    expect(entry.details).toEqual({ count });
  });
});

describe("the person's own data (D162)", () => {
  it("exports their place on the list with its history, and erasure deletes both", async () => {
    const exported = await exportCustomerData(storeId, { customerId: verified }, { channel: "staff", accountId: account });
    if (!exported.ok) throw new Error(exported.problem);
    const marketing = exported.file.sections.marketing as { email: string; status: string; history: { kind: string }[] }[];
    expect(marketing).toEqual([expect.objectContaining({ email: `kunde-${run}@example.com`, status: "subscribed", consentText: consent })]);
    expect(marketing[0].history.map((h) => h.kind)).toEqual(["subscribed", "unsubscribed", "subscribed"]);
    expect(exported.file.counts.marketing).toBe(1);

    const { id } = await row(`kunde-${run}@example.com`);
    const erased = await eraseSubject(storeId, { customerId: verified }, { channel: "staff", accountId: account });
    expect(erased).toMatchObject({ ok: true });
    expect(await row(`kunde-${run}@example.com`)).toBeUndefined();
    expect(await history(String(id))).toEqual([]);
    // Another person's place stays.
    expect(await row(`stab-${run}@example.com`)).toBeDefined();
  });
});
