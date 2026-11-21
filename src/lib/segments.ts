import { countWords, fillWords } from "./admin-fill";
import type { MarketingMessages } from "./admin-messages/marketing.en";
import type { RfmSegment } from "./rfm-segments";
import { SUBSCRIBER_STATUSES, type SubscriberStatus } from "./marketing-consent";
import { tagKey } from "./order-tags";
import type { SmsSubscriberStatus } from "./sms";
import type { Condition, SegmentRules } from "./segments-schema";

export type { Condition, SegmentInput, SegmentRules } from "./segments-schema";

/**
 * Segments (wave 5 unit B, D296, `docs/wave-5-marketing.md` 4): saved rules over a store's people, counted when read. Pure: the rules, their
 * check, whether a person matches and the words for staff. The people are read by `segmentPeople()` (`src/server/segments.ts`).
 */

export const SEGMENTS_MAX = 100;
export const CONDITIONS_MAX = 20;
/** The reader stops here and says so. */
export const SEGMENT_CAP = 100_000;
/** People listed on a segment's page. */
export const SEGMENT_SAMPLE = 100;
export const TAGS_PER_PERSON = 50;
const DAY_MS = 86_400_000;

export type Consent = SubscriberStatus | "none";
export const CONSENTS: readonly Consent[] = [...SUBSCRIBER_STATUSES, "none"];

/** A person's consent to the store's texts (D565): their best number's status (subscribed, then waiting, then the latest), or none. */
export type SmsConsent = SmsSubscriberStatus | "none";
// Written out rather than read from `./sms`, which would bring the phone tables into the rule builder's bundle; the type holds them together.
export const SMS_CONSENTS = ["subscribed", "pending", "unsubscribed", "none"] as const satisfies readonly SmsConsent[];

/** What a segment is about: one email address of the store, with the facts its conditions read. */
export type Person = {
  email: string;
  customerId: string | null;
  name: string;
  account: boolean;
  /** Two-letter language, or null. */
  language: string | null;
  /** The country of the last paid order, else the subscriber row's market; two letters, or null. */
  country: string | null;
  groupId: string | null;
  company: boolean;
  orders: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  /** Net revenue without VAT in the main currency; null when some of it is in a currency with no rate. */
  spentMinor: number | null;
  consent: Consent;
  rfm: RfmSegment | null;
  /** Tag keys. */
  tags: string[];
  /*
   * The facts below (ecosystem plan E3.6, D718) are read only when a rule asks for them (`segmentNeeds()`) and are absent otherwise: a
   * condition on a fact that was not read holds for nobody, as one on money in a currency with no rate does.
   */
  /** Product id → when a paid order with it was last placed (ISO), for the products the rules name; a product not in it was not bought. */
  boughtProducts?: Record<string, string>;
  /** Category id → the same, for the product categories the rules name: a product in the category or in one below it counts. */
  boughtCategories?: Record<string, string>;
  /** Their own deals (D464), while Deals is on: how many are open and how many were won. */
  deals?: { open: number; won: number };
  /** Their support conversations (D216): when the latest had its last message, and whether they rated one bad. */
  support?: { lastAt: string | null; ratedBad: boolean };
  /** The reviews they wrote as buyers (D301), while Product reviews is on: how many, and the fewest stars among them. */
  reviews?: { count: number; lowestStars: number | null };
  /** Their subscriptions (D25) and subscription boxes (D102) running now, each while its feature is on. */
  subscriptions?: number;
  sms?: SmsConsent;
  /** When they last pressed a link in the store's emails (a broadcast's or a flow's, M2.4), within the clicks kept (`CLICK_DAYS`); null for none. */
  lastClickAt?: string | null;
  /** The values of the customer's fields marked for marketing (M2.4), by field id, each as words in lower case (a choice by its key). */
  fields?: Record<string, string[]>;
  /** When a signed-in customer last looked at each of the products the rules name (M2.4), while views are kept (D691), by product id. */
  viewedProducts?: Record<string, string>;
  /** A business customer's lead score out of 100 (M2.8, D865, `leadScore()`); null for someone who buys for no company. */
  leadScore?: number | null;
};

/** How long presses are kept, as `CLICK_DAYS` in `email-clicks.ts` (which this browser-side module cannot import: it signs with node:crypto). */
export const SEGMENT_CLICK_DAYS = 180;

/** The most products, and categories, one condition names. */
export const PRODUCTS_PER_CONDITION = 50;
export const CATEGORIES_PER_CONDITION = 20;

export type ConditionKind = Condition["kind"];

