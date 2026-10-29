import type { DeliveryOffer, OfferedDelivery } from "./shipping-methods";

/**
 * Checkout rules and fields (wave 9 unit D, D357, `docs/wave-9-platform.md` section 3, D): the pure parts, free of zod so the cart (a pay route)
 * can import them. A rule is a list of conditions on the basket (all must hold) and one effect: hide shipping options, rename one, hide payment
 * methods, or refuse the basket with the owner's words; since D402 a rule may also price a delivery option (`delivery_price`). `applyCheckoutRules()`
 * is the one evaluator: `cartSummary()` and `placeOrder()` both reach it through the server's `checkoutRuleOutcome()`, so they agree. A rule never
 * changes a product's price, VAT or a legal page, and a delivery it prices never costs less than nothing. A rule that names something
 * gone (a method, a product, a category, a group) or cannot be read is skipped, never half applied, and the skip is recorded.
 */

export const RULES_MAX = 30;
export const RULE_CONDITIONS_MAX = 10;
export const FIELDS_MAX = 10;
export const FIELD_LABEL_MAX = 80;
export const FIELD_ANSWER_MAX = 500;
export const REFUSAL_MAX = 300;

export type AmountOp = "at_least" | "below";

export type RuleCondition =
  | { kind: "country"; op: "is" | "is_not"; countries: string[] }
  | { kind: "total"; op: AmountOp; amountMinor: number; currency: string }
  | { kind: "weight"; op: AmountOp; grams: number }
  | { kind: "product"; op: "has" | "has_not"; ids: string[] }
  | { kind: "category"; op: "has" | "has_not"; ids: string[] }
  | { kind: "tag"; op: "has" | "has_not"; ids: string[] }
  | { kind: "group"; op: "is" | "is_not"; ids: string[] };

export const CONDITION_KINDS = ["country", "total", "weight", "product", "category", "tag", "group"] as const;

/** Words per language over the main ones: `{ "nb-NO": "…" }`; the main words stand where a language has none. */
export type Words = { text: string; byLocale: Record<string, string> };

export type RuleEffect =
  | { kind: "hide_shipping"; options: string[] }
  | { kind: "rename_shipping"; option: string; label: Words }
  | { kind: "hide_payment_method"; methods: string[] }
  | { kind: "refuse"; message: Words }
  /** Shows these options first, in this order, the rest after in their own (D399); never changes which is chosen until the shopper chooses. */
  | { kind: "order_delivery"; options: string[] }
  /** Prices these options (D402): free, a percentage more or less (−100 to 300), or an amount more or less per currency, never below zero. */
  | { kind: "delivery_price"; options: string[]; price: DeliveryPrice };

/** How a rule prices a delivery option: amounts are signed minor units of the currency shown, a basket in a currency it names none of is untouched. */
export type DeliveryPrice = { kind: "free" } | { kind: "percent"; percent: number } | { kind: "amount"; amounts: Record<string, number> };

export const DELIVERY_PERCENT_MIN = -100;
export const DELIVERY_PERCENT_MAX = 300;

export const EFFECT_KINDS = ["hide_shipping", "rename_shipping", "order_delivery", "delivery_price", "hide_payment_method", "refuse"] as const;

export type CheckoutRule = { id: string; name: string; conditions: RuleCondition[]; effect: RuleEffect };

/** What a basket is, as the rules see it: the country, the basket's value in the currency shown, its weight and what it holds. */
export type CheckoutFacts = {
  country: string;
  currency: string;
  totalMinor: number;
  weightGrams: number;
  productIds: readonly string[];
  /** Every category and tag of the products (their parents and the collections filled by rules included, as `termsOfProducts()` reads them). */
  termIds: readonly string[];
  /** The buyer's customer groups (`customerTierIds()`): none for a guest. */
  tierIds: readonly string[];
};

/** What still exists in the store, so a rule that names something gone is skipped: options by key (`optionKey()`), products, terms, groups. */
export type KnownIds = {
  options: ReadonlySet<string>;
  products: ReadonlySet<string>;
  terms: ReadonlySet<string>;
  tiers: ReadonlySet<string>;
  methods: ReadonlySet<string>;
};

export type SkipReason = "gone" | "unreadable";

export type RuleOutcome = {
  /** Shipping options hidden, by key. */
  hidden: ReadonlySet<string>;
  /** Shipping options renamed, by key: the words in the basket's language. */
  renamed: ReadonlyMap<string, string>;
  /** Payment methods left out (Stripe's types), sorted; never cards. */
  hiddenMethods: string[];
  /** The first rule that refuses the basket, with its words in the basket's language. */
  refusal: { ruleId: string; message: string } | null;
  /** The options to show first, in order, from the first rule that orders them (D399); null when none does. */
  order: string[] | null;
  /** Delivery options priced by a rule, by key (D402): the first rule that prices an option stands; amounts already in the basket's currency. */
  prices: ReadonlyMap<string, PriceChange>;
  /** The rules whose conditions held and whose effect counts. */
  applied: string[];
  /** The rules left out, and why. */
  skipped: { ruleId: string; reason: SkipReason }[];
};

