import { e164Phone } from "./phone";
import type { DeliveryOffer, OfferedDelivery } from "./shipping-methods";
import type { Words } from "./words";
import { wordsIn } from "./words";

/** The words type and its reader moved to `words.ts` (D705), shared with forms; kept here for the checkout's importers. */
export { wordsIn, type Words };

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
/** A `textarea` answer's most characters, its lines kept (task 4). */
export const FIELD_LONG_ANSWER_MAX = 2000;
/** The most options a tick list (`checklist`) holds: the EU's 14 allergens and "None of these" fit with room (task 3). */
export const CHECKLIST_OPTIONS_MAX = 30;
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

/**
 * What a question asks (D357, tasks 3 and 4 of `docs/checkout-fields-tasks.md`): `text` one line, `textarea` several lines, `checkbox` one box,
 * `checklist` any number of options, `select` one option from a closed list (drawn with `Dropdown`, D82), `radio` one option, all of them shown,
 * `number` a whole number, `date` a day, `email` an email address and `phone` a phone number, each checked for its shape.
 */
export const CHECKOUT_FIELD_KINDS = ["text", "textarea", "checkbox", "checklist", "select", "radio", "number", "date", "email", "phone"] as const;
export type CheckoutFieldKind = (typeof CHECKOUT_FIELD_KINDS)[number];

/** The kinds that have options to choose from: a tick list (any number), a select and radio buttons (exactly one). */
export const OPTION_KINDS = ["checklist", "select", "radio"] as const satisfies readonly CheckoutFieldKind[];
export const hasOptions = (kind: CheckoutFieldKind): boolean => (OPTION_KINDS as readonly string[]).includes(kind);
/** The kinds answered with one option. */
export const isSingleChoice = (kind: CheckoutFieldKind): boolean => kind === "select" || kind === "radio";
/** The kinds with a lowest and a highest answer (`bounds`): a number's values, a date's days from the store's today. */
export const hasBounds = (kind: CheckoutFieldKind): boolean => kind === "number" || kind === "date";

/**
 * A number's lowest and highest value, or a date's earliest and latest day counted from the store's today (0 is today), each optional (task 4).
 * A number is whole; a date's days are 0 to `DATE_DAYS_MAX`.
 */
export type FieldBounds = { min?: number; max?: number };
export const NUMBER_LIMIT = 1_000_000_000;
export const DATE_DAYS_MAX = 730;

/**
 * One option of a tick list (task 3): its own words per language, and `none` for the option that says none of the others apply (ticking it
 * clears the others). Its `id` is kept with the answer, so renaming an option never changes what an order said.
 */
export type ChecklistOption = { id: string; label: Words; none?: boolean };

/** A question the shopper answers in the checkout (the store's `checkout_fields`), in the basket's language. */
export type CheckoutField = {
  id: string;
  kind: CheckoutFieldKind;
  required: boolean;
  label: Words;
  help: Words | null;
  width?: FieldWidth;
  /** The options of a tick list, a select or radio buttons, in order (tasks 3 and 4); only a tick list has a `none` one. */
  options?: ChecklistOption[];
  /** The answer may be sensitive personal data (GDPR article 9, such as allergies): the shopper ticks an explicit consent with it. */
  sensitive?: boolean;
  /** A number's or a date's lowest and highest answer (task 4). */
  bounds?: FieldBounds;
  /** Asked only when every one holds for the basket, the checkout rules' own conditions (task 4); none: always asked. */
  conditions?: RuleCondition[];
};

/**
 * Whether a question is asked of this basket (task 4): one without conditions always; one with them only when every one holds
 * (`conditionHolds()`, as a checkout rule), and never without a basket's facts to hold them against.
 */
export function fieldAsked(f: Pick<CheckoutField, "conditions">, facts: CheckoutFacts | null): boolean {
  const conditions = f.conditions ?? [];
  if (conditions.length === 0) return true;
  return facts !== null && conditions.every((c) => conditionHolds(c, facts));
}

