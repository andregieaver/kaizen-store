import { describe, expect, it } from "vitest";

import {
  answersByField,
  applyCheckoutRules,
  cleanAnswers,
  pricedBy,
  rulesOnOffer,
  wordsIn,
  type CheckoutFacts,
  type CheckoutField,
  type CheckoutRule,
  type KnownIds,
} from "./checkout-rules";
import type { DeliveryOffer } from "./shipping-methods";

const facts: CheckoutFacts = { country: "NO", currency: "NOK", totalMinor: 50_000, weightGrams: 1_200, productIds: ["p1"], termIds: ["c1"], tierIds: [] };
const known: KnownIds = {
  options: new Set(["flat", "method:m1", "method:m2", "pickup:x1"]),
  products: new Set(["p1", "p2"]),
  terms: new Set(["c1", "t1"]),
  tiers: new Set(["g1"]),
  methods: new Set(["klarna", "link"]),
};
const rule = (id: string, over: Partial<CheckoutRule>): CheckoutRule => ({ id, name: id, conditions: [], effect: { kind: "hide_shipping", options: ["flat"] }, ...over });

describe("applyCheckoutRules", () => {
  it("applies a rule only when every condition holds", () => {
    const out = applyCheckoutRules(
      [
        rule("a", { conditions: [{ kind: "country", op: "is", countries: ["NO"] }, { kind: "weight", op: "at_least", grams: 1000 }], effect: { kind: "hide_shipping", options: ["method:m1"] } }),
        rule("b", { conditions: [{ kind: "country", op: "is", countries: ["SE"] }], effect: { kind: "hide_shipping", options: ["method:m2"] } }),
      ],
      facts,
      known,
      "nb-NO",
    );
    expect([...out.hidden]).toEqual(["method:m1"]);
    expect(out.applied).toEqual(["a"]);
  });

  it("compares an amount only in its own currency", () => {
    const euro = rule("e", { conditions: [{ kind: "total", op: "at_least", amountMinor: 1, currency: "EUR" }], effect: { kind: "refuse", message: { text: "No", byLocale: {} } } });
    expect(applyCheckoutRules([euro], facts, known, "en").refusal).toBeNull();
    expect(applyCheckoutRules([euro], { ...facts, currency: "EUR" }, known, "en").refusal).toEqual({ ruleId: "e", message: "No" });
  });

  it("matches products, categories and groups by any of the ids, and their negations", () => {
    const has = (kind: "product" | "category", ids: string[], op: "has" | "has_not") => rule("x", { conditions: [{ kind, op, ids }] });
    expect(applyCheckoutRules([has("product", ["p1", "p2"], "has")], facts, known, "en").applied).toEqual(["x"]);
    expect(applyCheckoutRules([has("product", ["p2"], "has")], facts, known, "en").applied).toEqual([]);
    expect(applyCheckoutRules([has("category", ["t1"], "has_not")], facts, known, "en").applied).toEqual(["x"]);
    expect(applyCheckoutRules([rule("g", { conditions: [{ kind: "group", op: "is", ids: ["g1"] }] })], { ...facts, tierIds: ["g1"] }, known, "en").applied).toEqual(["g"]);
  });

  it("skips a rule that names something gone, or cannot be read, and never half applies it", () => {
    const out = applyCheckoutRules(
      [
        rule("gone", { effect: { kind: "hide_shipping", options: ["flat", "method:deleted"] } }),
        rule("product", { conditions: [{ kind: "product", op: "has", ids: ["p9"] }] }),
        { id: "broken", name: "broken", conditions: "nope", effect: { kind: "teleport" } } as unknown as CheckoutRule,
      ],
      facts,
      known,
      "en",
    );
    expect(out.hidden.size).toBe(0);
    expect(out.skipped).toEqual([
      { ruleId: "gone", reason: "gone" },
      { ruleId: "product", reason: "gone" },
      { ruleId: "broken", reason: "unreadable" },
    ]);
  });

  it("keeps the first rename and the first refusal, adds hidden methods up, and never hides cards", () => {
    const out = applyCheckoutRules(
      [
        rule("r1", { effect: { kind: "rename_shipping", option: "flat", label: { text: "Parcel", byLocale: { nb: "Pakke" } } } }),
        rule("r2", { effect: { kind: "rename_shipping", option: "flat", label: { text: "Box", byLocale: {} } } }),
        rule("p1", { effect: { kind: "hide_payment_method", methods: ["link"] } }),
        rule("p2", { effect: { kind: "hide_payment_method", methods: ["klarna", "card"] } }),
        rule("s1", { effect: { kind: "refuse", message: { text: "First", byLocale: {} } } }),
        rule("s2", { effect: { kind: "refuse", message: { text: "Second", byLocale: {} } } }),
      ],
      facts,
      { ...known, methods: new Set(["klarna", "link", "card"]) },
      "nb-NO",
    );
    expect(out.renamed.get("flat")).toBe("Pakke");
    expect(out.hiddenMethods).toEqual(["klarna", "link"]);
    expect(out.refusal).toEqual({ ruleId: "s1", message: "First" });
  });
});

