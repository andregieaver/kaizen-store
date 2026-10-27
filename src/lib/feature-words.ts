/**
 * What switching a store feature off would mean, in words (D178, D312 A8): the blockers and warnings of the Features page and its rows. Apart
 * from `store-features.ts` because their English default is the Settings catalogue, which a visitor's scripts must not carry (D211): the
 * storefront reads features through `store-features.ts`, the admin and the server these through this module.
 */

import { countWords } from "./admin-fill";
import { commonEn, type CommonMessages } from "./admin-messages/common.en";
import { settingsEn, type SettingsMessages } from "./admin-messages/settings.en";
import {
  dependentsOf,
  FEATURE_IDS,
  FEATURES_BY_ID,
  featureInUse,
  featureKept,
  featureOn,
  missingNeeds,
  needWords,
  type FeatureFacts,
  type FeatureId,
  type FeatureSource,
} from "./store-features";

/** A reason a feature cannot be switched off, with the admin page (after the store's address) where it is dealt with. */
export type FeatureBlocker = { text: string; path: string };

/**
 * The words the Features page's sentences are written in (D312 A8): `settings.features` and `common.features` in the account's language.
 * English, as the AI manager and the setup tools read them, unless given.
 */
export type FeatureWords = { s: SettingsMessages["features"]; c: CommonMessages["features"] };

export const FEATURE_WORDS_EN: FeatureWords = { s: settingsEn.features, c: commonEn.features };

function subscriptionBlockers(f: FeatureFacts, w: FeatureWords): FeatureBlocker[] {
  return f.runningSubscriptions > 0 ? [{ text: countWords(f.runningSubscriptions, w.s.blockers.subscriptions), path: "/subscriptions" }] : [];
}

function boxBlockers(f: FeatureFacts, w: FeatureWords): FeatureBlocker[] {
  const out: FeatureBlocker[] = [];
  if (f.runningBoxes > 0) out.push({ text: countWords(f.runningBoxes, w.s.blockers.boxLists), path: "/deliveries" });
  if (f.boxOrdersUnpaid > 0) out.push({ text: countWords(f.boxOrdersUnpaid, w.s.blockers.boxOrders), path: "/orders" });
  return out;
}

function appointmentBlockers(f: FeatureFacts, w: FeatureWords): FeatureBlocker[] {
  return f.futureAppointments > 0 ? [{ text: countWords(f.futureAppointments, w.s.blockers.appointments), path: "/bookings" }] : [];
}

function stayBlockers(f: FeatureFacts, w: FeatureWords): FeatureBlocker[] {
  const out: FeatureBlocker[] = [];
  if (f.futureStays > 0) out.push({ text: countWords(f.futureStays, w.s.blockers.stays), path: "/bookings/stays" });
  if (f.unpaidHostCommissions > 0) out.push({ text: countWords(f.unpaidHostCommissions, w.s.blockers.hostCommissions), path: "/hosts" });
  return out;
}

/**
 * What stops a feature being switched off: customers who would be hit (running subscriptions and box lists, bookings to come, goods paid
 * for and not sent, in another country for Several countries). Empty: nothing stands in the way. Bonus, referrals, business, currencies and
 * languages are never blocked, only warned of.
 */
export function featureBlockers(id: FeatureId, f: FeatureFacts, w: FeatureWords = FEATURE_WORDS_EN): FeatureBlocker[] {
  const b = w.s.blockers;
  switch (id) {
    case "shop": {
      const out: FeatureBlocker[] = [];
      if (f.paidUnshipped > 0) out.push({ text: countWords(f.paidUnshipped, b.paidUnshipped), path: "/orders" });
      return [...out, ...subscriptionBlockers(f, w), ...boxBlockers(f, w), ...appointmentBlockers(f, w), ...stayBlockers(f, w)];
    }
    case "subscriptions":
      return subscriptionBlockers(f, w);
    case "boxes":
      return boxBlockers(f, w);
    case "appointments":
      return appointmentBlockers(f, w);
    case "bookings":
      return stayBlockers(f, w);
    case "countries": {
      const out: FeatureBlocker[] = [];
      if (f.foreignSubscriptions > 0) out.push({ text: countWords(f.foreignSubscriptions, b.foreignSubscriptions), path: "/subscriptions" });
      if (f.foreignBoxes > 0) out.push({ text: countWords(f.foreignBoxes, b.foreignBoxes), path: "/deliveries" });
      if (f.foreignUnsent > 0) out.push({ text: countWords(f.foreignUnsent, b.foreignUnsent), path: "/orders" });
      return out;
    }
    default:
      return [];
  }
}