/** A rule's price for one basket: free, a percentage, or a signed amount in the basket's currency. */
export type PriceChange = { kind: "free" } | { kind: "percent"; percent: number } | { kind: "amount"; amountMinor: number };

export const NO_RULES: RuleOutcome = { hidden: new Set(), renamed: new Map(), hiddenMethods: [], refusal: null, order: null, prices: new Map(), applied: [], skipped: [] };

/** A shipping option's key, as rules name it: `flat`, `method:{id}`, `pickup:{id}` or `local:{id}`. */
export const optionKey = (d: Pick<OfferedDelivery, "kind" | "id">): string => (d.kind === "flat" ? "flat" : `${d.kind}:${d.id}`);

/** The words in a language: its own, else its language's first match (`nb` for `nb-NO`), else the main ones. */
export function wordsIn(words: Words, locale: string): string {
  const own = words.byLocale[locale];
  if (own) return own;
  const lang = locale.split("-")[0];
  const near = Object.entries(words.byLocale).find(([l]) => l.split("-")[0] === lang)?.[1];
  return near || words.text;
}

const ALWAYS_PAID_BY = "card";

/** Whether a condition holds for the basket. An amount holds only in its own currency (a basket in another currency is neither above nor below it). */
export function conditionHolds(c: RuleCondition, facts: CheckoutFacts): boolean {
  switch (c.kind) {
    case "country": {
      const inList = c.countries.includes(facts.country);
      return c.op === "is" ? inList : !inList;
    }
    case "total":
      if (c.currency !== facts.currency) return false;
      return c.op === "at_least" ? facts.totalMinor >= c.amountMinor : facts.totalMinor < c.amountMinor;
    case "weight":
      return c.op === "at_least" ? facts.weightGrams >= c.grams : facts.weightGrams < c.grams;
    case "product":
    case "category":
    case "tag":
    case "group": {
      const pool = c.kind === "product" ? facts.productIds : c.kind === "group" ? facts.tierIds : facts.termIds;
      const any = c.ids.some((id) => pool.includes(id));
      return c.op === "has" || c.op === "is" ? any : !any;
    }
  }
}

/** What a rule names that no longer exists: null when everything it names is there. */
function goneIn(rule: CheckoutRule, known: KnownIds): boolean {
  for (const c of rule.conditions) {
    if (c.kind === "product" && c.ids.some((id) => !known.products.has(id))) return true;
    if ((c.kind === "category" || c.kind === "tag") && c.ids.some((id) => !known.terms.has(id))) return true;
    if (c.kind === "group" && c.ids.some((id) => !known.tiers.has(id))) return true;
  }
  const e = rule.effect;
  if (e.kind === "hide_shipping" || e.kind === "order_delivery" || e.kind === "delivery_price") return e.options.some((o) => !known.options.has(o));
  if (e.kind === "rename_shipping") return !known.options.has(e.option);
  if (e.kind === "hide_payment_method") return e.methods.some((m) => !known.methods.has(m));
  return false;
}

/** Whether a stored rule has the shape the evaluator reads; a rule that does not is skipped as unreadable. */
function readable(rule: CheckoutRule): boolean {
  if (!rule || !Array.isArray(rule.conditions) || !rule.effect || typeof rule.effect !== "object") return false;
  if (!(EFFECT_KINDS as readonly string[]).includes(rule.effect.kind)) return false;
  return rule.conditions.every((c) => c && (CONDITION_KINDS as readonly string[]).includes(c.kind));
}

/**
 * The rules' outcome for a basket: each rule in order, skipped when it cannot be read or names something gone, applied when every condition holds.
 * Hidden options and methods add up; the first rename of an option and the first refusal stand. Never throws: a rule that throws is skipped.
 */
