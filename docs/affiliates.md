# The affiliate program, store level (D131)

A store's signed-in customers refer friends. A friend's first order through their link gets a **welcome discount**; the
customer who shared the link earns **bonus credits** (the D130 ledger) on what the friend pays. Switched on by the owner
under Sales → Referral program (`/admin/{store}/affiliates`); off by default, and it works only while the **bonus program
is on**, because the reward is bonus credits. Since D178 (`docs/store-features.md`) it also stands behind the store feature
`referrals` (which needs the feature `bonus`): the feature is the gate (the page, the customer's referral section, link capture,
the welcome discount, My account's referral page, the cookie and the AI tools are there only while it is on), and the program's
own switch (`affiliate_settings.enabled`) stays on its page. It **works** only while the feature, its own switch and the bonus
program are all on: `commerce.affiliate_program_on()`, `AffiliateProgram.on`, `affiliateSite().on`. The contract shared by the screens and the server is `src/lib/affiliates.ts`;
the rules are in SQL (`commerce.affiliate_*`, migration `affiliate_rules`); the engine is `src/server/affiliates.ts`;
checkout uses it from `cartSummary()` and `placeOrder()`.

(The platform's own program, where store owners refer other store owners, is the other half of D131: `docs/referrals.md`.)

## The owner's decisions (final)

- **Who refers**: anyone signed in. The first time they open Refer a friend (`/s/{store}/{market}/account/referrals`) they get a
  code and a link, `{store}/?ref={code}`. No approval; staff can **block** one (with a reason). What a blocked customer earned
  stays; nothing new is earned.
- **The friend** (`friendPercent`, 10 % by default, 0 for none) gets that percentage off the **goods** of their **first paid
  order**, at most `friendMaxMinor`. They must be signed in (a guest is asked to sign in). "First" = the customer has no
  earlier paid, fulfilled, closed or paid-and-cancelled order in this store, by their account or their email (a guest purchase
  before registering counts), and is not the referrer.
- **Applied** after campaigns (D114) and the group's discount (D108), **before** discount codes (D31) and bonus credits
  (D130), which count what is left. It is a discount like the others: `orders.referral_discount_minor` is part of
  `orders.discount_minor`, spread over the lines in `order_lines.referral_discount_minor` (by largest remainder, so VAT and
  refunds agree). It goes into the same one-time coupon Stripe is given (named with the store's "Welcome discount").
- **The referrer** earns `rewardBps` (5 % by default) of what the friend **paid online for goods**, counted as the bonus
  program counts it (`commerce.bonus_order_paid`: lines' totals less the part left for a venue, so without shipping and after
  every discount and the credits used), for the friend's first `rewardOrders` paid orders in the store (1 by default; null is
  every order), as a bonus lot of kind `referral`: **pending** for the bonus program's `pendingDays`, then usable, expiring as
  the bonus settings say (`commerce.bonus_expiry_from`). Rounded down, converted from the order's currency to the credits'.
- **A monthly limit** per referrer (`monthlyCapMinor`, credits' currency, calendar month in the store's time zone): the reward
  is cut to what is left of it, and an order that would earn nothing more is recorded `rejected` with `cap`. What counts
  against it is each rewarded order's granted reward in the month (a partial refund does not free room; a fully refunded or
  cancelled order, which is `reversed`, does).
- **Guards** (recorded in `affiliate_attributions.status` / `reject_reason`): `self` (same customer, or the order's or the
  customer's email is the referrer's), `not_new` (the friend has ordered before and is not already this referrer's friend),
  `blocked`, `limit` (the friend's orders have already earned `rewardOrders` rewards), `cap`, and `zero` (an order that earns
  nothing after rounding). A program that is off when the order is **placed** attributes nothing (`affiliate_resolve()` says
  `off`). One switched off **after** an order was attributed (its own switch, the bonus program, or the store features, D178) no
  longer stops the reward: the order was placed while the program was on, so the referrer is rewarded when it is paid, as
  promised, and the reward email goes out as usual. Rows rejected as `off` before D178 keep their reason. Copied orders (D129) and hosts' orders
  (D71) are never attributed and never earn; a guest's order is never attributed.
- **Taken back** by refund and cancellation, exactly as the bonus program takes back the friend's own earnings.

## Tables

| Table | What |
|---|---|
| `affiliate_settings` | one row per store: the rules above and `enabled`; none means defaults, program off |
| `affiliates` | a customer's code in a store (`(store_id, customer_id)`, code unique in the store, `^[a-z0-9]{6,16}$`), `blocked_at`, `blocked_reason` |
| `affiliate_attributions` | one row per attributed order: `affiliate_customer_id`, `friend_customer_id` (null once the friend is deleted), `code`, `discount_minor` (what the friend was given, order currency), `reward_minor` (credits' currency), `status` `pending` → `rewarded` → `reversed` or `rejected` (`reject_reason`), `rewarded_at` |
| `referral_visits` | visits to a link by day and code (`store_id` set for a store): a number, nothing about the visitor; a ceiling of 100 000 a day per code |
| `customers.referred_by_customer_id` | the affiliate whose link the customer registered through (set once; later orders earn for that referrer) |
| `carts.affiliate_code` | the code the shopper arrived with, checked again at checkout |
| `orders.referral_discount_minor`, `order_lines.referral_discount_minor` | the welcome discount, part of the discount |
| `bonus_entries` kind `referral` | the referrer's lot (positive, like `earn`), key `referral:{order}`; its reversals are `reverse` entries keyed `referral-reverse:{refund}` / `referral-reverse-cancel:{order}` |

`OrderView.discountMinor` leaves the welcome discount **and** the credits out (`referralDiscountMinor`, `creditMinor` carry
them: subtotal + shipping − discount − referral − credits = total); `cartSummary().discountMinor` does the same
(`referralMinor` is the welcome discount, `lineDiscount(i)` leaves it out, `referral` is what the cart shows of it).

## The database does the deciding

- `affiliate_resolve(store, customer, code, except_order)` → `(affiliate_customer_id, code, verdict, welcome)`: verdicts `none`,
  `off`, `guest`, `self`, `blocked`, `not_new`, `limit`, `ok`; `welcome` says it is the friend's first order. On a first order
  the cart's code counts (last click wins), else the referrer the customer registered through. The server's `friendState()` is
  the only caller that decides a discount, for the cart page and for `placeOrder()`, so they agree.
- `affiliate_attribute_order(order, code, discount)` is called by `placeOrder()` (under the customer's row lock) and records the
  row: `pending` for `ok`, `rejected` with the reason for `self`, `blocked` and `not_new`, nothing for the other verdicts. The
  discount is kept only for `ok`.
- `affiliate_order_paid(order)` (trigger `orders_affiliate`, on the status going to paid, so every payment path is covered:
  webhook, return page, venue confirmation, late payment) checks the guards again as they stand now, works out the reward
  and grants it with `commerce.bonus_grant(…, 'referral', …)`. Once per order: only a `pending` attribution moves.
- `affiliate_refund_applied(refund)` (trigger `refunds_affiliate`) and `affiliate_order_paid_cancelled(order)` take back the
  refunded share of the lot (`floor(granted × refunded ÷ paid)`, all of it when everything is refunded, counted against what
  was already taken back from that lot, so refunds add up to exactly the whole), at most what is left of the lot: **what the
  referrer already used stays used and a balance never goes below zero**. A fully refunded or cancelled reward is `reversed`.
  They call `commerce.bonus_take(…, 'reverse', …, 'lot', …)`; the D130 functions are not changed.
- The ledger entries of a referral carry **no order id**: the referrer's history must not name the friend's order. The bonus
  program's own refund logic finds an order's `reverse` entries by `order_id`, so a reward's reversal must never carry the
  friend's order id either.
- Triggers keep `affiliate_attributions` append-only (who, which order, the discount and the code never change; status only
  moves forward), refuse an attribution for a copied or host's order, for a customer who is not the order's, or of the
  referrer to themselves, and keep `customers.referred_by_customer_id` to an affiliate of the store, never oneself, set once.
- A referrer's and a friend's customer rows are locked together in id order before any ledger write, so two payments that
  involve the same two customers cannot deadlock.
- Both composite foreign keys that would null `store_id` on a customer's deletion (`customers_referred_by_fk`,
  `affiliate_attributions_friend_fk`) are replaced in the rules migration by `ON DELETE SET NULL (column)`.

## Flows

**A visit.** Store pages are prerendered, so the server cannot read `?ref=`. `StoreAffiliate` (in the market's layout and the
front door's, only while the program is on) draws `AffiliateCapture`, which runs `startCapture()`
(`src/lib/affiliate-capture.ts`) in the browser: the code is asked of the server once (`captureAffiliateAction`: a live code is
counted in `referral_visits`; nothing is set), held **in the page's memory** (`affiliate-memory.ts`, a module variable that
survives client navigations) and written to the **cookie `kaizen_aff_{storeId}` only when the visitor has allowed marketing**
(`mayKeepAffiliate()`, D58), for `cookieDays`; if they allow it later, `CONSENT_CHANGED_EVENT` writes it then. Nothing is
written to a cookie or to storage before consent. Links that leave the market's own pages (another market, the country
chooser: each a new page load) carry the code in their address. A single-market store's front door redirects keeping
`?ref=` while the program is on (`KeepReferral`). The cookie is declared in `KNOWN_COOKIES` (`affiliate: true`, marketing,
`on: "store"`), so the store's banner appears once the program is on.

**The cart.** The four forms that add to the cart carry the held code (`AffiliateField`, hidden `ref`); `addToCart` keeps it on
`carts.affiliate_code` through `rememberAffiliate()` (validated: a live code of the store's, program on; last click wins), and
`startCheckout()` keeps the consented cookie's code the same way. The cart page falls back to the cookie for what it shows.

**Registering.** The register and code-sign-in forms carry the code too; `attachReferral()` ties a customer created in the last
hour, with no referrer and no paid order, to the referrer (never themselves, never a blocked one). A friend whose cart lost the
code is still the referrer's: `affiliate_resolve()` uses `referred_by_customer_id`.

**Cart → order → payment → refund.** `cartSummary()` and `placeOrder()` work out the welcome discount with `friendState()` +
`welcomeFor()` (goods bought once after campaigns and the group's discount, not subscriptions, gifts or a host's; capped by
`friendMaxMinor` converted to the market's currency; no rate means no discount, never an uncapped one) and agree to the minor unit
(`checkout-kinds.int.test.ts` holds them together for every kind of product, in euro too). The order is attributed in the same
transaction. Paying rewards the referrer (pending), refunds and cancellations take it back. The referrer is emailed once per
order (`sendReferrerRewardEmail()`, key `affiliate-reward:{order}`; from the payment path and, for paths that skip it, from
`runAffiliateJobs()` in the five-minute cron).

## Screens

- **Shopper**: Refer a friend (`/account/referrals`, linked from My account): the link with a copy button, how it works in the
  store's terms, visits, friends who ordered, earned and pending credits, and each friend by **a first name at most** (or "A
  friend"), the date, where the order stands and what it earned: never an email, an order or what was bought. The cart and the
  checkout show the welcome discount as its own row (and the order page, the account's order and the confirmation email); a guest
  with a link in play is invited to sign in. Text is in `i18n.ts` (`affiliate`) and `email-text.ts` (`affiliate`): Norwegian,
  Swedish, Danish and English by hand, others from the AI catalogue.
- **Owner** (`/admin/{store}/affiliates`, Sales): settings (owners; staff see them), overview, referrers (name, email, code, friends,
  earned, block/unblock with a reason), every attributed order with its status and the reason a guard stopped a reward. The customer
  page shows who referred a customer and what their own link earned; the order page shows the attribution and the welcome discount.
- **AI manager**: `get_affiliate_program`, `set_affiliate_program` (gate `public`: it changes what shoppers are promised),
  `block_affiliate` (gate `spend`: blocking takes away what a customer earns and unblocking lets the store's credits be earned, so
  it is kept for a yes), and the playbook `set-up-referrals`. Served to Kaizen Life's assistant with the other owner tools.

## Copying a store (D129)

`affiliate_settings` is copied (`duplicate_store()`); `affiliates`, `affiliate_attributions` and visits never are, and
`customers.referred_by_customer_id`, `carts.affiliate_code` and `orders.referral_discount_minor` are not in `copy_customers()` /
`copy_orders()`'s column lists, so a copied order never carries a referral.

## Not in v1 (and known limits)

- **Subscription renewals** are never attributed or rewarded; only the order placed at checkout is (its first payment).
- **Guests** cannot be attributed or rewarded: the friend must be signed in.
- **Self-dealing with a second identity** (another email, another account, the same person) is not detectable beyond the guards
  above; the monthly limit, blocking and the audit trail are the tools. Staff see who referred whom.
- Two unpaid first orders placed before either is paid can both get the welcome discount; only the first paid earns a reward
  (the second is rejected `limit`/`not_new`).
- Without marketing consent the link survives only while the page is not loaded again (and across client navigation and market
  links that carry it); a hard navigation, a new tab or a reload loses it unless the visitor allowed the cookie.
- Refunds made directly in Stripe's Dashboard do not reach Kaizen (as in the bonus program), so the reward does not move.
- Visits are counted per page load; a script can inflate them up to the daily ceiling. They are only for the dashboard.
- No per-customer multiplier, no tiers, no payouts in money: the reward is credits only.
