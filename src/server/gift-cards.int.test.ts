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
