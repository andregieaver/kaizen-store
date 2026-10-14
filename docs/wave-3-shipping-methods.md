# Wave 3, shipping methods: rate tables, zones and profiles, local pickup and local delivery (decision D237 proposed)

This file is the contract for the run `parity-wave` with `wave: 3`, `spec: docs/wave-3-shipping-methods.md`. Code, tests and texts follow it; a disagreement is settled
here first (the agent that must deviate changes this file in the same edit, in a "3.x As built" paragraph, and says so in its report). It was written from the tracker
rows, `docs/parity-plan.md`, CLAUDE.md and the code as it is on 2026-10-14 (commit `95c1758`), and follows the shape of `docs/returns.md` and
`docs/wave-3-fulfilment.md`. It builds on what exists (`commerce.shipping_rates`, `delivery_quotes`, `chosenDelivery()`, `basketShipping()`, `cartSummary()`,
`placeOrder()`, `store_locations` (D40), `markSent()`/`shipment_lines`/`toSend()`/`refresh_fulfilment()`/`undoShipment()` (D174), `markDelivered()` (D153),
`orderListWhere()` (D173), `decideTax()` (D157)) and invents no parallel order, fulfilment, pricing or tax system.

**What was found in the code that shapes everything below** (verified 2026-10-14):

- **Shipping today is one flat rate per market** (`commerce.shipping_rates`: `amount_minor`, `free_over_minor`, both VAT-inclusive in the market's own currency, primary key
  `(store_id, market_code)`), edited at `/admin/{store}/settings/shipping` (`getShippingSettings()`/`saveShippingSettings()` in `src/server/settings.ts`, audit
  `shipping.updated`). It is read by `getCheckoutInfo()` (`src/server/orders.ts`, for `cartSummary()`), `placeOrder()` (`src/server/checkout.ts`, `no_shipping` when it is
  missing and nothing was chosen), the subscription renewals (`src/server/subscriptions.ts`), weekly boxes (`standing-orders.ts`), drafts (`draft-orders.ts`,
  `rateShipping()` in `src/lib/draft-order.ts`), returns (`standardShipping()` in `returns.ts`), `getShippingFacts()` (`src/server/seo.ts`: product JSON-LD and the chat agent),
  `legal-facts.ts` (legal starters), `setup.ts` (the wizard's progress) and the store copy (`clone_store()`, `duplicate_store()`; `COPY_RULES` class `settings`).
- **The basket's charge** is `basketShipping(lines, rate, { trial })` (`src/lib/subscriptions.ts`) over `shippingCost(subtotal, rate)` (`src/lib/checkout.ts`): free when the
  basket's value (line totals before discounts, downloads included, gifts out) reaches `freeOverMinor`. A subscription pays the flat rate per delivery (D25).
- **Carrier services at checkout** (D135 to D138): the shopper types a postal code in `DeliveryChoice` (`src/components/delivery-choice.tsx`, on the checkout pay route),
  `quoteDelivery()` stores `delivery_quotes`, `chooseDelivery()` sets `carts.delivery_quote_id`, and `chosenDelivery()` is the **one reader** that both `cartSummary()` and
  `placeOrder()` use; its rate replaces the flat rate in `basketShipping()`. The order keeps `orders.delivery` (jsonb, `readOrderDelivery()`: `carrier`, `serviceId`, `label`,
  `postalCode`, `pickupPoint`, `window`). `deliveryChoiceOn()` shows the choice only when a carrier is active in the country. Carriers weigh a cart by the variants'
  `weight_grams` plus their own `default_weight_grams` **once per basket** for goods without a weight (`cartWeightGrams()`); the flat rate never reads a weight.
- **The shipping address is collected by Stripe after the order is placed** (`saveCustomer()` in `stripe-webhooks.ts` writes `orders.shipping_address` from the session). The
  postal code a delivery is priced for is therefore *typed by the shopper before paying*, not proven by the address: D135 already lives with this and never checks the two
  against each other.
- **Places** (`commerce.store_locations`, D40): kinds `office`, `shop`, `pickup`, with address, phone, notes and opening hours (`src/lib/opening-hours.ts`), edited at
  `/admin/{store}/settings/company/places` (`saveLocation()`, `deleteLocation()` in `src/server/company.ts`; **delete is a hard delete**). They are information only; appointments
  point at one (`appointment_settings.location_id`). They are **not** the stock locations of D172 (`inventory_locations`), which have no address.
- **Sending** (D174): `markSent()` is the only writer of `shipments` and always writes `shipment_lines`; units to send are only `toSend()`/`commerce.line_to_send()`; an order
  becomes `fulfilled` only through `refresh_fulfilment()`; `markDelivered()` sets `delivered_at` (the start of the withdrawal period) and needs the order sent in full;
  `undoShipment()` takes a parcel back. The Orders list's *To send* is `ship=to_send` = `o.status = 'paid' and PHYSICAL_SQL` (`src/server/order-list-sql.ts`).
- **Products** have no shipping class of any kind; `product_variants.weight_grams` is optional (> 0 when set).
- The repo has **no signed-in admin fixture** (D158): admin screens are held by `renderToString` view tests and server integration tests; the storefront is clicked by e2e
  against `pnpm start` without Stripe.

---

## 1. Purpose and scope

### 1.1 Rows this run closes, and what each can honestly reach

| Row | Weight | Now | Bucket | What this run can honestly reach |
|---|---|---|---|---|
| `orders.weight-or-price-rate-tables-zones-profiles` | 4 | partial | A | **Full** by the criteria: tiers by basket weight and by basket value per market with a stated fallback (unit), zones of postal-code patterns inside a country (unit of matching, integration of checkout), shipping profiles with the stated mixed-basket rule (sum per method, as Shopify's classic profiles) equal in `cartSummary()` and `placeOrder()` with a euro scenario (`checkout-kinds.int.test.ts`), and the store's default weight per unit for goods without one. The admin screens are held by view tests and server tests (no signed-in fixture, D158); the skeptic may hold the row at partial for that, and the lead decides after 9.7. |
| `orders.local-pickup-at-own-location` | 3 | missing | A | **Full** by the criteria, after one criterion's wording is read as this spec reads it (6.4: the handover is recorded as a `shipments` row of method `pickup`, so D174's counting holds; it is no carrier parcel, has no tracking and sends no shipped email). Checkout offers pickup per place with instructions and a price (free by default), equal in `cartSummary()`/`placeOrder()` with a euro scenario; *Ready for pickup* sends one email in the order's language with address, hours and instructions; *Collected* fulfils the order and starts the withdrawal period; pickup orders are not in *To send*. Rated **partial** instead if the lead does not accept the reading of 6.4. |
| `orders.local-delivery` | 2 | partial | A | **Full** by the criteria: an area by postal-code patterns or by a radius from a place, with a price, a minimum basket and a free-above value, offered only inside the area (unit of matching, integration of checkout), equal in `cartSummary()` and `placeOrder()` in the euro view, and listed apart for staff with address and delivery note. **One honest limit, stated in the product:** a radius is measured between postal-code centroids from GeoNames reference data (4.6), not between street addresses; an address whose postal code is not in the reference data is outside every radius area. No third party is called at run time. |

No row is bucket B, C or D: nothing needs an agreement, a credential or a decision of `docs/parity-plan.md` section 5 (no geocoding service is used; the postal-code
reference data is CC BY 4.0, 4.6). **`blockers` is empty.** Weights are not changed (tracker rule 6).

Rows this run touches but does not close: `orders.order-list-search-filters-saved-views-bulk` (gains the `pickup`, `local` and `delivery_mismatch` filter values, the views
*To hand over* and *Local deliveries*, and the bulk action *Ready for pickup*), `orders.tracking-page-and-delivery-notifications` (gains the *Ready for pickup* and *Out for
delivery* emails; its own criteria are not this run's), `orders.editable-notification-email-templates` (the new emails are fixed texts), `checkout.*` rows about the checkout
page (nothing is rated there).

### 1.2 What Shopify does (pages read on 2026-10-14)

- **Rates and conditions** (https://help.shopify.com/en/manual/fulfillment/setup/shipping-rates/setting-up-shipping-rates): flat rates, and rates with a condition on
  order amount or weight with a Minimum and a Maximum ("leave this field empty" for no maximum). "Each customer is offered only rates that apply to their order, and the cheapest
  rate displays as the default." If an order falls outside every tier, "no rate applies and the customer receives a shipping error at checkout"; an address outside every zone gets
  "a notice that no shipping rate is available for their region". Transit time is optional and shown at checkout. Whether a Minimum or Maximum is inclusive is not stated (the
  examples leave one-cent gaps).
- **Profiles** (https://help.shopify.com/en/manual/fulfillment/setup/shipping-profiles): "A shipping profile is a set of shipping rules for specific products and locations";
  every store has a general profile with every product, and "up to 99 custom shipping profiles"; "If a product or variant isn't in a custom profile, then it uses the general shipping
  rates."
- **Mixed baskets** (https://help.shopify.com/en/manual/fulfillment/setup/shipping-profiles/combined-shipping-rates): "Shipping rates with the same name are added together and
  displayed to your customer at checkout", even across profiles; "If the rates aren't named the same in both profiles, then only the cheapest options are added together and shown to
  the customer at checkout as `Shipping`." Weight-based rates take each product's weight plus the store's default package weight.
- **Shopify is moving away from this** (https://help.shopify.com/en/manual/fulfillment/setup/shipping-options/whats-changing-with-shipping, early access, gradual, no date):
  shipping options per market with product and location conditions on each rate; "When a cart matches more than one rate within a shipping option, your customers are charged the
  price of the highest rate", and options are added together. This spec models **per-market methods with product (profile) conditions and zones**, which reads both ways; the
  rule it chooses for a mixed basket is the classic **sum per method name** (4.2), the one the row's criterion allows ("the dearest profile, or the sum").
- **Pickup in store** (https://help.shopify.com/en/manual/fulfillment/setup/delivery-methods/pickup-in-store): switched on per location; a processing time "is displayed at
  checkout"; pickup instructions per location go into the *Ready for pickup* notification; "When you mark an order as ready for pickup, a Ready for pickup notification email is sent
  to your customer"; *Mark as picked up* marks the order fulfilled, with an optional *Picked up* email. The page names no price; the row's criterion asks for one (free by default).
- **Local delivery** (https://help.shopify.com/en/manual/fulfillment/setup/delivery-methods/local-delivery): per location, a radius ("The maximum delivery radius is 160 kilometers",
  never into another country, the business location must be verified) or a list of postal codes (exact; a prefix with `*`, up to 3,000 characters); up to 10 zones per location,
  each with up to 3 price rules by order value and an optional minimum order; "When a customer is located within multiple zones with multiple conditional prices, the customer is
  always charged the lowest applicable delivery price"; delivery information per zone in the confirmation email; customers may add delivery instructions and must give a phone number.

**What Kaizen matches**: methods per market with flat, weight or value tiers, zones by postal-code patterns, profiles of products with a General profile, cheapest as default,
transit time, pickup per place with a price, ready time and instructions, the *Ready for pickup* email, *Collected*, local delivery by postal codes or radius with a price,
minimum basket, free-above, information and the shopper's note, cheapest of overlapping areas.
**Where Kaizen goes further on purpose:** a basket in no tier falls to the market's flat rate when one is set (a stated default rather than an error); the postal code a price
was set for is compared with the address Stripe collected, and a difference is flagged to staff (2.7); collecting starts the withdrawal period on the day (CRD Art. 9(2)(b)).
**What it deliberately does not match**: section 7 (price rules per local zone beyond one free-above, store transfers, a *Picked up* email, carrier-calculated rates inside
methods, rates per stock location, variant-level profiles, Shopify's newer "highest rate within an option").

### 1.3 Terms used in this file

- **Method**: a named way of shipping in one market that the owner prices (`shipping_methods`, e.g. *Standard*, *Express*), with **rates** per zone and profile.
- **Zone**: a named group of postal-code **patterns** inside one market's country (`shipping_zones`). **Rest of country**: every postal code no zone of the market matches,
  and the only zone a market without zones has (`zone_id` null in a rate).
- **Profile**: a named group of products (`shipping_profiles`); **General** is every product with no profile (`products.shipping_profile_id` null).
- **Rate**: what a method costs one profile's part of the basket in one zone (`shipping_method_rates`): a **basis** (`flat`, `weight` or `value`), a range (`min` inclusive,
  `max` exclusive, null open) and an amount. The rates of one (method, zone, profile) are its **tiers**.
- **Pickup option**: a place of kind `shop` or `pickup` where shoppers may collect (`pickup_options`). **Local area**: a delivery area of the store's own drivers
  (`local_delivery_areas`), by postal-code patterns or by a radius from a place.
- **Delivery method of an order** (`orders.delivery_method`): `ship` (flat rate, a method or a carrier's service: a parcel), `pickup` or `local`.
- **Delivery postal code**: the postal code the shopper typed for pricing (`carts.delivery_postal_code`), kept on the order in `orders.delivery.postalCode`.
- **Handover**: a `shipments` row of method `pickup` (collected) or `local` (taken out for delivery or delivered by the store's driver), written by `markSent()` like a parcel.
- **Basket weight** of a profile part: Σ quantity × (`weight_grams` or the store's default weight) over its physical, non-gift, non-recurring lines. **Basket value** of a part:
  Σ line totals before discounts, as shown (the same value `basketShipping()` judges free shipping on), gifts out.

### 1.4 Decisions this spec makes (the lead may veto any before the build; each is argued where it is used)

1. **The flat rate stays** as the market's default and fallback, and as the only shipping of subscriptions, weekly boxes and drafts (4.1). A market with no active method works
   exactly as today; nothing changes for a store that does nothing.
2. **Methods replace the flat rate as the offer** when a market has at least one active method: the shopper sees the methods that price the basket (cheapest preselected); the flat
   rate is offered (as *Shipping*) only when no method prices it, and the basket is refused (`no_shipping`) when neither does (4.2).
3. **A mixed basket is charged by the sum**: a method is offered only when every profile in the basket has a tier of it that matches; its price is the sum of the tiers (4.2).
4. **Weight without a weight**: a goods variant with no `weight_grams` weighs the store's default weight **per unit** (`shipping_settings.default_weight_grams`, 500 g by default) in
   methods' weight tiers. Carriers keep their own setting and rule (D135) unchanged (7).
5. **Zones match the most specific pattern**: an exact postal code beats a prefix, a longer prefix beats a shorter one; two zones of a market may never hold the same pattern.
6. **The cart keeps one choice**: a carrier quote, a method, a pickup option or a local area (at most one, a check), and the postal code; `chosenDelivery()` stays the one reader and
   now returns every kind, re-pricing own methods against the basket on every read (never a stored price) (4.2).
7. **A handover is a shipment** (method `pickup` or `local`, no tracking), written by `markSent()`, so D174's counting, `refresh_fulfilment()`, D153's "nothing sent" and
   `undoShipment()` need no second rule (4.4).
8. **Collecting starts the withdrawal period** on the day it is recorded (`delivered_at`, CRD Art. 9(2)(b)): *Collected* writes the handover and the receipt together (4.4).
9. **A priced postal code that differs from Stripe's address is never re-charged**: the order is flagged for staff (`orders.delivery_mismatch_at`, event, list filter) (2.7).
10. **Radius by postal-code centroids** from GeoNames' CC BY 4.0 postal data for the countries loaded (NO, SE, DK, FI first); no address geocoding, no third party at run time (4.6).

---

## 2. Behaviour

### 2.1 Staff side: methods, zones and profiles (`/admin/{store}/settings/shipping`, `settings:read` to see, `settings:write` to change; the `shop` feature)

The Shipping page becomes the section's hub (cards, D226): **Flat rate per country** (the table as today, renamed, its description now "the default, and what is charged
when no method fits"), **Methods** per market, **Zones**, **Profiles**, **Default weight**, and links to **Pickup** and **Local delivery** and to the carriers (Integrations).

- **Methods** (`/settings/shipping/methods?market=NO`, one list per market of `store.markets`, D178's offered countries): add, edit, reorder, switch off. A method has a name (in
  the store's main language, translations in the store translation worklist, scope `shipping`), an optional transit time (*1–3 days*, whole days 0 to 60), an optional free-above
  value (basket value as shown, the market's currency), and its rates. At most 10 methods a market.
- **Rates of a method** (the method's page): a grid with one block per zone (Rest of country first, then each zone) and, inside it, one block per profile (General first). Each
  block chooses its basis: *Flat* (one price), *By weight* or *By basket value* (tiers: *from* … *up to*, last *and above*, price), or *Not offered* (no rows). Up to 10 tiers a
  block. The editor shows the tiers as a ladder and refuses a gap or an overlap before saving (`tierProblems()`); the database refuses them too (3.3). A block left *Not offered*
  means the method is not offered to a basket holding that profile in that zone, which the page says beside it.
- **Zones** (`/settings/shipping/zones?market=NO`): name and postal-code patterns typed as a list (comma, space or line separated; `0150`, `01*`, `5*`), normalised by the
  country's rule (`cleanPostalPattern()`: the same characters `cleanPostalCode()` accepts, then an optional `*`), at most 1,000 patterns and 3,000 characters a zone, 20 zones a
  market. A pattern another zone of the market holds is refused, naming the zone. *Check a postal code* shows which zone and which rates it gets (`zoneFor()`), so the owner
  can try before saving.
- **Profiles** (`/settings/shipping/profiles`): name, the products in it (chosen by search, with a count), at most 20 profiles a store. Deleting a profile moves its products to
  General in the same transaction (the page says how many) and removes its rates. The product editor gets a *Shipping profile* field (a `select`, General by
  default) saved with the product (`productInput.shippingProfileId`, `saveProduct()`).
- **Default weight** (on the hub): grams, 1 to 35,000, default 500; the text says it is used per unit for goods without a weight in methods' weight tiers, and that carriers have
  their own setting.
- **Warnings the hub shows** (computed, never stored, `shippingWarnings()`): a market with methods and no flat rate ("baskets no method prices cannot be bought"); a market with a
  zone and no Rest of country rate on any method ("addresses outside your zones cannot be served"); subscriptions or weekly boxes on with no flat rate ("subscriptions pay the flat
  rate"); weight tiers in use while active goods variants have no weight ("N variants use the default weight").
- Every save is one transaction, audit-logged with area `shipping` (`shipping.method_saved`, `.method_deleted`, `.zone_saved`, `.zone_deleted`, `.profile_saved`,
  `.profile_deleted`, `.default_weight_saved`; `auditChange()` with names, counts and amounts in minor units, never a pattern list longer than its count) and refreshes
  `catalogTag(store)` (structured data reads shipping, 2.6).

### 2.2 Staff side: pickup (`/admin/{store}/settings/shipping/pickup`, `settings:write`; and the order page, `orders:write`)

- **Setting it up**: each place of kind `shop` or `pickup` is listed with a switch *Customers can collect here*, a price (empty or 0 = free; in the currency of the market whose
  country the place is in), *Usually ready in* (0 to 720 hours; 0 = "ready the same day" is not promised: 0 shows "We will email you when it is ready"), and *Pickup instructions*
  (up to 1,000 characters, main language, translations in the worklist, scope `shipping`). A place in a country the store does not sell to shows "not a country you sell to" and
  cannot be switched on. At most 20 pickup options a store (D40's place limit already bounds it).
- **Deleting a place** (`deleteLocation()`) is refused while a paid, not collected, not cancelled order has `pickup_location_id` = that place (`pickupBlockers()`), naming how many;
  otherwise its pickup option goes with it. Editing a place's address changes nothing on orders already placed (they keep a snapshot, 3.1).
- **The order page** of a pickup order shows *Collect at {place}* with the snapshot address, hours and instructions, and two buttons:
  - **Ready for pickup** (`markReadyForPickup()`): refused for an unpaid, copied, cancelled or closed order, an order with backordered units still waiting
    (`waiting_for_stock`), one with a change waiting for payment (D174), one already collected, and one already marked ready (the second press says when it was marked and offers
    *Send the email again*, which sends only if the first email failed: the email's key is per order, 2.5). Sets `orders.ready_for_pickup_at`, writes event
    `order.ready_for_pickup`, and sends the email once.
  - **Collected** (`markCollected()`, optional day, as *Mark delivered*): refused for the same states except "not ready" (a customer may come before the email). One transaction
    under the order's lock: a handover shipment of method `pickup` with every unit still to send (`markSent()` with `method: 'pickup'`, no carrier, no tracking), the order to
    `fulfilled` by `refresh_fulfilment()`, `delivered_at` set to the day (noon in the store's time zone, not in the future, not before the order, the same rules as
    `markDelivered()`), events `order.collected` (and `order.sent` as `markSent()` writes it, with `method`). No shipped email.
  - A mistaken *Collected* is taken back with D174's **Undo** on the handover (`undoShipment()`): it clears `delivered_at` and returns the order to `paid` (to hand over again).
- **The Orders list**: pickup orders are **not** in *To send*; the new view **To hand over** (`show=to-hand-over` = `ship=pickup`: paid, `delivery_method = 'pickup'`, not
  fulfilled) lists them with the place and a *Ready* chip when marked; a column *Delivery* shows the method's label for every order. Bulk **Ready for pickup** (`runBulk()`, 250 at
  most) marks each selected pickup order and reports each refusal; bulk *Mark as sent* refuses a pickup order (`pickup_order`).

### 2.3 Staff side: local delivery (`/admin/{store}/settings/shipping/local`, `settings:write`; and the order page, `orders:write`)

- **Areas**: name, market (the place's country), kind **Postal codes** (patterns as zones) or **Radius** (1 to 160 km from a place of kind `office`, `shop` or `pickup`), price,
  minimum basket (optional), free above (optional), *Delivery information* (up to 500 characters, shown at checkout and in the confirmation, translatable, scope `shipping`), active.
  At most 10 areas a place and 30 a store. A radius area needs the place's coordinates: taken from the place's postal code in the reference data (4.6) when it is saved, or typed by the
  owner (latitude and longitude on the place); without either the area cannot be switched on. The page states the limit: "Distances are measured between postal-code centres, so
  an address near the edge may be counted in or out", shows how many of the country's postal codes the circle includes, and *Check a postal code*. A country with no reference data
  loaded offers postal-code areas only.
- **The order page** of a local-delivery order shows *Local delivery: {area}*, the address, the phone and the shopper's delivery note, and:
  - **Out for delivery** (`markOutForDelivery()`): a handover of method `local` (every unit to send, no tracking) through `markSent()`, the order `fulfilled`, and the *Out for
    delivery* email (2.5).
  - **Delivered**: the existing *Mark delivered* (`markDelivered()`); pressed on a local order that was never taken out, it first writes the handover (one transaction, no email
    but the existing ones), so a driver who delivers at once needs one press.
- **The Orders list**: local orders are not in *To send*; the view **Local deliveries** (`show=local` = `ship=local`: paid, `delivery_method = 'local'`, not delivered) lists
  them with the address's postal code and city, the area, the phone and the first 80 characters of the note, sortable by postal code (keyset paging by `(postal, placed_at, id)`).
  The packing slip and pick list (D174) print the note on a local order and the place on a pickup order.

### 2.4 Shopper side (checkout pay route; every word in `m.delivery.*`, nb, sv, da, en by hand, other languages through the catalogue)

- **The cart page** (`cartSummary()`): shipping is the default delivery for the basket (4.2) at the cart's delivery postal code, or for Rest of country before one is given.
  When the market has zones, a local area or a pickup option, the shipping row says *From {price}* until a postal code is given or a pickup is chosen, and *Choose delivery at
  checkout* below (CRD Art. 6(1)(e): where charges cannot be calculated in advance, the fact that they may be payable, 4.7).
- **The checkout's delivery choice** (`DeliveryChoice`, extended; shown whenever the market has a method, a zone, a pickup option, a local area or a carrier, `deliveryChoiceOn()`):
  1. *Postal code* first (the D135 field, now also stored on the cart, `setDeliveryPostalCode()`), then the options grouped: **Delivery** (methods that price the basket in that
     zone, cheapest first, each with its price for this basket, *Free* when it is, transit time when set, and the carriers' services as today), **Local delivery** (the areas whose
     postal codes or radius include the code and whose minimum the basket reaches, cheapest one only (Shopify's rule), with its information and a *Note for the driver* field,
     500 characters, cleaned by `cleanShopperText()`), **Collect** (every active pickup option of the market, with address, opening hours today and *Usually ready in …*, its price
     or *Free*).
  2. A local area the basket is below the minimum of is shown greyed with *Local delivery from {minimum}* (the shopper sees why), never selectable.
  3. Choosing one re-places the order (as D135 does) at the price it shows; the cheapest method (or the flat rate) is preselected; pickup and local delivery are never preselected.
  4. **The pay press is refused** with *Enter your postal code to see the delivery price* when the market has zones or a local area and the cart has no delivery postal code
     and pickup is not chosen (`deliveryReady()`, checked by the server action the pay press calls before Stripe's `confirm`, beside `recordTermsAcceptance()`), and with
     *Delivery has changed, check the price* when the chosen option no longer prices the basket (the order is placed again, 2.7).
  5. **Pickup**: Stripe's form asks no shipping address (`OpenCheckout.ships` is false for a pickup order; `orders.shipping_address` stays `{}`); billing and email as today.
     **Local delivery**: Stripe's form asks the address and the phone (`phone_number_collection`).
- **The order page and the account's order page**: *Collect at {place}* with the snapshot address, hours and instructions, and *Ready for pickup* / *Collected on {day}* when they
  happened; *Local delivery* with the information and the note; a method's label (`order.delivery?.label ?? m.shipping`, as today).
- **The hosted-page fallback** (Stripe's own page, D22): the delivery choice is not shown; the order carries the default delivery for Rest of country, and the mismatch flag (2.7)
  tells staff when the address belongs to a dearer zone: an order priced with no postal code (a method at Rest of country, or the flat rate) is flagged with `priced: null`
  when the address is in a zone (for the flat rate: a zone some active method prices). The pay press's check (point 4) fails closed: when it cannot be asked, the press waits
  with *We could not check the delivery. Try again.* (`m.deliveryOptions.checkFailed`); the flag is the net for an order paid any other way. Pickup and local delivery are not offered there.

### 2.5 Emails (`src/lib/email-text.ts`, hand-written nb, sv, da, en; other languages through `emailText()`'s catalogue; kinds added to `EMAIL_KINDS`)

- **Ready for pickup** (`order.ready_for_pickup`, key `order-ready:{orderId}`, once per order): to `order.email` only, in the order's language: the order number, the place's name,
  address and opening hours (the next seven days, `openingHoursLines()`), the pickup instructions (the owner's text in the order's language, else the main one, as plain text), the
  lines still to hand over (no prices), what to bring (*your order number*), and the order page link. Never to a restricted or anonymised order (`sendEmail()` refuses, D162),
  never for a copied order, held back for a store template (D175).
- **Out for delivery** (`order.out_for_delivery`, key `order-out:{shipmentId}`): the order number, *on its way today with our own delivery*, the area's information, the address
  (postal code and city only), the order page link. Not sent for a weekly box (D102 keeps its own).
- **The order confirmation** gains the delivery block: the method's label and transit time; or the pickup place and *We will email you when it is ready*; or the local area's
  information and the shopper's note.
- **The shipped email** (`sendShipped()`) is sent only for handovers of method `parcel` (D174's per-parcel email); a `pickup` or `local` handover never sends it.

### 2.6 Platform side, structured data, the chat agent, the AI manager

- **Structured data** (`getShippingFacts()`): `OfferShippingDetails` is emitted only when the market's shipping is one unambiguous price for the General profile at Rest of
  country: the flat rate with no active method (as today), or exactly one active method whose General/Rest-of-country rate is one `flat` tier (its amount and free-above), in a
  market with no zone and a store with no profile (a zone or a profile sends some baskets to the flat rate, so the method's price is not the one price). Any
  tiers, zones-only rates, zones, profiles or several methods: no shipping details (never a "from" price claimed as the price). Pickup is not structured data in this run.
- **The chat agent** (`chatContext()` reads `getShippingFacts()`): unchanged facts; it may add *Collect in store at {places}* from `pickupFacts()` (names and towns, never
  prices it was not given), worded by the site.
- **The AI manager**: read-only, ungated owner tools `shipping_overview` (methods, zones, profiles, pickup options and areas per market, with counts and amounts by
  `formatMoney()`) and `pickup_orders` (paid orders to hand over or deliver locally, by place or area, counts and numbers, never an address); a row each in `TOOL_WORDS`,
  `TOOL_PERMISSIONS` (`settings:read`, `orders:read`), `TOOL_FEATURES` (`shop`), and served over MCP as owner tools. No tool changes shipping or marks an order ready or collected
  (7). The platform has no new screen.
- **Plan comparison** (D132): rows *Shipping methods, zones and profiles*, *Local pickup*, *Local delivery* in category *Orders and shipping*, granted to every plan, by migration.

### 2.7 Edge cases and failure behaviour

- **No method prices the basket** (a weight above the last tier with a maximum, a profile *Not offered* in the zone, a zone with no rates): the flat rate is offered as *Shipping*
  when set; otherwise the checkout says *We cannot deliver this basket to {postal code}. Collect it, or contact the store* and the pay press is refused (`no_shipping`), with pickup
  and local delivery still offered when they apply.
- **The basket changes after a choice**: `chosenDelivery()` re-prices an own method on every read; a method that no longer prices the basket, a local area the basket fell below
  the minimum of or that no longer covers the postal code, a pickup option switched off, or a place deleted makes the choice **void** (`chosenDelivery()` returns the default
  instead and `cartSummary()` reports `deliveryChanged`), and the pay press is refused once with *Delivery has changed, check the price*. `cartSummary()` and `placeOrder()`
  read the same, so they agree in every state.
- **The address Stripe collected has another postal code than the one priced** (`orders.delivery.postalCode`), for an order of method `ship` with zones or a carrier, or
  `local`: `applySession()` (after `saveCustomer()`) compares the two (`postalMismatch()`, after `cleanPostalCode()`: a different zone or area, or a different code for a
  carrier's service); on a difference it sets `orders.delivery_mismatch_at`, writes event `order.delivery_mismatch` (`{ priced, address }`: the two postal codes only), and the
  order page shows *Priced for {priced}, address is {address}: check the delivery before sending*. The payment is never changed or refused (the money was the shopper's choice);
  staff may change the shipping through D174's edit or contact the shopper. A pickup order is never flagged. The list filter `ship=delivery_mismatch` finds them.
- **Concurrency**: `markReadyForPickup()`, `markCollected()` and `markOutForDelivery()` lock the order row (`for update`) and pass D174's `seen` basis; two staff pressing at once
  get one success and one *changed*. A method or zone saved while a shopper checks out changes the next read; the order is priced by what it read inside `placeOrder()`'s
  transaction.
- **A postal code in no reference data** (radius): outside every radius area; postal-code areas still match it.
- **Gift orders** (D173): the gift block shows on pickup and local orders as on parcels; the *Ready for pickup* email goes to `order.email`, never to the recipient.
- **Backorders** (D172): a pickup order with units waiting cannot be marked ready or collected (`waiting_for_stock`); a local order cannot be taken out (`markSent()`'s rule).
- **Withdrawal and returns** (D153): the period starts at `delivered_at` (collected, or delivered locally); a pickup order's goods come back by the return flow as any other; the
  delivery refunded on a full withdrawal is at most `orders.standard_shipping_minor` (4.3).
- **A store that is closed or in website mode** (D171, D178): no orders; staff may still mark ready, collected and delivered on paid orders (orders stay in `allowedWhenNotOpen()`).
  The settings pages carry `feature: "shop"`.

### 2.8 Copied orders, host orders, subscriptions, other currencies, other languages, privacy

- **Copied orders** (D129): never marked ready, collected or out for delivery (`copied`), never in *To hand over* or *Local deliveries* (`excludesCopied()`), never emailed;
  `copy_orders()` copies `delivery_method`, `delivery` and `pickup_location_id` as history, never `ready_for_pickup_at` as an action (it is copied as the fact it was), and
  `delivery_note` only as `copy_orders()` copies other shopper text.
- **Host orders** (D71): stays and rentals are not physical; they have no delivery and none of this applies (`ships` is false).
- **Subscriptions, weekly boxes, drafts**: the flat rate, as today (decision 1). A basket with a subscription is offered no method, pickup or local delivery (`plan` set, as D135
  already skips carriers); drafts keep `rate`/`free`/`custom` (7).
- **Other currencies** (D109): every stored amount (rates, tier bounds of basis `value`, free-above, pickup price, area price, minimum) is in the market's own currency and read
  through `shown(market, minor)`; a tier bound and a free-above are compared with the basket value as shown, each converted on its own (as `freeOverMinor` is today). Writes are in
  `nativeCurrency`. `checkout-kinds.int.test.ts` gets euro scenarios (6.1 to 6.3).
- **Business buyers** (D63): prices are VAT-inclusive and shown without VAT to businesses (`shownAmount()`/`VatAmount`), the shipping's VAT as today (`decideTax()`, the shipping
  VAT rule, D157); a pickup fee and a local delivery charge are the order's shipping and take the same rule.
- **Other languages**: names, instructions and information are store texts with translations (`names`, `instructions`, `info` jsonb by locale, `mapTexts`-style worklist scope
  `shipping` in `src/lib/store-translate.ts`), read in the order's or page's language with the main language as fallback; nothing machine-written is applied without a person's
  tick (D110).
- **Privacy** (D162): `carts.delivery_postal_code`, `carts.delivery_note`, `orders.delivery_note` and `orders.delivery.postalCode` are personal data (register entries, 3.6);
  the delivery note is erased with the cart and anonymised with the order (`commerce.anonymise_order()` sets it null; the `orders_anonymised` check includes it); the export carries
  the order's note. Audit entries never hold a note, an address or a postal code (zone patterns are the store's, not a person's).

---

## 3. Data

### 3.1 Columns added to existing tables

| Table | Column | Type, default | Rule |
|---|---|---|---|
| `products` | `shipping_profile_id` | uuid null | Composite FK `(store_id, shipping_profile_id)` → `shipping_profiles (store_id, id)`, **no action** on delete (the server moves products to General before deleting a profile). Index `(store_id, shipping_profile_id)`. |
| `store_locations` | `latitude`, `longitude` | numeric(9,6) null | Both or neither; −90..90, −180..180. Filled from the reference data on save when empty. |
| `carts` | `shipping_method_id`, `pickup_option_id`, `local_area_id` | uuid null | At most one of these and `delivery_quote_id` is set (`carts_one_delivery` check). FKs to their tables `on delete set null` on the single column is not expressible in Drizzle for a composite key: plain FKs on `id` only (the ids are uuids), `on delete set null`. |
| `carts` | `delivery_postal_code` | text null | ≤ 12 characters, written only by `setDeliveryPostalCode()` after `cleanPostalCode()`. |
| `carts` | `delivery_note` | text null | ≤ 500 characters, cleaned by `cleanShopperText()`; only with `local_area_id` set (check). |
| `orders` | `delivery_method` | text not null default `'ship'` | in (`ship`, `pickup`, `local`); frozen once the order leaves `pending_payment` (trigger `orders_delivery_frozen`, also `delivery`, `pickup_location_id`), except under D174's edit context for nothing (an edit never changes the method). |
| `orders` | `pickup_location_id` | uuid null | Set iff `delivery_method = 'pickup'` (check). **No FK** (the place may go once nothing waits for it); index `(store_id, pickup_location_id) where pickup_location_id is not null`. |
| `orders` | `ready_for_pickup_at` | timestamptz null | Only for `pickup`; written only by `markReadyForPickup()`. |
| `orders` | `delivery_note` | text null | ≤ 500; only for `local`; null on anonymisation (added to the `orders_anonymised` check). |
| `orders` | `delivery_mismatch_at` | timestamptz null | Written only by `applySession()`'s comparison. |
| `shipments` | `method` | text not null default `'parcel'` | in (`parcel`, `pickup`, `local`); `pickup`/`local` have no tracking number, URL, carrier booking or label (check). Existing rows are `parcel`. |

`orders.delivery` (jsonb) becomes a tagged union read only by `readOrderDelivery()` (`src/lib/delivery-options.ts`, extended, no zod: it is read on the pay routes):
`{ kind: 'carrier', … as today }` (a row without `kind` is a carrier's, so existing orders read unchanged); `{ kind: 'method', methodId, label, zone: { id, name } | null,
postalCode, estimate: { min, max } | null }`; `{ kind: 'flat', label, postalCode | null }` (written from now on for the flat rate, so every order says what it was);
`{ kind: 'pickup', label, locationId, name, street, postalCode, city, country, hours, instructions, readyInHours }` (snapshot; `hours` as `OpeningHours`, `instructions` in the
order's language); `{ kind: 'local', label, areaId, name, postalCode, info }`. Every reader keeps `label`.

### 3.2 New tables (every one with `store_id`, `unique (store_id, id)`, RLS on with no policy, in the private `commerce` schema)

| Table | Columns | Rules |
|---|---|---|
| `shipping_settings` | `store_id` PK → stores (cascade), `default_weight_grams` int not null default 500, `updated_at`, `updated_by` | 1..35,000. Made lazily with the defaults when first read. |
| `shipping_profiles` | `id`, `store_id`, `name` text, `position` int, `created_at`, `updated_at` | Name 1..60 characters, unique per store case-insensitively; ≤ 20 a store (trigger). |
| `shipping_zones` | `id`, `store_id`, `market_code`, `name`, `patterns` text[] , `position`, timestamps | FK `(store_id, market_code)` → `markets` (cascade). Name 1..60; 1..1,000 patterns, Σ length ≤ 3,000; each pattern `^[A-Z0-9-]{1,10}\*?$` (trigger `shipping_zones_patterns`); a pattern may not appear in two zones of the same market (same trigger, under a per-market advisory lock); ≤ 20 a market. |
| `shipping_methods` | `id`, `store_id`, `market_code`, `currency`, `name`, `names` jsonb default `{}` (by locale), `estimate_min_days`, `estimate_max_days` int null, `free_over_minor` bigint null, `active` bool default true, `position`, timestamps | FK `(store_id, market_code, currency)` → `markets (store_id, code, currency)` (cascade), as `shipping_rates`. Name 1..60; estimate both or neither, 0 ≤ min ≤ max ≤ 60; free-over > 0; ≤ 10 a market. |
| `shipping_method_rates` | `id`, `store_id`, `method_id`, `zone_id` null, `profile_id` null, `basis` text, `min_value` bigint not null default 0, `max_value` bigint null, `amount_minor` bigint not null | FK `(store_id, method_id)` cascade, `(store_id, zone_id)` cascade, `(store_id, profile_id)` cascade. `basis` in (`flat`, `weight`, `value`); `amount_minor ≥ 0`; `min_value ≥ 0`; `max_value is null or max_value > min_value`; `flat` has `min_value = 0` and `max_value is null`. Trigger `shipping_rates_tiers` (deferred constraint trigger, at commit): within one `(method, zone, profile)` every row has the same basis, a `flat` group has exactly one row, ranges do not overlap, the first starts at 0 and each next starts where the previous ends (no gap), ≤ 10 rows; the zone belongs to the method's market. Weight in grams, value in the market's minor units. |
| `pickup_options` | `id`, `store_id`, `location_id`, `market_code`, `currency`, `amount_minor` bigint default 0, `ready_in_hours` int default 0, `instructions` text default `''`, `instructions_t` jsonb default `{}`, `active` bool default true, `position`, timestamps | FK `(store_id, location_id)` → `store_locations` **cascade** (the server refuses the delete while orders wait, 2.2); unique `(store_id, location_id)`; FK `(store_id, market_code, currency)` → markets; trigger: the place is of kind `shop` or `pickup` and `country = market_code`; amount ≥ 0; ready 0..720; instructions ≤ 1,000. |
| `local_delivery_areas` | `id`, `store_id`, `location_id` null, `market_code`, `currency`, `name`, `names` jsonb, `kind` text, `patterns` text[] default `{}`, `radius_km` numeric(5,1) null, `amount_minor` bigint, `min_basket_minor` bigint null, `free_over_minor` bigint null, `info` text default `''`, `info_t` jsonb, `active`, `position`, timestamps | FK location (cascade), market (cascade). `kind` in (`postal`, `radius`); `postal` needs 1..1,000 patterns (same pattern rule, overlap between areas allowed: cheapest wins) and no radius; `radius` needs `location_id` and 1 ≤ radius ≤ 160 and no patterns; an active radius area needs the place's coordinates (trigger); amount ≥ 0; min > 0 and free-over > 0 when set; info ≤ 500; ≤ 10 a place, 30 a store. |
| `postal_points` | `country` char(2), `postal_code` text, `latitude`, `longitude` numeric(9,6), `accuracy` smallint | Reference data, no `store_id`. PK `(country, postal_code)`. Read by everyone, written only by migrations. Source and licence in 4.6. |

### 3.3 What the database itself enforces (PGlite tests in `src/db/shipping-methods.test.ts`, 6.4)

1. A rate group with a gap, an overlap, two flat rows, mixed bases or a zone of another market is refused at commit (`shipping_rates_tiers`).
2. A zone pattern held by another zone of the market is refused (`shipping_zones_patterns`); a malformed pattern is refused.
3. A cart with two delivery choices is refused (`carts_one_delivery`); a note without a local area is refused.
4. An order with `pickup` and no `pickup_location_id`, or a location with another method, is refused; `delivery_method`, `delivery` and `pickup_location_id` cannot change after
   `pending_payment` (`orders_delivery_frozen`); `ready_for_pickup_at` only on `pickup` orders.
5. A `pickup`/`local` shipment with a tracking number, URL, booking or label is refused; `shipments_have_lines` (D174) holds for them too.
6. A pickup option at an `office`, or at a place in another country than its market, is refused; an active radius area at a place without coordinates is refused.
7. Limits: 20 profiles a store, 20 zones and 10 methods a market, 10 tiers a group, 10 areas a place and 30 a store.
8. `commerce.anonymise_order()` nulls `delivery_note` and the `orders_anonymised` check refuses an anonymised order with one.

### 3.4 Functions and shared reads

- `commerce.order_delivery_method(order)` is not needed: `orders.delivery_method` is the column. `PHYSICAL_SQL` in `order-list-sql.ts` keeps its meaning; `to_send` becomes
  `o.status = 'paid' and PHYSICAL_SQL and o.delivery_method = 'ship'`; new `pickup`, `local`, `delivery_mismatch` conditions there only (`orderListWhere()` stays the one place).
- `commerce.clone_store()` and `commerce.duplicate_store()` copy `shipping_settings`, `shipping_profiles`, `shipping_zones`, `shipping_methods`, `shipping_method_rates`,
  `pickup_options` and `local_delivery_areas` with new ids mapped (profiles before products' `shipping_profile_id`, places before pickup options and areas, zones and methods before
  rates), and `store_locations.latitude/longitude`; `commerce.copy_orders()` copies the order columns of 3.1 but `delivery_mismatch_at` (history, not an alert).
- `commerce.clone_starter_setup()` (D177) needs nothing more (shipping is copied by `clone_store()` already).

### 3.5 Indexes

`shipping_method_rates (store_id, method_id, zone_id, profile_id)`; `shipping_zones (store_id, market_code, position)`; `shipping_methods (store_id, market_code, position)`;
`pickup_options (store_id, market_code)`; `local_delivery_areas (store_id, market_code)` and `(store_id, location_id)`; `orders (store_id, delivery_method, status) where
delivery_method <> 'ship'` (the two views); every FK column indexed (the performance advisor).

### 3.6 Private, copied, registers, retention

- **COPY_RULES** (`src/lib/store-copy-rules.ts`): `shipping_settings`, `shipping_profiles`, `shipping_zones`, `shipping_methods`, `shipping_method_rates`, `pickup_options`,
  `local_delivery_areas` are **`settings`** (the store's own shipping setup, no secret, no person). `postal_points` has no `store_id` (outside the rules).
- **PERSONAL_DATA** (`src/lib/personal-data.ts`): `orders` gains `delivery_note` (erasure: restricted then anonymised with the order); `carts` gains `delivery_postal_code` and
  `delivery_note` (deleted with the cart). The new settings tables go in `NOT_PERSONAL` ("the store's own shipping setup"), `postal_points` in `NOT_PERSONAL` ("public reference
  data of postal-code centres"). `exportCustomerData()`'s orders section carries `deliveryMethod`, the pickup place's name and the note.
- **KNOWN_COOKIES**: nothing new (no cookie, no storage).
- **Retention**: no new growing table. Carts' fields go with carts (D162 `runRetention()`); quotes as today.

### 3.7 As built (foundation step)

Where the foundation differs from or adds to 3.1 to 3.6 and 2.6 (migrations `20261014230143_shipping_methods`, `…230201_shipping_methods_rules`,
`…230213_shipping_methods_copy`, `…230225_postal_points`, `…230237_shipping_plan_features`):

- **Plan comparison rows** (2.6): there is no category *Orders and shipping*; the three rows are in **Operations** at positions 402 to 404 (after the inventory rows), and
  they are **in no plan** until the platform's admin ticks one, as every earlier wave's rows (D172, D174). A migration that grants plans would decide for the platform's admin.
- **`clone_store()` copies no places** (`store_locations`; it never did), so a store made from the template or a store template gets the shipping settings, profiles
  (and its products' profile), zones, methods and rates, and only the local areas **by postal code that name no place**; no pickup option and no radius area.
  `duplicate_store()` copies everything of 3.4 (it copies places), with the places' positions.
- **`copy_orders()`** copies `delivery_method`, `delivery`, `pickup_location_id` (the copy's id of the place, `clone_id()`) and `ready_for_pickup_at`; never
  `delivery_mismatch_at` and never `delivery_note` (shopper text, as the gift message is not copied).
- **`readOrderDelivery()` keeps its shape** (a carrier's delivery or null) so the readers running today compile and behave as before; the tagged union is read by
  **`readDelivery()`** (same module), which reads a row without `kind` as `{ kind: 'carrier', … }`. Readers move to `readDelivery()` as they learn the new kinds.
  `DeliveryOption.kind` is optional for the same reason.
- **`cleanPostalCode()` moved** to `src/lib/postal-code.ts` (no zod, for the pay routes) and is re-exported from `src/lib/delivery-options.ts` unchanged.
- **The database holds a little more than 3.3 says**: `shipments_method_rules()` refuses a `pickup`/`local` handover for an order of another method and a parcel for a pickup
  order (a parcel for a local order is allowed); `ready_for_pickup_at` is set once (`order_delivery.ready_once`); a place keeps what its pickup option and areas need
  (`store_locations_shipping_rules()`: not made an office or moved to another country while it has a pickup option, not moved to another country while an area is measured from
  it, its position not cleared while an active radius area uses it); an area at a place is in the place's country; a zone's and a method's market (and a method's currency) are
  fixed; the cart's note is cleared by a trigger when its local area goes (`carts_delivery_note_follows()`), so deleting an area is never refused by `carts_delivery_note`.
- **`shipping_methods`' index** is `(store_id, market_code, currency, position)` so it covers the market foreign key (the performance advisor).
- **Two existing integration tests** (`porterbuddy-shipping.int.test.ts`, `helthjem-shipping.int.test.ts`) nulled `orders.delivery` on a paid order; with
  `orders_delivery_frozen` they now do it before the order is paid.
- **The postal-code centres are coarse inside cities**: GeoNames gives all 631 Norwegian codes below `1300` (Oslo) one position (accuracy 4, Oslo's), and the 3,708 Swedish codes
  starting with `1` (Stockholm and around) only 106 positions; a radius area therefore treats much of a city as one point. The Local delivery page must say so beside the radius ("Distances are measured between postal-code
  centres"); a store that needs finer areas uses postal-code areas. 28,754 codes are loaded (NO 5,132, SE 18,887, DK 1,159, FI 3,576).

### 3.8 As built (server step)

Where the server step differs from or adds to sections 2 to 5:

- **The one reader is `resolveDelivery()`** (`src/server/delivery-options.ts`), which `cartSummary()` and `placeOrder()` both call with the same basket value
  (the lines' totals before discounts, gifts out). It returns the offer, the delivery postal code and its zone, the rate charged, what the order keeps
  (`AnyOrderDelivery`), `orders.delivery_method`, the pickup place, the driver's note, `changed`, `needsPostalCode` and the standard delivery (4.3).
  **`chosenDelivery()` stays as its short form** and still returns null for the flat rate (so D135's readers and tests are unchanged); it returns a
  `ChosenDelivery` with `kind` for a carrier, a method, pickup or local delivery. The market's setup is read by `marketShipping()` (six small queries, not one
  round trip: 9.7's risk stands).
- **`orders.delivery` is written for every kind from now on**, the flat rate as `{ kind: 'flat', label: m.shipping, postalCode }`. `readOrderDelivery()` still
  reads only a carrier's, so it is null for the new kinds; `OrderView.deliveryKept` is the full `readDelivery()`.
- **Labels kept on the order are names, not sentences**: a pickup's label is the place's name and a local delivery's the area's name in the order's
  language. "Collect at {place}" and the other words are the pages' (`m.delivery.*`, not built in this step).
- **Emails' words are `deliveryEmailText(lang)`** in `src/lib/email-text.ts`, kept outside `text` like `vatEmailText()`, so the AI catalogue never sees them
  and no `HAND_WRITTEN_ONLY` entry is needed; the blocks are built by the pure `src/lib/delivery-email.ts` (`pickupReadyBlocks()`, `outForDeliveryBlocks()`,
  `confirmationDeliveryBlocks()`, `openingHoursLines()` for the next seven days).
- **Backorders and pickup**: `waiting_for_stock` refuses *Ready* and *Collected* while backordered units are still to send, unless staff confirm they have them
  (`haveStock: true`, the order page only; bulk never does). Without it a pickup order sold on backorder could never be collected (`backorder_quantity` is
  never lowered).
- **Send the email again** (*Ready for pickup*): the first email's key is `order-ready:{order}`; a retry after a failed first uses
  `order-ready:{order}:retry:{failed email id}`, so a retry is itself sent once.
- **`markSent()` takes a 7th argument `{ method }`** and its work is `markSentWithin(tx, …)` (defined inside `markSent()`'s span, so the writers scan still sees one writer), so *Collected* writes the handover and `delivered_at` in
  one transaction and *Mark delivered* on a local order never taken out writes the handover first (`order-delivery.ts`). New refusals: `pickup_order`,
  `not_pickup`, `not_local`, `handover_whole` (a handover with chosen lines or a booking).
- **The *Local deliveries* view** is `delivery_method = 'local'`, paid **or fulfilled** (taking it out fulfils the order), and not delivered; sorting it by
  postal code is not built.
- **Structured data** (2.6) names a method's price only when the market has exactly one active method whose only rate is a flat General, Rest-of-country rate:
  stricter than the spec, since a zone's or a profile's rate makes the price depend on the address or the product.
- **Pickup at Stripe**: `PlacedOrder.deliveryMethod` drops `shipping_address_collection` for a pickup order but still sends `shipping_options` with the pickup
  price (a priced pickup must be charged); whether Stripe accepts shipping options without address collection is not proven here (the fake Stripe of the
  tests accepts anything; 9.6's manual test-mode check must cover a priced pickup). `getOpenCheckout().ships` is false for a pickup order, and
  `saveCustomer()` keeps no shipping address for one. A local order asks for the phone (`phone_number_collection`).
- **A changed delivery is a changed cart**: `getOpenCheckout().changed` also compares the cart's pickup place, local area, note, delivery postal code and
  chosen method with the order's, so the checkout places the order again.
- **Places**: `saveLocation()` takes optional `latitude`/`longitude` (both or neither); left out, a place keeps its position unless its postal code or
  country changed, then it is taken from `postal_points`. `deleteLocation()` returns false while orders wait to be collected there; `placeDeleteBlockers()`
  gives the count for the page.
- **Translation**: scope `shipping` in `src/lib/store-translate.ts` (`shippingUnit()`, units `shipmethod:`, `pickupopt:`, `localarea:`), written into the
  `names`, `instructions_t` and `info_t` texts by locale.
- **Not built in this step**: the owner tools `shipping_overview` and `pickup_orders`, the control center's *to hand over* figure, `legal-facts.ts` and the
  legal starters' paragraphs (built in the fix step, 3.12), `m.delivery.*`, the chat agent's pickup facts.

### 3.9 As built (shopper step)

Where the storefront differs from or adds to 2.4, 5.1 and 5.3:

- **The words are `m.deliveryOptions.*`, not `m.delivery.*`**: `m.delivery` is already a string (*Delivery*, the heading of Stripe's address section). Hand-written
  nb, sv, da, en in `src/lib/messages/{lang}.ts`; `priceInfo.*` (*From {price}*, *Choose delivery at checkout*, *Enter your postal code …*, *Delivery has changed …*) is
  `HAND_WRITTEN_ONLY` (`ui:deliveryOptions.priceInfo.`); *Usually ready in* is `readyInHours`/`readyInDays` in `CHOOSING`. `DeliveryChoice` gets its words as
  props from the server (as D135's did), so nothing went into `*-browser.ts`.
- **Shared reads** are `src/lib/delivery-words.ts` (pure): `deliveryRowLabel()` (the summary row: *Collect at {place}*, *Local delivery: {area}*, else the
  kept label), `readyInText()`, `todayHoursText()`, `withDeliveryWords()` (a pickup option's sentences, worked out on the server) and `priceLaterFrom()`.
  The order page, My account's order page and the checkout's totals name the row with `deliveryRowLabel(order.deliveryKept ?? order.delivery, m)`.
- **The cart's *From {price}*** is the lowest of what is charged now, the methods offered at Rest of country and the pickup places (`priceLaterFrom()`); a
  zone's rate is not known before a code, so a zone cheaper than Rest of country can be below it. The sentence under it says the price is chosen at
  checkout. With free pickup it reads *From 0,00 kr*.
- **Typing a postal code places the order again** when the order no longer matches the cart (`getOpenCheckout().changed`, which since the server step also
  compares the delivery postal code): `lookUpDeliveryAction()` keeps the code (`setDeliveryPostalCode()`), asks the carriers only when one is on in the
  country, and re-places the order so what Stripe charges is what the page shows. A carrier-only store therefore opens one more Stripe session per code typed.
- **The pay press** asks `deliveryReadyAction()` (in `checkout/actions.ts`, before the account and terms steps, and for Apple Pay and the like). On
  `changed` the action places the order again at once and returns its checkout; the form says *Delivery has changed, check the price* with a *See the new
  price* link (a full page load), so nothing is paid at the old price.
- **The order pages** draw `DeliveryBlock` (`src/components/delivery-block.tsx`) inside the parcels piece (`OrderParcels`), so a store's own order page
  shows it too; a pickup order's handover is not listed as a parcel. `OrderView` gains `deliveredAt` (`orders.delivered_at`) for *Collected on*.
- **Not built here**: the chat agent's *Collect in store at {places}* (2.6 says it "may"); the checkout's own choice is not in the e2e (Stripe keys are
  needed to reach it), so `e2e/pickup.spec.ts` holds the cart's sentence and the order pages, and `delivery-choice.test.ts` the choice's drawing.

### 3.10 As built (admin step)

Where the admin screens differ from or add to 2.1 to 2.3 and 5.4:

- **Pages**: the hub `/settings/shipping` (cards, warnings, the flat-rate table and the default weight), `…/methods?market=` (list, *Up*/*Down*),
  `…/methods/[methodId]` (`new?market=` makes one), `…/zones?market=`, `…/profiles`, `…/pickup`, `…/local`; one `actions.ts` beside them; every page asks
  `settings:read` and `feature: "shop"`, every action `settings:write`. *Check a postal code* (zones and local delivery) asks `settings:write` too (the
  permissions scan holds an actions file to its page's write key) and is hidden from someone who may only read.
- **The rate grid** (`src/lib/shipping-method-form.ts`, `MethodEditor`): a tier is typed as *up to* and its price, its *from* being the tier before's
  *up to*, so a typed ladder has no gap by construction; weights are typed in kilograms (three decimals) and kept in grams; a block's problems show after
  Save is pressed. Names' and texts' translations are kept as they are (written from the Translate page, scope `shipping`).
- **Zones are not reordered**: two zones of a market never hold the same pattern, so their order decides nothing.
- **Profiles**: products are chosen in a filtered list of ticks (200 shown at a time, the ticked first); the product editor's *Shipping profile* select
  shows for products with a shipped variant (`EditorContext.shippingProfiles`).
- **The order page**: a pickup or local order gets a *Pickup* or *Local delivery* card (`PickupPanel`, `LocalDeliveryPanel`) in place of *Send the
  order*; carriers' booking and the parcel form are not offered for it. The local card has its own *Mark delivered* (`markDeliveredAction`), which on an
  order never taken out writes the handover first. Staff confirm units sold on backorder with a tick (`haveStock`). Handovers are listed with the
  parcels as *Collected by the customer* / *Taken out by your own driver*, without *Email again*, and are undone the same way.
- **The Orders list**: a *Delivery* column (on by default, `ORDER_COLUMNS` gains `delivery`) shows the label kept on the order, *Collect at {place}*, or
  the local area with the postal code, city, phone and the first 80 characters of the note (none for an erased person); the fulfilment cell says *To
  hand over*, *Ready for pickup*, *Collected*, *To deliver* or *Taken out* for those orders (`shipWords()`). Sorting *Local deliveries* by postal code is
  not built.
- **Packing slip**: a pickup order prints *Collect at {place}* in place of the address, a local order the driver's note under it (`m.deliveryOptions`).
- **Places**: the place page has *Position* (latitude and longitude, empty takes the postal code's centre); deleting a place is refused in words while
  paid orders wait to be collected there.

### 3.11 As built (analytics and AI step)

Where 2.6 and 5.5 were built, and what was added:

- **`shipping_overview`** (`settings:read`, feature `shop`, ungated): `src/server/shipping-tools.ts` over the pages' own readers (`getShippingSetup()`,
  `listPickupPlaces()`, `listLocalAreas()`, `shippingWarningsFor()` and the flat rate's `getShippingSettings()`, so `delivery-readers.scan.test.ts` needs no new
  reader); words in `src/lib/shipping-tools.ts` (`tierWords()`: *from … to under …*, *… and more*, *for any basket*; zones and postal areas give their first 10
  patterns; a radius area says it is measured between postal-code centres). Amounts are each country's own currency as stored, never converted. Takes an
  optional `market`; a country the store does not sell to is refused in words. Carriers are not listed.
- **`pickup_orders`** (`orders:read`, feature `shop`, ungated): the *To hand over* and *Local deliveries* conditions, archived orders left out as the views
  leave them out (a paid pickup order cannot be archived; a local order taken out can), grouped by the place's or area's name kept on the order
  (`groupHandovers()`), with numbers, how many are marked ready or out, the oldest placing time; at most 500 read (`more_than_counted`). Never a name, email
  or address.
- **The control center** (`StoreFigures.handOver`: `pickup`, `oldestPickupAt`, `local`) says *N orders are waiting to be collected* (`show=to-hand-over`)
  and *N local deliveries are not delivered yet* (`show=local`), not urgent; *waiting to be sent* counts `delivery_method = 'ship'` only. The store
  checkup (`store_checkup`) does the same. `docs/analytics.md` has the definitions.
- **Playbooks**: `ship-orders` gains the handover step; a new `shipping-setup` playbook explains the overview and says the assistant cannot change shipping.
- **The chat agent** (2.6's *may*): `store_info` gains `collectInStore` (the active pickup places of the visitor's country, name and town only, from
  `pickupFacts()` in `src/server/pickup-facts.ts`), with a note that the checkout shows the price; no price, street, hours or instructions.

---

### 3.12 As built (fix step, after the adversarial review)

- **Collected and Delivered on today's date**: `markCollected()` and `markDelivered()` take the order page's default date (the store's today) before noon as *now*; only a
  later day is refused as `future` (the morning pickup was refused, and backdating it would have moved the day of physical possession, CRD Art. 9(2)(b)).
- **Anonymising** (D162): `anonymise_order()` also takes `priced` and `address` out of the order's `order.delivery_mismatch` events, and `forbid_change()` lets anonymising remove
  exactly those two keys of that event type (both patched in place in `…_shipping_methods_rules`). The register's `order_events` entry lists them.
- **The mismatch flag** (2.7): `postalMismatch()` flags an order priced with no postal code (see 2.4's hosted-page fallback); its result is `{ priced: string | null, address }`.
  The pay press's check fails closed (2.4).
- **Weekly boxes** pay the flat rate: `placeOrder(..., { flatRateOnly: true })` from `prepareDueDeliveries()` skips `resolveDelivery()` (decision 1, 2.8).
- **The standard delivery** (4.3) counts only options offered: `standardShippingMinor(offer)`.
- **Structured data** (2.6): none in a market with a zone or a store with a profile.
- **Legal starters** (5.2, 8 item 5): `legalFacts()` reads the markets the store's own methods price, the active pickup places and the active local areas. Where methods price a
  market, its line in the shipping policy and the terms is an `[[Add: …]]` placeholder for the prices checkout charges (never the fallback flat rate), which the checker blocks
  publishing over; the shipping policy lists the pickup places (with their price) and the local areas (price, smallest order, free above), and adds that an order collected
  or delivered by the store has no tracking link (`shipping.pickup.1`, `pickup.*`, `shipping.local.1`, `local.*`, `rate.methods`, `shipping.tracking.handover`,
  `label.methodPrices`; hand-written nb, sv, da, en, for legal review, 8 item 5).

## 4. Rules and law

### 4.1 Which shipping a basket gets (`deliveryOffer()`, pure, `src/lib/shipping-methods.ts`; read by `chosenDelivery()`/`defaultDelivery()`)

1. Nothing physical to ship (downloads, services, stays): no delivery, shipping 0 (as today).
2. A subscription in the basket: the flat rate (D25); `no_shipping` without one (as today).
3. Otherwise the offer is: the methods that price the basket (4.2), else the flat rate when set; plus the carriers' services (D135); plus the pickup options of the market; plus
   the cheapest local area that covers the delivery postal code and whose minimum the basket reaches (4.5).
4. **Default** (nothing valid chosen): the cheapest method for the basket at the delivery postal code's zone (Rest of country before one is given), ties by `position` then
   `id`; else the flat rate; else none (`no_shipping`). Pickup and local delivery are never the default. Carriers are never the default (as today).
5. **Chosen**: the cart's one choice, if it still prices the basket (method), is still active and covers the code (area, pickup), or is a quote that has not run out (D135);
   else the default and `deliveryChanged` (2.7).

### 4.2 Pricing a method (`methodPrice(method, rates, parts, zoneId, view)`, pure; BigInt not needed: sums of a few int64-safe minor amounts, `Number.isSafeInteger` asserted)

1. Split the basket's physical, non-gift, non-recurring lines into **parts** by profile (General = null). For each part: weight = Σ quantity × (`weight_grams` ?? default weight),
   value = Σ `unit × quantity` as shown (before discounts).
2. For each part, take the method's rates for `(zone, profile)`; when the postal code's zone has **no row at all** for that (method, profile), the method is not offered (zones do
   not fall back to Rest of country: a zone is the owner's statement about those codes). Before a postal code is given the zone is Rest of country.
3. In that group, the tier whose `min ≤ x < max` (or `min ≤ x` when `max` is null) for `x` = the part's weight (basis `weight`) or its value converted to the market's own
   currency for comparison (basis `value`: compare `shown(view, min) ≤ value < shown(view, max)`, each bound converted on its own as `freeOverMinor` is today), or the one row
   (basis `flat`). No tier matches: the method is not offered.
4. Price = Σ over parts of `shown(view, tier.amount_minor)` (each converted then added, so the euro view equals the sum of what each part shows).
5. Free above: when `free_over_minor` is set and the **whole** basket value (`basketShipping()`'s value: line totals before discounts, downloads included, gifts out) is
   `≥ shown(view, free_over_minor)`, the price is 0. The method's price and free-above are then handed to `basketShipping()` as its `ShippingRate`, so codes with free shipping
   (D31), the shipping's VAT (D157) and everything downstream are unchanged.
6. `cartSummary()` and `placeOrder()` both call `chosenDelivery()` (inside `placeOrder()`'s transaction with its runner), which calls the same pure functions over the same rows;
   `checkout-kinds.int.test.ts` holds them equal for each kind (6.1 to 6.3).

Source: the row's criteria; Shopify's combined rates (1.2) for the sum; the inclusive-minimum, exclusive-maximum rule is Kaizen's (Shopify does not state one), chosen so tiers
meet without gaps.

### 4.3 The standard delivery kept on the order (D153, CRD Art. 13(1))

The trader must refund "the costs of delivery" but not "the supplementary costs" of a delivery dearer than "the least expensive type of standard delivery offered by the trader"
(Directive 2011/83/EU Art. 13(2), https://eur-lex.europa.eu/eli/dir/2011/83/oj). `orders.standard_shipping_minor` becomes the **lowest** of the options actually **offered** to ship the
basket (`offer.ship`): every method that prices it at the priced zone (4.2, after free-above), or the flat rate for the basket when it is the fallback being offered (4.1
point 3). A flat rate kept only as a fallback the basket never reaches is not "offered by the trader" and does not count (corrected after the adversarial review: counting it
withheld part of the delivery refund; legal review item 3). Pickup and local delivery are not counted as "standard delivery" (an assumption flagged for
review, 8): an order that chose pickup at 0 charged 0, so the cap is moot; a local delivery dearer than the cheapest method is capped at that method.

### 4.4 Pickup and local delivery as fulfilment (D174 extended)

- `markSent(storeId, orderId, input, accountId, booking, parcel, { method })`: `method` `parcel` (default, every caller today), `pickup` or `local`. `pickup` is refused for an
  order of another delivery method, `local` likewise, `parcel` for a pickup order (`pickup_order`); a handover always takes every unit still to send (no partial handover in this
  run; 7) and writes no carrier, tracking or booking. `markSent()` stays the only writer of `shipments` (its scan test).
- `markCollected()` = `markSent(method pickup)` + `delivered_at` (rules of `markDelivered()`) in **one** transaction. Possession is acquired when the consumer collects
  (Directive 2011/83/EU Art. 9(2)(b): the period runs from the day the consumer "acquires physical possession of the goods"; Art. 20: risk passes then).
- `markOutForDelivery()` = `markSent(method local)` and the email; `markDelivered()` on a local order with no handover writes it first.
- `undoShipment()` works on handovers unchanged (it already clears `delivered_at` and returns the order to `paid`).

### 4.5 Local areas (`areaFor()`, pure)

- Postal kind: the postal code matches a pattern (exact or prefix `*`, after `cleanPostalCode()` of the market's country). Radius kind: the code is in `postal_points` for the
  country and its haversine distance (earth radius 6,371.0088 km) from the place's coordinates is `≤ radius_km`.
- Several areas match: those whose minimum the basket value as shown reaches; of them the one with the lowest price for this basket (after its free-above), ties by `position`
  (Shopify: "always charged the lowest applicable delivery price").
- Free above: as 4.2 point 5, on the whole basket.

### 4.6 Postal-code reference data

GeoNames postal codes (https://download.geonames.org/export/zip/, readme read 2026-10-14): "Creative Commons Attribution 4.0 License", latitude and longitude "estimated",
accuracy 1 (estimated), 4 (geonameid), 6 ("centroid of addresses or shape"). Loaded for NO, SE, DK, FI by a custom migration generated once by
`scripts/postal-points.mjs` (a developer tool, never imported by the app) from the country files, committed as SQL; more countries are a later migration. Attribution
("Postal-code positions © GeoNames, CC BY 4.0") on the Local delivery page and in `docs/shipping-carriers.md`. The licence and the attribution wording are for the lead to confirm (9.2).

### 4.7 Price information (consumer law)

- The total price including "all additional freight, delivery or postal charges" must be given before the consumer is bound, or, "where those charges cannot reasonably be
  calculated in advance, the fact that such additional charges may be payable" (Directive 2011/83/EU Art. 6(1)(e); Art. 8(2) for the moment before the order button). Hence the
  cart's *From {price}* and *Choose delivery at checkout* while a zone may change the price, and the pay press refused until the price is known (2.4 point 4).
- Pickup and local delivery change no withdrawal right (Art. 9 to 16 unchanged); the hand-written texts say nothing about the right beyond what the existing confirmation says.

### 4.8 Limits and constants (`src/lib/shipping-limits.ts`; a unit test pins every number)

`PROFILES_MAX` 20, `ZONES_MAX` 20, `METHODS_MAX` 10, `TIERS_MAX` 10, `PATTERNS_MAX` 1,000, `PATTERN_CHARS_MAX` 3,000, `AREAS_PER_PLACE_MAX` 10, `AREAS_MAX` 30,
`RADIUS_KM_MAX` 160, `READY_HOURS_MAX` 720, `INSTRUCTIONS_MAX` 1,000, `INFO_MAX` 500, `NOTE_MAX` 500, `ESTIMATE_DAYS_MAX` 60, `DEFAULT_WEIGHT_GRAMS` 500,
`WEIGHT_GRAMS_MAX` 35,000 (the default weight), `EARTH_RADIUS_KM` 6,371.0088.

### 4.9 Who may do what

| Action | Who |
|---|---|
| See the shipping settings | `settings:read` |
| Change methods, zones, profiles, default weight, pickup options, areas | `settings:write` |
| Set a product's profile | `products:write` (with the product) |
| Mark ready, collected, out for delivery, delivered | `orders:write` |
| See the views *To hand over*, *Local deliveries* | `orders:read` |
| AI manager tools (read-only) | `settings:read` / `orders:read`; `shop` on |

---

## 5. Where things live

### 5.1 Foundation (schema, migrations, pure libraries, words)

- `src/db/schema.ts` (3.1, 3.2); migrations (9.1); `src/db/shipping-methods.test.ts` (PGlite, 3.3).
- `src/lib/shipping-limits.ts` (4.8); `src/lib/postal-patterns.ts` (`cleanPostalPattern()`, `patternMatches()`, `mostSpecific()`, `zoneFor()`); `src/lib/shipping-methods.ts`
  (`partsOf()`, `tierFor()`, `methodPrice()`, `deliveryOffer()`, `defaultDelivery()`, `tierProblems()`, `shippingWarnings()`); `src/lib/local-delivery.ts` (`distanceKm()`,
  `areaFor()`); `src/lib/pickup.ts` (`pickupBlock()`: why an order cannot be marked ready or collected; `readyInWords()` keys); `src/lib/delivery-options.ts`
  (`OrderDelivery` union, `readOrderDelivery()`, `postalMismatch()`, `DeliveryOption` gains `kind`), each with unit tests. No zod in what the pay routes load (D211, D158):
  input schemas in `src/lib/shipping-methods-schema.ts`.
- Words: `m.delivery.*` in `src/lib/messages/{nb,sv,da,en}.ts` and `{lang}-browser.ts` for `DeliveryChoice`; `emailText().pickup` and `.outForDelivery` in
  `src/lib/email-text.ts`; `CHOOSING` entries for *Usually ready in {hours}*; `scripts/postal-points.mjs`.

### 5.2 Server

- `src/server/shipping-methods.ts` (admin reads and saves of methods, rates, zones, profiles, default weight; `refreshTag()`), `src/server/pickup.ts` (options, `pickupBlockers()`,
  `markReadyForPickup()`, `markCollected()`), `src/server/local-delivery.ts` (areas, coordinates from `postal_points`, `markOutForDelivery()`).
- `src/server/delivery-options.ts` (extended: `chosenDelivery()` returns every kind and stays the one reader; `defaultDelivery()`; `setDeliveryPostalCode()`; `chooseDelivery()`
  takes `method:{id}`, `pickup:{id}`, `local:{id}`; `deliveryChoiceOn()`; `deliveryReady()`), `src/server/delivery-choice.ts`, `src/server/cart-summary.ts`, `src/server/checkout.ts`
  (`placeOrder()`: delivery method, snapshot, standard shipping 4.3; `OpenCheckout.ships` false for pickup; phone for local), `src/server/payment-session.ts` (phone collection),
  `src/server/stripe-webhooks.ts` (mismatch after `saveCustomer()`), `src/server/order-admin.ts` (`markSent()`'s `method`), `src/server/order-delivery.ts` (local without
  handover), `src/server/order-list-sql.ts` and `src/lib/order-list.ts` (filters and views), `src/server/order-bulk.ts` or wherever `runBulk()` lives (bulk ready),
  `src/server/shopper-emails.ts` (the two emails, confirmation block), `src/server/company.ts` (`deleteLocation()` refusal, coordinates), `src/server/products.ts`
  (`shippingProfileId`), `src/server/seo.ts` (`getShippingFacts()` 2.6), `src/server/legal-facts.ts` (methods and pickup places as facts), `src/server/store-copy.ts`,
  `src/server/privacy-export.ts`, `src/server/privacy-erasure.ts` (nothing new beyond the SQL function), `src/server/packing-slips.ts`.

### 5.3 Shopper

`src/components/delivery-choice.tsx` (grouped options, postal code, note), the checkout section (`checkout-section.tsx`: pay press check), `cart/cart-contents.tsx` (*From*),
the order and account order pages (`order-section.tsx`, `account/orders/…`) through a shared `DeliveryBlock` (`src/components/delivery-block.tsx`). The pay-route rules hold
(no zod, no forbidden module, `FORBIDDEN_ON_PAY_ROUTES`).

### 5.4 Admin (English only; semantic tokens; components of D218; every page with `loading.tsx` and its own permission check)

`/admin/{store}/settings/shipping` (hub), `…/shipping/methods` and `…/shipping/methods/[methodId]`, `…/shipping/zones`, `…/shipping/profiles`, `…/shipping/pickup`,
`…/shipping/local` (with their `actions.ts`), the product editor's field (`ProductEditor`), the order page's `PickupPanel`/`LocalDeliveryPanel`
(`src/components/admin/orders/`), the list's *Delivery* column and views, places' coordinates fields (`settings/company/places`).

### 5.5 Analytics and AI

`src/lib/owner-tools.ts` and `src/server/owner-tools.ts` (`shipping_overview`, `pickup_orders`), `TOOL_WORDS`, `TOOL_PERMISSIONS`, `TOOL_FEATURES`; the control center's
*to send* figure excludes pickup and local and adds *to hand over* (`src/lib/control-center.ts`, `src/server/control-center.ts`); `docs/analytics.md`: no new figure (shipping
income unchanged; a figure by delivery method is wave 8, 7).

### 5.6 The registries, and who edits each

| Registry | Change | Area |
|---|---|---|
| `src/lib/store-nav.ts` | Settings → Shipping keeps one item; the sub-pages are its children (`feature: "shop"`) | admin |
| `src/lib/admin-map.ts` (`ADMIN_PAGES`) | `shipping` description updated; `shipping.methods`, `shipping.method`, `shipping.zones`, `shipping.profiles`, `shipping.pickup`, `shipping.local` | admin |
| `src/lib/i18n.ts` / `messages/*` / `*-browser.ts` | `m.delivery.*` | foundation |
| `src/lib/email-text.ts`, `EMAIL_KINDS` | `pickup`, `outForDelivery`, confirmation block | foundation |
| `src/lib/store-copy-rules.ts` | seven `settings` entries | foundation |
| `src/lib/personal-data.ts` | 3.6 | foundation |
| `AUDIT_AREAS` | `shipping` exists; new action names under it | foundation |
| `src/lib/store-translate.ts` | scope `shipping` (method names, pickup instructions, area names and info) | server |
| Plan features (D132) | three rows, migration | foundation |
| Owner tools | two tools | analytics-and-ai |
| Sitemap, KNOWN_COOKIES | nothing | — |
| Structured data | `getShippingFacts()` 2.6 | server |

---

## 6. Acceptance criteria, row by row, mapped to tests

Test kinds: **U** unit (`pnpm test`), **P** PGlite (`src/db/*.test.ts`), **I** integration against a real database (`pnpm test:int`), **V** view test (`renderToString`),
**E** storefront e2e (`pnpm test:e2e`).

### 6.1 `orders.weight-or-price-rate-tables-zones-profiles`

| Criterion | Held by |
|---|---|
| An owner defines tiers by basket weight and by basket value per market; the charge is the tier that matches, and a basket in no tier falls to the flat rate when set, else is refused | U `src/lib/shipping-methods.test.ts` (bounds inclusive/exclusive, last open tier, no match → not offered, `deliveryOffer()` fallback and `no_shipping`); P tiers rules; I `src/server/shipping-methods.int.test.ts` (save through the action's validation, refusals) and `checkout-kinds.int.test.ts` scenario *weight tier* and *value tier* (krone and euro) |
| A zone groups postal-code ranges inside a country, with its own rates | U `src/lib/postal-patterns.test.ts` (exact, prefix, most specific, normalisation per country, duplicates); I `checkout-kinds.int.test.ts` scenario *zone* (a code in the zone pays its rate, one outside pays Rest of country, the zone with no rate for a profile refuses the method) and `delivery-options.int.test.ts` (postal code on the cart, re-pricing) |
| A shipping profile assigns products to rates, and a mixed basket is charged the sum, the same in `cartSummary()` and `placeOrder()` (euro scenario) | U `methodPrice()` sums; I `checkout-kinds.int.test.ts` scenario *two profiles* in NOK and in the euro view, `cartSummary().shipping === order.shipping_minor` |
| A product with no weight uses the store's default weight | U `partsOf()`; I scenario *weightless variant* (default 500 g per unit crosses a tier) |
| Admin screens | V `src/components/admin/shipping/*-view.test.ts` (methods grid, zones, profiles, warnings) |

### 6.2 `orders.local-pickup-at-own-location`

| Criterion | Held by |
|---|---|
| An owner switches pickup on for a place with instructions and a price (free by default); checkout offers it for that market; `cartSummary()` and `placeOrder()` agree (euro scenario) | P option rules; I `src/server/pickup.int.test.ts` (save, refusals: office, other country) and `checkout-kinds.int.test.ts` scenario *pickup* (free and priced, NOK and euro; `orders.delivery_method = 'pickup'`, snapshot, no shipping address asked); E `e2e/pickup.spec.ts` (choose *Collect*, the price row, the pay press allowed without a postal code; no Stripe) |
| The order keeps the chosen place; staff mark it ready, which sends the customer an email in the order's language with the address, hours and instructions, once | I `pickup.int.test.ts` (`markReadyForPickup()`: event, `ready_for_pickup_at`, the email logged once with key `order-ready:{id}`, a second press `duplicate`, language nb and en, refusals: unpaid, copied, backordered, edit pending); U the email's text builder (address, hours, instructions in the order's language, fallback to main) |
| Marking it collected closes the order without a carrier parcel, and the order is excluded from To send | I `pickup.int.test.ts` (`markCollected()`: handover shipment `method = 'pickup'` with every unit, no tracking, order `fulfilled`, `delivered_at` set, no shipped email; undo returns it to `paid`) and `order-list.int.test.ts` (`ship=to_send` excludes, `ship=pickup` includes, copied never); V order page panel |

### 6.3 `orders.local-delivery`

| Criterion | Held by |
|---|---|
| An owner defines an area by postal codes or a radius from a place, with a price, a minimum basket and a free-above value; checkout offers it only inside the area | U `src/lib/local-delivery.test.ts` (haversine against known pairs, radius in and out, a code missing from the data is out, cheapest of overlapping areas, minimum, free-above); P area rules; I `src/server/local-delivery.int.test.ts` (coordinates from `postal_points`, offered inside, not outside, below minimum shown and refused) |
| `cartSummary()` and `placeOrder()` agree on its price in the euro view too | I `checkout-kinds.int.test.ts` scenario *local delivery* (NOK and euro, with free-above crossed) |
| Orders for local delivery list apart for staff, with the address and any delivery note | I `order-list.int.test.ts` (`ship=local`, not in `to_send`, note and postal code in the row, copied never); V list row and order panel; I `markOutForDelivery()` (handover `local`, email once) and *Delivered* without handover |

### 6.4 Database tests, cross-cutting tests, scans, and criteria changes

- P `src/db/shipping-methods.test.ts`: every rule of 3.3. U `shipping-limits.test.ts` pins 4.8. The scan `order-edit-writers.scan.test.ts`/`markSent` scan keep `markSent()` the
  only writer of `shipments`; a new scan `delivery-readers.scan.test.ts` fails when a module other than `delivery-options.ts`, `orders.ts` (`getCheckoutInfo()`), `settings.ts`,
  `subscriptions.ts`, `standing-orders.ts`, `draft-orders.ts`, `returns.ts`, `seo.ts`, `legal-facts.ts`, `setup.ts`, `shipping-methods.ts` and the copy reads `shipping_rates`,
  `shipping_method_rates` or `local_delivery_areas` (one reader of the choice, as D135 says).
- `src/db/privacy.test.ts` passes with the new columns registered; `store-copy-rules` test passes with the new tables classified; `storefront-bundle.scan.test.ts` passes
  (`DeliveryChoice` imports no zod).
- I `stripe-webhooks` mismatch: a session whose postal code is in another zone flags the order once and changes no amount; a pickup order is never flagged.
- I withdrawal: `standard_shipping_minor` is the cheapest method (4.3) when a dearer one was chosen (euro too).

**Criteria changes (for the lead; the rows are not edited here):**

1. `orders.local-pickup-at-own-location`, criterion 3, "Marking it collected closes the order without a shipment": this spec records the handover as a `shipments` row of method
   `pickup` (no carrier, no tracking, no email), because D174 made shipments the one record of what left the store and every reader (units to send, the order's state, D153's
   "nothing sent", undo) counts them. Proposed text: "Marking it collected fulfils the order without a carrier parcel (no tracking, no shipped email), starts the withdrawal period
   on that day, and the order is excluded from To send." The intent is kept; the lead decides whether this is the row's meaning (1.1).
2. `orders.local-pickup-at-own-location`, criterion 2, "with the address, hours and instructions, once": "once" is read as *one email per order*, resent only when the first failed
   (a second press does not send another). No change proposed; stated so the test holds it.
3. `orders.weight-or-price-rate-tables-zones-profiles`, criterion 2, "postal-code ranges": built as patterns (exact codes and prefixes), as Shopify's postal-code zones are; a
   numeric range `0150-0199` is entered as prefixes (`015*` … `019*`). Proposed text: "A zone groups postal codes and postal-code prefixes inside a country …".
4. `orders.weight-or-price-rate-tables-zones-profiles`, criterion 4: "the store's default weight" applies to methods' weight tiers; carriers keep their own per-connection
   default (D135). Proposed text: "… uses the store's default weight in weight-based rates."

---

## 7. What is deliberately NOT done, and why

- **Carrier-calculated prices inside methods, rates per stock location (D172) and split shipments priced per location**: carriers stay their own options (D135); stock routing
  stays by rank. Wave 3's carrier-labels run or wave 9 (shipping rules) may join them.
- **Shopify's newer "highest rate within an option"** and rates by product *collections*: early access at Shopify; the sum per method is the classic rule and the row's.
- **Variant-level profiles**: profiles are per product (Shopify allows variants); no merchant need found yet.
- **Several price rules per local area** (Shopify: up to 3 by order value): one price, a minimum and a free-above; a second area with a higher minimum gives the same effect. Revisit
  on request.
- **Store transfers and pickup availability by a place's stock**, a *Picked up* email, pickup time slots, partial handovers (part collected, part later): routing and stock per
  pickup place are D172's next step; the handover takes every unit still to send.
- **Delivery routes, driver apps and delivery-day calendars** for local delivery: the weekly boxes (D102) and Porterbuddy windows (D137) already cover dated rounds.
- **Methods, pickup or local delivery for subscriptions, weekly boxes and drafts**: they keep the flat rate (or the draft's custom shipping); a later run can give drafts a method.
- **Address geocoding** (radius from the street address): needs a geocoding vendor with EU processing (bucket B); centroids are the honest substitute.
- **Shipping in product imports and exports** (D165 `Shipping profile` column) and a delivery-method figure in analytics: wave 2 follow-up and wave 8.
- **AI changing shipping or marking orders** ready or collected: actions that email customers or change what they pay stay with a person.

## 8. Needs human legal review

Every text below is hand-written in nb, sv, da and en, kept out of machine translation where marked (`HAND_WRITTEN_ONLY`: `m.delivery.priceLater`, `emailText().pickup`,
`emailText().outForDelivery`), and flagged in `LEGAL_REVIEW_MANIFEST` where it is legal:

1. The cart's and checkout's price-information sentences (*From {price}*, *Choose delivery at checkout*, *Enter your postal code to see the delivery price*): CRD Art. 6(1)(e)
   and 8(2) (4.7).
2. The *Ready for pickup* and *Out for delivery* emails and the confirmation's delivery block (no statement about the right of withdrawal; review that none is implied).
3. The assumption that pickup and local delivery are not "standard delivery" for Art. 13(2) refunds (4.3).
4. That collecting is the day of physical possession (Art. 9(2)(b), Art. 20) and that marking it is staff's only.
5. The legal starters' shipping page (`src/lib/legal-starters/{nb,sv,da,en}.ts`): new placeholders and a paragraph for pickup places and local delivery areas from
   `legalFacts()` (the starters stay drafts with the review notice).
6. The GeoNames attribution wording and licence use (4.6).

## 9. For the lead

### 9.1 Migrations expected

1. `…_shipping_methods` (generated by `pnpm db:generate`): the tables of 3.2, columns of 3.1, checks, indexes, FKs.
2. `…_shipping_methods_rules` (custom): triggers `shipping_rates_tiers` (deferred constraint), `shipping_zones_patterns` (advisory lock per market), limits, `carts_one_delivery`
   if not expressible, `orders_delivery_frozen`, pickup option and radius checks, `anonymise_order()` replaced with `delivery_note`, the `orders_anonymised` check widened, the
   `shipments` method check.
3. `…_shipping_methods_copy` (custom): `clone_store()`, `duplicate_store()`, `copy_orders()` replaced with the new tables and columns.
4. `…_postal_points` (custom, generated once by `scripts/postal-points.mjs`): NO, SE, DK, FI rows (about 26,000; around 1 MB of SQL).
5. `…_shipping_plan_features` (custom): three `plan_features` rows granted to every plan.

Every migration is additive; the code still running keeps working until the deploy finishes (no rename, no drop; `orders.delivery_method` defaults to `ship`).

### 9.2 Statements the Supabase migration tool would cancel, and things only the lead can do

No function of this run contains `DELETE` or `DROP` (the profile delete and the place delete are application code). The `clone_store()`/`duplicate_store()` replacements are
`create or replace` of large functions: CI's `release` job applies them (a direct connection); **never apply them by hand first**. The lead confirms the GeoNames licence and
attribution before the postal-points migration ships, and confirms the criteria readings of 6.4.

### 9.3 Advisors to check after the deploy

Security: RLS on with no policy for the eight new tables (INFO, as every private table); no function with a mutable search path (every new function sets `search_path`).
Performance: every new FK indexed (3.5); `postal_points` lookups by primary key. Record the migration versions in `docs/decisions.md` (Migration versions).

### 9.4 Decision row, draft (D237)

| D237 | **Shipping methods, zones and profiles, local pickup and local delivery (wave 3).** `docs/wave-3-shipping-methods.md` is the contract. Per market, named methods (`shipping_methods`) carry rates per zone and profile (`shipping_method_rates`: flat, by basket weight or by basket value, tiers from an inclusive minimum to an exclusive maximum with no gap, held by a deferred trigger); zones are postal-code patterns inside a country (`shipping_zones`, the most specific pattern wins, Rest of country for the rest); profiles group products (`shipping_profiles`, General for the rest); a mixed basket is offered a method only when every profile has a matching tier, at their sum; free above the method's value; goods without a weight weigh the store's default (`shipping_settings`, 500 g) per unit. The market's flat rate stays as the fallback when no method prices a basket and as the only shipping of subscriptions, weekly boxes and drafts. Pickup is per place (`pickup_options`: price, ready time, instructions); local delivery per area by postal codes or a radius from a place measured between GeoNames postal-code centroids (`local_delivery_areas`, `postal_points`, CC BY 4.0), with price, minimum and free-above, the cheapest matching area offered. The cart holds one choice and the postal code; `chosenDelivery()` stays the one reader for `cartSummary()` and `placeOrder()` and re-prices own methods on every read. Orders keep `delivery_method`, a snapshot in `delivery`, the place, the driver's note; *Ready for pickup* emails once, *Collected* records a handover (`shipments.method = 'pickup'`) and the receipt together, *Out for delivery* a `local` handover; neither is in *To send*. A priced postal code that differs from Stripe's address flags the order for staff and never changes the charge. | 2026-10-1x | *Why:* the rows `orders.weight-or-price-rate-tables-zones-profiles`, `orders.local-pickup-at-own-location`, `orders.local-delivery`. Migration versions: (to fill). |

### 9.5 CLAUDE.md bullet, draft (Admin section, after the D174 bullet)

- **Shipping methods, pickup and local delivery (wave 3, D237, `docs/wave-3-shipping-methods.md`)**: a market's shipping is its methods (`shipping_methods`, rates in
  `shipping_method_rates` per zone and profile, priced only by `methodPrice()`/`deliveryOffer()` in `src/lib/shipping-methods.ts`: tiers min inclusive, max exclusive, a mixed
  basket the sum per method, a zone with no rate for a profile offers no method, goods without a weight the store's default per unit) with the flat rate (`shipping_rates`) as the
  fallback and the only shipping of subscriptions, weekly boxes and drafts. Zones are postal patterns (`src/lib/postal-patterns.ts`, most specific wins). Pickup is per place
  (`pickup_options`), local delivery per area (`local_delivery_areas`, radius between `postal_points` centroids). The cart holds one choice; `chosenDelivery()` is still the one
  reader for `cartSummary()` and `placeOrder()` and re-prices on every read (a new money read here needs a euro scenario in `checkout-kinds.int.test.ts`). A handover is a
  `shipments` row of method `pickup`/`local` through `markSent()`; *Collected* also sets `delivered_at`; pickup and local orders are never in *To send*. Never re-charge a
  postal-code mismatch: flag it (`orders.delivery_mismatch_at`). Every amount is stored in the market's currency and read through `shown()`. New tables are `settings` in `COPY_RULES`.

### 9.6 Before pushing (the things CI cannot prove)

- One order of each kind (method with a zone, pickup, local) paid in Stripe test mode on a real store, the emails read in nb and en.
- The checkout page at phone width with five kinds of option; the pay press refusals.
- The GeoNames data spot-checked for a few known Oslo, Stockholm and Copenhagen codes (distance between two known centres within 1 km of a map's).

### 9.7 Blockers and risks

No blocker. Risks: the checkout's delivery choice grows complex (keep it grouped and short; `MAX_OPTIONS` applies per group); `chosenDelivery()` now reads more rows on every
cart read (one query joining the cart's choice with its rates, profiles of the cart's products and the zone; an `inventory-perf`-style guard is not required but the read must
stay one round trip); the shopper can type a cheaper postal code than the address (flagged, not prevented, 2.7); the admin screens rest on view tests (D158).