export function applyCheckoutRules(rules: readonly CheckoutRule[], facts: CheckoutFacts, known: KnownIds, locale: string): RuleOutcome {
  const hidden = new Set<string>();
  const renamed = new Map<string, string>();
  const methods = new Set<string>();
  let refusal: RuleOutcome["refusal"] = null;
  let order: string[] | null = null;
  const prices = new Map<string, PriceChange>();
  const applied: string[] = [];
  const skipped: RuleOutcome["skipped"] = [];
  for (const rule of rules) {
    try {
      if (!readable(rule)) {
        skipped.push({ ruleId: rule?.id ?? "", reason: "unreadable" });
        continue;
      }
      if (goneIn(rule, known)) {
        skipped.push({ ruleId: rule.id, reason: "gone" });
        continue;
      }
      if (!rule.conditions.every((c) => conditionHolds(c, facts))) continue;
      const e = rule.effect;
      // An amount for another currency does not price this basket: the rule does not apply to it, as a total in another currency never holds.
      const change = e.kind === "delivery_price" ? priceChangeIn(e.price, facts.currency) : null;
      if (e.kind === "delivery_price" && !change) continue;
      if (e.kind === "hide_shipping") for (const o of e.options) hidden.add(o);
      else if (e.kind === "rename_shipping") {
        if (!renamed.has(e.option)) renamed.set(e.option, wordsIn(e.label, locale).slice(0, FIELD_LABEL_MAX));
      } else if (e.kind === "hide_payment_method") {
        for (const m of e.methods) if (m !== ALWAYS_PAID_BY) methods.add(m);
      } else if (e.kind === "order_delivery") {
        if (!order) order = [...new Set(e.options)];
      } else if (e.kind === "delivery_price") {
        for (const o of e.options) if (!prices.has(o)) prices.set(o, change!);
      } else if (!refusal) refusal = { ruleId: rule.id, message: wordsIn(e.message, locale).slice(0, REFUSAL_MAX) };
      applied.push(rule.id);
    } catch {
      skipped.push({ ruleId: rule?.id ?? "", reason: "unreadable" });
    }
  }
  return { hidden, renamed, hiddenMethods: [...methods].sort(), refusal, order, prices, applied, skipped };
}

/** A rule's price for a basket in `currency`: null for an amount the rule names none of in that currency, or a shape it cannot read. */
export function priceChangeIn(price: DeliveryPrice, currency: string): PriceChange | null {
  if (!price || typeof price !== "object") return null;
  if (price.kind === "free") return { kind: "free" };
  if (price.kind === "percent") {
    const p = price.percent;
    return Number.isInteger(p) && p >= DELIVERY_PERCENT_MIN && p <= DELIVERY_PERCENT_MAX ? { kind: "percent", percent: p } : null;
  }
  if (price.kind === "amount") {
    const a = price.amounts?.[currency];
    return Number.isSafeInteger(a) ? { kind: "amount", amountMinor: a } : null;
  }
  return null;
}

/** An amount as a rule prices it: half up for a percentage, never below zero (D402). */
export function pricedBy(amountMinor: number, change: PriceChange): number {
  if (change.kind === "free") return 0;
  if (change.kind === "percent") return Math.max(0, amountMinor + Math.sign(change.percent) * Math.floor((Math.abs(amountMinor * change.percent) + 50) / 100));
  return Math.max(0, amountMinor + change.amountMinor);
}

/** A delivery with a rule's price laid over its rate: the rate's amount priced, its free-over threshold kept, what it costs this basket with it. */
function priced(d: OfferedDelivery, change: PriceChange | undefined): OfferedDelivery {
  if (!change) return d;
  const amountMinor = pricedBy(d.rate.amountMinor, change);
  // Free over a value stays free: the rule prices what the basket would otherwise pay.
  const freeAlready = d.priceMinor === 0 && d.rate.amountMinor > 0;
  return { ...d, rate: { ...d.rate, amountMinor }, priceMinor: freeAlready ? 0 : amountMinor };
}

/** A delivery as a rule renamed it: the label the page and the order show (`renamed`); null where no rule renamed it. */
export type RenamedDelivery = OfferedDelivery & { renamed?: string };

/**
 * An offer with the rules laid over it: hidden options taken out of what ships, the pickup places and local delivery, renamed ones carrying their
 * new label, priced ones their rule's price (D402), and the default the cheapest that is left. Hiding every way to ship leaves the basket with `no_shipping`, as a store with none.
 */
export function rulesOnOffer(offer: DeliveryOffer, outcome: RuleOutcome): DeliveryOffer {
  const prices = outcome.prices ?? new Map<string, PriceChange>();
  if (outcome.hidden.size === 0 && outcome.renamed.size === 0 && !outcome.order && prices.size === 0) return offer;
  const keep = (d: OfferedDelivery) => !outcome.hidden.has(optionKey(d));
  const name = (option: OfferedDelivery): RenamedDelivery => {
    const d = priced(option, prices.get(optionKey(option)));
    const label = outcome.renamed.get(optionKey(d));
    if (!label) return d;
    return d.kind === "method" ? { ...d, label, renamed: label } : { ...d, renamed: label };
  };
  if (offer.status === "none") return offer;
  // A rule that prices options may change which is cheapest: what ships is sorted again as the offer sorts it (price, then the store's position).
  const ship = cheapestFirst(offer.ship.filter(keep).map(name), prices.size > 0);
  const pickups = offer.pickups.filter(keep).map(name);
  const local = offer.local && keep(offer.local) ? name(offer.local) : null;
  return {
    ...offer,
    status: ship.length > 0 ? "ok" : "no_shipping",
    // Ordering moves options on the page only: the default stays the first left in the store's own order (D399), so a rule that orders never
    // chooses another option, or another price, for the shopper.
    ship: orderedBy(ship, outcome.order),
    pickups: orderedBy(pickups, outcome.order),
    local,
    localBelowMinimum: local ? null : offer.localBelowMinimum,
    default: ship[0] ?? null,
  };
}

