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
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

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

  it("refuses another store's products and groups, and saves a rule naming the store's own product", async () => {
    const [theirs] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${other.storeId}::uuid and sku = 'DEMO-TOTE'`);
    expect(
      await rules.saveCheckoutRule(member, null, { name: "Theirs", conditions: [{ kind: "product", op: "has", ids: [String(theirs.product_id)] }], effect: { kind: "refuse", message: { text: "No", byLocale: {} } } }),
    ).toMatchObject({ ok: false });
    // The store's own product: saving read no products before (task 4 found it), so every rule naming one was refused.
    const [ours] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-TOTE'`);
    expect(
      await rules.saveCheckoutRule(member, null, { name: "Ours", conditions: [{ kind: "product", op: "has", ids: [String(ours.product_id)] }], effect: { kind: "refuse", message: { text: "No", byLocale: {} } } }),
    ).toMatchObject({ ok: true });
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
  it("asks a tick list: refuses a sensitive answer without consent, keeps the options ticked on the order, and keeps its options when reworded (task 3)", async () => {
    const { allergenQuestion } = await import("@/lib/checkout-presets");
    const preset = allergenQuestion(["nb-NO", "en"]);
    const made = await rules.saveCheckoutField(member, null, { kind: "checklist", required: true, label: preset.label, help: preset.help, options: preset.options, sensitive: true });
    if (!made.ok) throw new Error(made.problems.join("; "));
    const [field] = await rules.listCheckoutFields(db(), store.storeId);
    expect(field).toMatchObject({ kind: "checklist", sensitive: true });
    expect(field.options).toHaveLength(15);
    const milk = field.options!.find((o) => o.label.text === "Melk")!.id;
    const none = field.options!.find((o) => o.none)!.id;
    const shown = await rules.checkoutQuestionsFor(store.storeId, "en", null, NO);
    expect(shown.fields[0]).toMatchObject({ kind: "checklist", label: "Allergies we should know about", sensitive: true });
    expect(shown.fields[0].options.find((o) => o.id === milk)?.label).toBe("Milk");

    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    // Milk ticked without the shopper's consent: the order is refused.
    await rules.setCartAnswers(store.storeId, cartId, [{ fieldId: made.id, label: "Allergier vi bør vite om", kind: "checklist", answer: ["Melk"], optionIds: [milk], consent: false }]);
    expect(await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null })).toEqual({ ok: false, problem: "checkout_fields" });
    // With consent it is kept on the order in the store's main words.
    await rules.setCartAnswers(store.storeId, cartId, [{ fieldId: made.id, label: "Allergier vi bør vite om", kind: "checklist", answer: ["Melk"], optionIds: [milk], consent: true }]);
    const placed = await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null });
    if (!placed.ok) throw new Error(placed.problem);
    expect((await getOrder(store.storeId, placed.order.orderId))?.checkoutAnswers).toEqual([
      { fieldId: made.id, label: "Allergier vi bør vite om", kind: "checklist", answer: ["Melk"], optionIds: [milk], consent: true },
    ]);
    // None of these needs no consent.
    const second = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    await rules.setCartAnswers(store.storeId, second, [{ fieldId: made.id, label: "x", kind: "checklist", answer: ["Ingen av disse"], optionIds: [none], consent: false }]);
    expect((await placeOrder({ storeId: store.storeId, market: NO }, second, {}, { customerId: null })).ok).toBe(true);

    // Reworded without options (the AI manager): the options and the consent stay.
    expect(await rules.saveCheckoutField(member, made.id, { kind: "checklist", required: true, label: { text: "Allergier", byLocale: {} }, help: null })).toEqual({ ok: true, id: made.id });
    const [after] = await rules.listCheckoutFields(db(), store.storeId);
    expect(after).toMatchObject({ label: { text: "Allergier" }, sensitive: true });
    expect(after.options).toHaveLength(15);
    // A tick list without options is refused.
    expect(await rules.saveCheckoutField(member, null, { kind: "checklist", label: { text: "Empty", byLocale: {} }, options: [] })).toEqual({ ok: false, problems: ["Give the tick list at least one option."] });
  });

  it("asks a dropdown, a choice of one and longer text, keeps each answer on the order, and refuses a tick list's None of these in a dropdown (task 4)", async () => {
    const w = (text: string) => ({ text, byLocale: {} });
    const size = await rules.saveCheckoutField(member, null, { kind: "select", required: true, label: w("Størrelse"), options: [{ label: w("Liten") }, { label: w("Stor") }] });
    const diet = await rules.saveCheckoutField(member, null, { kind: "radio", label: w("Kost"), options: [{ label: w("Vegansk") }, { label: w("Halal") }], sensitive: true });
    const notes = await rules.saveCheckoutField(member, null, { kind: "textarea", required: true, label: w("Beskjed"), sensitive: true });
    if (!size.ok || !diet.ok || !notes.ok) throw new Error("fields not saved");
    const fields = await rules.listCheckoutFields(db(), store.storeId);
    expect(fields.map((f) => [f.kind, f.options?.length ?? 0, f.sensitive])).toEqual([
      ["select", 2, false],
      ["radio", 2, true],
      // Longer text has no options, and no consent to ask.
      ["textarea", 0, false],
    ]);
    const big = fields[0].options![1].id;
    const halal = fields[1].options![1].id;
    expect((await rules.checkoutQuestionsFor(store.storeId, "nb", null, NO)).fields.map((f) => f.kind)).toEqual(["select", "radio", "textarea"]);

    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    const answers = [
      { fieldId: size.id, label: "Størrelse", kind: "choice" as const, answer: "Stor", optionId: big, consent: false },
      { fieldId: diet.id, label: "Kost", kind: "choice" as const, answer: "Halal", optionId: halal, consent: true },
      { fieldId: notes.id, label: "Beskjed", kind: "text" as const, answer: "Ring på\nBlå port" },
    ];
    // The sensitive choice without consent: refused.
    await rules.setCartAnswers(store.storeId, cartId, answers.map((a) => (a.fieldId === diet.id ? { ...a, consent: false } : a)));
    expect(await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null })).toEqual({ ok: false, problem: "checkout_fields" });
    await rules.setCartAnswers(store.storeId, cartId, answers);
    const placed = await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null });
    if (!placed.ok) throw new Error(placed.problem);
    expect((await getOrder(store.storeId, placed.order.orderId))?.checkoutAnswers).toEqual(answers);

    // A dropdown needs two options; a tick list with None of these cannot become one without its options being changed.
    expect(await rules.saveCheckoutField(member, null, { kind: "select", label: w("Én"), options: [{ label: w("A") }] })).toEqual({ ok: false, problems: ["Give the question at least two options to choose from."] });
    const list = await rules.saveCheckoutField(member, null, { kind: "checklist", label: w("Allergier"), options: [{ label: w("Melk") }, { label: w("Ingen"), none: true }] });
    if (!list.ok) throw new Error("list not saved");
    expect(await rules.saveCheckoutField(member, list.id, { kind: "select", label: w("Allergier") })).toEqual({ ok: false, problems: ["Only a tick list has a None of these option."] });
    // Made a line of text, it loses its options and its consent.
    expect(await rules.saveCheckoutField(member, diet.id, { kind: "text", label: w("Kost") })).toEqual({ ok: true, id: diet.id });
    const plain = (await rules.listCheckoutFields(db(), store.storeId)).find((f) => f.id === diet.id);
    expect(plain).toMatchObject({ kind: "text", sensitive: false });
    expect(plain?.options).toBeUndefined();
  });

  it("asks a number, a date, an email and a phone, checked again when the order is placed, and keeps a number's bounds while it stays one (task 4)", async () => {
    const w = (text: string) => ({ text, byLocale: {} });
    const guests = await rules.saveCheckoutField(member, null, { kind: "number", required: true, label: w("Gjester"), bounds: { min: 1, max: 40 } });
    const day = await rules.saveCheckoutField(member, null, { kind: "date", label: w("Ønsket dato"), bounds: { min: 2 } });
    const mail = await rules.saveCheckoutField(member, null, { kind: "email", label: w("Mottakers e-post") });
    const tel = await rules.saveCheckoutField(member, null, { kind: "phone", label: w("Mottakers telefon") });
    if (!guests.ok || !day.ok || !mail.ok || !tel.ok) throw new Error("fields not saved");
    expect((await rules.listCheckoutFields(db(), store.storeId)).map((f) => [f.kind, f.bounds ?? null])).toEqual([
      ["number", { min: 1, max: 40 }],
      ["date", { min: 2 }],
      ["email", null],
      ["phone", null],
    ]);
    const today = await rules.storeToday(store.storeId);
    const { daysAfter } = await import("@/lib/checkout-rules");
    expect((await rules.checkoutQuestionsFor(store.storeId, "nb", null, NO)).fields.map((f) => [f.min, f.max])).toEqual([
      ["1", "40"],
      [daysAfter(today, 2), null],
      [null, null],
      [null, null],
    ]);

    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    const answers = [
      { fieldId: guests.id, label: "Gjester", kind: "text" as const, answer: "12" },
      { fieldId: day.id, label: "Ønsket dato", kind: "text" as const, answer: daysAfter(today, 5) },
      { fieldId: mail.id, label: "Mottakers e-post", kind: "text" as const, answer: "anna@example.no" },
      { fieldId: tel.id, label: "Mottakers telefon", kind: "text" as const, answer: "+4791234567" },
    ];
    // A day before the earliest, kept on the cart: placing the order checks it again and refuses it.
    await rules.setCartAnswers(store.storeId, cartId, answers.map((a) => (a.fieldId === day.id ? { ...a, answer: today } : a)));
    expect(await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null })).toEqual({ ok: false, problem: "checkout_fields" });
    await rules.setCartAnswers(store.storeId, cartId, answers);
    const placed = await placeOrder({ storeId: store.storeId, market: NO }, cartId, {}, { customerId: null });
    if (!placed.ok) throw new Error(placed.problem);
    expect((await getOrder(store.storeId, placed.order.orderId))?.checkoutAnswers).toEqual(answers);

    // Reworded without bounds (the AI manager): kept. Made a date: a number's bounds are not a date's days, so they go. Made an email: none.
    expect(await rules.saveCheckoutField(member, guests.id, { kind: "number", required: true, label: w("Antall gjester") })).toEqual({ ok: true, id: guests.id });
    const bounded = async () => (await rules.listCheckoutFields(db(), store.storeId)).find((f) => f.id === guests.id)?.bounds;
    expect(await bounded()).toEqual({ min: 1, max: 40 });
    expect(await rules.saveCheckoutField(member, guests.id, { kind: "date", label: w("Dato") })).toEqual({ ok: true, id: guests.id });
    expect(await bounded()).toBeUndefined();
    expect(await rules.saveCheckoutField(member, guests.id, { kind: "number", label: w("Tall"), bounds: { min: 5, max: 1 } })).toEqual({ ok: false, problems: ["The lowest answer is above the highest."] });
    expect(await rules.saveCheckoutField(member, mail.id, { kind: "email", label: w("E-post"), bounds: { max: 3 } })).toEqual({ ok: false, problems: ["Only a number or a date has a lowest and a highest answer."] });
  });

  it("asks a question only of a basket its conditions hold for, in the cart and when the order is placed, and keeps its conditions when reworded (task 4)", async () => {
    const w = (text: string) => ({ text, byLocale: {} });
    const [lamp] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-LAMP'`);
    const lampId = String(lamp.product_id);
    // Another store's product is refused.
    expect(await rules.saveCheckoutField(member, null, { kind: "text", label: w("Pære"), conditions: [{ kind: "product", op: "has", ids: ["00000000-0000-4000-8000-000000000001"] }] })).toEqual({
      ok: false,
      problems: ["Choose products of this store."],
    });
    const bulb = await rules.saveCheckoutField(member, null, { kind: "text", required: true, label: w("Hvilken pære?"), conditions: [{ kind: "product", op: "has", ids: [lampId] }, { kind: "country", op: "is", countries: ["NO"] }] });
    const always = await rules.saveCheckoutField(member, null, { kind: "text", label: w("Portkode") });
    if (!bulb.ok || !always.ok) throw new Error("fields not saved");
    expect((await rules.listCheckoutFields(db(), store.storeId)).find((f) => f.id === bulb.id)?.conditions).toHaveLength(2);

    // A basket without the lamp is not asked, and its order needs no answer.
    const mug = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    expect((await rules.checkoutQuestionsFor(store.storeId, "nb", mug, NO)).fields.map((f) => f.label)).toEqual(["Portkode"]);
    expect((await placeOrder({ storeId: store.storeId, market: NO }, mug, {}, { customerId: null })).ok).toBe(true);
    // A basket with it is asked, and refused without the answer.
    const withLamp = await cartOf(store, [["DEMO-LAMP", 1]]);
    expect((await rules.checkoutQuestionsFor(store.storeId, "nb", withLamp, NO)).fields.map((f) => f.label)).toEqual(["Hvilken pære?", "Portkode"]);
    expect(await placeOrder({ storeId: store.storeId, market: NO }, withLamp, {}, { customerId: null })).toEqual({ ok: false, problem: "checkout_fields" });
    // A basket that took the lamp in after its answers were kept is checked again: the newly asked question stops the order.
    const later = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    await rules.setCartAnswers(store.storeId, later, []);
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      select ${store.storeId}::uuid, ${later}::uuid, id, 1 from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-LAMP'
    `);
    expect(await placeOrder({ storeId: store.storeId, market: NO }, later, {}, { customerId: null })).toEqual({ ok: false, problem: "checkout_fields" });
    // Without a cart, a question with conditions is not shown.
    expect((await rules.checkoutQuestionsFor(store.storeId, "nb", null, NO)).fields.map((f) => f.label)).toEqual(["Portkode"]);

    // Reworded without conditions (the AI manager): kept. [] asks it always.
    expect(await rules.saveCheckoutField(member, bulb.id, { kind: "text", required: true, label: w("Pære") })).toEqual({ ok: true, id: bulb.id });
    expect((await rules.listCheckoutFields(db(), store.storeId)).find((f) => f.id === bulb.id)?.conditions).toHaveLength(2);
    expect(await rules.saveCheckoutField(member, bulb.id, { kind: "text", required: true, label: w("Pære"), conditions: [] })).toEqual({ ok: true, id: bulb.id });
    expect((await rules.listCheckoutFields(db(), store.storeId)).find((f) => f.id === bulb.id)?.conditions).toBeUndefined();
  });

  it("keeps a question half width, keeps its width when changed without one, and gives the cart its width (task 2)", async () => {
    const half = await rules.saveCheckoutField(member, null, { kind: "text", required: false, label: { text: "Postcode", byLocale: {} }, help: null, width: "half" });
    const full = await rules.saveCheckoutField(member, null, { kind: "text", required: false, label: { text: "Gift note", byLocale: {} }, help: null });
    if (!half.ok || !full.ok) throw new Error("fields not saved");
    expect((await rules.listCheckoutFields(db(), store.storeId)).map((f) => [f.label.text, f.width])).toEqual([
      ["Postcode", "half"],
      ["Gift note", "full"],
    ]);
    // Reworded without a width (the AI manager, an older API caller): it stays half.
    expect(await rules.saveCheckoutField(member, half.id, { kind: "text", required: true, label: { text: "Post code", byLocale: {} }, help: null })).toEqual({ ok: true, id: half.id });
    expect((await rules.checkoutQuestionsFor(store.storeId, "en", null, NO)).fields.map((f) => [f.label, f.width])).toEqual([
      ["Post code", "half"],
      ["Gift note", "full"],
    ]);
    expect(await rules.saveCheckoutField(member, half.id, { kind: "text", required: true, label: { text: "Post code", byLocale: {} }, help: null, width: "full" })).toEqual({ ok: true, id: half.id });
    expect((await rules.listCheckoutFields(db(), store.storeId))[0].width).toBe("full");
    expect(await rules.saveCheckoutField(member, null, { kind: "text", label: { text: "Wide", byLocale: {} }, width: "wide" })).toMatchObject({ ok: false });
  });

  it("moves a question to its place, asks them in that order, audits the move and leaves another store's questions alone", async () => {
    const ids: string[] = [];
    for (const text of ["First", "Second", "Third"]) {
      const saved = await rules.saveCheckoutField(member, null, { kind: "text", required: false, label: { text, byLocale: {} }, help: null });
      if (!saved.ok) throw new Error(saved.problems.join("; "));
      ids.push(saved.id);
    }
    expect(await rules.moveCheckoutField(member, ids[2], 0)).toBe(true);
    expect((await rules.listCheckoutFields(db(), store.storeId)).map((f) => f.label.text)).toEqual(["Third", "First", "Second"]);
    expect((await rules.checkoutQuestionsFor(store.storeId, "en", null, NO)).fields.map((f) => f.label)).toEqual(["Third", "First", "Second"]);
    expect(await rules.moveCheckoutField(member, ids[2], 99)).toBe(true);
    expect((await rules.listCheckoutFields(db(), store.storeId)).map((f) => f.position)).toEqual([0, 1, 2]);
    expect((await rules.listCheckoutFields(db(), store.storeId)).map((f) => f.label.text)).toEqual(["First", "Second", "Third"]);
    const [audit] = await db().execute<Row>(
      sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'shipping.checkout_field_moved' order by created_at limit 1`,
    );
    expect(audit?.details).toMatchObject({ from: 2, to: 0 });
    const elsewhere = { ...member, store: { ...member.store, id: other.storeId } } as Member;
    expect(await rules.moveCheckoutField(elsewhere, ids[0], 2)).toBe(false);
    expect((await rules.listCheckoutFields(db(), store.storeId)).map((f) => f.label.text)).toEqual(["First", "Second", "Third"]);
  });

  it("refuses an order without a required answer, and keeps the answers on the order", async () => {
    const field = await rules.saveCheckoutField(member, null, { kind: "text", required: true, label: { text: "Delivery door code", byLocale: { "nb-NO": "Portkode" } }, help: null });
    const box = await rules.saveCheckoutField(member, null, { kind: "checkbox", required: false, label: { text: "Leave at the door", byLocale: {} }, help: null });
    if (!field.ok || !box.ok) throw new Error("fields not saved");
    const questions = await rules.checkoutQuestionsFor(store.storeId, "nb-NO", null, NO);
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
