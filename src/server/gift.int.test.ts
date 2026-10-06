import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { GIFT_MESSAGE_LINES, GIFT_MESSAGE_MAX } from "@/lib/order-limits";

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

const { getCart, getCartGift, setCartGift } = await import("./cart");
const { placeOrder } = await import("./checkout");
const { getOrder } = await import("./orders");
const { cartOf, no, pay } = await import("./inventory-test-support");
const { newPlainStore, seedOrder } = await import("./order-ops-fixture");
const { saveOrderSettings, getOrderSettings } = await import("./order-settings");
const { sendOrderConfirmation } = await import("./shopper-emails");
const { exportCustomerData } = await import("./privacy-export");
const { eraseSubject } = await import("./privacy-erasure");

type Row = Record<string, unknown>;

/**
 * Gift messages against a real database (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1, 4.8, G1 to G6): off until the owner turns them on; the buyer's words cleaned and never cut; kept
 * on the cart and copied to the order; frozen there; shown to the buyer and staff only, as text; carried through the export and blanked by the erasure; no money moves.
 */

afterAll(async () => {
  await closeDb();
});

beforeEach(() => jar.clear());

const payOrder = (store: { storeId: string; account: string }, order: Parameters<typeof pay>[1]) => pay(store.storeId, order, store.account);
const shopOf = (storeId: string) => ({ storeId, market: no });

/** A store (invoicing off) with a cart of one mug that the cart cookie names, and the store's gift switch as asked. */
async function giftStore(label: string, on: boolean) {
  const store = await newPlainStore(label);
  await db().execute(sql`
    insert into commerce.order_settings (store_id, gift_messages) values (${store.storeId}::uuid, ${on}) on conflict (store_id) do update set gift_messages = excluded.gift_messages
  `);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 100 where store_id = ${store.storeId}::uuid`);
  const cartId = await cartOf(store.storeId, [["DEMO-MUG-WHITE", 1]]);
  jar.set(`cart_${store.storeId}_no`, cartId);
  return { store, cartId };
}

const cartRow = async (cartId: string) => (await db().execute<Row>(sql`select is_gift, gift_to, gift_from, gift_message from commerce.carts where id = ${cartId}::uuid`))[0];

describe("the switch", () => {
  it("is off until the owner turns it on: nothing is stored, the cart has no gift, and a gift already on a cart is not copied to the order", async () => {
    const { store, cartId } = await giftStore("gift-off", false);
    expect(await getCartGift(shopOf(store.storeId))).toEqual({ enabled: false, gift: { isGift: false, to: null, from: null, message: null } });
    const set = await setCartGift(shopOf(store.storeId), { isGift: true, to: "Lena", from: "Anna", message: "Hei" });
    expect(set).toMatchObject({ ok: true, gift: { isGift: false } });
    expect(await cartRow(cartId)).toMatchObject({ is_gift: false, gift_to: null, gift_message: null });
    // Even a gift written straight on the cart (a switch that was on and was turned off) is ignored at placing.
    await db().execute(sql`update commerce.carts set is_gift = true, gift_to = 'Lena', gift_message = 'Hei' where id = ${cartId}::uuid`);
    expect((await getCart(shopOf(store.storeId))).gift.isGift).toBe(false);
    const placed = await placeOrder(shopOf(store.storeId), cartId, {});
    if (!placed.ok) throw new Error(placed.problem);
    const order = (await getOrder(store.storeId, placed.order.orderId))!;
    expect(order.gift).toBeNull();
    const [row] = await db().execute<Row>(sql`select is_gift, gift_message from commerce.orders where id = ${placed.order.orderId}::uuid`);
    expect(row).toMatchObject({ is_gift: false, gift_message: null });
  });

  it("is turned on by the owner only through the settings, which an owner and a settings writer may change", async () => {
    const store = await newPlainStore("gift-settings");
    expect((await getOrderSettings(store.storeId)).giftMessages).toBe(false);
    const owner = { ...store.member, kind: "staff", permissions: [] } as Parameters<typeof saveOrderSettings>[0];
    const saved = await saveOrderSettings(owner, { giftMessages: true });
    expect(saved).toMatchObject({ ok: true, settings: { giftMessages: true } });
    expect((await getOrderSettings(store.storeId)).giftMessages).toBe(true);
    const [entry] = await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${store.storeId}::uuid order by id desc limit 1`);
    expect(String(entry.action)).toMatch(/settings/);
  });
});

