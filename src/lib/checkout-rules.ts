import type { DeliveryOffer, OfferedDelivery } from "./shipping-methods";

/**
 * Checkout rules and fields (wave 9 unit D, D357, `docs/wave-9-platform.md` section 3, D): the pure parts, free of zod so the cart (a pay route)
 * can import them. A rule is a list of conditions on the basket (all must hold) and one effect: hide shipping options, rename one, hide payment
 * methods, or refuse the basket with the owner's words. `applyCheckoutRules()` is the one evaluator: `cartSummary()` and `placeOrder()` both reach
 * it through the server's `checkoutRuleOutcome()`, so they agree. A rule never changes a price, VAT or a legal page. A rule that names something
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
  | { kind: "refuse"; message: Words };

export const EFFECT_KINDS = ["hide_shipping", "rename_shipping", "hide_payment_method", "refuse"] as const;

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
  /** The rules whose conditions held and whose effect counts. */
  applied: string[];
  /** The rules left out, and why. */
  skipped: { ruleId: string; reason: SkipReason }[];
};

export const NO_RULES: RuleOutcome = { hidden: new Set(), renamed: new Map(), hiddenMethods: [], refusal: null, applied: [], skipped: [] };

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
  if (e.kind === "hide_shipping") return e.options.some((o) => !known.options.has(o));
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
      if (e.kind === "hide_shipping") for (const o of e.options) hidden.add(o);
      else if (e.kind === "rename_shipping") {
        if (!renamed.has(e.option)) renamed.set(e.option, wordsIn(e.label, locale).slice(0, FIELD_LABEL_MAX));
      } else if (e.kind === "hide_payment_method") {
        for (const m of e.methods) if (m !== ALWAYS_PAID_BY) methods.add(m);
      } else if (!refusal) refusal = { ruleId: rule.id, message: wordsIn(e.message, locale).slice(0, REFUSAL_MAX) };
      applied.push(rule.id);
    } catch {
      skipped.push({ ruleId: rule?.id ?? "", reason: "unreadable" });
    }
  }
  return { hidden, renamed, hiddenMethods: [...methods].sort(), refusal, applied, skipped };
}

/** A delivery as a rule renamed it: the label the page and the order show (`renamed`); null where no rule renamed it. */
export type RenamedDelivery = OfferedDelivery & { renamed?: string };

/**
 * An offer with the rules laid over it: hidden options taken out of what ships, the pickup places and local delivery, renamed ones carrying their
 * new label, and the default the cheapest that is left. Hiding every way to ship leaves the basket with `no_shipping`, as a store with none.
 */
export function rulesOnOffer(offer: DeliveryOffer, outcome: RuleOutcome): DeliveryOffer {
  if (outcome.hidden.size === 0 && outcome.renamed.size === 0) return offer;
  const keep = (d: OfferedDelivery) => !outcome.hidden.has(optionKey(d));
  const name = (d: OfferedDelivery): RenamedDelivery => {
    const label = outcome.renamed.get(optionKey(d));
    if (!label) return d;
    return d.kind === "method" ? { ...d, label, renamed: label } : { ...d, renamed: label };
  };
  if (offer.status === "none") return offer;
  const ship = offer.ship.filter(keep).map(name);
  const pickups = offer.pickups.filter(keep).map(name);
  const local = offer.local && keep(offer.local) ? name(offer.local) : null;
  return {
    ...offer,
    status: ship.length > 0 ? "ok" : "no_shipping",
    ship,
    pickups,
    local,
    localBelowMinimum: local ? null : offer.localBelowMinimum,
    default: ship[0] ?? null,
  };
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
