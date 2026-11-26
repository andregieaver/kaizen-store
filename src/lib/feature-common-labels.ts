/**
 * The store features' common words in English (D178, D312 A8, bloat review step 2.50): `common.features`, which the server's refusals, the AI
 * manager and the setup tools read with no language (`requirementLabel()`, `featureOffText()` in `feature-labels.ts`). The `common`
 * catalogue, which every admin screen's first scripts carry, takes the group from here; `settings.features` is apart in
 * `store-feature-labels.ts`, so the browser does not carry it. Imports nothing.
 */

export const FEATURE_COMMON_EN = {
  labels: {
    shop: "Online shop",
    subscriptions: "Subscriptions",
    boxes: "Subscription boxes",
    appointments: "Appointments",
    bookings: "Stays and rentals",
    gift_cards: "Gift cards",
    countries: "Several countries",
    languages: "Several languages",
    currencies: "Several currencies",
    business: "Sell to businesses",
    bonus: "Bonus program",
    referrals: "Referral program",
    reviews: "Product reviews",
    sales: "Deals",
    projects: "Projects",
  },
  /** A feature that another needs, in a sentence: "needs the online shop". */
  need: {
    shop: "the online shop",
    subscriptions: "the subscriptions",
    boxes: "the subscription boxes",
    appointments: "the appointments",
    bookings: "the stays and rentals",
    gift_cards: "the gift cards",
    countries: "the several countries",
    languages: "the several languages",
    currencies: "the several currencies",
    business: "the sell to businesses",
    bonus: "the bonus program",
    referrals: "the referral program",
    reviews: "the product reviews",
    sales: "the deals",
  },
  or: " or ",
  off: { one: "{label} is switched off", many: "{label} are switched off" },
  /** What a server action says when a stale page asks for something of a feature that is off (`featureOffText()`). */
  offUnder: { one: "{label} is switched off under Settings, Features.", many: "{label} are switched off under Settings, Features." },
  asleep: "{label} needs {need}, which is switched off.",
  hidden: "This page is hidden while the feature is off. Nothing has been deleted: switch it on and everything is as it was.",
  goTo: "Go to Features",
  /** One press from the page itself (round 14, D641). */
  switchOn: "Switch it on",
  onlyOwner: "Only an owner can switch features on or off, under Settings → Features.",
  noteOff: "{label} is switched off, so this is hidden.",
  noteSwitch: "Switch it on under Features",
  noteOwner: "An owner can switch it on under Settings, Features",
};
