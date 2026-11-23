/**
 * The Shipping hub's warnings in English (bloat review step 2.50): beside `warningWords()` in `lib/shipping-warning-words.ts`, so the
 * AI manager's shipping tool says them without the shipping catalogue, and the catalogue (`admin-messages/shipping.en.ts`) spreads them from here.
 * Imports nothing.
 */
export const SHIPPING_WARNING_WORDS = {
  no_flat_with_methods: "{market}: there is no flat rate, so a basket no method prices cannot be bought.",
  zones_without_rest: "{market}: no method has a rate for Rest of country, so addresses outside your zones cannot be served by a method.",
  subscriptions_need_flat: "{market}: subscriptions and subscription boxes pay the flat rate, and none is set.",
  default_weight_used: {
    one: "{n} variant has no weight and uses the default weight in weight tiers.",
    many: "{n} variants have no weight and use the default weight in weight tiers.",
  },
} as const;