describe("on the cart", () => {
  it("keeps To, From and the message cleaned, and unticking clears all three", async () => {
    const { store, cartId } = await giftStore("gift-cart", true);
    const shop = shopOf(store.storeId);
    expect(await getCartGift(shop)).toMatchObject({ enabled: true });
    // Control characters and the characters that disguise text go; new lines unify; markup stays what was typed.
    const typed = "Line one\r\nLine‮ two ​\u0007<b>bold</b>   \n\n\n\nLine three";
    const set = await setCartGift(shop, { isGift: true, to: "  Lena​ ", from: "Anna", message: typed });
    expect(set).toMatchObject({ ok: true });
    expect(await cartRow(cartId)).toEqual({ is_gift: true, gift_to: "Lena", gift_from: "Anna", gift_message: "Line one\nLine two <b>bold</b>\n\nLine three" });
    expect((await getCart(shop)).gift).toMatchObject({ isGift: true, to: "Lena", from: "Anna" });
    const cleared = await setCartGift(shop, { isGift: false, to: "ignored", from: "ignored", message: "ignored" });
    expect(cleared).toMatchObject({ ok: true, gift: { isGift: false, to: null, from: null, message: null } });
    expect(await cartRow(cartId)).toEqual({ is_gift: false, gift_to: null, gift_from: null, gift_message: null });
  });

  it("refuses text over the limit, with how much too long it is, and never cuts it", async () => {
    const { store, cartId } = await giftStore("gift-long", true);
    const shop = shopOf(store.storeId);
    await setCartGift(shop, { isGift: true, to: "Lena", from: "Anna", message: "Short" });
    const over = await setCartGift(shop, { isGift: true, to: "Lena", from: "Anna", message: "x".repeat(GIFT_MESSAGE_MAX + 7) });
    expect(over).toMatchObject({ ok: false, problem: "too_long", problems: [{ field: "message", problem: "too_long", over: 7 }] });
    const lines = await setCartGift(shop, { isGift: true, to: "Lena", from: "Anna", message: Array.from({ length: GIFT_MESSAGE_LINES + 1 }, (_, i) => `l${i}`).join("\n") });
    expect(lines).toMatchObject({ ok: false, problem: "too_long", problems: [{ field: "message", problem: "too_many_lines", over: 1 }] });
    const longName = await setCartGift(shop, { isGift: true, to: "n".repeat(61), from: "Anna", message: "Hi" });
    expect(longName).toMatchObject({ ok: false });
    // What the cart held before the refused tries is what it holds now.
    expect(await cartRow(cartId)).toMatchObject({ gift_message: "Short" });
    // Exactly the limit is accepted, counted in characters (an emoji is one).
    const exact = await setCartGift(shop, { isGift: true, to: "Lena", from: "Anna", message: "🎁".repeat(GIFT_MESSAGE_MAX) });
    expect(exact).toMatchObject({ ok: true });
  });

  it("another store's cart is never touched: the cookie names this store's cart only", async () => {
    const a = await giftStore("gift-iso-a", true);
    const b = await giftStore("gift-iso-b", true);
    jar.set(`cart_${a.store.storeId}_no`, a.cartId);
    await setCartGift(shopOf(a.store.storeId), { isGift: true, to: "A", from: "A", message: "for A" });
    expect(await cartRow(b.cartId)).toMatchObject({ is_gift: false, gift_message: null });
    // A cart cookie of store A offered to store B finds no cart there.
    jar.set(`cart_${b.store.storeId}_no`, a.cartId);
    expect((await getCart(shopOf(b.store.storeId))).gift.isGift).toBe(false);
  });
});

