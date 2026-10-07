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
- Caches (`refreshFeatureTags()`): `storeTag`, `catalogTag` (products for businesses only come and go), `STORES_TAG`, the store's
  `pagesTag` (shop components of a feature), `affiliateTag` (the referral program's storefront read) and `cookiesTag`, through
  `refreshTag()`.

## 4. The "off" contract

When a feature is off (not kept, or asleep):

1. **Hidden in the admin**: its navigation items and pages (`feature` on `StoreItem`/`StoreSection` in
   `src/lib/store-nav.ts` and on `AdminPage` in `src/lib/admin-map.ts`), its AI manager tools (`TOOL_FEATURES` in
   `src/lib/owner-tool-features.ts`) and, from step 2, its parts of other pages (a product's purchase options, the
   bonus panel on a customer).
2. **Hidden in the storefront**: no subscribe option, no box button, no booking picker, no business toggle,
   no credits, no currency or language chooser beyond the main one.
3. **Refused by the server**: carts, checkout, actions, routes and tools refuse what belongs to it, whatever
   a stale page sends.
4. **Nothing is deleted**: products, plans, delivery days, staff, rooms, credits, referrers, translations, markets and
   currencies stay; switching back on restores them as they were.
5. **History stays truthful**: past orders, invoices, credit notes, subscriptions and bookings keep showing what was
   sold, with its words and amounts; analytics keep counting them.
6. **Shoppers' after-sale links keep working**: an order page, a subscription's manage link, a booking's cancel link,
   a hosted invoice, a withdrawal or return.

## 4a. The framework for hiding (step 2, used by every later step)

- **Admin pages inside pages**: a feature's part of another admin page asks `featureOn(store, id)` and shows `FeatureOffNote`
  (`src/components/admin/feature-off.tsx`: what is off and, for an owner, the way to Features) or nothing in its place; a server action
  behind such a part refuses with plain words whatever a stale page sends.
- **Storefront routes**: a feature's route resolves its shop with `resolveFeatureShop(store, market, feature)` (`src/server/shop.ts`),
  null while the feature is off, and calls `notFound()`; a component asks `featureOn(store, id)` of the store it was given.
- **Builder parts**: shop components (`STORE_PARTS`/`STORE_PIECES`, `feature` on the entry), site parts (`SITE_PART_FEATURES`) and product
  parts (`PRODUCT_PART_FEATURES`) may stand behind a feature (an id, or several any of which will do). `partFeature()`/`partFeatureOn()`
  (`src/lib/part-features.ts`) read the tag for any block: `StorePartSection`, `sitePartShows()` and `productPartShows()` draw nothing
  while it is off, the builder's palette leaves the part out (`PageOwnerContext.features`, a store's pages only), and a part already on a
  page shows "Switched off – not shown" on the canvas. `src/lib/part-features.test.ts` holds every tag to a real feature id.
- **Cookies**: a `KNOWN_COOKIES` entry may carry `feature`; `siteCookies()` (and so the cookie page and the banner) leaves it out while
  the feature is off, even when an earlier scan found it.

## 4b. The Customers group (step 2)

**Sell to businesses (`business`).** The switch gates `stores.audience`: while it is on the owner's choice (consumers, businesses or both,
the Company settings' Customers card) applies; while it is off the store sells to **consumers**, and the choice is kept for when it comes
back. There is one reading of it: `effectiveAudience()` (`src/lib/b2b.ts`), which `getStore()` gives as `store.audience` (the choice
itself is `store.chosenAudience`, read only by the card), and `commerce.store_audience(audience, features)` in SQL (`STORE_AUDIENCE` in
`src/server/product-conditions.ts`); `audience-readers.scan.test.ts` keeps it so. Following from it:

- A product for one kind of buyer is offered only where the store sells to that kind (`audienceOffered()`,
  `commerce.audience_offered()`/`product_offered()`, the fragment `OFFERED` on every shopper-facing product read: catalogue, listings,
  search, recommendations, sitemap, wishlists, subscription boxes, WordPress, the cart and `placeOrder()`). So a business-only product is
  neither shown nor sold while the feature is off, and the same rule closes the earlier gap where an owner had simply chosen consumers.
  The product keeps its audience; it comes back with the feature.
