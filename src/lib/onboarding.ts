/**
 * Onboarding (D178 step 6, `docs/store-features.md` 4f), pure: the setup wizard's first question, "What will you sell?", and what its answers
 * switch on. The answers are never stored: they become the store's features (`stores.features`, through `setFeatures()`), and the question
 * is read back from the features (`answersForFeatures()`), so it is pre-filled with what is on now (a store template's features, say). The
 * owner changes everything later on the Features page.
 */

import { FEATURE_IDS, FEATURES_BY_ID, featureOn, normaliseFeatures, type FeatureId, type FeatureSource } from "./store-features";

/** What a store sells (several may be chosen), or that it is a website with no online shop (alone). */
export const SELL_ANSWERS = ["goods", "downloads", "appointments", "stays", "subscriptions", "boxes", "website"] as const;
export type SellAnswer = (typeof SELL_ANSWERS)[number];

/** What else the store does, ticked or not. */
export const EXTRA_ANSWERS = ["countries", "languages", "business"] as const;
export type ExtraAnswer = (typeof EXTRA_ANSWERS)[number];

export type OnboardingAnswers = { sells: SellAnswer[]; extras: ExtraAnswer[] };

/** The words of each answer, as the wizard shows them. */
export const SELL_ANSWER_WORDS: Record<SellAnswer, { label: string; words: string }> = {
  goods: { label: "Products to ship", words: "Things you send by post or a carrier, or that customers collect." },
  downloads: { label: "Downloads", words: "Files customers buy and download, such as e-books, music or patterns." },
  appointments: { label: "Appointments", words: FEATURES_BY_ID.appointments.words },
  stays: { label: "Stays or rentals", words: "Rooms, homes and items booked by the night, day or hour." },
  subscriptions: { label: "Subscriptions", words: FEATURES_BY_ID.subscriptions.words },
  boxes: { label: "Subscription boxes", words: FEATURES_BY_ID.boxes.words },
  website: { label: "Just a website, no online shop", words: "Pages, a blog, forms and your business details. Nothing is sold; switch the shop on later when you want to." },
};

export const EXTRA_ANSWER_WORDS: Record<ExtraAnswer, { label: string; words: string }> = {
  countries: { label: "Sell in several countries", words: FEATURES_BY_ID.countries.words },
  languages: { label: "Several languages", words: "Show the store in more than one language; with an online shop, prices in other currencies too." },
  business: { label: "Sell to businesses", words: FEATURES_BY_ID.business.words },
};

/** The feature each kind of thing sold switches on besides the online shop (goods and downloads need nothing more). */
const SELL_FEATURE: Partial<Record<SellAnswer, FeatureId>> = {
  appointments: "appointments",
  stays: "bookings",
  subscriptions: "subscriptions",
  boxes: "boxes",
};

/**
 * The features the question decides. The bonus and referral programs are not asked about: the answers leave them as they are kept (a store
 * template's programs stay), and the owner switches them on the Features page.
 */
export const QUESTION_FEATURES: readonly FeatureId[] = FEATURE_IDS.filter((id) => id !== "bonus" && id !== "referrals");

const isSell = (value: unknown): value is SellAnswer => (SELL_ANSWERS as readonly unknown[]).includes(value);
const isExtra = (value: unknown): value is ExtraAnswer => (EXTRA_ANSWERS as readonly unknown[]).includes(value);

/** The answers a form sent (`sells` and `extras`, repeated), known values only, each once. */
export function readAnswers(form: { sells: readonly unknown[]; extras: readonly unknown[] }): OnboardingAnswers {
  return {
    sells: SELL_ANSWERS.filter((answer) => form.sells.some((value) => value === answer && isSell(value))),
    extras: EXTRA_ANSWERS.filter((answer) => form.extras.some((value) => value === answer && isExtra(value))),
  };
}

/**
 * The features the answers switch on, of `QUESTION_FEATURES`, or what is wrong with the answers. Anything sold switches on the online shop
 * with what that kind needs; a website is the shop off, alone. Several languages adds Several currencies with a shop (a currency needs one).
 */
