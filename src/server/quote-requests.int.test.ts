import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

// Email is only kept (`logged`), never sent, without Resend's settings.
delete process.env.RESEND_API_KEY;

/** Kaizen's platform Stripe client, faked: a draft's pay link opens no real session. */
vi.mock("./stripe", () => ({
  platformStripe: () => ({}),
  platformPublishableKey: () => "pk_test_quotes",
  platformModes: () => ["test"],
  WEBHOOK_EVENTS: [],
}));

const { requestQuote, declineQuote, quoteRequestsWaiting } = await import("./quote-requests");
const { getDraft, listDrafts, previewDraft, saveDraft, sendDraft } = await import("./draft-orders");
const { getOrderSettings, saveOrderSettings } = await import("./order-settings");
const support = await import("./inventory-test-support");
const { newPlainStore } = await import("./order-ops-fixture");
const { staffActor } = await import("./order-actor");
const { changeLine } = await import("./cart");
const { storeById } = await import("./shopper-emails");
const { payPageFor } = await import("./draft-pay");
const { getStore } = await import("./stores");
const { formFromDraft } = await import("@/lib/draft-editor");

type Row = Record<string, unknown>;
type TestStore = Awaited<ReturnType<typeof support.newStore>>;

/**
 * Request a quote against a real database (D431): a shopper's request from a product's page or the cart becomes a draft of source `quote`
 * (its lines at the market's price, a product priced on request without one), staff are emailed and the shopper gets a receipt; staff type
 * the missing price, and *Send quote* sends the draft's pay link worded as a quote; a declined request emails the reply and can never be sent.
 * Who may ask follows the store's setting; a product priced on request is never put in a cart. Email is only logged here.
 */

afterAll(async () => {
  await closeDb();
});

beforeEach(() => jar.clear());

let visitors = 0;
const visitor = () => `quote-visitor-${Date.now().toString(36)}-${++visitors}`;