- Shoppers are private buyers (`getBuyer()`), prices are shown with VAT, there is no business switch, popup, `data-buyer` script or
  `buyer_…` cookie, and the cart asks for no company. A company typed on a stale page is not kept (`setCartCompany()`), the tax facts
  treat every cart as a private buyer's (`loadTaxFacts()`), and `placeOrder()` puts no company on the order, so reverse charge cannot be
  chosen. Switching the feature off clears the company and VAT number of the store's **open** carts in the database
  (`stores_features_after()`).
- A company account's discount stops (`memberDiscountFor()`, `customerTierIds()`); a customer's own group keeps theirs. Company
  accounts, their invitations and My company (`/account/company`, its invitation page and actions) are not there (404), and the admin's
  Companies are hidden (step 1), as are the company on a customer's page, the Customers card, companies' returns on the Returns settings
  (kept as set), reverse charge on the Tax page and in `tax_readiness`, the company fields of a draft order (a company already on a draft
  stays) and "Sold to" among custom fields' rules.
- History stays: past orders keep their company, reverse charge and VAT relief, and their VAT treatment panel, invoices and emails show
  them as they were. The VAT treatment panel is every order's frozen VAT record, so it stays for every order.

**The bonus program (`bonus`).** The feature is the gate; `bonus_settings.enabled` stays the program's own switch on the Bonus page, so the
rules can be set up while the feature is on. The program works when both are on: `commerce.bonus_program_on()`, `BonusProgram.on`.
Off: credits are neither used (`bonus_redeem()` raises `bonus.off`; the cart and checkout pieces `cart_credits`/`checkout_credits` and
My account's credits and `/account/bonus` are gone) nor earned (`bonus_order_paid()`), the Bonus page, the customer's bonus panel and
the AI tools are hidden and their actions refused (`saveBonusSettings()`, `adjustBonus()`), and the analytics' advice no longer
suggests bonus credit. **Expiry pauses**: nothing expires and nobody is reminded while it is off (`bonus_settings.paused_at`), and when
it comes back on, credits whose date passed meanwhile are given that time back (`bonus_resume()`, `docs/bonus.md`). Balances are kept;
past orders keep the credits they used and earned, and the analytics' discount line "Bonus credits" still shows a period that had
some (it is drawn only for a period with any, on or off).

**The referral program (`referrals`, needs `bonus`).** The feature is the gate; `affiliate_settings.enabled` stays the program's own
switch. It works when the feature, its switch and the bonus program are all on (`commerce.affiliate_program_on()`, `affiliateSite()`).
Off: no link is captured (`StoreAffiliate`, the country chooser's `KeepReferral`), the hidden code fields stay empty, the `kaizen_aff_…`
cookie is not declared, new carts get no welcome discount and new orders are not attributed, My account's referral card and
`/account/referrals` are gone, and the admin page, the customer's referral section and the AI tools are hidden and their actions refused.
**An order attributed while it was on is still rewarded when it is paid** (`affiliate_order_paid()` no longer rejects it as `off`), and
the reward email goes out: that reward was promised. Referrers and their history are kept, an order's referral card stays on orders
that have an attribution, and the analytics' "Welcome discounts (referral)" line shows a period that had some.

## 4c. The Selling group (step 3)

**One rule for what a shopper is offered.** A product is offered only while what its kind needs is on: an appointment needs
*Appointments*, a stay or a rental *Stays and rentals*, a product sold only as a subscription *Subscriptions* (`kindOffered()`/`kindFeature()`
in `src/lib/store-features.ts`, `commerce.kind_offered()` in SQL, migration `store_features_selling_rules`). It is part of `OFFERED`
(`src/server/product-conditions.ts`), so every shopper-facing product read already asks it: listings, the product page (a 404), search,
grids, recommendations, the sitemap and llms.txt, wishlists, WordPress, the chat agent, the cart and `placeOrder()`.
`selling-readers.scan.test.ts` keeps `commerce.kind_offered()` to that one fragment. A new store starts with the shop alone, so the
template's demo appointment, stay and rental are offered nowhere until the owner switches their feature on. The admin's product list says
"Not shown: Appointments is off" beside such a product, and so does the setup wizard's product step.

**Subscriptions (`subscriptions`).** Purchase options are offered while it is on (`plansOffered()`: the product page's options, a cart line on a
plan and what a checkout sells; the scan test lists the readers). Off: a product sold both ways is sold once only, one sold only as a
subscription is not offered, a line on a plan already in a cart is unavailable (the cart has no plan, renewal or consent tick, and checkout
waits until it is removed), the product editor shows no purchase options (`saveProduct()` keeps the product's options and "only as a
subscription" as stored, whatever a stale page sends), the discount editor does not offer "every renewal" (a code that has it keeps it), My
account has no Subscriptions list, the customer's page no subscriptions figure or list, the integrations no subscription events (chosen ones
are kept), the subscriptions analytics files are refused, and the renewal reminders skip the store. **After-sale stays**: a subscription's own
page (`/subscription/{token}`, its shop component is `afterSale` and draws while the feature is off), its emails' links, the order's
subscription card and the admin's links on orders. Switching off waits while any subscription runs, so there is nothing to renew.

**Subscription boxes (`boxes`).** Every reader asks the feature (`commerce.feature_on(store, 'boxes')`; `store.deliveriesOn` is derived from
it): the shopper's `/deliveries` (a 404) and its actions, My account's card, the product page's *Add to box*, the box cutoffs
(`prepareDueDeliveries()`), the delivery days' editor (its action refuses). The shop component and page place are named *Subscription boxes*
and tagged `boxes`. A box order already made stays chargeable and sendable from the order (switching off waits while a list is active or
paused or a box order waits to be sent and paid).

**Appointments (`appointments`) and Stays and rentals (`bookings`, with hosts).** Each kind apart: the product editor offers a kind only while
its feature is on (a product keeps its own kind, and can still be edited; `saveProduct()` refuses making one of a kind that is off), so the
accommodation VAT category (offered only for stays and rentals) follows. The booking pickers' loaders (`loadOffer()` and `loadRange()`)
ask the booking's own feature, so no time is offered, checked, held (the cart, `placeOrder()`) or moved by a shopper while it is off.
Staff (Appointments) and rooms and items (Stays and rentals) are changed, and their calendars' blocks and feeds kept, only while their feature
is on (`saveResource()`, `removeResource()`, `resourceFeatureOn()`); a resource's published iCal (`/api/calendar/{token}.ics`) is a 404 and
its other calendars are not read (`syncDueFeeds()`) while it is off. The week calendar is the appointments'; with only stays and rentals on
it opens their calendar. Hosts are Stays and rentals': the host area (`getHosting()`, `listHostings()`) is not there while it is off, and the
store's host actions refuse. The `host` product part is tagged `bookings`. Booking reminders go only for a booking whose feature is on. Hosts'
commissions already owed are still paid out (`payHostCommissions()` is not gated: money owed is after-sale; switching off waits until none
is unpaid). **After-sale stays**: an order's booking times and its `order_bookings` piece, the venue balance, a booking's emails and cancel
link, staff cancelling a booking or marking a no-show, and the DAC7 report's file (a tax obligation for what was sold).

The AI manager's `store_overview` names the features that are on; `list_bookings` lists each kind while its feature is on.

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
| `bonus` | — | customers holding credits and what they hold (in the program's currency), and that their expiry dates move on by the pause; the referral program going to sleep |
| `referrals` | — | referrers whose links stop giving discounts; rewards still pending (still decided as usual: they were earned while it was on) |

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
2. **The framework for hiding, and the Customers group** (done): section 4a's helpers (`FeatureOffNote`, `resolveFeatureShop()`,
   part tags, cookie tags) and `business`, `bonus` and `referrals` hidden and refused everywhere, admin and storefront, with the
   rules of section 4b (migration `store_features_customers_rules`).
3. **The Selling group** (done): `subscriptions`, `boxes`, `appointments` and `bookings` hidden and refused everywhere, admin, storefront,
   server and jobs, with the rules of section 4c (migration `store_features_selling_rules`), and `checkout-kinds.int.test.ts` scenarios.
4. **Countries and languages**: `countries`, `languages` and `currencies`: currency and language choosers, other markets, sitemap and
   feeds, the server refusing them.
5. **Redirects and website mode**: the storefront with the shop off (no prices, cart or checkout, product pages as
   content), addresses of a feature that is off answered sensibly (a 404 or a redirect), legal starters following the
   features.
6. **Onboarding**: a setup question ("What will you sell?") and store templates choosing features; new stores'
   defaults revisited.