export function featuresForAnswers(answers: OnboardingAnswers): { ok: true; features: FeatureId[] } | { ok: false; problems: string[] } {
  const website = answers.sells.includes("website");
  const selling = answers.sells.filter((answer) => answer !== "website");
  if (!website && selling.length === 0) return { ok: false, problems: ["Choose what you will sell, or Just a website."] };
  if (website && selling.length > 0) return { ok: false, problems: ["A website without an online shop sells nothing: choose Just a website, or what you will sell."] };
  if (website && answers.extras.includes("business")) return { ok: false, problems: ["Selling to businesses needs an online shop: leave it out for a website, or choose what you will sell."] };
  const features: FeatureId[] = [];
  if (!website) features.push("shop");
  for (const answer of selling) {
    const feature = SELL_FEATURE[answer];
    if (feature) features.push(feature);
  }
  if (answers.extras.includes("countries")) features.push("countries");
  if (answers.extras.includes("languages")) features.push(...(website ? (["languages"] as const) : (["languages", "currencies"] as const)));
  if (answers.extras.includes("business")) features.push("business");
  return { ok: true, features: normaliseFeatures(features) };
}

/**
 * The store's whole kept set after answering: what the answers switch on, and of the features the question does not decide (the bonus and
 * referral programs) what the store keeps now.
 */
export function targetFeatures(kept: readonly string[], answered: readonly FeatureId[]): FeatureId[] {
  return normaliseFeatures([...normaliseFeatures(kept).filter((id) => !QUESTION_FEATURES.includes(id)), ...answered]);
}

/**
 * The question pre-filled from what is on now: a website when the shop is off, else each kind whose feature is on (products to ship when
 * none is: goods and downloads need no feature, so they cannot be read back), and the extras that are on.
 */
export function answersForFeatures(source: FeatureSource): OnboardingAnswers {
  const extras = EXTRA_ANSWERS.filter((extra) => featureOn(source, extra));
  if (!featureOn(source, "shop")) return { sells: ["website"], extras: extras.filter((extra) => extra !== "business") };
  const kinds = SELL_ANSWERS.filter((answer) => {
    const feature = SELL_FEATURE[answer];
    return feature !== undefined && featureOn(source, feature);
  });
  return { sells: kinds.length > 0 ? kinds : ["goods"], extras };
}

/**
 * The switches that take a store's kept features to a target, in an order each can be made in: off first, from the features that need
 * others to the ones they need (so nothing is put to sleep on the way), then on, from the ones needed (the shop first).
 */
export function planFeatureChanges(before: readonly string[], target: readonly string[]): { id: FeatureId; on: boolean }[] {
  const from = new Set(normaliseFeatures(before));
  const to = new Set(normaliseFeatures(target));
  const offs = [...FEATURE_IDS].reverse().filter((id) => from.has(id) && !to.has(id));
  const ons = FEATURE_IDS.filter((id) => to.has(id) && !from.has(id));
  return [...offs.map((id) => ({ id, on: false })), ...ons.map((id) => ({ id, on: true }))];
}

/** What a target set lacks: a feature kept on whose needs are not in the set, in words; empty when it holds together. */
export function targetProblems(target: readonly string[]): string[] {
  const set = new Set(normaliseFeatures(target));
  return [...set].flatMap((id) => {
    const missing = FEATURES_BY_ID[id].needs.filter((need) => !set.has(need));
    return missing.length > 0 ? [`${FEATURES_BY_ID[id].label} needs ${missing.map((need) => FEATURES_BY_ID[need].label).join(" and ")}.`] : [];
  });
}

/**
 * What a store template switches on, in a few words for its card (D178 step 6): "Online shop with Appointments and Several countries",
 * "Online shop", or "Website (no online shop)".
 */
export function featureSummary(source: FeatureSource): string {
  if (!featureOn(source, "shop")) {
    const world = FEATURE_IDS.filter((id) => id !== "shop" && featureOn(source, id)).map((id) => FEATURES_BY_ID[id].label);
    return world.length > 0 ? `Website (no online shop) with ${listWords(world)}` : "Website (no online shop)";
  }
  const on = FEATURE_IDS.filter((id) => id !== "shop" && featureOn(source, id)).map((id) => FEATURES_BY_ID[id].label);
  return on.length > 0 ? `Online shop with ${listWords(on)}` : "Online shop";
}

const listWords = (words: string[]) => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);
