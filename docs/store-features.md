# Store features (D178)

Kaizen does a lot. A store owner who sells candles should not have to look at bookings, hosts, DAC7 reports,
subscription boxes and three currencies. Store features let an owner switch on what the store uses and leave the
rest out of the way: a master switch for the online shop (off: the store is a website) and a switch per feature.
This document is the contract; it is built in six steps (section 7).

## 1. The features

| Id | Label | Group | Needs | Today (before D178) |
|---|---|---|---|---|
| `shop` | Online shop | (master switch) | — | always on |
| `subscriptions` | Subscriptions | Selling | `shop` | always on (selling plans, D25, D29) |
| `boxes` | Subscription boxes | Selling | `shop` | module `deliveries` (D102) |
| `appointments` | Appointments | Selling | `shop` | module `bookings` (D65) |
| `bookings` | Stays and rentals (and hosts) | Selling | `shop` | module `bookings` (D67, D71) |
| `countries` | Several countries | Countries and languages | — | always on (markets) |
| `languages` | Several languages | Countries and languages | — | always on (D109) |
| `currencies` | Several currencies | Countries and languages | `shop` | always on (D109) |
| `business` | Sell to businesses | Customers | `shop` | `stores.audience` (D63, D108) |
| `bonus` | Bonus program | Customers | `shop` | `bonus_settings.enabled` (D130) |
| `referrals` | Referral program | Customers | `shop`, `bonus` | `affiliate_settings.enabled` (D131) |

The registry is `src/lib/store-features.ts` (`STORE_FEATURES`: id, group, label, one line of words, what switching off
takes away, needs, where it is set up, the legacy module). The database repeats the needs in
`commerce.feature_needs()`; `src/db/store-features.test.ts` holds the two together. Needs are transitively complete
(`referrals` names `shop` as well as `bonus`), so one level is enough in SQL.

## 2. Storage and the effective value

- `stores.features text[] not null default '{shop}'`, checked against the ids (`stores_features`). It holds what the
  owner **keeps** switched on.
- A feature is **on** when it is kept on and everything it needs is kept on: `featureOn(store, id)` in code,
  `commerce.feature_on(store_id, feature)` and `commerce.features_effective(features)` in SQL. So a feature's own switch
  is remembered while the shop is off: switching the shop back on brings back exactly what was on.
- `getStore()` gives `store.features` (as kept); `store.bookingsOn` (appointments or stays and rentals on) and
  `store.deliveriesOn` (boxes on) are derived from it.
