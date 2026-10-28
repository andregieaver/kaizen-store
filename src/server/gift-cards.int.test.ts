import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { formatMoney } from "@/lib/money";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { changeLine, getCart, readCartId } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { placeOrder } = await import("./checkout");
const { getOrder } = await import("./orders");
const { no, pay, variantId } = await import("./inventory-test-support");
const { newPlainStore } = await import("./order-ops-fixture");
const { sendOrderConfirmation } = await import("./shopper-emails");
const { deliverGiftCards } = await import("./gift-card-delivery");
const { hashGiftCode } = await import("./gift-card-codes");

type Row = Record<string, unknown>;

/**
 * Selling gift cards against a real database (D300 F2, `docs/wave-5-marketing.md` 8.2): a card in the cart for the buyer or for someone on a
 * day, no VAT and no tick for downloads, one card per unit issued when the order is paid, its code made and emailed (the log keeps none), the
 * buyer told when it went to someone else, and nothing issued twice.
 */

afterAll(async () => {
  await closeDb();
});

beforeEach(() => jar.clear());

async function giftCardStore(label: string) {
  const store = await newPlainStore(label);
  await db().execute(sql`update commerce.stores set features = array['shop', 'gift_cards'] where id = ${store.storeId}::uuid`);
  // A new store's demo gift card waits as a draft, as every digital product does: the owner publishes it.
  await db().execute(sql`update commerce.products set status = 'active' where store_id = ${store.storeId}::uuid and handle = 'demo-gavekort'`);
  return store;
}

const cardsOf = (orderId: string) =>
  db().execute<Row>(sql`
    select id, initial_minor, currency, recipient_email, recipient_name, message, send_at, sent_at, code_hash, last4, commerce.gift_card_balance(id) as balance
    from commerce.gift_cards where order_id = ${orderId}::uuid order by recipient_email nulls first, unit_index
  `);

const emailsOf = (orderId: string | null, kind: string, to?: string) =>
  db().execute<Row>(sql`
    select to_address, subject, html, text from commerce.email_messages
    where kind = ${kind} and (${to ?? null}::text is null or to_address = ${to ?? null})
      and (${orderId}::uuid is null or idempotency_key like 'gift-card%')
    order by created_at
  `);

