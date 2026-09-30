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
4. Rates at checkout: offer the carrier's options next to the flat rate for the markets the store chose, in the shopper's
   currency (D109, `shown()`), priced with VAT like every shipping price; `placeOrder()` and `cartSummary()` must agree
   (`checkout-kinds.int.test.ts`).
5. Booking: a "Book shipment" action on the order that stores the tracking number in `shipments` and emails it; store the
   label in private storage.
6. Keep the agreement out of store copies (`shipping_carriers` is `never` in `COPY_RULES`, and in `SECRET_TABLES`).