describe("rulesOnOffer", () => {
  const rate = { amountMinor: 0, freeOverMinor: null };
  const offer: DeliveryOffer = {
    status: "ok",
    ship: [
      { kind: "method", id: "m1", label: "Express", position: 0, rate, priceMinor: 9900, estimate: null },
      { kind: "method", id: "m2", label: "Standard", position: 1, rate, priceMinor: 4900, estimate: null },
    ],
    pickups: [{ kind: "pickup", id: "x1", locationId: "l1", position: 0, rate, priceMinor: 0, readyInHours: 2 }],
    local: null,
    localBelowMinimum: null,
    default: { kind: "method", id: "m1", label: "Express", position: 0, rate, priceMinor: 9900, estimate: null },
  };
  it("takes hidden options out, renames, and makes the default the first left", () => {
    const out = rulesOnOffer(offer, { ...applyCheckoutRules([], facts, known, "en"), hidden: new Set(["method:m1", "pickup:x1"]), renamed: new Map([["method:m2", "Home"]]) });
    expect(out.ship.map((d) => ("label" in d ? d.label : d.id))).toEqual(["Home"]);
    expect(out.pickups).toEqual([]);
    expect(out.default?.id).toBe("m2");
  });
  it("shows the options a rule orders first, in its order, and keeps the default as it was (D399)", () => {
    const three: DeliveryOffer = { ...offer, ship: [...offer.ship, { kind: "method", id: "m3", label: "Night", position: 2, rate, priceMinor: 19900, estimate: null }] };
    const ordered = applyCheckoutRules([rule("o", { effect: { kind: "order_delivery", options: ["method:m3", "method:m2"] } })], facts, { ...known, options: new Set([...known.options, "method:m3"]) }, "en");
    expect(ordered.order).toEqual(["method:m3", "method:m2"]);
    const out = rulesOnOffer(three, ordered);
    expect(out.ship.map((d) => d.id)).toEqual(["m3", "m2", "m1"]);
    expect(out.default?.id).toBe("m1");
    // The first ordering rule stands; a rule naming an option gone is skipped.
    const two = applyCheckoutRules(
      [rule("o1", { effect: { kind: "order_delivery", options: ["method:m2"] } }), rule("o2", { effect: { kind: "order_delivery", options: ["method:m1"] } })],
      facts,
      known,
      "en",
    );
    expect(two.order).toEqual(["method:m2"]);
    const gone = applyCheckoutRules([rule("g", { effect: { kind: "order_delivery", options: ["method:nope"] } })], facts, known, "en");
    expect(gone.order).toBeNull();
    expect(gone.skipped).toEqual([{ ruleId: "g", reason: "gone" }]);
  });
  it("leaves nothing to ship when every way is hidden", () => {
    const out = rulesOnOffer(offer, { ...applyCheckoutRules([], facts, known, "en"), hidden: new Set(["method:m1", "method:m2"]) });
    expect(out.status).toBe("no_shipping");
    expect(out.default).toBeNull();
  });
});

describe("words and answers", () => {
  it("chooses a language's words, then its family's, then the main ones", () => {
    const w = { text: "Hello", byLocale: { "nb-NO": "Hei", sv: "Hej" } };
    expect(wordsIn(w, "nb-NO")).toBe("Hei");
    expect(wordsIn(w, "sv-SE")).toBe("Hej");
    expect(wordsIn(w, "da-DK")).toBe("Hello");
  });

  it("cleans answers, names the required ones left empty and leaves out unknown fields", () => {
    const fields: CheckoutField[] = [
      { id: "f1", kind: "text", required: true, label: { text: "Door code", byLocale: {} }, help: null },
      { id: "f2", kind: "checkbox", required: true, label: { text: "I am over 18", byLocale: {} }, help: null },
      { id: "f3", kind: "text", required: false, label: { text: "Note", byLocale: {} }, help: null },
    ];
    expect(cleanAnswers(fields, { f1: "  12\n34  ", f2: "on", other: "x" })).toEqual({
      answers: [
        { fieldId: "f1", label: "Door code", kind: "text", answer: "12 34" },
        { fieldId: "f2", label: "I am over 18", kind: "checkbox", answer: true },
      ],
      missing: [],
    });
    expect(cleanAnswers(fields, {}).missing).toEqual(["f1", "f2"]);
    expect(cleanAnswers(fields, { f1: "x".repeat(900), f2: true }).answers[0].answer).toHaveLength(500);
  });

  it("reads answers back as kept, by field, and drops what is not of the shape", () => {
    expect(answersByField([{ fieldId: "f1", label: "A", kind: "text", answer: "x" }, { fieldId: "f2", label: "B", kind: "checkbox", answer: "yes" }, null])).toEqual({ f1: "x" });
  });
});