describe("selling gift cards", () => {
  it("are kept on the cart with who they are for, carry no VAT and no tick for downloads, and reach the order as they were", async () => {
    const store = await giftCardStore("gc-sell");
    const shop = { storeId: store.storeId, market: no };
    const small = await variantId(store.storeId, "DEMO-GAVEKORT-500");
    const large = await variantId(store.storeId, "DEMO-GAVEKORT-1000");
    expect(await changeLine(shop, small, 1, "add")).toMatchObject({ outcome: "added" });
    const lena = { to: "lena@example.com", toName: "Lena", from: "Anna", message: "Gratulerer!", sendOn: "2099-01-01" };
    expect(await changeLine(shop, large, 1, "add", null, undefined, null, { recipient: lena })).toMatchObject({ outcome: "added" });
    // The same card for the same person is one line of two; the buyer's own stays its own.
    expect(await changeLine(shop, large, 1, "add", null, undefined, null, { recipient: lena })).toMatchObject({ outcome: "added", quantity: 2 });
    // A product that is not a gift card names nobody.
    expect(await changeLine(shop, await variantId(store.storeId, "DEMO-MUG-WHITE"), 1, "add", null, undefined, null, { recipient: lena })).toMatchObject({ outcome: "unavailable" });

    const cart = await getCart(shop);
    // By SKU: the 1 000 card, then the 500.
    expect(cart.lines.map((l) => [l.quantity, l.giftCard?.recipient?.to ?? null])).toEqual([
      [2, "lena@example.com"],
      [1, null],
    ]);
    const summary = await cartSummary(shop, cart);
    expect(summary.digital).toBe(false);
    expect(summary.vat).toBe(0);
    expect(summary.total).toBe(50_000 + 2 * 100_000);

    // The cart's forms change Lena's line by its key alone.
    const key = cart.lines.find((l) => l.giftCard?.recipient)!.giftCard!.key!;
    await changeLine(shop, large, 1, "set", null, undefined, null, { key });
    expect((await getCart(shop)).lines.map((l) => l.quantity)).toEqual([1, 1]);

    const placed = await placeOrder(shop, (await readCartId(shop))!, {});
    if (!placed.ok) throw new Error(placed.problem);
    const order = (await getOrder(store.storeId, placed.order.orderId))!;
    expect(order.taxMinor).toBe(0);
    expect(order.lines.map((l) => [l.title, l.giftCard?.recipient?.to ?? null]).sort()).toEqual([
      [`Demo: Gavekort (${formatMoney(100_000, "NOK", "nb-NO")})`, "lena@example.com"],
      [`Demo: Gavekort (${formatMoney(50_000, "NOK", "nb-NO")})`, null],
    ]);
    // No card before the order is paid.
    expect(await cardsOf(placed.order.orderId)).toHaveLength(0);
  });

  it("are issued once at payment, emailed with a code the log never keeps, and the one for someone else on its day, the buyer told", async () => {
    const store = await giftCardStore("gc-issue");
    const shop = { storeId: store.storeId, market: no };
    await changeLine(shop, await variantId(store.storeId, "DEMO-GAVEKORT-500"), 1, "add");
    const lena = { to: "lena@example.com", toName: "Lena", from: "Anna", message: "Gratulerer!", sendOn: "2099-01-01" };
    await changeLine(shop, await variantId(store.storeId, "DEMO-GAVEKORT-1000"), 1, "add", null, undefined, null, { recipient: lena });
    const placed = await placeOrder(shop, (await readCartId(shop))!, {});
    if (!placed.ok) throw new Error(placed.problem);
    await pay(store.storeId, placed.order, store.account);

    const issued = await cardsOf(placed.order.orderId);
    expect(issued.map((c) => [Number(c.initial_minor), String(c.currency).trim(), c.recipient_email, c.code_hash])).toEqual([
      [50_000, "NOK", null, null],
      [100_000, "NOK", "lena@example.com", null],
    ]);
    expect(issued.map((c) => Number(c.balance))).toEqual([50_000, 100_000]);

    // The confirmation delivers the buyer's card at once; Lena's waits for its day.
    await sendOrderConfirmation(store.storeId, placed.order.orderId);
    const [own, hers] = await cardsOf(placed.order.orderId);
    expect(own.code_hash).not.toBeNull();
    expect(own.sent_at).not.toBeNull();
    expect(hers.code_hash).toBeNull();
    const [mail] = await emailsOf(placed.order.orderId, "gift_card.issued", "kari@example.com");
    expect(String(mail.html)).toContain("[code]");
    expect(String(mail.text)).toContain("[code]");
    // What the log keeps is never a code that finds the card.
    const kept = String(mail.text).match(/[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}/g) ?? [];
    for (const candidate of kept) expect(hashGiftCode(candidate)).not.toBe(own.code_hash);

    // Lena's day comes: hers goes to her with the words, the buyer hears it went (without the code).
    await db().execute(sql`update commerce.gift_cards set send_at = now() - interval '1 minute' where id = ${String(hers.id)}::uuid`);
    expect(await deliverGiftCards({ orderId: placed.order.orderId })).toEqual({ sent: 1, failed: 0 });
    const [toLena] = await emailsOf(placed.order.orderId, "gift_card.issued", "lena@example.com");
    expect(String(toLena.text)).toContain("Gratulerer!");
    expect(String(toLena.text)).toContain("Fra Anna:");
    const [copy] = await emailsOf(placed.order.orderId, "gift_card.on_its_way", "kari@example.com");
    expect(String(copy.text)).toContain("lena@example.com");
    expect(String(copy.text)).not.toContain("[code]");

    // Nothing is issued or sent twice.
    await db().execute(sql`update commerce.payments set status = 'captured' where order_id = ${placed.order.orderId}::uuid`);
    expect(await cardsOf(placed.order.orderId)).toHaveLength(2);
    expect(await deliverGiftCards({ orderId: placed.order.orderId })).toEqual({ sent: 0, failed: 0 });
  });

  it("are not offered while gift cards are off", async () => {
    const store = await giftCardStore("gc-off");
    await db().execute(sql`update commerce.stores set features = array['shop'] where id = ${store.storeId}::uuid`);
    const shop = { storeId: store.storeId, market: no };
    expect(await changeLine(shop, await variantId(store.storeId, "DEMO-GAVEKORT-500"), 1, "add")).toMatchObject({ outcome: "unavailable" });
  });
});

const { addCartGiftCard, cartGiftCards, GIFT_CARD_TRIES_PER_CART_PER_HOUR } = await import("./gift-card-cart");
const { startCheckout, cancelUnpaidOrder } = await import("./checkout");
const { getShopperOrder } = await import("./orders");
const { refundOrder } = await import("./order-admin");
const { newGiftCode } = await import("./gift-card-codes");
const { storePaymentMode } = await import("./host-payments");

