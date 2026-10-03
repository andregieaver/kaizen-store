# The parity tracker (wave 0 of `docs/parity-plan.md`)

`docs/shopify-parity.md` is the report; **this folder is the data it is made from**. One JSON file per domain in
`rows/`, one object per Shopify feature (row counts are printed by `pnpm parity`). The headline and the per-domain
tables are computed from these files by `pnpm parity` (never typed by hand), and a test fails when the data and the
rules below disagree.

## A row

```jsonc
{
  "id": "orders.self-serve-withdrawal-and-return-requests",   // "{domain}.{slug}", never changes
  "domain": "orders",                      // catalogue | storefront | checkout | orders | customers | analytics | international | platform | ai
  "feature": "Self-serve withdrawal and return requests",
  "weight": 5,                             // 1..5, importance to an EU small or mid-size merchant (judgement)
  "shopify": {
    "tier": "native",                      // native (scored in the headline) | app | plus
    "text": "Native.",                     // what Shopify does, in a line
    "url": "https://help.shopify.com/...", // the page it was read from
    "fetched": true,                       // true only when the page was actually read; false = from memory
    "checkedOn": "2026-10-03"              // date of the last real read
  },
  "kaizen": { "rating": "full", "rechecked": true, "was": "missing" },   // full | partial | missing
  "gap": "What is lacking (empty when full), with evidence.",
  "bucket": null,                          // A | B | C | D for rows that are not full, see below; null when full
  "wave": null,                            // 1..9 (docs/parity-plan.md), or null when full or undecided
  "criteria": ["Testable behaviour that makes this row Full."],
  "evidence": {
    "files": ["src/server/withdrawals.ts"],        // code that does it; every path must exist
    "tests": ["src/server/returns.int.test.ts"],   // tests that hold it; every path must exist
    "untested": false                              // true = Full by reading the code but no test holds it yet (debt, counted)
  },
  "decisions": ["D153"],                   // decision rows in docs/decisions.md
  "history": [ { "on": "2026-10-03", "from": "missing", "to": "full", "why": "D153 shipped the function" } ]
}
```

### Rules (checked by `src/lib/parity.test.ts` and `pnpm parity:check`)

1. **Full needs evidence.** A `full` row lists at least one existing file in `evidence.files` and either at least one
   existing test in `evidence.tests` or `evidence.untested: true`. The report counts both: *Full with tests* and *Full,
   untested* (debt to clear, not hidden). A row is never Full because a table exists or code was written: the criteria
   must hold in the running product.
2. **Partial and missing rows** have a `gap`, a `bucket`, a `wave` (or `null` for "not planned") and `criteria`.
3. **Buckets** (docs/parity-plan.md section 1): `A` build in-house; `B` build, but live only with a third party's
   agreement, approval or credential; `C` needs a strategy decision first (section 5 of the plan); `D` not reachable by
   code (people, contracts, audits, Shopify's own network). `D` rows never count as Full.
4. **A rating change is logged** in `history` with a date and a reason; a changed rating without a history entry fails the
   test. Ratings are changed only by reading the code and the running behaviour, never to reach a number.
5. **Shopify side.** `fetched: true` needs a `url` and `checkedOn`. A row that cannot be fetched keeps `fetched: false` and
   says why in `shopify.text`; the report counts them.
6. **Weights** are judgement and are not changed in a wave that also changes ratings.
7. Scores: full = 1, partial = 0.5, missing = 0, times the weight; the headline is the core rows (`tier: native`), the
   must-have figure those with weight 4 or 5. Same arithmetic as the first report.
8. **One row per Shopify feature.** The same Shopify feature is never a core row in two domains: the headline would count
   it twice, with ratings and weights that disagree. The row whose domain owns the code survives and takes the other's
   criteria, evidence and better Shopify reading; the other is deleted and named in its survivor's `gap`. Merged on
   2026-10-03: the feed rows (`ai.product-feed-to-merchant-center`, `customers.google-shopping-and-merchant-center-feed`)
   into `catalogue.product-feeds-to-google-and-other-channels`; `customers.url-redirect-manager` into
   `storefront.url-redirect-manager`; `orders.inventory-transfers` into
   `catalogue.inventory-transfers-and-purchase-orders`; `catalogue.multi-location-inventory` into
   `orders.multi-location-inventory-and-routing`; `catalogue.gift-cards` into `customers.gift-cards`;
   `catalogue.product-reviews-and-ratings` into `customers.product-reviews-and-ugc`;
   `checkout.draft-orders-and-payment-links` into `orders.draft-and-manual-orders`;
   `international.eu-vat-per-country-rates-oss-ready` into
   `checkout.eu-vat-by-destination-vat-inclusive-prices-reduced-rates`;
   `international.b2b-vat-id-validation-and-reverse-charge` into `checkout.b2b-vat-id-reverse-charge-exemption`;
   `platform.b2b-companies-catalogs-terms` (an umbrella over four other rows) into `catalogue.b2b-catalogs-and-price-lists`;
   `ai.search-merchandising` into `catalogue.search-merchandising-synonyms-boosts-pins`. A survivor keeps its own
   weight (rule 6), so a pair that disagreed on weight is for the next weight review.

## Waves

`wave` follows `docs/parity-plan.md` section 3: 1 compliance and money, 2 data in and out, 3 inventory and orders, 4
payments, 5 customers and marketing, 6 catalogue, 7 storefront and international, 8 analytics and AI, 9 platform and
extensibility. `pnpm parity` prints the score now and the score each wave would reach if all its rows became Full (and
the ceiling with buckets B, C and D left as they are), so the plan's numbers come from the data.

Running a wave: `.claude/workflows/parity-wave.js` (see `docs/parity/WAVES.md`).