const ageDays = (iso: string | null, today: Date): number | null => (iso ? Math.floor((today.getTime() - new Date(iso).getTime()) / DAY_MS) : null);

/** Whether a fact's day is in the last `days` days at `today` (no `days`: whenever it was). */
const inLast = (iso: string | null | undefined, days: number | undefined, today: Date): boolean => {
  if (!iso) return false;
  if (days === undefined) return true;
  const age = ageDays(iso, today);
  return age !== null && age < days;
};

/** Whether one condition holds for a person, at `today`. A fact that is not known (money in a currency with no rate) holds for no condition. */
export function holds(c: Condition, p: Person, today: Date): boolean {
  switch (c.kind) {
    case "consent":
      return c.statuses.includes(p.consent);
    case "orders":
      return c.op === "atLeast" ? p.orders >= c.value : c.op === "atMost" ? p.orders <= c.value : p.orders === c.value;
    case "spent":
      if (p.spentMinor === null) return false;
      return c.op === "atLeast" ? p.spentMinor >= c.minor : p.spentMinor <= c.minor;
    case "lastOrder": {
      if (c.op === "never") return p.lastOrderAt === null;
      const age = ageDays(p.lastOrderAt, today);
      if (age === null) return false;
      return c.op === "within" ? age < (c.days ?? 0) : age >= (c.days ?? 0);
    }
    case "firstOrder": {
      const age = ageDays(p.firstOrderAt, today);
      if (age === null) return false;
      return c.op === "within" ? age < c.days : age >= c.days;
    }
    case "rfm":
      return p.rfm !== null && c.groups.includes(p.rfm);
    case "country":
      return p.country !== null && c.codes.includes(p.country.toLowerCase());
    case "language":
      return p.language !== null && c.codes.includes(p.language.toLowerCase());
    case "group":
      return p.groupId !== null && c.ids.includes(p.groupId);
    case "company":
      return p.company === c.has;
    case "account":
      return p.account === c.has;
    case "tag": {
      const wanted = c.tags.map(tagKey).filter((k): k is string => k !== null);
      return wanted.some((k) => p.tags.includes(k));
    }
    case "bought":
    case "boughtCategory": {
      const last = c.kind === "bought" ? p.boughtProducts : p.boughtCategories;
      if (!last) return false;
      const ids = c.kind === "bought" ? c.products : c.categories;
      const hit = ids.some((id) => inLast(last[id], c.days, today));
      return c.has ? hit : !hit;
    }
    case "deal":
      if (!p.deals) return false;
      return c.status === "open" ? p.deals.open > 0 : p.deals.won > 0;
    case "support":
      if (!p.support) return false;
      return c.op === "ratedBad" ? p.support.ratedBad : inLast(p.support.lastAt, c.days ?? 0, today);
    case "review":
      if (!p.reviews || p.reviews.count === 0) return false;
      return c.maxStars === undefined || (p.reviews.lowestStars !== null && p.reviews.lowestStars <= c.maxStars);
    case "subscription":
      if (p.subscriptions === undefined) return false;
      return (p.subscriptions > 0) === c.has;
    case "sms":
      return p.sms !== undefined && c.statuses.includes(p.sms);
    case "clicked":
      if (p.lastClickAt === undefined) return false;
      return c.op === "never" ? p.lastClickAt === null : inLast(p.lastClickAt, c.days ?? 0, today);
    case "viewed": {
      if (!p.viewedProducts) return false;
      const seen = c.products.some((id) => inLast(p.viewedProducts?.[id], c.days, today));
      return c.has ? seen : !seen;
    }
    case "field": {
      if (p.fields === undefined) return false;
      const values = p.fields[c.field] ?? [];
      if (c.op === "filled") return values.length > 0;
      if (c.op === "empty") return values.length === 0;
      const hit = values.includes((c.value ?? "").trim().toLowerCase());
      return c.op === "is" ? hit : !hit;
    }
    case "leadScore":
      return typeof p.leadScore === "number" && p.leadScore >= c.min;
  }
}

/** Whether a person is in a segment: every condition (`all`) or one of them (`any`). No conditions: everyone. */
export function matches(rules: SegmentRules, p: Person, today: Date): boolean {
  if (rules.conditions.length === 0) return true;
  return rules.match === "all" ? rules.conditions.every((c) => holds(c, p, today)) : rules.conditions.some((c) => holds(c, p, today));
}

/**
 * What the people reader must read for some rule sets (ecosystem plan E3.6, D718): the customer types, the products and categories the rules
 * name, and each family of facts a condition asks for. Nothing more is read, so a segment of the first twelve conditions costs what it did.
 */
