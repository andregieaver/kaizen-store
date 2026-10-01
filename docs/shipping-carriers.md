# Shipping carriers (D133)

Posten / Bring, PostNord, Porterbuddy and Helthjem are listed under **Integrations → Shipping carriers**
(`/admin/{store}/integrations`). Their connections are not built yet. This is the preparation, so each can be switched
on the day it arrives without rework.

## What exists

- **Registry** (`src/lib/shipping-carriers.ts`): for each carrier its name, the countries it delivers in, what it will do
  (`CarrierFeature`: delivery options and prices, pickup points, labels, tracking, time windows, same day), the details
  the store must give (`CarrierField`, each marked secret or not), how to get an agreement and API access, and a link to
  the carrier's developer pages. The fields are the usual ones for each carrier's API and are **confirmed against its own
  documentation when its connection is built**; adding or changing a field is a line in the registry, and saved details
  that do not match any field are simply ignored.
- **The store's agreement** (`commerce.shipping_carriers`, one row per store and carrier): environment (`test` or
  `live`), the non-secret details, the countries (markets) the store wants to ship to with it, `complete` (every required
  detail saved), and the secrets as one encrypted JSON (`SETTINGS_ENCRYPTION_KEY`, `src/lib/secret-box.ts`) with `secret_hints`,
  the last four characters of each, to recognise them by. Screens never receive a secret; a secret left empty in the form
  keeps the saved one.
- **Server** (`src/server/shipping-carriers.ts`): `listCarriers()`, `getCarrier()`, `saveCarrier()`, `removeCarrier()`
  (audited: `shipping.carrier_saved`, `shipping.carrier_removed`) and `carrierContext()`, which gives a connection the
  decrypted agreement and is called by nothing else.
- **Screens**: the carriers as cards on the integrations page ("Preparing", "Needs details", "Details saved"), and one page
  per carrier (`/admin/{store}/integrations/shipping/{carrier}`) with what it will do, the steps to get ready and the form.
  Only an owner saves or forgets an agreement (it holds the store's own keys); staff can read the page.
- **The contract for what comes next**: `ShippingCarrierAdapter` in the same file. Each connection implements `check()` and
  whichever of `rates()`, `pickupPoints()`, `book()` and `track()` the carrier offers, with shared types for addresses,
  parcels, options, pickup points, bookings and tracking events.

## What it does not do

Nothing is sent to a carrier, and checkout, shipping prices (`commerce.shipping_rates`), orders and shipments are
unchanged. `shipments.carrier` is still free text.

## Building a connection

1. Confirm the carrier's credential fields against its API documentation and fix the registry.
2. Implement `ShippingCarrierAdapter` in `src/server/carriers/{carrier}.ts`, taking a `CarrierContext` from
   `carrierContext()`; never log or return secrets; set timeouts like other outbound calls; catch failures and fall back
   to the store's flat rate (`commerce.shipping_rates`), so checkout never depends on a carrier being up.
3. Add a "Check connection" action to the carrier's page that calls `check()`.
4. Rates at checkout (built for Posten / Bring, D135): offer the carrier's options next to the flat rate for the markets the store chose, in the shopper's
   currency (D109, `shown()`), priced with VAT like every shipping price; `placeOrder()` and `cartSummary()` must agree
   (`checkout-kinds.int.test.ts`).
5. Booking: a "Book shipment" action on the order that stores the tracking number in `shipments` and emails it; store the
   label in private storage.
6. Keep the agreement out of store copies (`shipping_carriers` is `never` in `COPY_RULES`, and in `SECRET_TABLES`).

## Posten / Bring (D134): the first connection

Built against Bring's developer documentation (Shipping Guide v2, Pickup Point, Booking v2, Tracking v2); every call
carries the store's own Mybring user (`X-Mybring-API-Uid`), key (`X-Mybring-API-Key`) and Kaizen's address
(`X-Bring-Client-URL`). Pure request and response code is `src/lib/bring.ts` (tested with documented examples); the calls
are `src/server/carriers/bring.ts` (`createBringAdapter()`, `fetchBringLabel()`, registered in `carriers/index.ts`);
the order-side logic is `src/server/bring-shipping.ts`.

**Works now**
- **Check connection** (carrier page, owners): looks up a pickup point (the user and key) and asks Shipping Guide for the
  customer number's services (the agreement); the answer is kept (`shipping_carriers.checked_at/check_ok/check_message`) and
  shown on the page and as a badge ("Connected", "Not accepted"). Saving the details again clears it.
- **Book from an order** (order page → Send the order → *Book with Posten / Bring*): the parcel's weight (guessed from the
  products' weights, else typed; optional size), Bring's services and what they cost the store excluding VAT (5800 pickup
  point, 5600 home delivery, 3584 mailbox), a pickup point near the recipient for 5800, then Book. A real booking marks the
  order as sent through `markSent()` with the tracking number and link, and keeps the shipment number and label address
  (`shipments.carrier_id/consignment_number/label_url`); the customer is emailed when asked. The label is **never stored**: *Print label*
  (`/admin/{store}/orders/{order}/label/{shipment}`) fetches it from Bring with the store's keys, for staff only.
- **Test environment**: Bring is told it is a test (`X-Bring-Test-Indicator: true`): it books a test shipment, nothing is
  shipped, the label is not valid, and the order is **not** marked as sent. Switch the carrier to live to ship for real.
- **Tracking**: the latest event of a parcel booked with Bring shows under the shipment on the order page, from Tracking v2
  (nothing when Bring does not answer).
- Only parcels to Norway, from the sender address saved on the carrier page (name, street, postal code, city, optional phone).

**Delivery options at checkout (D135)** (`src/lib/delivery-options.ts`, `src/server/delivery-options.ts`,
`src/server/delivery-choice.ts`, `DeliveryChoice`, the `checkout_delivery` piece):
- The owner switches it on under the carrier's page (*Delivery options at checkout*): on/off, which services (5800 pickup
  point, 5600 home delivery, 3584 mailbox), a percentage and a fixed amount added to the price with VAT, the basket value
  over which the services are free, and the parcel weight to assume when the goods have none
  (`shipping_carriers.checkout_*`, `markup_*`, `free_over_minor`, `default_weight_grams`). It only works in the countries
  ticked for the carrier, and for Bring only Norway. The market's flat rate stays: it is what the order starts with, what
  is shown next to the carrier's services, and what is left when Bring does not answer, so the owner keeps it set up.