- `stores.modules` stays for the code that reads it. The trigger `stores_features_sync()` keeps its `bookings`
  (appointments or bookings on) and `deliveries` (boxes on) in step with what is on (the shop's switch included), and
  when older code writes a module it moves the features (`bookings` → `appointments` and `bookings`; `deliveries` →
  `boxes`). `work` is not a feature (Work is switched at the owner's level, D123) and is left alone.

### Existing stores (the backfill, migration `store_features_rules`)

Every store gets `shop`. Then, what a store uses stays on, the rest starts off:

- `appointments` where module `bookings` is on and the store has appointment products or staff; `bookings` where the
  module is on and it has stay or rental products, rooms or items, or hosts; both when the module is on and nothing
  tells them apart.
- `boxes` where module `deliveries` is on; `subscriptions` where any selling plan or subscription exists.
- `bonus` where `bonus_settings.enabled`; `referrals` where `affiliate_settings.enabled`.
- `business` where `audience <> 'consumers'`; `countries` where more than one market is active; `currencies` where any
  `store_currencies` row exists (conservative: any row); `languages` where `stores.locales` names more than one
  language or any market has more than one locale.

### New stores

- From the template (`clone_store()`): the shop alone. `clone_store()` no longer copies the template's `bookings` and
  `deliveries` modules (patched on its live definition), so the new store's demo appointment, stay and rental are
  there but not bookable until the owner switches their feature on (step 6 asks at setup).
- From a store template (D175): the template's features (`clone_starter_setup()` copies `features`).
- A duplicate (D129, `duplicate_store()`): the original's features, a sleeping switch included.

## 3. Who switches, and how

- Only owners switch (`setFeature()` in `src/server/store-features.ts` asks `memberCan(member, 'owner')`; the action
  asks `checkOwnerRole()`). Every member who may read the settings sees the Features page, read-only.
- Switching **on** is immediate, refused while something it needs is off ("Referral program needs the bonus program").
- Switching **off** is refused while customers would be hit (*blockers*, section 5), and needs the owner's confirmation
  when there is something to know (*warnings*). A feature kept on but asleep (its needs off) has neither: its switch
  goes down at once.
- The store's row is locked while the facts are counted and the change written; every change is audited as
  `store.feature` (area `settings`, target the store, `changes.features` before and after, and in `details` the
  feature, on/off and the features that came on or went to sleep with it).
- Caches: `storeTag`, `catalogTag`, `STORES_TAG` and the store's `pagesTag`, through `refreshTag()`.

## 4. The "off" contract

When a feature is off (not kept, or asleep):

1. **Hidden in the admin**: its navigation items and pages (`feature` on `StoreItem`/`StoreSection` in
   `src/lib/store-nav.ts` and on `AdminPage` in `src/lib/admin-map.ts`), its AI manager tools (`TOOL_FEATURES` in
   `src/lib/owner-tool-features.ts`) and, from step 2, its parts of other pages (a product's purchase options, the
   bonus panel on a customer).
2. **Hidden in the storefront** (step 3): no subscribe option, no box button, no booking picker, no business toggle,
   no credits, no currency or language chooser beyond the main one.
3. **Refused by the server** (step 4): carts, checkout, actions, routes and tools refuse what belongs to it, whatever
   a stale page sends.
4. **Nothing is deleted**: products, plans, delivery days, staff, rooms, credits, referrers, translations, markets and
   currencies stay; switching back on restores them as they were.
5. **History stays truthful**: past orders, invoices, credit notes, subscriptions and bookings keep showing what was
   sold, with its words and amounts; analytics keep counting them.
6. **Shoppers' after-sale links keep working**: an order page, a subscription's manage link, a booking's cancel link,
   a hosted invoice, a withdrawal or return.

## 5. Blockers and warnings

Counted by `featureFacts()` (one query, reusing `storeObligations()` of `src/server/store-closure.ts`); the rules are
pure (`featureBlockers()`, `featureWarnings()` in `src/lib/store-features.ts`).

| Feature | Blocked while (with a link) | Warned of (confirm to go on) |
|---|---|---|
| `shop` | paid orders with goods to send (real payments); and every blocker of subscriptions, boxes, appointments and stays | orders waiting for payment; the features that go to sleep with it |
| `subscriptions` | subscriptions active, past due or paused | products with purchase options |
| `boxes` | box lists active or paused; box orders waiting to be sent and paid | delivery days kept |
| `appointments` | appointments held or confirmed that have not ended | appointment products no longer bookable |
| `bookings` | stays and rentals held or confirmed that have not ended; hosts' commissions not paid out | stay and rental products; hosts |
| `countries` | subscriptions or box lists in another country than the store's own | other countries no longer offered |
| `languages` | — | languages besides the main one hidden (translations kept) |
| `currencies` | — | extra currencies no longer offered |
| `business` | — | open carts with a VAT number; products for businesses only; company accounts |
| `bonus` | — | customers holding credits and what they hold (in the program's currency); the referral program going to sleep |
| `referrals` | — | referrers whose links stop giving discounts; rewards still pending |

The store's own country is `stores.country`'s market, else its first active market (as `getStore()` orders them).

## 6. The Features page

`/admin/{store}/settings/features` (`FeaturesView` in `src/components/admin/features-view.tsx`):

- "N of 10 on" at the top (every feature but the shop's own switch, counted on).
- A card with the online shop's switch; then Selling, Countries and languages, and Customers, a row per feature: its
  label, one line, *In use* when there is data, *Set up* (to its page) when it is on, and a switch
  (`button role="switch"`, `aria-checked`, the admin's tokens).
- With the shop off, the rows that need it are greyed with "Needs the online shop"; switches kept on stay up and can be
  put down, the others cannot be switched on.
- Switching off opens a panel under the row: what disappears, then the blockers with links (no way on) or the warnings
  with *Switch off* and *Keep it on*.
- The **Time zone and reminders** card (the store's time zone and the appointment reminder email, `saveBookingSettings()`)
  stays on this page under the switches, always shown: the time zone serves appointments, stays, boxes' cutoffs and
  the analytics' days.
- Admin pages behind a feature that is off show `FeatureOff` (via `requireFeature(member, feature)` after the page's
  permission check): what is off and, for an owner, the way to Features.

## 7. The steps

1. **Foundation and the Features page** (this change): the registry, `stores.features` with its backfill and the modules
   mirror, `feature_on()`, `setFeature()` with blockers, warnings, needs and the audit, the navigation, admin map and AI
   tools gated, `FeatureOff` on the gated pages, the new Features page.
2. **Admin surfaces inside pages**: hide each feature's parts of other pages (product editor purchase options and kinds,
   customer bonus panel, company fields, currency and language choosers in settings, hosts in products, analytics
   subscription figures, setup steps) and the AI manager's words about them.
3. **Storefront hiding**: subscribe options, box button and My account's box page, booking pickers, business toggle and
   prices without VAT, credits and referral pages, currency and language choosers, other markets, sitemap and feeds.
4. **Server enforcement**: carts, checkout, server actions, routes, crons (renewals, box cutoffs, reminders, calendar
   sync) and AI tools refuse a feature that is off, with `checkout-kinds.int.test.ts` scenarios.
5. **Redirects and website mode**: the storefront with the shop off (no prices, cart or checkout, product pages as
   content), addresses of a feature that is off answered sensibly (a 404 or a redirect), legal starters following the
   features.
6. **Onboarding**: a setup question ("What will you sell?") and store templates choosing features; new stores'
   defaults revisited.