export type SegmentNeeds = {
  rfm: boolean;
  /** The product ids and category ids conditions name, each once. */
  products: string[];
  categories: string[];
  deals: boolean;
  support: boolean;
  reviews: boolean;
  subscriptions: boolean;
  sms: boolean;
  clicks: boolean;
  /** The ids of the customer fields conditions name, each once. */
  fields: string[];
  /** The product ids "looked at" conditions name, each once. */
  viewed: string[];
  leads: boolean;
};

export function segmentNeeds(sets: readonly SegmentRules[]): SegmentNeeds {
  const conditions = sets.flatMap((rules) => rules.conditions);
  const kinds = new Set(conditions.map((c) => c.kind));
  const products = new Set<string>();
  const categories = new Set<string>();
  for (const c of conditions) {
    if (c.kind === "bought") for (const id of c.products) products.add(id);
    if (c.kind === "boughtCategory") for (const id of c.categories) categories.add(id);
  }
  return {
    rfm: kinds.has("rfm"),
    products: [...products],
    categories: [...categories],
    deals: kinds.has("deal"),
    support: kinds.has("support"),
    reviews: kinds.has("review"),
    subscriptions: kinds.has("subscription"),
    sms: kinds.has("sms"),
    clicks: kinds.has("clicked"),
    fields: [...new Set(conditions.flatMap((c) => (c.kind === "field" ? [c.field] : [])))],
    viewed: [...new Set(conditions.flatMap((c) => (c.kind === "viewed" ? c.products : [])))],
    leads: kinds.has("leadScore"),
  };
}

export type SegmentCount = { people: number; subscribed: number; moneyUnknown: number };

/** How many match, how many of them want the store's emails, and how many could not be judged on money (a currency with no rate). */
export function countSegment(rules: SegmentRules, people: readonly Person[], today: Date): SegmentCount {
  const usesMoney = rules.conditions.some((c) => c.kind === "spent");
  let n = 0;
  let subscribed = 0;
  let unknown = 0;
  for (const p of people) {
    if (usesMoney && p.spentMinor === null) unknown += 1;
    if (!matches(rules, p, today)) continue;
    n += 1;
    if (p.consent === "subscribed") subscribed += 1;
  }
  return { people: n, subscribed, moneyUnknown: unknown };
}