describe("spending gift cards (D300 F3)", () => {
  /** A card of the store, issued by its owner and delivered, in the store's mode: its code. */
  async function cardOf(store: { storeId: string; accountId: string }, amountMinor: number, currency = "NOK"): Promise<{ code: string; id: string }> {
    const test = (await storePaymentMode(store.storeId)) === "test";
    const [card] = await db().execute<Row>(sql`
      select commerce.gift_card_issue(${store.storeId}::uuid, 'staff', ${currency}, ${amountMinor}, null, null, null, ${store.accountId}::uuid, ${test}, null, null, null, null, null, 'Test') as id
    `);
    const code = newGiftCode()!;
    await db().execute(sql`select commerce.gift_card_set_code(${store.storeId}::uuid, ${String(card.id)}::uuid, ${code.hash}, ${code.last4})`);
    await db().execute(sql`select commerce.gift_card_mark_sent(${store.storeId}::uuid, ${String(card.id)}::uuid)`);
    return { code: code.code, id: String(card.id) };
  }
  const balanceOf = async (id: string) => Number((await db().execute<Row>(sql`select commerce.gift_card_balance(${id}::uuid) as b`))[0].b);
  const payer = { name: "Kari Nordmann", email: "kari@example.com", phone: "", line1: "Storgata 1", line2: "", postalCode: "0155", city: "Oslo" };

  it("are put on a cart by their code: never a wrong one, another store's or another currency's, three at most, tries counted", async () => {
    const store = await giftCardStore("gc-spend-cart");
    const elsewhere = await giftCardStore("gc-spend-other");
    const shop = { storeId: store.storeId, market: no };
    await changeLine(shop, await variantId(store.storeId, "DEMO-MUG-WHITE"), 1, "add");
    const cartId = (await readCartId(shop))!;
    // A code that is no card, and another store's card, say the same: it can't be used.
    expect(await addCartGiftCard(shop, "AAAA-BBBB-CCCC-DDDD", { clientKey: null })).toEqual({ ok: false, problem: "unusable" });
    expect(await addCartGiftCard(shop, (await cardOf(elsewhere, 10_000)).code, { clientKey: null })).toEqual({ ok: false, problem: "unusable" });
    // A card in another currency says which, so the shopper can change the view.
    expect(await addCartGiftCard(shop, (await cardOf(store, 1_000, "EUR")).code, { clientKey: null })).toEqual({ ok: false, problem: "currency", currency: "EUR" });
    const cards = [await cardOf(store, 1_000), await cardOf(store, 2_000), await cardOf(store, 3_000), await cardOf(store, 4_000)];
    for (const card of cards.slice(0, 3)) expect(await addCartGiftCard(shop, card.code, { clientKey: null })).toMatchObject({ ok: true });
    expect(await addCartGiftCard(shop, cards[3].code, { clientKey: null })).toEqual({ ok: false, problem: "full" });
    expect((await cartGiftCards(db(), store.storeId, cartId, { currency: "NOK" })).map((c) => c.id)).toEqual(cards.slice(0, 3).map((c) => c.id));
    // The cart's tries are counted, right or wrong.
    await db().execute(sql`update commerce.chat_usage set count = ${GIFT_CARD_TRIES_PER_CART_PER_HOUR} where store_id = ${store.storeId}::uuid and bucket = ${`giftcard:k:${cartId}`}`);
    expect(await addCartGiftCard(shop, cards[3].code, { clientKey: null })).toEqual({ ok: false, problem: "limit" });
  });

  it("pay an order in full with no provider: who pays kept, the order paid, the card spent, and a refund back on it", async () => {
    const store = await giftCardStore("gc-spend-all");
    const shop = { storeId: store.storeId, market: no };
    await changeLine(shop, await variantId(store.storeId, "DEMO-MUG-WHITE"), 1, "add");
    const cartId = (await readCartId(shop))!;
    const card = await cardOf(store, 100_000_00);
    await addCartGiftCard(shop, card.code, { clientKey: null });
    const summary = await cartSummary(shop, await getCart(shop));
    expect(summary.giftCards).toMatchObject({ paidMinor: summary.total, coverAll: true });
    expect(summary.dueNowMinor).toBe(0);

    const checkoutShop = { ...shop, storeSlug: store.slug };
    // No one given for the order: nothing is placed, and the card holds what it held.
    expect(await startCheckout(checkoutShop, cartId, "https://shop.example", "Frakt", {})).toMatchObject({ ok: false, problem: "payments_off" });
    expect(await balanceOf(card.id)).toBe(100_000_00);
    const started = await startCheckout(checkoutShop, cartId, "https://shop.example", "Frakt", {}, { payer });
    if (!started.ok) throw new Error(started.problem);
    const key = new URL(started.url).searchParams.get("session_id")!;
    expect(key).toMatch(/^gc_/);
    const orderId = new URL(started.url).pathname.split("/").at(-1)!;
    const order = (await getShopperOrder(store.storeId, orderId, key))!;
    expect(order.status).toBe("paid");
    expect(order.email).toBe("kari@example.com");
    expect(await balanceOf(card.id)).toBe(100_000_00 - order.totalMinor);

    // Refunded: the card's part goes back on it, recorded, with no provider asked.
    const refunded = await refundOrder(store.storeId, orderId, { amountMinor: 5_000, reason: "Test", restock: [] }, store.accountId);
    expect(refunded).toMatchObject({ ok: true, status: "succeeded" });
    expect(await balanceOf(card.id)).toBe(100_000_00 - order.totalMinor + 5_000);
  });

  it("give back their hold when the checkout is left unpaid", async () => {
    const store = await giftCardStore("gc-spend-cancel");
    const shop = { storeId: store.storeId, market: no };
    await changeLine(shop, await variantId(store.storeId, "DEMO-MUG-WHITE"), 2, "add");
    const card = await cardOf(store, 5_000);
    await addCartGiftCard(shop, card.code, { clientKey: null });
    const placed = await placeOrder(shop, (await readCartId(shop))!, {});
    if (!placed.ok) throw new Error(placed.problem);
    expect(placed.order.giftCardsMinor).toBe(5_000);
    expect(placed.order.dueNowMinor).toBe(placed.order.totalMinor - 5_000);
    expect(await balanceOf(card.id)).toBe(0);
    await cancelUnpaidOrder(placed.order.orderId, "test");
    expect(await balanceOf(card.id)).toBe(5_000);
  });
});

