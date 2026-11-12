# FT-9 ✓ Campaigns and discount codes overlap at their edges; one page is planned, one engine is not worth it

The product's surface (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P3. **Effort:** S. **Confidence:** medium. **Step:** tolerated. **The owner's choice.**
- **Second check:** corrected.
- **Where:** `src/lib/campaigns.ts:24`, `src/lib/campaigns.ts:159`, `src/lib/campaigns.ts:178`, `src/lib/discounts.ts:23`, `src/lib/discounts.ts:380`, `src/lib/discounts.ts:401`, `docs/audits/admin-usability-2026-11.md:198`
- **Evidence:** Campaigns have 7 kinds (campaigns.ts:24), discount codes 3 (discounts.ts:23). I listed both modules' exports. The shared part is small: a reaches() in each for the product and category reach (campaigns.ts:178, discounts.ts:380), a running and a status function in each (campaigns.ts:159 and :170, discounts.ts:401), and the three simple kinds. The bulk of each is its own: multi-buy, tiers, buy X get Y and the best offer per unit on one side; availability, once per customer, generated codes, stacking classes and subscriptions on the other. Two mechanisms with a shared edge, not one job built twice.
- **Cost today:** Two pages under one heading for the owner, and about 100 to 200 lines of parallel helpers. Paid by: An owner's admin; anyone changing pricing code
- **Saving:** Estimate: one link (with step 2.4) and 100 to 200 lines of shared helpers.
- **Risk:** A shared helper that changes which lines a discount reaches changes money; the money tests are the gate.
- **Already tracked:** The page merge is audit phase 2 ('Campaigns and Coupons become one Discounts page', docs/audits/admin-usability-2026-11.md:198; code review step 2.4, Open).

## The fix

1. Do the page merge already planned: one Discounts page with Automatic and Code (code review step 2.4; docs/audits/admin-usability-2026-11.md:198).
2. When pricing code is next touched: move the reach test and the running and status helpers into one small module (for example src/lib/offer-reach.ts) used by src/lib/campaigns.ts and src/lib/discounts.ts, changing no order of pricing.
3. Leave the two engines apart.

**Done when:** `rg -c "export function reaches" src/lib` counts one definition, and the money tests pass.

**Tests and rules that hold today's behaviour, and change with it:**

- The money tests (the quick gate): src/lib/campaigns.test.ts, src/lib/discounts.test.ts, src/lib/discount-combinations tests and the checkout integration tests that hold cartSummary() to placeOrder().
- Rule: the order of pricing is a money rule (campaigns, then the group's discount, then the welcome discount, then codes, then credits; campaigns.ts and cart-summary.ts say it); shared helpers must not change it.

**Comes after:** Code review step 2.4

**Notes:** P3: the saving is small and the code is money. Do the helpers only when that code is open for another reason.