- The shopper gives a postal code in the checkout's *Delivery method* section. `quoteDelivery()` asks Shipping Guide for the
  services for the cart's parcel (variants' weights, the default for goods with none, once) and keeps one
  `commerce.delivery_quotes` row per service offered: the carrier's price without VAT, plus the country's standard VAT,
  plus the store's percentage, plus its amount (`shopperPrice()`), in the country's own currency, with the nearest pickup
  points for a service that needs one. Only services the store switched on and priced in the country's currency are kept;
  a service that needs a pickup point is left out if Bring found none. A quote holds two hours.
- Choosing (`chooseDelivery()`) puts the quote on the cart (`carts.delivery_quote_id`, the pickup point on the quote) and the
  order is placed again, like a discount code does. `chosenDelivery()` is the one reader: a quote of the cart, for its
  country, not expired, with its pickup point chosen when it needs one, read in the market's currency; `cartSummary()` and
  `placeOrder()` both use it as the basket's shipping rate instead of the flat rate (free above the store's threshold,
  VAT at the standard rate), so they agree (`checkout-kinds.int.test.ts` has pickup, home, free-over and euro scenarios).
  No carrier is called while an order is placed. Subscriptions pay the flat rate on each delivery and ignore it.
- The order keeps `orders.delivery` (carrier, service, label, postal code, pickup point) and Stripe's shipping line is named
  after the service. The order pages, totals and emails name the service and the pickup point; the admin order page shows it,
  warns when the delivery address's postal code differs from the one the price was quoted for, and *Book with Posten / Bring*
  starts with the shopper's service and pickup point.
- Not built: other carriers, time windows, changing the delivery after the order is placed, and the shopper's postal code
  being filled into Stripe's address form (the admin page warns instead when they differ).

**To verify with real credentials** (nothing here has met Bring's servers yet): the `X-Bring-Test-Indicator` behaviour, the
booking request's `parties.pickupPoint` shape for service 5800, the label link being fetchable with the same headers, and
that the customer number is accepted for the three services.
