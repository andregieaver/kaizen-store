/**
 * Store features (D178, `docs/store-features.md`), pure: what a store can switch on or off so an owner sees only what they use. The master
 * switch is the online shop (`shop`; off, the store is a website); the others are grouped as the Features page shows them. A store keeps the
 * features it switched on in `stores.features`; what is *on* is the effective value: the feature is kept on and everything it needs is too
 * (`featureOn()`), so a feature's own switch is remembered while the shop is off. The database repeats the needs (`commerce.feature_needs()`,
 * `commerce.feature_on()`), and a test holds the two together.
 *
 * A new feature is an entry here (its needs transitively complete, a test fails otherwise), the `stores_features` check and
 * `commerce.feature_needs()` in a migration, its blockers and warnings in `featureBlockers()`/`featureWarnings()` with a count in
 * `FeatureFacts`, and `feature` tags on its navigation items and `ADMIN_PAGES` entries (and `TOOL_FEATURES` for its AI manager tools).
 */

export const FEATURE_IDS = [
  "shop",
  "subscriptions",
  "boxes",
  "appointments",
  "bookings",
  "countries",
  "languages",
  "currencies",
  "business",
  "bonus",
  "referrals",
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export const isFeatureId = (value: unknown): value is FeatureId => (FEATURE_IDS as readonly unknown[]).includes(value);

export type FeatureGroupId = "selling" | "world" | "customers";

export const FEATURE_GROUPS: { id: FeatureGroupId; label: string }[] = [
  { id: "selling", label: "Selling" },
  { id: "world", label: "Countries and languages" },
  { id: "customers", label: "Customers" },
];

export type StoreFeature = {
  id: FeatureId;
  /** The card it is drawn in on the Features page; null for the online shop, which has a card of its own. */
  group: FeatureGroupId | null;
  label: string;
  /** One line on what it is, for the Features page. */
  words: string;
  /** What disappears when it is switched off, for the confirmation. */
  offWords: string;
  /** Features that must be on for it to work, transitively complete (a test holds it). */
  needs: readonly FeatureId[];
  /** Where it is set up, after the store's admin address. */
  setupPath: string;
  /** The module of `stores.modules` code from before D178 reads (kept in step by the database). */
  legacyModule?: "bookings" | "deliveries";
};

export const STORE_FEATURES: readonly StoreFeature[] = [
  {
    id: "shop",
    group: null,
    label: "Online shop",
    words: "Sell online: products with prices, a cart, checkout and orders. Off, the store is a website.",
    offWords: "Prices, the cart and checkout leave the site, and so does every selling feature below. Orders, invoices and customers stay in the admin.",
    needs: [],
    setupPath: "/products",
  },
  {
    id: "subscriptions",
    group: "selling",
    label: "Subscriptions",
    words: "Products bought on a schedule, every week, month or year, with a discount for subscribing.",
    offWords: "Subscribing leaves product pages, and Subscriptions leaves the admin. Past subscriptions stay on their orders.",
    needs: ["shop"],
    setupPath: "/subscriptions",
  },
  {
    id: "boxes",
    group: "selling",
    label: "Subscription boxes",
    words: "Customers keep a list of what they want in a box, delivered on your delivery days.",
    offWords: "Subscription boxes leave the admin, My account and product pages. Delivery days and past orders are kept.",
    needs: ["shop"],
    setupPath: "/deliveries",
    legacyModule: "deliveries",
  },
  {
    id: "appointments",
    group: "selling",
    label: "Appointments",
    words: "Sell time with your staff, such as treatments, consultations or lessons, booked on the product page.",
    offWords: "Appointments can no longer be booked, and Staff and hours leaves the admin. Past bookings stay on their orders.",
    needs: ["shop"],
    setupPath: "/bookings/staff",
    legacyModule: "bookings",
  },
  {
    id: "bookings",
    group: "selling",
    label: "Stays and rentals",
    words: "Rooms, homes and items booked by the night, day or hour, and outside hosts who list them in your store.",
    offWords: "Stays and rentals can no longer be booked, and Rooms and items, Stays and rentals and Hosts leave the admin. Past bookings stay on their orders.",
    needs: ["shop"],
    setupPath: "/bookings/units",
    legacyModule: "bookings",
  },
  {
    id: "countries",
    group: "world",
    label: "Several countries",
    words: "Sell in more countries than your own, each with its own prices, shipping and address.",
    offWords: "Only your own country is offered. The other countries' prices and settings are kept for when you switch it on again.",
    needs: [],
    setupPath: "/setup/countries",
  },
  {
    id: "languages",
    group: "world",
    label: "Several languages",
    words: "Show the store in more than one language, with translations of products, pages and emails.",
    offWords: "The store is shown in its main language only. Translations are kept for when you switch it on again.",
    needs: [],
    setupPath: "/settings/localization",
  },
  {
    id: "currencies",
    group: "world",
    label: "Several currencies",
    words: "Let shoppers see prices in other currencies, converted at your exchange rates.",
    offWords: "Shoppers see prices in each country's own currency. Your extra currencies and rates are kept.",
    needs: ["shop"],
    setupPath: "/settings/localization",
  },
  {
    id: "business",
    group: "customers",
    label: "Sell to businesses",
    words: "Prices without VAT for businesses, company accounts, VAT numbers at checkout and products for businesses only.",
    offWords: "Businesses buy as private shoppers do, with VAT, and products for businesses only are hidden; Companies leaves the admin. Company accounts and past orders are kept.",
    needs: ["shop"],
    setupPath: "/settings/company",
  },
  {
    id: "bonus",
    group: "customers",
    label: "Bonus program",
    words: "Customers earn credits on what they pay and use them as a price reduction.",
    offWords: "Customers stop earning and using credits, and Bonus credits leaves the admin. Their credits are kept, and do not expire, until you switch it on again.",
    needs: ["shop"],
    setupPath: "/bonus",
  },
  {
    id: "referrals",
    group: "customers",
    label: "Referral program",
    words: "Customers share a link; a friend gets a welcome discount and the customer earns bonus credits. Needs the bonus program.",
    offWords: "Referral links stop giving discounts and new orders earn no rewards, and Referral program leaves the admin. Orders already placed are still rewarded; referrers and their history are kept.",
    needs: ["shop", "bonus"],
    setupPath: "/affiliates",
  },
];

export const FEATURES_BY_ID: Record<FeatureId, StoreFeature> = Object.fromEntries(STORE_FEATURES.map((f) => [f.id, f])) as Record<FeatureId, StoreFeature>;

/** The features that count on the Features page ("N of 10 on"): every one but the shop's own switch. */
export const COUNTED_FEATURES: readonly FeatureId[] = FEATURE_IDS.filter((id) => id !== "shop");

/** What a new store starts with: the shop, nothing else (D178). */
export const NEW_STORE_FEATURES: readonly FeatureId[] = ["shop"];

/** The features a store has kept on, from a store, a `features` field or a list. Unknown names are dropped. */
export type FeatureSource = { features: readonly string[] } | readonly string[];

const storedOf = (source: FeatureSource): ReadonlySet<string> => new Set(Array.isArray(source) ? source : (source as { features: readonly string[] }).features);

/** Whether the owner keeps a feature switched on, whatever it needs (its own switch, remembered while the shop is off). */
export const featureKept = (source: FeatureSource, id: FeatureId): boolean => storedOf(source).has(id);

/** Whether a feature is on: kept on, and everything it needs kept on too. */
export function featureOn(source: FeatureSource, id: FeatureId): boolean {
  const stored = storedOf(source);
  return stored.has(id) && FEATURES_BY_ID[id].needs.every((need) => stored.has(need));
}

/** Every feature that is on, in the registry's order. */
export function effectiveFeatures(source: FeatureSource): FeatureId[] {
  return FEATURE_IDS.filter((id) => featureOn(source, id));
}

/** The kept-on features, cleaned (known ids only, in the registry's order): what is written to `stores.features`. */
export function normaliseFeatures(stored: readonly string[]): FeatureId[] {
  const set = new Set(stored);
  return FEATURE_IDS.filter((id) => set.has(id));
}

/** A page or a tool may stand behind one feature or several (any of them on is enough: the calendar is for appointments and stays). */
export type FeatureRequirement = FeatureId | readonly FeatureId[];

/** Whether a requirement is met by these features (effective ones, from `effectiveFeatures()`, or a store). */
export function requirementMet(source: FeatureSource, requirement: FeatureRequirement | undefined): boolean {
  if (requirement === undefined) return true;
  const ids: readonly FeatureId[] = typeof requirement === "string" ? [requirement] : requirement;
  return ids.some((id) => featureOn(source, id));
}

/** The words for a requirement: "Appointments or Stays and rentals". */
export function requirementLabel(requirement: FeatureRequirement): string {
  const ids: readonly FeatureId[] = typeof requirement === "string" ? [requirement] : requirement;
  return ids.map((id) => FEATURES_BY_ID[id].label).join(" or ");
}

/** The features that need this one (directly or not): switching it off puts them to sleep. */
export const dependentsOf = (id: FeatureId): FeatureId[] => FEATURE_IDS.filter((other) => FEATURES_BY_ID[other].needs.includes(id));

/** The features of a group, in order. */
export const featuresIn = (group: FeatureGroupId): StoreFeature[] => STORE_FEATURES.filter((f) => f.group === group);

/** How many of the counted features are on, of how many. */
export function featureCount(source: FeatureSource): { on: number; total: number } {
  return { on: COUNTED_FEATURES.filter((id) => featureOn(source, id)).length, total: COUNTED_FEATURES.length };
}

/** Whether a feature can be switched on now: what it needs that is off, by label (empty: it can). */
export function missingNeeds(source: FeatureSource, id: FeatureId): FeatureId[] {
  return FEATURES_BY_ID[id].needs.filter((need) => !featureOn(source, need));
}

// ---------------------------------------------------------------------------
// What stands in the way of switching a feature off, and what is worth a warning
// ---------------------------------------------------------------------------

/** Counts the database gives (`featureFacts()` in `src/server/store-features.ts`), all of the store, now. */
export type FeatureFacts = {
  /** Paid orders with goods still to send (real payments). */
  paidUnshipped: number;
  /** Orders waiting for payment. */
  openCheckouts: number;
  /** Subscriptions customers still have running (active, past due or paused), and those in a country other than the store's own. */
  runningSubscriptions: number;
  foreignSubscriptions: number;
  /** Products with purchase options (selling plans). */
  subscriptionProducts: number;
  /** Subscription box lists that are active or paused, and those in another country. */
  runningBoxes: number;
  foreignBoxes: number;
  /** Subscription box orders waiting for payment (made at a cutoff, charged when sent). */
  boxOrdersUnpaid: number;
  /** Delivery days set up. */
  deliverySchedules: number;
  /** Appointments to come (held or confirmed). */
  futureAppointments: number;
  appointmentProducts: number;
  staff: number;
  /** Stays and rentals to come, and hosts' commissions not yet paid out. */
  futureStays: number;
  unpaidHostCommissions: number;
  stayProducts: number;
  units: number;
  hosts: number;
  /** Active countries besides the store's own. */
  otherCountries: number;
  /** Languages besides the main one. */
  otherLanguages: number;
  /** Currencies offered besides the countries' own. */
  extraCurrencies: number;
  /** Open carts that hold a VAT number, products for businesses only, company accounts. */
  businessCarts: number;
  businessProducts: number;
  companies: number;
  /** The bonus program: whether its rules are switched on, customers holding credits and what they hold (in the program's currency). */
  bonusEnabled: boolean;
  creditHolders: number;
  creditsMinor: number;
  creditsCurrency: string | null;
  /** The referral program: whether its rules are on, referrers, and friends' orders whose reward is still pending. */
  referralsEnabled: boolean;
  referrers: number;
  pendingReferrals: number;
};

export const NO_FACTS: FeatureFacts = {
  paidUnshipped: 0,
  openCheckouts: 0,
  runningSubscriptions: 0,
  foreignSubscriptions: 0,
  subscriptionProducts: 0,
  runningBoxes: 0,
  foreignBoxes: 0,
  boxOrdersUnpaid: 0,
  deliverySchedules: 0,
  futureAppointments: 0,
  appointmentProducts: 0,
  staff: 0,
  futureStays: 0,
  unpaidHostCommissions: 0,
  stayProducts: 0,
  units: 0,
  hosts: 0,
  otherCountries: 0,
  otherLanguages: 0,
  extraCurrencies: 0,
  businessCarts: 0,
  businessProducts: 0,
  companies: 0,
  bonusEnabled: false,
  creditHolders: 0,
  creditsMinor: 0,
  creditsCurrency: null,
  referralsEnabled: false,
  referrers: 0,
  pendingReferrals: 0,
};

/** A reason a feature cannot be switched off, with the admin page (after the store's address) where it is dealt with. */
export type FeatureBlocker = { text: string; path: string };

const many = (count: number, one: string, other: string) => `${count} ${count === 1 ? one : other}`;
const them = (count: number) => (count === 1 ? "it" : "them");

function subscriptionBlockers(f: FeatureFacts): FeatureBlocker[] {
  return f.runningSubscriptions > 0
    ? [{ text: `${many(f.runningSubscriptions, "subscription is", "subscriptions are")} still running. Cancel ${them(f.runningSubscriptions)} first.`, path: "/subscriptions" }]
    : [];
}

function boxBlockers(f: FeatureFacts): FeatureBlocker[] {
  const out: FeatureBlocker[] = [];
  if (f.runningBoxes > 0) out.push({ text: `${many(f.runningBoxes, "subscription box list is", "subscription box lists are")} still active or paused. Cancel ${them(f.runningBoxes)} first.`, path: "/deliveries" });
  if (f.boxOrdersUnpaid > 0) out.push({ text: `${many(f.boxOrdersUnpaid, "subscription box order is", "subscription box orders are")} waiting to be sent and paid. Send or cancel ${them(f.boxOrdersUnpaid)} first.`, path: "/orders" });
  return out;
}

function appointmentBlockers(f: FeatureFacts): FeatureBlocker[] {
  return f.futureAppointments > 0
    ? [{ text: `${many(f.futureAppointments, "appointment is", "appointments are")} still to come. Cancel ${them(f.futureAppointments)} first, or wait until they have taken place.`, path: "/bookings" }]
    : [];
}

function stayBlockers(f: FeatureFacts): FeatureBlocker[] {
  const out: FeatureBlocker[] = [];
  if (f.futureStays > 0) out.push({ text: `${many(f.futureStays, "stay or rental is", "stays and rentals are")} still to come. Cancel ${them(f.futureStays)} first, or wait until they are over.`, path: "/bookings/stays" });
  if (f.unpaidHostCommissions > 0) out.push({ text: `${many(f.unpaidHostCommissions, "host's commission is", "hosts' commissions are")} not paid out yet. Wait until ${f.unpaidHostCommissions === 1 ? "it is" : "they are"} settled.`, path: "/hosts" });
  return out;
}

/**
 * What stops a feature being switched off: customers who would be hit (running subscriptions and box lists, bookings to come, goods paid
 * for and not sent). Empty: nothing stands in the way. Bonus, referrals, business, currencies and languages are never blocked, only warned of.
 */
export function featureBlockers(id: FeatureId, f: FeatureFacts): FeatureBlocker[] {
  switch (id) {
    case "shop": {
      const out: FeatureBlocker[] = [];
      if (f.paidUnshipped > 0) out.push({ text: `${many(f.paidUnshipped, "paid order has", "paid orders have")} goods still to send. Send or refund ${them(f.paidUnshipped)} first.`, path: "/orders" });
      return [...out, ...subscriptionBlockers(f), ...boxBlockers(f), ...appointmentBlockers(f), ...stayBlockers(f)];
    }
    case "subscriptions":
      return subscriptionBlockers(f);
    case "boxes":
      return boxBlockers(f);
    case "appointments":
      return appointmentBlockers(f);
    case "bookings":
      return stayBlockers(f);
    case "countries": {
      const out: FeatureBlocker[] = [];
      if (f.foreignSubscriptions > 0) out.push({ text: `${many(f.foreignSubscriptions, "subscription runs", "subscriptions run")} in another country. Cancel ${them(f.foreignSubscriptions)} first.`, path: "/subscriptions" });
      if (f.foreignBoxes > 0) out.push({ text: `${many(f.foreignBoxes, "subscription box list is", "subscription box lists are")} for another country. Cancel ${them(f.foreignBoxes)} first.`, path: "/deliveries" });
      return out;
    }
    default:
      return [];
  }
}

/** What is worth knowing before switching a feature off, which the owner confirms; empty: nothing more than the feature's own words. */
export function featureWarnings(id: FeatureId, f: FeatureFacts, features: FeatureSource, formatMoney: (minor: number, currency: string) => string): string[] {
  const out: string[] = [];
  // What needs it and is on now goes to sleep with it; its own switch is kept.
  const asleep = dependentsOf(id).filter((dep) => featureOn(features, dep));
  switch (id) {
    case "shop":
      if (f.openCheckouts > 0) out.push(`${many(f.openCheckouts, "order is", "orders are")} waiting for payment. Customers can still pay ${them(f.openCheckouts)}.`);
      break;
    case "subscriptions":
      if (f.subscriptionProducts > 0) out.push(`${many(f.subscriptionProducts, "product has", "products have")} purchase options. They are kept, but not offered.`);
      break;
    case "boxes":
      if (f.deliverySchedules > 0) out.push(`${many(f.deliverySchedules, "delivery day is", "delivery days are")} kept, but not offered.`);
      break;
    case "appointments":
      if (f.appointmentProducts > 0) out.push(`${many(f.appointmentProducts, "appointment product", "appointment products")} can no longer be booked.`);
      break;
    case "bookings":
      if (f.stayProducts > 0) out.push(`${many(f.stayProducts, "stay or rental product", "stay and rental products")} can no longer be booked.`);
      if (f.hosts > 0) out.push(`${many(f.hosts, "host", "hosts")} can no longer list stays and rentals in the store.`);
      break;
    case "countries":
      if (f.otherCountries > 0) out.push(`${many(f.otherCountries, "country besides your own is", "countries besides your own are")} no longer offered to shoppers.`);
      break;
    case "languages":
      if (f.otherLanguages > 0) out.push(`${many(f.otherLanguages, "language besides the main one is", "languages besides the main one are")} no longer shown. Translations are kept.`);
      break;
    case "currencies":
      if (f.extraCurrencies > 0) out.push(`${many(f.extraCurrencies, "extra currency is", "extra currencies are")} no longer offered. Open carts are shown in their country's own currency.`);
      break;
    case "business":
      if (f.businessCarts > 0) out.push(`${many(f.businessCarts, "open cart holds", "open carts hold")} a VAT number that will no longer be used.`);
      if (f.businessProducts > 0) out.push(`${many(f.businessProducts, "product is", "products are")} for businesses only.`);
      if (f.companies > 0) out.push(`${many(f.companies, "company account", "company accounts")} no longer ${f.companies === 1 ? "gets" : "get"} a discount.`);
      break;
    case "bonus":
      if (f.creditHolders > 0 && f.creditsCurrency) {
        out.push(`${many(f.creditHolders, "customer holds", "customers hold")} ${formatMoney(f.creditsMinor, f.creditsCurrency)} in credits. They can't use them while the program is off; nothing is taken away, and expiry dates that pass meanwhile are moved on by as long as it was off.`);
      }
      break;
    case "referrals":
      if (f.referrers > 0) out.push(`${many(f.referrers, "customer has", "customers have")} a referral link that stops giving discounts.`);
      if (f.pendingReferrals > 0) out.push(`${many(f.pendingReferrals, "reward is", "rewards are")} still pending: ${f.pendingReferrals === 1 ? "it was" : "they were"} earned while the program was on, so ${f.pendingReferrals === 1 ? "it is" : "they are"} decided as usual.`);
      break;
  }
  if (asleep.length > 0) {
    const labels = asleep.map((dep) => FEATURES_BY_ID[dep].label);
    out.push(`${labels.join(", ")} ${asleep.length === 1 ? "needs" : "need"} it, so ${asleep.length === 1 ? "it stops" : "they stop"} too. ${asleep.length === 1 ? "Its" : "Their"} own switch is kept for when you switch it on again.`);
  }
  return out;
}

/** Whether there is data for a feature (the Features page's "In use"). */
export function featureInUse(id: FeatureId, f: FeatureFacts): boolean {
  switch (id) {
    case "shop":
      return true;
    case "subscriptions":
      return f.subscriptionProducts > 0 || f.runningSubscriptions > 0;
    case "boxes":
      return f.deliverySchedules > 0 || f.runningBoxes > 0;
    case "appointments":
      return f.appointmentProducts > 0 || f.staff > 0 || f.futureAppointments > 0;
    case "bookings":
      return f.stayProducts > 0 || f.units > 0 || f.hosts > 0 || f.futureStays > 0;
    case "countries":
      return f.otherCountries > 0;
    case "languages":
      return f.otherLanguages > 0;
    case "currencies":
      return f.extraCurrencies > 0;
    case "business":
      return f.businessProducts > 0 || f.companies > 0 || f.businessCarts > 0;
    case "bonus":
      return f.bonusEnabled || f.creditHolders > 0;
    case "referrals":
      return f.referralsEnabled || f.referrers > 0;
  }
}

// ---------------------------------------------------------------------------
// The Features page's rows
// ---------------------------------------------------------------------------

/** A feature as the Features page draws it (serializable: handed from the server page to its view). */
export type FeatureRow = {
  id: FeatureId;
  label: string;
  words: string;
  offWords: string;
  /** Its own switch, as kept. */
  kept: boolean;
  /** On: kept, with everything it needs. */
  on: boolean;
  /** There is data for it ("In use"). */
  inUse: boolean;
  /** What it needs that is off, in words ("the online shop", "the bonus program"); empty when nothing is missing. */
  missing: string[];
  /** Where it is set up, after the store's admin address. */
  setupPath: string;
  /** Switching it off now: refused for these, else confirmed over these. */
  blockers: FeatureBlocker[];
  warnings: string[];
};

const needWords = (id: FeatureId) => (id === "shop" ? "the online shop" : `the ${FEATURES_BY_ID[id].label.toLowerCase()}`);

/** Every feature's row, from the store's kept features and the facts counted now. */
export function featureRows(features: FeatureSource, facts: FeatureFacts, formatMoney: (minor: number, currency: string) => string): Record<FeatureId, FeatureRow> {
  const rows = FEATURE_IDS.map((id): FeatureRow => {
    const f = FEATURES_BY_ID[id];
    const on = featureOn(features, id);
    return {
      id,
      label: f.label,
      words: f.words,
      offWords: f.offWords,
      kept: featureKept(features, id),
      on,
      inUse: featureInUse(id, facts),
      missing: missingNeeds(features, id).map(needWords),
      setupPath: f.setupPath,
      blockers: on ? featureBlockers(id, facts) : [],
      warnings: on ? featureWarnings(id, facts, features, formatMoney) : [],
    };
  });
  return Object.fromEntries(rows.map((r) => [r.id, r])) as Record<FeatureId, FeatureRow>;
}