const or = (words: readonly string[], w: DescribeWords) => (words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} ${w.or} ${words.at(-1)}`);

/** The sentences a condition is written in (D312 A6): the marketing catalogue's `describe`, English unless given. */
export type DescribeWords = MarketingMessages["describe"];

export type DescribeContext = {
  /** Writes an amount of the main currency. */
  money: (minor: number) => string;
  groupName?: (id: string) => string | undefined;
  countryName?: (code: string) => string;
  /** A product's and a product category's name (ecosystem plan E3.6, D718); without them a condition says how many it names. */
  productName?: (id: string) => string | undefined;
  categoryName?: (id: string) => string | undefined;
  /** A customer field's label (M2.4); without it the condition says "a customer field". */
  fieldLabel?: (id: string) => string | undefined;
  words: DescribeWords;
};

/** The products or categories a condition names, in words: by name where the reader knows them, else how many. */
function namedList(ids: readonly string[], name: ((id: string) => string | undefined) | undefined, gone: string, chosen: { one: string; many: string }, w: DescribeWords): string {
  if (!name) return countWords(ids.length, chosen);
  return or(
    ids.map((id) => {
      const found = name(id);
      return found ? fillWords(w.named, { name: found }) : gone;
    }),
    w,
  );
}

/** A condition in staff's words: *Ordered at least 2 times*. */
export function describeCondition(c: Condition, ctx: DescribeContext): string {
  const w = ctx.words;
  const times = (n: number) => countWords(n, w.times);
  const days = (n: number) => countWords(n, w.days);
  switch (c.kind) {
    case "consent":
      return fillWords(w.consent, { list: or(c.statuses.map((s) => w.consentWords[s]), w) });
    case "orders":
      return fillWords(c.op === "atLeast" ? w.ordersAtLeast : c.op === "atMost" ? w.ordersAtMost : w.ordersExactly, { times: times(c.value) });
    case "spent":
      return fillWords(c.op === "atLeast" ? w.spentAtLeast : w.spentAtMost, { money: ctx.money(c.minor) });
    case "lastOrder":
      return c.op === "never" ? w.neverOrdered : fillWords(c.op === "within" ? w.lastWithin : w.lastBefore, { days: days(c.days ?? 0) });
    case "firstOrder":
      return fillWords(c.op === "within" ? w.firstWithin : w.firstBefore, { days: days(c.days) });
    case "rfm":
      return fillWords(w.rfm, { list: or(c.groups, w) });
    case "country":
      return fillWords(w.country, { list: or(c.codes.map((code) => ctx.countryName?.(code) ?? code.toUpperCase()), w) });
    case "language":
      return fillWords(w.language, { list: or(c.codes.map((code) => code.toUpperCase()), w) });
    case "group":
      return fillWords(w.group, { list: or(c.ids.map((id) => ctx.groupName?.(id) ?? w.goneGroup), w) });
    case "company":
      return c.has ? w.company : w.noCompany;
    case "account":
      return c.has ? w.account : w.noAccount;
    case "tag":
      return fillWords(w.tag, { list: or(c.tags.map((tag) => fillWords(w.quoted, { tag })), w) });
    case "bought": {
      const list = namedList(c.products, ctx.productName, w.goneProduct, w.chosenProducts, w);
      const template = c.has ? (c.days === undefined ? w.boughtAny : w.boughtWithin) : c.days === undefined ? w.boughtNot : w.boughtNotWithin;
      return fillWords(template, { list, days: days(c.days ?? 0) });
    }
    case "boughtCategory": {
      const list = namedList(c.categories, ctx.categoryName, w.goneCategory, w.chosenCategories, w);
      const template = c.has ? (c.days === undefined ? w.fromAny : w.fromWithin) : c.days === undefined ? w.fromNot : w.fromNotWithin;
      return fillWords(template, { list, days: days(c.days ?? 0) });
    }
    case "deal":
      return c.status === "open" ? w.dealOpen : w.dealWon;
    case "support":
      return c.op === "ratedBad" ? w.supportBad : fillWords(w.supportWithin, { days: days(c.days ?? 0) });
    case "review":
      return c.maxStars === undefined ? w.reviewAny : fillWords(w.reviewAtMost, { stars: countWords(c.maxStars, w.stars) });
    case "subscription":
      return c.has ? w.subscription : w.noSubscription;
    case "sms":
      return fillWords(w.sms, { list: or(c.statuses.map((s) => w.smsWords[s]), w) });
    case "clicked":
      return c.op === "never" ? fillWords(w.clickedNever, { days: days(SEGMENT_CLICK_DAYS) }) : fillWords(w.clickedWithin, { days: days(c.days ?? 0) });
    case "viewed": {
      const list = namedList(c.products, ctx.productName, w.goneProduct, w.chosenProducts, w);
      const template = c.has ? (c.days === undefined ? w.viewedAny : w.viewedWithin) : c.days === undefined ? w.viewedNot : w.viewedNotWithin;
      return fillWords(template, { list, days: days(c.days ?? 0) });
    }
    case "field": {
      const field = ctx.fieldLabel?.(c.field) ?? w.aField;
      const template = { is: w.fieldIs, isNot: w.fieldIsNot, filled: w.fieldFilled, empty: w.fieldEmpty }[c.op];
      return fillWords(template, { field, value: c.value ?? "" });
    }
    case "leadScore":
      return fillWords(w.leadScoreAtLeast, { n: c.min });
  }
}

/** The rules as one line: the conditions joined by "and" or "or"; *Everyone* without any. */
export function describeRules(rules: SegmentRules, ctx: DescribeContext): string {
  const w = ctx.words;
  if (rules.conditions.length === 0) return w.everyone;
  return rules.conditions.map((c) => describeCondition(c, ctx)).join(rules.match === "all" ? w.andJoin : w.orJoin);
}

/** Ready rule sets offered by *New segment*; each is a normal segment once saved. */
export const SEGMENT_STARTERS: readonly { key: string; name: string; line: string; rules: SegmentRules }[] = [
  { key: "subscribers", name: "People who want your emails", line: "Everyone on your subscriber list.", rules: { match: "all", conditions: [{ kind: "consent", statuses: ["subscribed"] }] } },
  { key: "vip", name: "Your best customers", line: "Recent, frequent and big spenders.", rules: { match: "all", conditions: [{ kind: "rfm", groups: ["VIP", "Loyal"] }] } },
  { key: "at-risk", name: "Good customers gone quiet", line: "They bought often or a lot, but not lately.", rules: { match: "all", conditions: [{ kind: "rfm", groups: ["At risk"] }] } },
  { key: "one-order", name: "Ordered once", line: "Customers who have not come back yet.", rules: { match: "all", conditions: [{ kind: "orders", op: "exactly", value: 1 }] } },
  { key: "lapsed", name: "No order in six months", line: "Customers whose last order is more than 180 days old.", rules: { match: "all", conditions: [{ kind: "lastOrder", op: "before", days: 180 }] } },
  {
    key: "never-bought",
    name: "Subscribed but never bought",
    line: "On your list, with no order yet.",
    rules: { match: "all", conditions: [{ kind: "consent", statuses: ["subscribed"] }, { kind: "lastOrder", op: "never" }] },
  },
];

/** A fresh condition of a kind, as the rule builder adds one. */
export function newCondition(kind: ConditionKind): Condition {
  switch (kind) {
    case "consent":
      return { kind, statuses: ["subscribed"] };
    case "orders":
      return { kind, op: "atLeast", value: 1 };
    case "spent":
      return { kind, op: "atLeast", minor: 100_000 };
    case "lastOrder":
      return { kind, op: "within", days: 30 };
    case "firstOrder":
      return { kind, op: "within", days: 30 };
    case "rfm":
      return { kind, groups: ["VIP"] };
    case "country":
      return { kind, codes: ["no"] };
    case "language":
      return { kind, codes: ["nb"] };
    case "group":
      return { kind, ids: [] };
    case "company":
      return { kind, has: true };
    case "account":
      return { kind, has: true };
    case "tag":
      return { kind, tags: [""] };
    case "bought":
      return { kind, has: true, products: [] };
    case "boughtCategory":
      return { kind, has: true, categories: [] };
    case "deal":
      return { kind, status: "open" };
    case "support":
      return { kind, op: "within", days: 30 };
    case "review":
      return { kind };
    case "subscription":
      return { kind, has: true };
    case "sms":
      return { kind, statuses: ["subscribed"] };
    case "clicked":
      return { kind, op: "within", days: 90 };
    case "viewed":
      return { kind, has: true, products: [], days: 7 };
    case "field":
      return { kind, field: "", op: "filled" };
    case "leadScore":
      return { kind, min: 25 };
  }
}

export const CONDITION_KIND_WORDS: Record<ConditionKind, string> = {
  consent: "Email consent",
  orders: "Number of orders",
  spent: "Money spent",
  lastOrder: "Last order",
  firstOrder: "First order",
  rfm: "Customer type",
  country: "Country",
  language: "Language",
  group: "Customer group",
  company: "Company account",
  account: "Account",
  tag: "Tag",
  bought: "Bought a product",
  boughtCategory: "Bought from a category",
  deal: "Deals",
  support: "Support",
  review: "Reviews",
  subscription: "Subscription",
  sms: "Text consent",
  clicked: "Email engagement",
  field: "Customer field",
  viewed: "Looked at a product",
  leadScore: "Lead score",
};

/**
 * The rule builder's list of conditions in groups (ecosystem plan E3.6, D718), in the order Homer looks for them: what they bought, how they
 * order, who they are, how they may be reached, and how they deal with the store.
 */
export const CONDITION_GROUPS: readonly { id: "bought" | "orders" | "who" | "reach" | "talks"; kinds: readonly ConditionKind[] }[] = [
  { id: "bought", kinds: ["bought", "boughtCategory", "viewed", "subscription"] },
  { id: "orders", kinds: ["orders", "spent", "lastOrder", "firstOrder", "rfm"] },
  { id: "who", kinds: ["country", "language", "group", "company", "account", "tag", "field"] },
  { id: "reach", kinds: ["consent", "clicked", "sms"] },
  { id: "talks", kinds: ["deal", "leadScore", "support", "review"] },
];

/** What a store has switched on or set up, for which conditions the rule builder offers (a condition behind a feature only while it is on). */
/** A customer's field marked for marketing (M2.4), as the rule builder offers it: its id, label, type and choices. */
export type SegmentField = { id: string; label: string; type: string; choices: { key: string; label: string }[] };

export type ConditionOffer = { rfmReady: boolean; deals: boolean; reviews: boolean; subscriptions: boolean; sms: boolean; fields?: boolean; views?: boolean; leads?: boolean };

export function conditionOffered(kind: ConditionKind, offer: ConditionOffer): boolean {
  switch (kind) {
    case "rfm":
      return offer.rfmReady;
    case "deal":
      return offer.deals;
    case "review":
      return offer.reviews;
    case "subscription":
      return offer.subscriptions;
    case "sms":
      return offer.sms;
    case "field":
      return offer.fields === true;
    case "viewed":
      return offer.views === true;
    case "leadScore":
      return offer.leads === true;
    default:
      return true;
  }
}