describe("on the order", () => {
  it("is copied from the cart as typed, frozen by the database, and moves no amount", async () => {
    const withGift = await giftStore("gift-order", true);
    const without = await giftStore("gift-order-plain", true);
    await setCartGift(shopOf(withGift.store.storeId), { isGift: true, to: "Lena", from: "Anna", message: "Grattis!\nHilsen Anna" });
    const a = await placeOrder(shopOf(withGift.store.storeId), withGift.cartId, {});
    const b = await placeOrder(shopOf(without.store.storeId), without.cartId, {});
    if (!a.ok || !b.ok) throw new Error("placing");
    const gifted = (await getOrder(withGift.store.storeId, a.order.orderId))!;
    const plain = (await getOrder(without.store.storeId, b.order.orderId))!;
    expect(gifted.gift).toEqual({ isGift: true, to: "Lena", from: "Anna", message: "Grattis!\nHilsen Anna" });
    expect(plain.gift).toBeNull();
    expect({ total: gifted.totalMinor, vat: gifted.taxMinor, shipping: gifted.shippingMinor }).toEqual({ total: plain.totalMinor, vat: plain.taxMinor, shipping: plain.shippingMinor });
    // The buyer's words cannot be changed once the order exists: not by staff, not by a retry.
    await expect(db().execute(sql`update commerce.orders set gift_message = 'Edited' where id = ${a.order.orderId}::uuid`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/gift/) } });
    await expect(db().execute(sql`update commerce.orders set is_gift = false where id = ${a.order.orderId}::uuid`)).rejects.toBeTruthy();
    // Changing the cart afterwards does not change the order.
    await setCartGift(shopOf(withGift.store.storeId), { isGift: true, to: "Someone else", from: "Anna", message: "Different" });
    expect((await getOrder(withGift.store.storeId, a.order.orderId))!.gift?.message).toBe("Grattis!\nHilsen Anna");
  });

  it("is in the buyer's confirmation as escaped text, to the buyer only, and not at all when there is none", async () => {
    const { store, cartId } = await giftStore("gift-email", true);
    await setCartGift(shopOf(store.storeId), { isGift: true, to: "Lena", from: "Anna", message: "<script>alert(1)</script> & love" });
    const placed = await placeOrder(shopOf(store.storeId), cartId, {});
    if (!placed.ok) throw new Error("placing");
    await payOrder(store, placed.order);
    await db().execute(sql`update commerce.orders set email = 'buyer@example.com' where id = ${placed.order.orderId}::uuid`);
    await sendOrderConfirmation(store.storeId, placed.order.orderId);
    const mails = await db().execute<Row>(sql`select to_address, html, text from commerce.email_messages where store_id = ${store.storeId}::uuid and order_id = ${placed.order.orderId}::uuid`);
    expect(mails.map((m) => String(m.to_address))).toEqual(["buyer@example.com"]);
    expect(String(mails[0].html)).not.toContain("<script>");
    expect(String(mails[0].html)).toContain("&lt;script&gt;");
    expect(String(mails[0].text)).toContain("<script>alert(1)</script> & love");

    const plain = await seedOrder(store, { status: "paid", captured: true, email: "plain@example.com" });
    await sendOrderConfirmation(store.storeId, plain.id);
    const plainMails = await db().execute<Row>(sql`select text from commerce.email_messages where store_id = ${store.storeId}::uuid and order_id = ${plain.id}::uuid`);
    expect(String(plainMails[0].text)).not.toContain("Gavehilsen");
    expect(String(mails[0].text)).toContain("Gavehilsen");
  });

  it("is in the buyer's export and gone from an anonymised order", async () => {
    const { store, cartId } = await giftStore("gift-privacy", true);
    await setCartGift(shopOf(store.storeId), { isGift: true, to: "Lena", from: "Anna", message: "Secret words" });
    const placed = await placeOrder(shopOf(store.storeId), cartId, {});
    if (!placed.ok) throw new Error("placing");
    await db().execute(sql`update commerce.orders set email = 'giver@example.com' where id = ${placed.order.orderId}::uuid`);
    const exported = await exportCustomerData(store.storeId, { email: "giver@example.com" }, { channel: "staff", accountId: store.accountId });
    if (!exported.ok) throw new Error(exported.problem);
    const orders = exported.file.sections.orders as unknown as { id: string; gift: { to: string; from: string; message: string } | null }[];
    expect(orders.find((o) => o.id === placed.order.orderId)?.gift).toEqual({ to: "Lena", from: "Anna", message: "Secret words" });
    // Erasure restricts the sale; when the retention ends the order is anonymised and the third party's words go with it.
    expect(await eraseSubject(store.storeId, { email: "giver@example.com" }, { channel: "staff", accountId: store.accountId })).toMatchObject({ ok: true });
    await db().execute(sql`select commerce.anonymise_order(${store.storeId}::uuid, ${placed.order.orderId}::uuid, 'retention')`);
    const [row] = await db().execute<Row>(sql`select is_gift, gift_to, gift_from, gift_message from commerce.orders where id = ${placed.order.orderId}::uuid`);
    expect(row).toEqual({ is_gift: false, gift_to: null, gift_from: null, gift_message: null });
  });
});

