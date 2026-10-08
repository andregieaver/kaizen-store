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

## 4d. The Countries and languages group (step 4)

**The store's own country, defined once.** `homeMarket(store)` (`src/lib/markets.ts`) and `commerce.home_market()` in SQL: the active market of
`stores.country`, else the first active one in the order `getStore()` lists them (`created_at`, then the code). `getStore()` lists it first in
`markets` and `keptMarkets`, so everything that took `store.markets[0]` as the main market (the main currency, `marketIn(store, null)`, the
redirect resolver's main market, the chooser's language, the analytics' currency, the products list's price column) means it. `clone_store()` now
copies the template's markets in the template's order, its own country first: they were all made in one instant, so a new store with no country yet
took Denmark (by code) for its own, and with Several countries off by default that would have been the only country it offered.

**What `getStore()` gives.** `store.markets` is the countries **offered**: every active market while Several countries is on, else the store's own
alone (`offeredMarkets()`); `store.keptMarkets` every active market the owner keeps (the Countries page, a switch's facts); `store.allMarkets` every
market the store ever had, active or not (after-sale links). `store.localization` (`localizationOf()`, `src/lib/localization.ts`) follows the
features: `locales` are the languages in use (Several languages on: the store's chosen ones and each offered country's own; off: the main language,
which everything is written in first, and each offered country's own), `keptLocales` every language the store keeps texts in, `currencies` the ones
offered (off: each offered country's own only), `rates` the rate of every currency the store keeps, offered or not (the analytics convert past orders
with them), and `languageChoice`/`currencyChoice` whether a shopper may see a country in another language or currency than its own (`offers()`,
`currencyChoices()`, `languageChoices()`, `marketChoices()`). So with Several currencies off a Norwegian shopper is not offered Swedish kronor even
when Sweden is a country of the store (D109 offered every country's own currency to every country).

**Addresses.** `resolveShop()` finds only an offered market view. A page that finds none calls `marketMoved()` (a page whose content streams
calls `pageShopOrMoved()`, `src/server/shop-page.ts`, before its `<Suspense>` boundary, from the root parameters, so the move is the response's
status; the two pages with a token in the address, an invitation and a sign-in link, move inside the boundary, where the token is known): the same path in the market that offers the most of what the address asked
(`movedMarketSlug()`, `src/lib/market-move.ts`, pure and tested): a country not offered (Several countries off, or taken off the store's list) goes to
the store's own country, keeping a language and a currency it offers there; a language or a currency not offered is dropped (`no-en` → `no`,
`no-eur` → `no`, `se-en-eur` → `no-en-eur` with only the countries off). The answer is always an offered address, so a move never loops; a country
the store never had is the 404 it was. It is a 308, decided from the cached store alone (D168's rule: only where the request would be a 404; the
market layout draws the not-offered market's chrome so the page can decide). The query string is kept where the route reads it (D168's limit:
a prerendered page has none). The proxy is unchanged: it never sees an address with a market.

**After-sale stays.** `resolveAfterSaleShop()` opens a country, language or currency no longer offered, offered or retired (`allMarkets`, the kept
languages, any currency with a rate), for what a shopper already bought: an order and its terms, `/withdraw`, `/returns/{token}`, a hosted invoice or
credit note (`/account/documents/{token}` and its PDF), a Work invoice (`/account/invoice/{token}`), `/download` and its link, `/subscription/{token}`,
`/unsubscribe/{token}` and My account's order. Paying a draft order (`/account/pay/{token}`) and a change (`/account/change/{token}`) are not
after-sale: they sell, and are a 404 in a market not offered. `marketIn()` finds such a market for the parts of an after-sale page;
`offeredMarketIn()` (WordPress) does not. Emails keep their links: they lead to the market the order was placed in.

**The cart and checkout.** `commerce.market_offered(store, country, currency)` is the one rule: an active market, offered (Several countries on or
the store's own), in its own currency or (Several currencies on) another. `getCart()` marks every line of a cart in a market not offered
`unavailable` (so `cartSummary()` charges nothing), `sellableQuantity()` adds nothing there (the cart and the WordPress handoff), and `placeOrder()`
refuses it (`unavailable`): they agree (`checkout-kinds.int.test.ts`, kroner and euro). A cart is the country's whatever it is shown in, so a cart
in euro with Several currencies off is the same cart in kroner at the country's own address. The cart page of a country no longer offered says so
(`m.cartCountryClosed`) and links to the store's own country; a cart reminder's link leads there. A draft order is made, priced and sent only in
an offered country, language and currency (`marketOf()` in `src/server/draft-orders.ts`; a new draft starts in the store's own country); the
editor offers each country's own language and currency only while the features are off (`draftMarketOptions()`).

**Storefront.** The header's and footer's country lists and `MarketChoice` follow `store.markets`; `LocaleChoice` offers a language only with
`languageChoice` and a currency only with `currencyChoice`; the builder's *Countries* site part shows whichever of the three has more than one choice
(with one country, its list display is the languages and currencies). hreflang (the market layout, product, category and tag pages), Open Graph
`alternateLocale`, the sitemap and llms.txt (`listPublicStores()`) list the offered countries in the languages each is shown in.

**Admin.** Settings, *Countries* (`/admin/{store}/settings/countries`, `settings:write`; the Features page's *Set up* for Several countries) shows the
store's own country and, with the feature on, the list to sell to; with it off, the one country it sells in (choosing the same one changes nothing;
another makes it the only one on the list, the others keeping their prices and settings) and the countries kept for when it is on again
(`setMarkets()`, shared with the setup wizard, `CountriesForm`). Everything per country follows `store.markets`: product price columns, shipping,
payments, campaigns' and A/B tests' countries, the draft order's country, the legal starters' country list, the SEO page's front-page texts.
**Nothing is lost on a save**: a save writes the countries and languages it shows and keeps the others' values as they were (product prices,
booking fees and sign-up fees, discount codes' amounts and minimums, campaigns' thresholds and countries, shipping rates; menu labels, term SEO,
the store's SEO texts, return instructions, cart reminder texts, media alt texts). Languages and currencies (`/settings/localization`): each
section is a `FeatureOffNote` while its feature is off and its actions refuse; a kept country's own language and currency stay required.
*Translate the store* is tagged `["languages", "countries"]` (more than one language comes with either) and says so when only one remains; the
builder's AI translation needs more than one language as before. Analytics read past orders as they were (every country, every rate kept).

**AI.** `store_overview.countries`, the chat agent's `store_info.countries` and the AI manager's context list the offered countries;
`create_campaign` and `create_draft_order` refuse another (`saveCampaign()`, `createDraft()`).

**Blockers and warnings.** Several countries is blocked while subscriptions or box lists run in another country or a paid order there has goods
still to send, and warns of the other countries and of open carts there; languages and currencies warn only.

## 4e. Website mode (step 5)

With the online shop (`shop`) off the store is a **website**: its pages, blog, menus, header and footer, forms, cookies and privacy stay; nothing is
offered or sold. Every selling feature sleeps with it (their own switches are kept). Nothing is deleted, and switching the shop on brings back
everything as it was.

**One rule for what is offered.** `OFFERED` (`src/server/product-conditions.ts`) asks `commerce.feature_on(p.store_id, 'shop')` first, so every
shopper-facing product read is empty in a website: the catalogue, a product's page, listings, content grids of products, search, recommendations,
wishlists, the sitemap's products, categories and tags, llms.txt, WordPress and the chat agent. The cart marks every line unavailable, `changeLine()`
adds nothing, `placeOrder()` refuses (`unavailable`), a draft order is made and sent in no market (`marketOf()`), and the database refuses any new
order whoever asks (`orders_store_open()`, reason `orders.shop_off`, migration `store_features_website_rules`; a copied order still copies). No
renewal or box can be due: switching the shop off waits while subscriptions, box lists or bookings run, and while paid goods wait to be sent.

**Storefront.** The shop's pages (`/p/{handle}`, `/products`, `/category/…`, `/tag/…`, `/cart`, `/checkout`, `/wishlist`, `/search`) call
`sellingPageOr404()` (`src/server/shop.ts`) once they have their shop, before any `<Suspense>`: the store's 404, or a manual redirect's target where
one names the address (D168's rule: a lookup only where the request would be a 404). The search page is a 404, not a search of pages: search finds
products only (D72), and a search of pages and articles would be a new engine (the chat agent's `search_content` already answers from them). The
shop's actions and routes (cart, checkout, wishlists, type-ahead, a product's pickers, `cart/resume`, `cart/restore`, `search/go`, `wishlist/saved`,
the cart drawer, registering an account, the checkout's account actions) resolve with `resolveSellingShop()` and refuse. The front page draws the page
chosen for it (a grid of products in it draws nothing); without one it shows the store's name and description, never a list of products. The All
products page chosen for `/products` keeps its own address. The standard header, the phone's menu and bottom bar have no search, My account,
wishlist or cart; menus leave out the shop's links (`shopLink()`: All products, My account, the cart, a product, a category or tag); the notice says
nothing of payments. Builder parts carry `shop` (part-features, section 4a): the header's and footer's search, account, wishlist and cart, the
cart, checkout, wishlist, category and tag components and their pieces, a content grid of products (`contentGrid` with a products source) and the
search component; the order's page and its pieces, My account and its sign-in are `afterSale` (out of the palette, still drawn). The cart, wishlist
and recommendations' storage are tagged `shop` in `KNOWN_COOKIES`.

**After the sale (the owner's decision).** What was sold stays reachable while it can still matter to a shopper: `afterSaleOf(storeId)`
(`src/server/after-sale.ts`) counts the orders with a line that can still be withdrawn from or returned, each judged by the withdrawal function's own
`lineEligibility()` (the 14 days from receipt, the store's own window, sealed and excluded goods, business orders; no rule of its own), and the
returns not ended (`isEnded()`). An order sent and not recorded as received keeps the right open (`withdrawalWindow()`: the period starts on receipt),
so recording deliveries is what lets after-sale close. While either count is above zero:

- the admin's Orders, an order with its slips and terms, Returns and a return, and Invoices (`AFTER_SALE_ADMIN_PATHS`) open for members who may read
  them (`requireShopOrAfterSale()`), out of the menu: Home and the Features page say how many orders and returns are open and link to them
  (`AfterSaleNote`);
- the storefront's footer keeps the withdrawal link (`showsWithdrawalLink()`, the standard footer, a footer's *Withdrawal link* part and the strip
  under a footer without one; `afterSaleOpenCached()`, an hour, refreshed with the features), and the withdrawal information and returns policy stay
  in the footer's legal links.

When both are zero, those pages show `FeatureOff` and the link goes. Whatever the counts, the after-sale routes open (section 4 point 6): an order's
page by its key, `/withdraw`, `/returns/{token}`, hosted documents, downloads, a subscription's page and My account for customers the store has
(their orders and their data, D162; it is not linked and opens no new accounts). Pay links of orders already waiting for payment keep working, as
the shop's warning says.

**Admin.** Hidden (`feature: "shop"` on the navigation items and `ADMIN_PAGES`, `requireFeature(member, "shop")` on the pages): Orders (the section),
Products, Inventory, Product layouts, Customers, Customer groups and Wishlists (Privacy requests and erasing a person's data stay: GDPR is a
website's too), Campaigns, Coupons, Recommendations and Cart reminders (A/B tests stay), the sales analytics (Overview, Finance, VAT, Customers,
Products, Inventory, Marketing; Traffic and Analytics settings stay), and the selling settings (Payments, Shipping and the shipping carriers, Orders,
Returns, Tax, Invoicing, Search). A section whose main page is hidden opens on the first page it has left (Customers on Privacy requests). The AI
manager's selling tools carry `shop` in `TOOL_FEATURES` (and so leave the store's MCP server). Home shows no sales, latest orders or analytics alerts,
and its checklist no shipping, payments or products; the control center shows the store as a *Website*, without sales or stock. The admin layout sets
up no Stripe test account or payment methods for a website. Pages: the All products choice and the Special pages of the shop are not offered.

**Legal pages.** `LEGAL_ROLE_NEEDS` (`src/lib/legal-roles.ts`, `legalRoleNeeded()`): the terms of sale, returns and shipping policies and withdrawal
information need the shop; privacy, imprint and accessibility are always needed. A website's footer links only what it needs (the withdrawal
information and returns policy while after-sale is open); the Legal pages screen marks the others "Not needed while the online shop is off" (chosen
pages are kept) and has no checkout setting.

**Outside the store.** The sitemap and llms.txt list no products, categories or tags (llms.txt says who runs the site instead of how to buy, and a
website's All products page is listed at its own address); WordPress lists no website and answers its routes as for a store that is not there;
`/api/recommendations` and its events answer 404; the chat agent gets no product tools, cannot open the shop's places and states no shipping or
return policy; cart reminders and low-stock notices skip a website.

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
| `countries` | subscriptions or box lists in another country than the store's own; paid orders with goods still to send there | other countries no longer offered; open carts there |
| `languages` | — | languages besides each country's own hidden (translations kept) |
| `currencies` | — | extra currencies no longer offered |
| `business` | — | open carts with a VAT number; products for businesses only; company accounts |
| `bonus` | — | customers holding credits and what they hold (in the program's currency), and that their expiry dates move on by the pause; the referral program going to sleep |
| `referrals` | — | referrers whose links stop giving discounts; rewards still pending (still decided as usual: they were earned while it was on) |

The store's own country is `stores.country`'s market, else its first active market (as `getStore()` orders them): `commerce.home_market()`.

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
4. **Countries and languages** (done): `countries`, `languages` and `currencies` hidden, moved and refused everywhere, with the rules of
   section 4d (migration `store_features_world_rules`), and `checkout-kinds.int.test.ts` scenarios.
5. **Redirects and website mode** (done): the storefront with the shop off (no products, prices, cart or checkout), the shop's addresses the
   store's 404 through `missOrRedirect()`, legal pages following the features, with the rules of section 4e (migration
   `store_features_website_rules`). **Decided by the owner:** with the shop off, Orders stays reachable (out of the main menu) while any order can
   still be withdrawn from or has an open return, and the footer's withdrawal link stays as long; then both disappear. Nothing is deleted.
6. **Onboarding**: a setup question ("What will you sell?") and store templates choosing features; new stores'
   defaults revisited.