/** What is worth knowing before switching a feature off, which the owner confirms; empty: nothing more than the feature's own words. */
export function featureWarnings(
  id: FeatureId,
  f: FeatureFacts,
  features: FeatureSource,
  formatMoney: (minor: number, currency: string) => string,
  w: FeatureWords = FEATURE_WORDS_EN,
): string[] {
  const out: string[] = [];
  const t = w.s.warnings;
  const add = (count: number, words: { one: string; many: string }, values: Record<string, string | number> = {}) => {
    if (count > 0) out.push(countWords(count, words, values));
  };
  // What needs it and is on now goes to sleep with it; its own switch is kept.
  const asleep = dependentsOf(id).filter((dep) => featureOn(features, dep));
  switch (id) {
    case "shop":
      add(f.openCheckouts, t.openCheckouts);
      break;
    case "subscriptions":
      add(f.subscriptionProducts, t.subscriptionProducts);
      break;
    case "boxes":
      add(f.deliverySchedules, t.deliverySchedules);
      break;
    case "appointments":
      add(f.appointmentProducts, t.appointmentProducts);
      break;
    case "bookings":
      add(f.stayProducts, t.stayProducts);
      add(f.hosts, t.hosts);
      break;
    case "countries":
      add(f.otherCountries, t.otherCountries);
      add(f.foreignCarts, t.foreignCarts);
      break;
    case "languages":
      add(f.otherLanguages, t.otherLanguages);
      break;
    case "currencies":
      add(f.extraCurrencies, t.extraCurrencies);
      break;
    case "business":
      add(f.businessCarts, t.businessCarts);
      add(f.businessProducts, t.businessProducts);
      add(f.companies, t.companies);
      break;
    case "bonus":
      if (f.creditHolders > 0 && f.creditsCurrency) add(f.creditHolders, t.credits, { amount: formatMoney(f.creditsMinor, f.creditsCurrency) });
      break;
    case "referrals":
      add(f.referrers, t.referrers);
      add(f.pendingReferrals, t.pendingReferrals);
      break;
    case "gift_cards":
      add(f.giftCardProducts, t.giftCardProducts);
      add(f.giftCardsHeld, t.giftCardsHeld);
      break;
    case "reviews":
      add(f.publishedReviews, t.publishedReviews);
      break;
  }
  if (asleep.length > 0) {
    const labels = asleep.map((dep) => w.c.labels[dep]);
    out.push(countWords(asleep.length, t.asleep, { labels: labels.join(t.listSeparator) }));
  }
  return out;
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

/** Every feature's row, from the store's kept features and the facts counted now, in the account's words (English unless given). */
export function featureRows(
  features: FeatureSource,
  facts: FeatureFacts,
  formatMoney: (minor: number, currency: string) => string,
  w: FeatureWords = FEATURE_WORDS_EN,
): Record<FeatureId, FeatureRow> {
  const rows = FEATURE_IDS.map((id): FeatureRow => {
    const f = FEATURES_BY_ID[id];
    const on = featureOn(features, id);
    return {
      id,
      label: w.c.labels[id],
      words: w.s.items[id].words,
      offWords: w.s.items[id].offWords,
      kept: featureKept(features, id),
      on,
      inUse: featureInUse(id, facts),
      missing: missingNeeds(features, id).map((need) => needWords(need, w.c)),
      setupPath: f.setupPath,
      blockers: on ? featureBlockers(id, facts, w) : [],
      warnings: on ? featureWarnings(id, facts, features, formatMoney, w) : [],
    };
  });
  return Object.fromEntries(rows.map((r) => [r.id, r])) as Record<FeatureId, FeatureRow>;
}
