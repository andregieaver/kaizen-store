/**
 * The numbers of order automation rules (bloat review step 2.50): beside `order-rules.ts`, which re-exports them, so the rules' words
 * (`order-rules-labels.ts`) can say a limit out loud without importing the rules' code. Imports nothing.
 */

export const RULE_LIMITS = {
  /** Rules a store may have (also the database's `order_rules_limit`). */
  rules: 50,
  conditions: 10,
  actions: 5,
  name: 80,
  /** A *Notify staff* note and a *Hold* reason. */
  note: 200,
  reason: 200,
  /** What an *Ask the AI manager* asks it to look at. */
  question: 300,
  /** Turns *Ask the AI manager* may start in a store in 24 hours (each is a model's turn). */
  asksPerDay: 20,
  /** Products of one `has_product` and countries of one `country_in`. */
  products: 50,
  countries: 40,
} as const;