/** Options cheapest first, then by the store's position and id, as `deliveryOffer()` sorts them; unchanged when nothing was priced. */
function cheapestFirst<T extends OfferedDelivery>(options: T[], repriced: boolean): T[] {
  if (!repriced) return options;
  const position = (d: T) => ("position" in d ? d.position : 0);
  return [...options].sort((a, b) => a.priceMinor - b.priceMinor || position(a) - position(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Options with the ones a rule names first, in its order, and the rest after in their own order (D399). */
export function orderedBy<T extends OfferedDelivery>(options: T[], order: readonly string[] | null): T[] {
  if (!order || order.length === 0) return options;
  const place = (d: T) => {
    const at = order.indexOf(optionKey(d));
    return at === -1 ? order.length : at;
  };
  return options.map((d, i) => ({ d, i })).sort((a, b) => place(a.d) - place(b.d) || a.i - b.i).map(({ d }) => d);
}

/** The label a delivery shows: a rule's new name, else its own. */
export const shownLabel = (d: OfferedDelivery, own: string): string => (d as RenamedDelivery).renamed ?? own;

// Checkout fields

export type CheckoutFieldKind = "text" | "checkbox";

/** A question the shopper answers in the checkout (the store's `checkout_fields`), in the basket's language. */
export type CheckoutField = { id: string; kind: CheckoutFieldKind; required: boolean; label: Words; help: Words | null };

/** A field as the page shows it: words in the basket's language. */
export type ShownField = { id: string; kind: CheckoutFieldKind; required: boolean; label: string; help: string | null };

export const shownField = (f: CheckoutField, locale: string): ShownField => ({
  id: f.id,
  kind: f.kind,
  required: f.required,
  label: wordsIn(f.label, locale),
  help: f.help ? wordsIn(f.help, locale) : null,
});

/** What the order keeps of an answer (`orders.checkout_answers`): the question as it was asked in the store's main words, and the answer. */
export type CheckoutAnswer = { fieldId: string; label: string; kind: CheckoutFieldKind; answer: string | boolean };

/**
 * The shopper's answers checked against the store's fields: a text trimmed to one line of at most `FIELD_ANSWER_MAX`, a box ticked or not, every
 * required one answered (a required box ticked), anything for a field that is not there left out. `missing` names the required fields left empty.
 */
export function cleanAnswers(
  fields: readonly CheckoutField[],
  typed: Record<string, unknown> | null | undefined,
): { answers: CheckoutAnswer[]; missing: string[] } {
  const answers: CheckoutAnswer[] = [];
  const missing: string[] = [];
  for (const f of fields) {
    const raw = typed?.[f.id];
    if (f.kind === "checkbox") {
      const ticked = raw === true || raw === "on" || raw === "true";
      if (f.required && !ticked) missing.push(f.id);
      answers.push({ fieldId: f.id, label: f.label.text, kind: "checkbox", answer: ticked });
      continue;
    }
    const text = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, FIELD_ANSWER_MAX) : "";
    if (!text) {
      if (f.required) missing.push(f.id);
      continue;
    }
    answers.push({ fieldId: f.id, label: f.label.text, kind: "text", answer: text });
  }
  return { answers, missing };
}

/** An answer in words for staff and the export. */
export const answerText = (a: CheckoutAnswer, yes: string, no: string): string => (typeof a.answer === "boolean" ? (a.answer ? yes : no) : a.answer);

/** Reads `orders.checkout_answers` as stored; anything not of the shape is left out. */
export function readAnswers(value: unknown): CheckoutAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v): CheckoutAnswer[] => {
    if (!v || typeof v !== "object") return [];
    const a = v as Record<string, unknown>;
    if (typeof a.fieldId !== "string" || typeof a.label !== "string") return [];
    if (a.kind === "checkbox" && typeof a.answer === "boolean") return [{ fieldId: a.fieldId, label: a.label, kind: "checkbox" as const, answer: a.answer }];
    if (a.kind === "text" && typeof a.answer === "string") return [{ fieldId: a.fieldId, label: a.label, kind: "text" as const, answer: a.answer }];
    return [];
  });
}

/** Answers as kept (on a cart or an order) back to what was typed, by field, for `cleanAnswers()` to check again. */
export function answersByField(value: unknown): Record<string, string | boolean> {
  return Object.fromEntries(readAnswers(value).map((a) => [a.fieldId, a.answer]));
}