/**
 * How wide the cart draws a question (task 2): `full` (the default) or `half`. Two halves next to each other share a line, one alone takes its
 * left half, and a narrow box draws all of them full width. Only `half` is kept, never a side.
 */
export const FIELD_WIDTHS = ["full", "half"] as const;
export type FieldWidth = (typeof FIELD_WIDTHS)[number];

/** A field as the page shows it: words in the basket's language. */
export type ShownField = {
  id: string;
  kind: CheckoutFieldKind;
  required: boolean;
  label: string;
  help: string | null;
  width: FieldWidth;
  options: { id: string; label: string; none: boolean }[];
  sensitive: boolean;
  /** A number's lowest and highest value, or a date's earliest and latest day (`YYYY-MM-DD`, from the store's today), for the input's `min` and `max`. */
  min: string | null;
  max: string | null;
};

/**
 * The ids in their new order once `id` is moved to place `to` (0 is first), the others keeping theirs; a place past either end is that end.
 * `null` when `id` is not in the list. Used for questions at checkout (`moveCheckoutField()`), whose order the cart asks them in.
 */
export function movedTo(ids: readonly string[], id: string, to: number): string[] | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  const rest = ids.filter((x) => x !== id);
  const at = Number.isFinite(to) ? Math.min(Math.max(Math.trunc(to), 0), rest.length) : rest.length;
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** `today` (`YYYY-MM-DD`, the store's) resolves a date question's earliest and latest day. */
export function shownField(f: CheckoutField, locale: string, today?: string): ShownField {
  const [min, max] = boundsOf(f, today);
  return {
    id: f.id,
    kind: f.kind,
    required: f.required,
    label: wordsIn(f.label, locale),
    help: f.help ? wordsIn(f.help, locale) : null,
    width: f.width ?? "full",
    options: (f.options ?? []).map((o) => ({ id: o.id, label: wordsIn(o.label, locale), none: o.none === true })),
    sensitive: f.sensitive === true,
    min,
    max,
  };
}

/** A day `n` days after `day` (`YYYY-MM-DD`), counted on the calendar. */
export function daysAfter(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Today's day (`YYYY-MM-DD`) in a time zone. */
export const todayInZone = (timeZone: string, now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(now);

/** A field's lowest and highest answer as the input takes them: a number's values, a date's days from `today` (none without a today). */
function boundsOf(f: Pick<CheckoutField, "kind" | "bounds">, today?: string): [string | null, string | null] {
  const b = f.bounds ?? {};
  if (f.kind === "number") return [b.min === undefined ? null : String(b.min), b.max === undefined ? null : String(b.max)];
  if (f.kind === "date" && today) return [b.min === undefined ? null : daysAfter(today, b.min), b.max === undefined ? null : daysAfter(today, b.max)];
  return [null, null];
}

/** What answers are checked against besides the fields: the store's today (a date's days) and the basket's country (a phone without its code). */
export type AnswerContext = { today?: string; country?: string | null };

/** A real day of the calendar written `YYYY-MM-DD`. */
const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && daysAfter(s, 0) === s;

/** An email address's shape: something, an @, a domain with a dot; no spaces; at most 254 characters. */
const isEmail = (s: string): boolean => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

/**
 * A typed answer to a number, date, email or phone question, made what the order keeps, or `null` when it is not of the question's shape or is
 * out of its bounds: a whole number, a day between its earliest and latest, an email address as typed (trimmed), a phone in international form.
 */
function shapedAnswer(f: CheckoutField, typed: string, ctx: AnswerContext): string | null {
  const [min, max] = boundsOf(f, ctx.today);
  if (f.kind === "number") {
    if (!/^-?\d{1,10}$/.test(typed)) return null;
    const n = Number(typed);
    if (Math.abs(n) > NUMBER_LIMIT || (min !== null && n < Number(min)) || (max !== null && n > Number(max))) return null;
    return String(n);
  }
  if (f.kind === "date") {
    if (!isDay(typed) || (min !== null && typed < min) || (max !== null && typed > max)) return null;
    return typed;
  }
  if (f.kind === "email") return isEmail(typed) ? typed : null;
  return e164Phone(typed, ctx.country ?? null);
}

/** What the order keeps of an answer (`orders.checkout_answers`): the question as it was asked in the store's main words, and the answer. */
/**
 * What the order keeps of an answer: the question as it was asked in the store's main words, and the answer. A tick list keeps the options
 * ticked in the store's main words as they were (`answer`), their ids (`optionIds`, to show the cart again) and whether the shopper gave the
 * explicit consent a sensitive question asks (`consent`).
 */
export type CheckoutAnswer =
  | { fieldId: string; label: string; kind: "text"; answer: string }
  | { fieldId: string; label: string; kind: "checkbox"; answer: boolean }
  | { fieldId: string; label: string; kind: "checklist"; answer: string[]; optionIds: string[]; consent: boolean }
  /** A select's or radio buttons' one option (task 4), in the store's main words as it was, its id, and the consent a sensitive one asks. */
  | { fieldId: string; label: string; kind: "choice"; answer: string; optionId: string; consent: boolean };

/** What a shopper sends for one question: a text, a box, or the option ids chosen (one for a select or radio buttons) and the consent. */
export type AnswerInput = string | boolean | { options: string[]; consent: boolean };

/** The option ids a tick list's answer names, as sent: an array, or `{ options }`; anything else is none. */
function tickedIds(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { options?: unknown }).options) ? (raw as { options: unknown[] }).options : [];
  return [...new Set(list.filter((v): v is string => typeof v === "string"))];
}

/**
 * The shopper's answers checked against the store's fields: a text trimmed to one line of at most `FIELD_ANSWER_MAX` (a `textarea` keeps its
 * lines, at most `FIELD_LONG_ANSWER_MAX`), a box ticked or not, a tick list's options among its own (its `none` option alone when ticked), a select's
 * or radio buttons' one option among its own, every required one answered (a required box ticked, a required list with at least one option), a
 * sensitive list with an option other than `none` (or a sensitive one-choice question with its option) only with the shopper's consent, a
 * number, date, email or phone of its shape and within its bounds (`ctx`: the store's today, the basket's country; one given but wrong stops
 * the order even when optional), anything for a field that is not there left out. `missing` names the fields that stop the order.
 */
export function cleanAnswers(
  fields: readonly CheckoutField[],
  typed: Record<string, unknown> | null | undefined,
  ctx: AnswerContext = {},
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
    if (isSingleChoice(f.kind)) {
      const id = typeof raw === "string" ? raw : tickedIds(raw)[0];
      const chosen = (f.options ?? []).find((o) => !o.none && o.id === id);
      const consent = raw !== null && typeof raw === "object" && !Array.isArray(raw) && (raw as { consent?: unknown }).consent === true;
      if (!chosen) {
        if (f.required) missing.push(f.id);
        continue;
      }
      if (f.sensitive && !consent) {
        missing.push(f.id);
        continue;
      }
      answers.push({ fieldId: f.id, label: f.label.text, kind: "choice", answer: chosen.label.text, optionId: chosen.id, consent: f.sensitive === true });
      continue;
    }
    if (f.kind === "number" || f.kind === "date" || f.kind === "email" || f.kind === "phone") {
      const given = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
      if (!given) {
        if (f.required) missing.push(f.id);
        continue;
      }
      // Given but not of the question's shape: it stops the order, even when the question is optional, so nothing wrong is kept.
      const shaped = shapedAnswer(f, given.slice(0, 254), ctx);
      if (shaped === null) {
        missing.push(f.id);
        continue;
      }
      answers.push({ fieldId: f.id, label: f.label.text, kind: "text", answer: shaped });
      continue;
    }
    if (f.kind === "textarea") {
      const long = typeof raw === "string" ? longText(raw) : "";
      if (!long) {
        if (f.required) missing.push(f.id);
        continue;
      }
      answers.push({ fieldId: f.id, label: f.label.text, kind: "text", answer: long });
      continue;
    }
    if (f.kind === "checklist") {
      const options = f.options ?? [];
      const wanted = new Set(tickedIds(raw));
      const none = options.find((o) => o.none && wanted.has(o.id));
      const ticked = none ? [none] : options.filter((o) => !o.none && wanted.has(o.id));
      const consent = raw !== null && typeof raw === "object" && !Array.isArray(raw) && (raw as { consent?: unknown }).consent === true;
      if (ticked.length === 0) {
        if (f.required) missing.push(f.id);
        continue;
      }
      if (f.sensitive && !none && !consent) {
        missing.push(f.id);
        continue;
      }
      answers.push({ fieldId: f.id, label: f.label.text, kind: "checklist", answer: ticked.map((o) => o.label.text), optionIds: ticked.map((o) => o.id), consent: f.sensitive === true && !none && consent });
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

/** Several lines as a shopper typed them: other control characters and runs of spaces made one space, at most one empty line in a row. */
function longText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, FIELD_LONG_ANSWER_MAX);
}

/** An answer in words for staff and the export: a tick list's options joined. */
export const answerText = (a: CheckoutAnswer, yes: string, no: string): string =>
  a.kind === "checkbox" ? (a.answer ? yes : no) : a.kind === "checklist" ? a.answer.join(", ") : a.answer;

/** Reads `orders.checkout_answers` as stored; anything not of the shape is left out. */
export function readAnswers(value: unknown): CheckoutAnswer[] {
  if (!Array.isArray(value)) return [];
  const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);
  return value.flatMap((v): CheckoutAnswer[] => {
    if (!v || typeof v !== "object") return [];
    const a = v as Record<string, unknown>;
    if (typeof a.fieldId !== "string" || typeof a.label !== "string") return [];
    if (a.kind === "checkbox" && typeof a.answer === "boolean") return [{ fieldId: a.fieldId, label: a.label, kind: "checkbox" as const, answer: a.answer }];
    if (a.kind === "text" && typeof a.answer === "string") return [{ fieldId: a.fieldId, label: a.label, kind: "text" as const, answer: a.answer }];
    const words = strings(a.answer);
    const ids = strings(a.optionIds);
    if (a.kind === "checklist" && words && ids) return [{ fieldId: a.fieldId, label: a.label, kind: "checklist" as const, answer: words, optionIds: ids, consent: a.consent === true }];
    if (a.kind === "choice" && typeof a.answer === "string" && typeof a.optionId === "string")
      return [{ fieldId: a.fieldId, label: a.label, kind: "choice" as const, answer: a.answer, optionId: a.optionId, consent: a.consent === true }];
    return [];
  });
}

/**
 * The answers a packing slip prints (D357, task 3 of `docs/checkout-fields-tasks.md`): all of them, but a gift's slip leaves out those given with the
 * shopper's consent (a sensitive tick list such as allergies, D598), since the person who reads it is not the buyer.
 */
export function slipAnswers(value: unknown, gift: boolean): CheckoutAnswer[] {
  return readAnswers(value).filter((a) => !(gift && (a.kind === "checklist" || a.kind === "choice") && a.consent));
}

/** Answers as kept (on a cart or an order) back to what was typed, by field, for `cleanAnswers()` to check again. */
export function answersByField(value: unknown): Record<string, AnswerInput> {
  return Object.fromEntries(
    readAnswers(value).map((a): [string, AnswerInput] => [
      a.fieldId,
      a.kind === "checklist" ? { options: a.optionIds, consent: a.consent } : a.kind === "choice" ? { options: [a.optionId], consent: a.consent } : a.answer,
    ]),
  );
}
