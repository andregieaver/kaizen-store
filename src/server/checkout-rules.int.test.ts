import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const cookieCart = vi.hoisted(() => ({ name: "", value: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === cookieCart.name ? { name, value: cookieCart.value } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const sm = await import("./shipping-methods");
const rules = await import("./checkout-rules");
const { resolveDelivery, chooseDelivery } = await import("./delivery-options");
const { cartSummary } = await import("./cart-summary");
const { getCart } = await import("./cart");
const { placeOrder } = await import("./checkout");
const { getOrder } = await import("./orders");
const { excludedPaymentMethods } = await import("./payment-methods");
const { fxStore, NO, NO_EUR } = await import("./fulfilment-test-fixture");
const { cartOf } = await import("./shipping-test-fixture");

type Row = Record<string, unknown>;
type Member = Parameters<typeof rules.saveCheckoutRule>[0];

/**
 * Checkout rules and questions against a real database (D357): a rule hides or renames a delivery option, leaves a payment method out or stops the
 * basket, the cart (`cartSummary()`) and checkout (`placeOrder()`) agreeing, in kroner and in euro; a rule naming something gone is left out and
 * counted; another store's ids are refused; required questions stop the order and the answers are kept on it.
 */

let store: Awaited<ReturnType<typeof fxStore>>;
let other: Awaited<ReturnType<typeof fxStore>>;
let member: Member;

beforeAll(async () => {
  store = await fxStore("rules");
  other = await fxStore("rules-other");
  member = { account: { id: store.accountId }, store: { id: store.storeId, localization: { currencies: [{ currency: "NOK" }, { currency: "EUR" }] } } } as unknown as Member;
});
afterAll(async () => {
  await closeDb();
});
afterEach(async () => {
  await db().execute(sql`delete from commerce.checkout_rules where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`delete from commerce.checkout_fields where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`delete from commerce.shipping_methods where store_id = ${store.storeId}::uuid`);
});

async function methodOf(name: string, amountMinor: number): Promise<string> {
  const saved = await sm.saveShippingMethod(store.accountId, store.storeId, {
    id: null,
    marketCode: "NO",
    name,
    names: {},
    estimate: { min: 1, max: 3 },
    freeOverMinor: null,
    active: true,
    groups: [{ zoneId: null, profileId: null, tiers: [{ basis: "flat", minValue: 0, maxValue: null, amountMinor }] }],
  });
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  return (saved as { id: string }).id;
}

async function ruleOn(input: unknown): Promise<string> {
  const saved = await rules.saveCheckoutRule(member, null, input);
  if (!saved.ok) throw new Error(saved.problems.join("; "));
  expect(await rules.switchCheckoutRule(member, saved.id, true)).toBe(true);
  return saved.id;
}

async function summaryOf(cartId: string, market = NO) {
  cookieCart.name = `cart_${store.storeId}_${market.code.toLowerCase()}`;
  cookieCart.value = cartId;
  return cartSummary({ storeId: store.storeId, market }, await getCart({ storeId: store.storeId, market }), { cartId, customerId: null });
}

describe("delivery options", () => {
  it("hides a method for a country in the cart and at checkout alike, and refuses choosing it", async () => {
    const standard = await methodOf("Standard", 4900);
    const express = await methodOf("Express", 9900);
    await ruleOn({ name: "No express to Norway", conditions: [{ kind: "country", op: "is", countries: ["NO"] }], effect: { kind: "hide_shipping", options: [`method:${express}`] } });
    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    const resolved = await resolveDelivery(db(), store.storeId, cartId, NO);
    expect(resolved?.offer.ship.map((d) => d.id)).toEqual([standard]);
    expect(await chooseDelivery({ storeId: store.storeId, market: NO }, cartId, `method:${express}`)).toEqual({ ok: false, problem: "gone" });
    const placed = await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null });
    if (!placed.ok) throw new Error(placed.problem);
    expect(placed.order.shippingMinor).toBe(4900);
  });

  it("renames the flat rate in the cart's language, and the order keeps the new name", async () => {
    await ruleOn({ name: "Rename", conditions: [], effect: { kind: "rename_shipping", option: "flat", label: { text: "Standard parcel", byLocale: { "nb-NO": "Vanlig pakke" } } } });
    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    const resolved = await resolveDelivery(db(), store.storeId, cartId, NO);
    expect(resolved?.delivery).toMatchObject({ kind: "flat", label: "Vanlig pakke" });
    const placed = await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null });
    if (!placed.ok) throw new Error(placed.problem);
    const [row] = await db().execute<Row>(sql`select delivery ->> 'label' as label from commerce.orders where id = ${placed.order.orderId}::uuid`);
    expect(row.label).toBe("Vanlig pakke");
  });

  it("shows the options a rule orders first, keeps the store's own first chosen, and charges what is chosen (D399)", async () => {
    const standard = await methodOf("Standard", 4900);
    const express = await methodOf("Express", 9900);
    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    const before = await resolveDelivery(db(), store.storeId, cartId, NO);
    await ruleOn({ name: "Express first", conditions: [], effect: { kind: "order_delivery", options: [`method:${express}`] } });
    const after = await resolveDelivery(db(), store.storeId, cartId, NO);
    expect(after?.offer.ship[0]?.id).toBe(express);
    expect(after?.offer.ship.map((d) => d.id).sort()).toEqual(before?.offer.ship.map((d) => d.id).sort());
    expect(after?.offer.default?.id).toBe(before?.offer.default?.id);
    expect(after?.offer.ship.map((d) => d.id)).toContain(standard);
    // The cart and the order still agree on what the basket's shipping costs.
    const summary = await summaryOf(cartId);
    const placed = await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null });
    if (!placed.ok) throw new Error(placed.problem);
    expect(placed.order.shippingMinor).toBe(summary.shipping);
  });

  it("prices a delivery option: the cart and the order charge the rule's price, in kroner and in euro, and the order keeps the rule (D402)", async () => {
    const express = await methodOf("Express", 9900);
    // An amount in a currency the store does not show is refused.
    expect(await rules.saveCheckoutRule(member, null, { name: "Bad", conditions: [], effect: { kind: "delivery_price", options: ["flat"], price: { kind: "amount", amounts: { USD: 100 } } } })).toMatchObject({ ok: false });
    const id = await ruleOn({
      name: "Express cheaper",
      conditions: [],
      effect: { kind: "delivery_price", options: [`method:${express}`], price: { kind: "amount", amounts: { NOK: -4000, EUR: -300 } } },
    });
    for (const market of [NO, NO_EUR]) {
      const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]], market);
      const before = (await resolveDelivery(db(), store.storeId, cartId, market))!;
      const own = before.offer.ship.find((d) => d.id === express)!;
      expect(own).toBeDefined();
      const unpriced = market === NO ? 9900 : null;
      if (unpriced !== null) expect(own.priceMinor).toBe(9900 - 4000);
      expect(await chooseDelivery({ storeId: store.storeId, market }, cartId, `method:${express}`)).toMatchObject({ ok: true });
      const summary = await summaryOf(cartId, market);
      expect(summary.shipping).toBe(own.priceMinor);
      const placed = await placeOrder({ storeId: store.storeId, market }, cartId, {}, { customerId: null });
      if (!placed.ok) throw new Error(placed.problem);
      expect(placed.order.shippingMinor).toBe(summary.shipping);
      const [kept] = await db().execute<Row>(sql`select checkout_rules_applied from commerce.orders where id = ${placed.order.orderId}::uuid`);
      expect(kept.checkout_rules_applied).toContain(id);
    }
  });

  it("hiding every way to ship leaves the basket with nothing to ship it, as checkout refuses", async () => {
    await ruleOn({ name: "No flat", conditions: [], effect: { kind: "hide_shipping", options: ["flat"] } });
    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    expect((await resolveDelivery(db(), store.storeId, cartId, NO))?.offer.status).toBe("no_shipping");
    expect(await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null })).toEqual({ ok: false, problem: "no_shipping" });
  });
});

