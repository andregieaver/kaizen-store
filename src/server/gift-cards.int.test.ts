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