describe("delivery prices (D402)", () => {
  const rate = (amountMinor: number, freeOverMinor: number | null = null) => ({ amountMinor, freeOverMinor });
  const offer: DeliveryOffer = {
    status: "ok",
    ship: [
      { kind: "method", id: "m2", label: "Standard", position: 1, rate: rate(4900), priceMinor: 4900, estimate: null },
      { kind: "method", id: "m1", label: "Express", position: 0, rate: rate(9900), priceMinor: 9900, estimate: null },
    ],
    pickups: [{ kind: "pickup", id: "x1", locationId: "l1", position: 0, rate: rate(2900), priceMinor: 2900, readyInHours: 2 }],
    local: null,
    localBelowMinimum: null,
    default: { kind: "method", id: "m2", label: "Standard", position: 1, rate: rate(4900), priceMinor: 4900, estimate: null },
  };
  const priceRule = (id: string, options: string[], price: Extract<CheckoutRule["effect"], { kind: "delivery_price" }>["price"]) =>
    rule(id, { effect: { kind: "delivery_price", options, price } });

  it("prices an amount: free, a percentage half up, an amount, never below zero", () => {
    expect(pricedBy(4900, { kind: "free" })).toBe(0);
    expect(pricedBy(4950, { kind: "percent", percent: -10 })).toBe(4455);
    expect(pricedBy(4945, { kind: "percent", percent: -10 })).toBe(4450);
    expect(pricedBy(4900, { kind: "percent", percent: 50 })).toBe(7350);
    expect(pricedBy(4900, { kind: "amount", amountMinor: -6000 })).toBe(0);
    expect(pricedBy(4900, { kind: "amount", amountMinor: 1500 })).toBe(6400);
  });

  it("applies an amount only in a currency it names, and the first price of an option stands", () => {
    const amount = priceRule("a", ["method:m1"], { kind: "amount", amounts: { EUR: -500 } });
    expect(applyCheckoutRules([amount], facts, known, "en").prices.size).toBe(0);
    expect(applyCheckoutRules([amount], facts, known, "en").applied).toEqual([]);
    const both = applyCheckoutRules([priceRule("f", ["method:m1"], { kind: "free" }), priceRule("p", ["method:m1", "flat"], { kind: "percent", percent: 20 })], facts, known, "en");
    expect(both.prices.get("method:m1")).toEqual({ kind: "free" });
    expect(both.prices.get("flat")).toEqual({ kind: "percent", percent: 20 });
    expect(both.applied).toEqual(["f", "p"]);
    // A percentage out of bounds is not read.
    expect(applyCheckoutRules([priceRule("x", ["flat"], { kind: "percent", percent: -150 })], facts, known, "en").prices.size).toBe(0);
  });

  it("lays the price over the rate, keeps what is free over a value free, and makes the cheapest the default again", () => {
    const out = rulesOnOffer(offer, applyCheckoutRules([priceRule("f", ["method:m1"], { kind: "free" }), priceRule("p", ["pickup:x1"], { kind: "amount", amounts: { NOK: 1000 } })], facts, known, "en"));
    expect(out.ship.map((d) => [d.id, d.priceMinor, d.rate.amountMinor])).toEqual([["m1", 0, 0], ["m2", 4900, 4900]]);
    expect(out.default?.id).toBe("m1");
    expect(out.pickups[0]).toMatchObject({ priceMinor: 3900, rate: { amountMinor: 3900 } });
    const freeOver: DeliveryOffer = { ...offer, ship: [{ kind: "flat", id: "flat", rate: rate(4900, 50_000), priceMinor: 0 }], default: null };
    const up = rulesOnOffer(freeOver, applyCheckoutRules([priceRule("u", ["flat"], { kind: "amount", amounts: { NOK: 2000 } })], facts, known, "en"));
    expect(up.ship[0]).toMatchObject({ priceMinor: 0, rate: { amountMinor: 6900, freeOverMinor: 50_000 } });
  });
});