describe("payment methods and refusals", () => {
  it("keeps the methods a rule left out on the order and passes them with the owner's choices, never cards", async () => {
    await ruleOn({ name: "No Klarna", conditions: [], effect: { kind: "hide_payment_method", methods: ["klarna"] } });
    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    const placed = await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null });
    if (!placed.ok) throw new Error(placed.problem);
    expect(await excludedPaymentMethods(store.storeId, "NO", placed.order.orderId)).toEqual(["klarna"]);
    const [kept] = await db().execute<Row>(sql`select checkout_rules_applied from commerce.orders where id = ${placed.order.orderId}::uuid`);
    expect((kept.checkout_rules_applied as string[]).length).toBe(1);
    expect(await excludedPaymentMethods(store.storeId, "NO")).toEqual([]);
    // Cards cannot be named by a rule.
    expect(await rules.saveCheckoutRule(member, null, { name: "No cards", conditions: [], effect: { kind: "hide_payment_method", methods: ["card"] } })).toMatchObject({ ok: false });
  });

  it("stops a heavy basket with the owner's words, the cart blocked and the order refused", async () => {
    await ruleOn({
      name: "Too heavy",
      conditions: [{ kind: "weight", op: "at_least", grams: 1 }],
      effect: { kind: "refuse", message: { text: "We can't send this much in one parcel.", byLocale: { "nb-NO": "Vi kan ikke sende så mye i én pakke." } } },
    });
    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 3]]);
    const summary = await summaryOf(cartId);
    expect(summary.blocked).toBe(true);
    expect(summary.refusal).toBe("Vi kan ikke sende så mye i én pakke.");
    expect(await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null })).toEqual({ ok: false, problem: "checkout_rule" });
  });

  it("compares a basket value in its own currency only: a euro rule holds in the euro view, not in kroner", async () => {
    await ruleOn({ name: "Big euro baskets", conditions: [{ kind: "total", op: "at_least", amountMinor: 100, currency: "EUR" }], effect: { kind: "refuse", message: { text: "Call us for large orders.", byLocale: {} } } });
    const euro = await cartOf(store, [["DEMO-MUG-WHITE", 1]], NO_EUR);
    expect((await summaryOf(euro, NO_EUR)).refusal).toBe("Call us for large orders.");
    expect(await placeOrder({ storeId: store.storeId, market: NO_EUR }, euro, {}, { customerId: null })).toEqual({ ok: false, problem: "checkout_rule" });
    const kroner = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    expect((await summaryOf(kroner)).refusal).toBeNull();
    expect((await placeOrder({ storeId: store.storeId, market: NO }, kroner, {}, { customerId: null })).ok).toBe(true);
  });
});