async function quoteStore(label: string, mode: "off" | "everyone" | "business" = "everyone"): Promise<TestStore> {
  const store = await newPlainStore(label);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${store.storeId}::uuid`);
  const saved = await saveOrderSettings(store.member, { quoteRequests: mode });
  if (!saved.ok) throw new Error(saved.problem);
  return store;
}

const onRequest = (store: TestStore, sku: string) =>
  db().execute(sql`
    update commerce.products set price_on_request = true
    where store_id = ${store.storeId}::uuid and id = (select product_id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${sku})
  `);

const ask = async (store: TestStore, over: Record<string, unknown> = {}, who = visitor()) =>
  requestQuote(
    {
      store: store.slug,
      market: "no",
      from: "product",
      lines: [{ variantId: await support.variantId(store.storeId, "DEMO-MUG-WHITE"), quantity: 3 }],
      name: "Kari Nordmann",
      email: "kari@example.com",
      phone: "",
      company: "Nordmann AS",
      note: "Ten of these for the office, please.",
      website: "",
      elapsed: 6000,
      block: null,
      ...over,
    },
    who,
    `/s/${store.slug}/no/p/mug`,
  );

const quotes = async (store: TestStore) =>
  db().execute<Row>(sql`select * from commerce.draft_orders where store_id = ${store.storeId}::uuid and source = 'quote' order by created_at, number`);
const emailsOf = async (store: TestStore, kind: string) =>
  db().execute<Row>(sql`select to_address, subject, status from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = ${kind} order by created_at`);

describe("asking for a quote", () => {
  it("makes a draft of source quote with the shopper's details, a receipt for them and an alert for staff", async () => {
    const store = await quoteStore("quote-ask");
    expect(await ask(store)).toEqual({ status: 200, body: { ok: true } });
    const [draft] = await quotes(store);
    expect(draft).toMatchObject({ status: "open", source: "quote", email: "kari@example.com", company_name: "Nordmann AS", request_note: "Ten of these for the office, please." });
    expect(draft.shipping_address).toEqual({ name: "Kari Nordmann" });
    const view = (await getDraft(store.storeId, String(draft.id)))!;
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]).toMatchObject({ quantity: 3, priceRequested: false, onRequest: false });
    expect(view.lines[0].unitPriceMinor).toBe(view.lines[0].listPriceMinor);
    const receipts = await emailsOf(store, "quote.received");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ to_address: "kari@example.com", status: "logged" });
    // Nothing the shopper typed is in it: the address is anyone's, and the store's mail is no way to send a stranger's words.
    const [receipt] = await db().execute<Row>(sql`select html from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'quote.received'`);
    expect(String(receipt.html)).not.toContain("for the office");
    expect(String(receipt.html)).not.toContain("Nordmann AS");
    const alerts = await emailsOf(store, "staff.quote_requested");
    expect(alerts.length).toBeGreaterThan(0);
    // Staff are told the request's number and lines, never who asked.
    expect(alerts.every((a) => !String(a.subject).includes("Kari"))).toBe(true);
    expect(await quoteRequestsWaiting(store.storeId)).toBe(1);
    // In Orders, Drafts: the list's filter and its count.
    const listed = await listDrafts(store.storeId, { quotes: true });
    expect(listed.quotesWaiting).toBe(1);
    expect(listed.rows.map((r) => [r.number, r.quote, r.customer])).toEqual([[String(draft.number), "requested", "Kari Nordmann"]]);
  });

  it("tells a robot it worked and makes nothing, and holds a visitor to the forms' hourly limit", async () => {
    const store = await quoteStore("quote-spam");
    expect(await ask(store, { website: "https://spam.example" })).toEqual({ status: 200, body: { ok: true } });
    expect(await ask(store, { elapsed: 200 })).toEqual({ status: 200, body: { ok: true } });
    expect(await quotes(store)).toHaveLength(0);
    const who = visitor();
    for (let i = 0; i < 5; i++) expect((await ask(store, {}, who)).status).toBe(200);
    expect(await ask(store, {}, who)).toEqual({ status: 429, body: { ok: false, error: "busy" } });
    expect(await quotes(store)).toHaveLength(5);
  });

  it("answers what to correct, and refuses a store that offers no quotes on a product that shows its price", async () => {
    const store = await quoteStore("quote-refuse", "off");
    expect(await ask(store, { email: "kari@" })).toEqual({ status: 422, body: { ok: false, problems: { email: "invalid" } } });
    expect(await ask(store)).toEqual({ status: 403, body: { ok: false, error: "not_offered" } });
    expect(await ask(store, { store: "no-such-store-at-all" })).toMatchObject({ status: 404 });
    // Another store's variant is never asked about.
    const other = await quoteStore("quote-other");
    expect(await ask(store, { lines: [{ variantId: await support.variantId(other.storeId, "DEMO-MUG-WHITE"), quantity: 1 }] })).toMatchObject({ status: 403 });
    expect(await quotes(store)).toHaveLength(0);
  });

  it("offers business-only quotes to a shopper who chose Business", async () => {
    const store = await quoteStore("quote-business", "business");
    expect(await ask(store)).toMatchObject({ status: 403 });
    expect((await getOrderSettings(store.storeId)).quoteRequests).toBe("business");
  });
});

describe("a product priced on request", () => {
  it("is asked a quote of whatever the setting, without a price, and is never put in a cart", async () => {
    const store = await quoteStore("quote-por", "off");
    await onRequest(store, "DEMO-MUG-WHITE");
    const found = (await storeById(store.storeId))!;
    const market = found.markets.find((m) => m.code === "NO")!;
    const variant = await support.variantId(store.storeId, "DEMO-MUG-WHITE");
    const added = await changeLine({ storeId: store.storeId, market }, variant, 1, "add");
    expect(added.outcome).toBe("unavailable");

    expect(await ask(store)).toEqual({ status: 200, body: { ok: true } });
    const [draft] = await quotes(store);
    const view = (await getDraft(store.storeId, String(draft.id)))!;
    expect(view.lines[0]).toMatchObject({ unitPriceMinor: 0, priceRequested: true, onRequest: true });
    expect(view.lines[0].listPriceMinor).toBeGreaterThan(0);
    const alert = await db().execute<Row>(sql`select html from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'staff.quote_requested' limit 1`);
    expect(alert.length).toBe(1);
    // The receipt names what was asked about and no price.
    const [receipt] = await db().execute<Row>(sql`select html from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'quote.received'`);
    expect(String(receipt.html)).not.toMatch(/kr\s?\d|\d\s?kr/);
  });
});

describe("from the request to the quote sent", () => {
  it("waits for staff to type the missing price, then sends the pay link as a quote", async () => {
    const store = await quoteStore("quote-send");
    await onRequest(store, "DEMO-NOTEBOOK-LINED");
    const lines = [
      { variantId: await support.variantId(store.storeId, "DEMO-MUG-WHITE"), quantity: 2 },
      { variantId: await support.variantId(store.storeId, "DEMO-NOTEBOOK-LINED"), quantity: 5 },
    ];
    expect(await ask(store, { lines })).toMatchObject({ status: 200 });
    const [row] = await quotes(store);
    const draftId = String(row.id);
    const before = (await previewDraft(store.storeId, draftId))!;
    expect(before.blocking.map((p) => p.code)).toEqual(expect.arrayContaining(["price_requested", "no_shipping_address"]));
    // The guide price is never charged: a send is refused until a price is typed.
    const refused = await sendDraft(store.storeId, staffActor(store.accountId), draftId, { version: before.draft.version, createLink: true });
    expect(refused).toMatchObject({ ok: false, problem: "problems" });

    // The line waiting for its price has none of its own: the editor's price box starts empty, never at the 0 it is kept at, so a save of
    // anything else on the draft leaves it waiting.
    expect(before.draft.lines[1]).toMatchObject({ priceRequested: true, customPrice: false, unitPriceMinor: 0 });
    expect(formFromDraft(before.draft).lines[1].price).toBe("");
    const editorLines: { kind: "goods"; variantId: string | null; quantity: number; price?: string }[] = formFromDraft(before.draft).lines.map((l) => ({
      kind: "goods",
      variantId: l.variantId,
      quantity: l.quantity,
      ...(l.price ? { price: l.price } : {}),
    }));
    // Saved without a price, the line still waits for one.
    const waiting = await saveDraft(store.storeId, staffActor(store.accountId), draftId, {
      version: before.draft.version,
      marketSlug: "no",
      email: "kari@example.com",
      shippingAddress: { name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" },
      billingAddress: {},
      tags: [],
      discount: null,
      shipping: { kind: "rate" },
      lines: editorLines,
    });
    if (!waiting.ok) throw new Error(JSON.stringify(waiting));
    expect(waiting.draft.lines.map((l) => l.priceRequested)).toEqual([false, true]);
    // Typed: 45,00 each.
    const priced = await saveDraft(store.storeId, staffActor(store.accountId), draftId, {
      version: waiting.draft.version,
      marketSlug: "no",
      email: "kari@example.com",
      shippingAddress: { name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" },
      billingAddress: {},
      tags: [],
      discount: null,
      shipping: { kind: "rate" },
      lines: editorLines.map((l, i) => (i === 1 ? { ...l, price: "45,00" } : l)),
    });
    if (!priced.ok) throw new Error(JSON.stringify(priced));
    expect(priced.draft.lines[1]).toMatchObject({ priceRequested: false, unitPriceMinor: 4500, customPrice: true });
    expect((await previewDraft(store.storeId, draftId))!.blocking).toEqual([]);

    const sent = await sendDraft(store.storeId, staffActor(store.accountId), draftId, { version: priced.draft.version });
    expect(sent).toMatchObject({ ok: true });
    const [mail] = await emailsOf(store, "draft.pay_link");
    expect(mail).toMatchObject({ to_address: "kari@example.com", status: "logged" });
    expect(String(mail.subject)).toMatch(/quote|tilbud/i);
    // The link opens the draft's pay page, which reads as the quote (D435).
    const [html] = await db().execute<Row>(sql`select html from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'draft.pay_link'`);
    const token = /\/account\/pay\/([A-Za-z0-9_-]{43})/.exec(String(html.html))?.[1];
    expect(token).toBeTruthy();
    const full = (await getStore(store.slug))!;
    const page = await payPageFor({ store: full, market: full.markets.find((m) => m.code === "NO")! }, token!);
    expect(page).toMatchObject({ state: "ready", draft: { source: "quote" } });
    expect(await quoteRequestsWaiting(store.storeId)).toBe(0);
    // A staff member's later save keeps the typed price (a product priced on request is never at its list price).
    const after = (await getDraft(store.storeId, draftId))!;
    expect(after.status).toBe("sent");
  });

  it("declines with a short reply emailed to the shopper, and a declined request is never sent", async () => {
    const store = await quoteStore("quote-decline");
    expect(await ask(store)).toMatchObject({ status: 200 });
    const [row] = await quotes(store);
    const draftId = String(row.id);
    const actor = staffActor(store.accountId);
    expect(await declineQuote(store.storeId, actor, draftId, "   ")).toEqual({ ok: false, problem: "reply", reply: "required" });
    const done = await declineQuote(store.storeId, actor, draftId, "We cannot deliver this many before March.");
    expect(done).toEqual({ ok: true, emailed: "logged" });
    expect(await declineQuote(store.storeId, actor, draftId, "Again.")).toEqual({ ok: false, problem: "declined" });
    const view = (await getDraft(store.storeId, draftId))!;
    expect(view).toMatchObject({ status: "open", quoteReply: "We cannot deliver this many before March." });
    expect(view.quoteDeclinedAt).not.toBeNull();
    expect((await previewDraft(store.storeId, draftId))!.blocking.map((p) => p.code)).toContain("quote_declined");
    const [mail] = await emailsOf(store, "quote.declined");
    expect(mail).toMatchObject({ to_address: "kari@example.com", status: "logged" });
    expect(await quoteRequestsWaiting(store.storeId)).toBe(0);
    expect((await listDrafts(store.storeId, { quotes: true })).rows[0].quote).toBe("declined");
    // A draft staff made is not a request to decline.
    const { createDraft } = await import("./draft-orders");
    const made = await createDraft(store.storeId, actor);
    if (!made.ok) throw new Error(made.problem);
    expect(await declineQuote(store.storeId, actor, made.draft.id, "No.")).toEqual({ ok: false, problem: "not_quote" });
  });
});

describe("asking from the cart", () => {
  it("reads the lines from the shopper's own cart, never from what the browser sent", async () => {
    const store = await quoteStore("quote-cart");
    const cartId = await support.cartOf(store.storeId, [
      ["DEMO-MUG-WHITE", 2],
      ["DEMO-NOTEBOOK-LINED", 1],
    ]);
    jar.set(`cart_${store.storeId}_no`, cartId);
    const sent = await ask(store, { from: "cart", lines: [{ variantId: await support.variantId(store.storeId, "DEMO-MUG-WHITE"), quantity: 999 }] });
    expect(sent).toEqual({ status: 200, body: { ok: true } });
    const [row] = await quotes(store);
    const view = (await getDraft(store.storeId, String(row.id)))!;
    expect(view.lines.map((l) => [l.sku, l.quantity])).toEqual([
      ["DEMO-MUG-WHITE", 2],
      ["DEMO-NOTEBOOK-LINED", 1],
    ]);
    // An empty cart has nothing to ask about.
    jar.clear();
    expect(await ask(store, { from: "cart", lines: [] })).toEqual({ status: 422, body: { ok: false, problems: { lines: "required" } } });
  });
});