const { getStore } = await import("./stores");
const { periodTotals } = await import("./analytics-totals");
const { findGiftCard } = await import("./gift-card-cart");
const admin = await import("./gift-cards-admin");
const { customPeriod } = await import("@/lib/analytics-period");

describe("the owner's screens and figures (D300 F4)", () => {
  const storeOf = async (fx: { slug: string }) => (await getStore(fx.slug))!;
  const today = async (storeId: string) =>
    String((await db().execute<Row>(sql`select to_char(commerce.store_day(${storeId}::uuid, now()), 'YYYY-MM-DD') as d`))[0].d);
  const balanceOf = async (id: string) => Number((await db().execute<Row>(sql`select commerce.gift_card_balance(${id}::uuid) as b`))[0].b);

  it("send a delivered card a new code: the old one stops, the balance stays, the code goes to the card's own address and never into the log (D381)", async () => {
    const fx = await giftCardStore("gc-admin-new-code");
    const store = await storeOf(fx);
    const test = (await storePaymentMode(store.id)) === "test";
    const issued = await admin.issueGiftCard(store, fx.accountId, {
      amountMinor: 20_000, currency: "NOK", recipientEmail: "kari-ny@example.com", recipientName: "Kari", message: null, lang: "nb", note: "",
    });
    if (!issued.ok) throw new Error(issued.problem);
    const renewed = await admin.sendNewGiftCardCode(store.id, fx.accountId, issued.cardId);
    if (!renewed.ok) throw new Error(renewed.problem);
    expect(renewed.emailed).toBe("sent");
    expect(renewed.code).not.toBe(issued.code);
    expect(await findGiftCard(db(), store.id, issued.code, { currency: "NOK", testMode: test })).toEqual({ ok: false, problem: "unusable" });
    expect(await findGiftCard(db(), store.id, renewed.code, { currency: "NOK", testMode: test })).toEqual({ ok: true, id: issued.cardId });
    expect(await balanceOf(issued.cardId)).toBe(20_000);
    const mails = await emailsOf(null, "gift_card.issued", "kari-ny@example.com");
    expect(mails).toHaveLength(2);
    expect(String(mails[1].text)).toContain("[code]");
    const [entry] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.id}::uuid and action = 'gift_card.new_code'`);
    expect(JSON.stringify(entry.details)).not.toContain(renewed.code.replace(/-/g, "").slice(0, 8));
    // A card with no address shows its new code to staff only; another store's card is not found.
    const kept = await admin.issueGiftCard(store, fx.accountId, { amountMinor: 5_000, currency: "NOK", recipientEmail: null, recipientName: null, message: null, lang: "nb", note: "" });
    if (!kept.ok) throw new Error(kept.problem);
    expect(await admin.sendNewGiftCardCode(store.id, fx.accountId, kept.cardId)).toMatchObject({ ok: true, emailed: "not_asked" });
    const elsewhere = await giftCardStore("gc-admin-new-code-other");
    expect(await admin.sendNewGiftCardCode(elsewhere.storeId, fx.accountId, kept.cardId)).toEqual({ ok: false, problem: "unknown" });
  });

  it("issue a card by hand that can be spent at once, its code shown once and never kept, then change and deactivate it with reasons", async () => {
    const fx = await giftCardStore("gc-admin-issue");
    const store = await storeOf(fx);
    // Only a currency the store sells in.
    expect(await admin.issueGiftCard(store, fx.accountId, { amountMinor: 10_000, currency: "JPY", recipientEmail: null, recipientName: null, message: null, lang: "nb", note: "" })).toEqual({ ok: false, problem: "currency" });
    const issued = await admin.issueGiftCard(store, fx.accountId, {
      amountMinor: 25_000,
      currency: "NOK",
      recipientEmail: "ola@example.com",
      recipientName: "Ola",
      message: "Takk for hjelpen",
      lang: "nb",
      note: "Make-good",
    });
    if (!issued.ok) throw new Error(issued.problem);
    expect(issued.emailed).toBe("sent");
    const test = (await storePaymentMode(store.id)) === "test";
    const found = await findGiftCard(db(), store.id, issued.code, { currency: "NOK", testMode: test });
    expect(found).toEqual({ ok: true, id: issued.cardId });
    // Its email has the code in place of nothing the log can spend; the audit keeps ids and amounts only.
    const [mail] = await emailsOf(null, "gift_card.issued", "ola@example.com");
    expect(String(mail.text)).toContain("[code]");
    expect(String(mail.text)).toContain("Takk for hjelpen");
    const [entry] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.id}::uuid and action = 'gift_card.issued'`);
    expect(JSON.stringify(entry.details)).not.toContain(issued.code.replace(/-/g, "").slice(0, 8));

    const detail = (await admin.giftCardDetail(store.id, issued.cardId, { people: true }))!;
    expect(detail).toMatchObject({ state: "active", balanceMinor: 25_000, source: "staff", recipientEmail: "ola@example.com", issuedBy: expect.any(String) });
    expect((await admin.giftCardDetail(store.id, issued.cardId))!.recipientEmail).toBeNull();

    // Changed with a reason, never below zero.
    expect(await admin.adjustGiftCard(store.id, fx.accountId, issued.cardId, 5_000, " ")).toEqual({ ok: false, problem: "reason" });
    expect(await admin.adjustGiftCard(store.id, fx.accountId, issued.cardId, 5_000, "Goodwill")).toEqual({ ok: true });
    expect(await admin.adjustGiftCard(store.id, fx.accountId, issued.cardId, -40_000, "Too much")).toEqual({ ok: false, problem: "below_zero" });
    expect(await balanceOf(issued.cardId)).toBe(30_000);

    // The list finds it by its last four, and by the person only for staff who may read customers.
    const last4 = issued.code.slice(-4);
    expect((await admin.listGiftCards(store.id, { query: last4 })).rows.map((r) => r.id)).toEqual([issued.cardId]);
    expect((await admin.listGiftCards(store.id, { query: "ola@example" })).rows).toEqual([]);
    expect((await admin.listGiftCards(store.id, { query: "ola@example", people: true })).rows.map((r) => r.id)).toEqual([issued.cardId]);

    // Deactivated: what was left goes, and it is changed and spent no more.
    expect(await admin.deactivateGiftCard(store.id, fx.accountId, issued.cardId, "Lost")).toEqual({ ok: true });
    expect(await balanceOf(issued.cardId)).toBe(0);
    expect(await admin.adjustGiftCard(store.id, fx.accountId, issued.cardId, 1_000, "Again")).toEqual({ ok: false, problem: "inactive" });
    expect((await findGiftCard(db(), store.id, issued.code, { currency: "NOK", testMode: test })).ok).toBe(false);
    expect((await admin.giftCardDetail(store.id, issued.cardId))!.entries.map((e) => e.kind)).toEqual(["issue", "adjust", "void"]);
  });

  it("expire what is left on a card past its date, once, and keep the store's expiry for new cards", async () => {
    const fx = await giftCardStore("gc-admin-expire");
    expect(await admin.saveGiftCardSettings(fx.storeId, fx.accountId, 6)).toBe(false);
    expect(await admin.saveGiftCardSettings(fx.storeId, fx.accountId, 24)).toBe(true);
    expect(await admin.giftCardSettings(fx.storeId)).toEqual({ expiryMonths: 24 });
    // A card whose date has passed (written as the ledger writes one, with its date in the past).
    const [card] = await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('kaizen.gift_card_ledger', 'on', true)`);
      const rows = await tx.execute<Row>(sql`
        insert into commerce.gift_cards (store_id, currency, initial_minor, source, issued_by, issued_at, expires_at)
        values (${fx.storeId}::uuid, 'NOK', 7000, 'staff', ${fx.accountId}::uuid, now() - interval '3 years', now() - interval '1 day') returning id
      `);
      await tx.execute(sql`select commerce.gift_card_entry(${fx.storeId}::uuid, ${String(rows[0].id)}::uuid, 'issue', 7000, null, ${fx.accountId}::uuid, '', 'issue')`);
      return rows;
    });
    const id = String(card.id);
    expect(await admin.expireGiftCards()).toBeGreaterThanOrEqual(1);
    expect(await balanceOf(id)).toBe(0);
    expect(await admin.expireGiftCards()).toBe(0);
    const [entries] = await db().execute<Row>(sql`select count(*)::int as n from commerce.gift_card_entries where card_id = ${id}::uuid and kind = 'expire'`);
    expect(Number(entries.n)).toBe(1);
  });

  it("leave gift cards sold out of Finance's sales and count what they buy, and report what customers hold per currency", async () => {
    const fx = await giftCardStore("gc-admin-finance");
    const store = await storeOf(fx);
    const issued = await admin.issueGiftCard(store, fx.accountId, { amountMinor: 30_000, currency: "NOK", recipientEmail: null, recipientName: null, message: null, lang: "nb", note: "" });
    if (!issued.ok) throw new Error(issued.problem);
    const shop = { storeId: fx.storeId, market: no };
    await changeLine(shop, await variantId(fx.storeId, "DEMO-MUG-WHITE"), 1, "add");
    await changeLine(shop, await variantId(fx.storeId, "DEMO-GAVEKORT-500"), 1, "add");
    await addCartGiftCard(shop, issued.code, { clientKey: null });
    const placed = await placeOrder(shop, (await readCartId(shop))!, {});
    if (!placed.ok) throw new Error(placed.problem);
    const paidByCard = placed.order.giftCardsMinor ?? 0;
    const rest = placed.order.totalMinor - paidByCard;
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${fx.storeId}::uuid, ${placed.order.orderId}::uuid, 'stripe', ${`cs_${placed.order.orderId}`}, ${fx.account}, ${rest}, 'NOK', 'captured')
    `);
    const { completeOrderPayment } = await import("./checkout");
    await completeOrderPayment(placed.order.orderId, `cs_${placed.order.orderId}`);

    const [o] = await db().execute<Row>(sql`select total_minor, tax_minor from commerce.orders where id = ${placed.order.orderId}::uuid`);
    const day = await today(fx.storeId);
    const { totals } = await periodTotals(store, customPeriod(day, day));
    // The gift card bought (500 kr, no VAT) is not a sale; the mug paid partly with a card is.
    expect(totals.orders).toBe(1);
    expect(totals.revenueMinor).toBe(Number(o.total_minor) - Number(o.tax_minor) - 50_000);

    const { lines } = await admin.giftCardLiability(store, customPeriod(day, day));
    expect(lines).toHaveLength(1);
    const nok = lines[0];
    expect(nok.currency).toBe("NOK");
    expect(nok.issuedMinor).toBe(30_000 + 50_000);
    expect(nok.spentMinor).toBe(paidByCard);
    // The new card is not delivered until its email goes, so what is held now is the issued card's rest.
    expect(nok.outstandingMinor).toBe(30_000 - paidByCard);
    const overview = await admin.giftCardOverview(fx.storeId);
    expect(overview.outstanding).toEqual([{ currency: "NOK", amountMinor: 30_000 - paidByCard, cards: 30_000 > paidByCard ? 1 : 0 }]);
  });
});