describe("rules that name what is gone, and another store's ids", () => {
  it("leaves out a rule whose method was deleted, counts the skip, and starts again when the rule is saved", async () => {
    const express = await methodOf("Express", 9900);
    const id = await ruleOn({ name: "Hide express", conditions: [], effect: { kind: "hide_shipping", options: [`method:${express}`] } });
    await db().execute(sql`delete from commerce.shipping_methods where id = ${express}::uuid`);
    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    await summaryOf(cartId);
    await summaryOf(cartId);
    const [skip] = (await rules.listCheckoutRules(store.storeId)).find((r) => r.id === id)!.skips;
    expect(skip).toMatchObject({ reason: "gone" });
    expect(skip.count).toBeGreaterThanOrEqual(2);
    // Saving refuses a method that is not the store's; putting it right clears the skips.
    expect(await rules.saveCheckoutRule(member, id, { name: "Hide express", conditions: [], effect: { kind: "hide_shipping", options: [`method:${express}`] } })).toMatchObject({ ok: false });
    expect(await rules.saveCheckoutRule(member, id, { name: "Hide flat", conditions: [], effect: { kind: "hide_shipping", options: ["flat"] } })).toEqual({ ok: true, id });
    expect((await rules.listCheckoutRules(store.storeId)).find((r) => r.id === id)!.skips).toEqual([]);
  });

  it("refuses another store's products and groups", async () => {
    const [theirs] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${other.storeId}::uuid and sku = 'DEMO-TOTE'`);
    expect(
      await rules.saveCheckoutRule(member, null, { name: "Theirs", conditions: [{ kind: "product", op: "has", ids: [String(theirs.product_id)] }], effect: { kind: "refuse", message: { text: "No", byLocale: {} } } }),
    ).toMatchObject({ ok: false });
  });

  it("saves a new rule off and audits it", async () => {
    const saved = await rules.saveCheckoutRule(member, null, { name: "Off at first", conditions: [], effect: { kind: "hide_shipping", options: ["flat"] } });
    if (!saved.ok) throw new Error("not saved");
    expect((await rules.listCheckoutRules(store.storeId)).find((r) => r.id === saved.id)?.enabled).toBe(false);
    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    expect((await resolveDelivery(db(), store.storeId, cartId, NO))?.offer.status).toBe("ok");
    const [audit] = await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'shipping.checkout_rule_made' limit 1`);
    expect(audit?.action).toBe("shipping.checkout_rule_made");
  });
});

describe("questions at checkout", () => {
  it("refuses an order without a required answer, and keeps the answers on the order", async () => {
    const field = await rules.saveCheckoutField(member, null, { kind: "text", required: true, label: { text: "Delivery door code", byLocale: { "nb-NO": "Portkode" } }, help: null });
    const box = await rules.saveCheckoutField(member, null, { kind: "checkbox", required: false, label: { text: "Leave at the door", byLocale: {} }, help: null });
    if (!field.ok || !box.ok) throw new Error("fields not saved");
    const questions = await rules.checkoutQuestionsFor(store.storeId, "nb-NO", null);
    expect(questions.fields.map((f) => f.label)).toEqual(["Portkode", "Leave at the door"]);
    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    expect(await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null })).toEqual({ ok: false, problem: "checkout_fields" });
    await rules.setCartAnswers(store.storeId, cartId, [
      { fieldId: field.id, label: "Delivery door code", kind: "text", answer: "1234" },
      { fieldId: box.id, label: "Leave at the door", kind: "checkbox", answer: true },
    ]);
    const placed = await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null });
    if (!placed.ok) throw new Error(placed.problem);
    const order = await getOrder(store.storeId, placed.order.orderId);
    expect(order?.checkoutAnswers).toEqual([
      { fieldId: field.id, label: "Delivery door code", kind: "text", answer: "1234" },
      { fieldId: box.id, label: "Leave at the door", kind: "checkbox", answer: true },
    ]);
  });
});
