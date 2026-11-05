# Shipping carriers (D133)

Posten / Bring, PostNord, Porterbuddy, Helthjem, Instabox, DHL Express, UPS, DHL Paket and nShift are listed under **Integrations → Shipping carriers**
(`/admin/{store}/integrations`), each connected with the store's own agreement. This file began as the preparation (D133); each
carrier's section below says what its connection does now.

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


## PostNord (D136)

`src/lib/postnord.ts` (pure: addresses, `parseServicePoints()`, `parseTracking()`, `postnordProblem()`),
`src/server/carriers/postnord.ts` (`createPostnordAdapter()`), and the checkout side in `src/server/delivery-options.ts`.
Every call carries the store's own API key as `apikey`; in the store's test environment the calls go to PostNord's sandbox
(`atapi2.postnord.com`), live to `api2.postnord.com`.

**Works now**
- **Check connection**: a service point search near a postal code in Stockholm; a refused key is told plainly.
- **Service points** for the shopper at checkout (Business Location v5, nearest by address, up to five).
- **Tracking**: the latest event under a shipment on the order page (Track and Trace v5), for a shipment whose carrier name
  staff gave as "PostNord" (or booked with it, later) while PostNord is connected.
- **Services at checkout**, in SE, DK, NO and FI: MyPack Collect (17, with a service point), MyPack Home (19) and Parcel
  (18), **at prices the store enters**. PostNord has no price API: what a service costs is in the store's agreement, so on
  the carrier's page the owner enters, per country (in its currency) and service, the price **with VAT, as the shopper
  pays**, and what the basket is free above (`shipping_carriers.checkout_prices`, `{ NO: { freeOverMinor, services } }`). A
  service with no price in a country is not offered there; no markup applies. Both carriers can be on in a country:
  the services are listed together, cheapest first after the flat rate, each named for its carrier
  ("Posten / Bring: …"). A carrier that does not answer leaves the others, and the flat rate stays the fallback.

**Booking and labels (D458)**, from PostNord's own public Postman collection (guide.developer.postnord.com, read 2026-11-05; the portal's
EDI pages need a login): one call books and returns the label, `POST /rest/shipment/v3/edi/labels/pdf` with an EDI instruction (the store's
customer number with its country's issuer code Z11 DK, Z12 SE, Z13 NO, Z14 FI; the recipient; the order number; one item per parcel), and
`applicationId` (a store field; PostNord gives one on going live, its example 9999 in test). MyPack Collect carries the shopper's service
point as the delivery party. Across a customs border a CN23 declaration (at most five lines; more and staff declare it in PostNord's tools).
The label is only in the answer and is kept (`carrier_labels`). Return Drop Off (24) return labels, also kept. A collection from Sweden,
Denmark or Finland (`collectionCountries`), never from Norway. No cancel call is documented. **PostNord's codes**: its examples name 19
MyPack Collect and 17 MyPack Home, which this section had the other way round; the services are corrected and the migration swaps a store's
saved 17 and 19.

**To verify with real credentials**: the service point search's answer shape, Track and Trace v5's, that `atapi2` accepts a sandbox key,
that 17, 18 and 19 are in the store's agreement, the application id (one per store or one for Kaizena Flow), `paperSize=LABEL` for return
labels, and the A7 add-on read as "optional service point".


## Porterbuddy (D137)

`src/lib/porterbuddy.ts` (pure: addresses and phone numbers, pick-up windows, the availability and order requests, `parseAvailability()`,
`parseOrder()`, `formatWindow()`), `src/server/carriers/porterbuddy.ts` (`createPorterbuddyAdapter()`, `fetchPorterbuddyLabel()`),
`src/server/porterbuddy-shipping.ts` (booking), and the checkout side in `src/server/delivery-options.ts`. Built against
Porterbuddy's public API reference (developer.porterbuddy.com): `POST /availability`, `POST /order`, `GET /order/{id}/label`,
`GET /order/{id}/status`, every call with the store's API key in `x-api-key`; the test environment is
`api.porterbuddy-test.com` (nothing is delivered), live is `api.porterbuddy.com`.

**How it differs**: Porterbuddy sells a *time window*, not a service. At checkout the shopper's postal code is sent in an
availability request (the parcel's weight, and the windows in which the store has the goods ready) and Porterbuddy answers with
the windows it can deliver in, each with a price, a hold time (`expiresAt`) and a token.

**Works now** (Norway)
- **Windows at checkout**: each window is a quote (`delivery_quotes.window_start/window_end`, held until Porterbuddy's `expiresAt`
  or two hours, whichever is first) listed by date after the services, the earliest first, up to eight, with products `delivery`
  and `large` as the owner switches them on. The price is Porterbuddy's price without VAT plus VAT plus the owner's markup; a
  `displayPrice` (a price Porterbuddy made for shoppers to see) already has VAT and only gets the markup. The order keeps the
  window (`orders.delivery.window`) and the pages, emails and admin show it ("Delivered Thu 13 Feb, 17:30–19:30").
- **When the goods are ready** is on the carrier's page (the store's pickup address, phone and email, opening hours `10:00-17:00`
  and the days it hands over parcels `1-5`): windows are asked for after those, in the store's time zone, starting no earlier than
  half an hour from now.
- **Booking** (order page → *Book with Porterbuddy*, only for an order whose customer chose a window): the window is asked for
  again just before it is booked and booked with the *fresh* token (the shopper's has usually expired); if Porterbuddy no longer
  offers it nothing is booked and the owner is told to ask the customer for another time. The order reference is the order
  number and the idempotency key, so a retry never orders twice. A real booking marks the order as sent with Porterbuddy's order
  number as the tracking number and its tracking page; in the test environment the order is **not** marked as sent.
- **Labels** are fetched when printed (the label info, which holds short-lived addresses, then the PDF) and never kept; only
  `api.porterbuddy.com` and `api.porterbuddy-test.com` addresses are fetched (`carrierLabel()`, `isPorterbuddyUrl()`).
- **Status**: the order's status shows under the shipment (Porterbuddy gives a status, not a trail).

**Not yet**: consolidated delivery (*Samlevert*), pin-code or ID checks (the order is contactless), the status webhook, changing
a booked order, and any country but Norway.

**To verify with real credentials** (nothing here has met Porterbuddy's servers): whether `price` is with or without VAT for the
store's agreement (it is treated as without, as Porterbuddy invoices, and a `displayPrice` as with; compare the checkout with the
portal in the test environment and use the markup to adjust), that availability accepts a postal code without a street for the
destination, and that the pick-up windows match the store's agreement.


## Helthjem (D138)

`src/lib/helthjem.ts` (pure), `src/server/carriers/helthjem.ts` (`createHelthjemAdapter()`, `fetchHelthjemLabel()`),
`src/server/helthjem-shipping.ts` (booking), and the checkout side in `src/server/delivery-options.ts`. Built against
Helthjem's public OpenAPI description (`developer.helthjem.no/api-docs/openapi.json`): a bearer token from the store's client
id and secret (`/auth/oauth2/v1/token`, kept until a minute before it runs out and asked for again once if refused), Single
Address Check, Nearby Service Points, Bookings, Labels (`unified-large`, PDF) and Tracking. The test environment is
`api.pre.helthjem.no`, live is `api.helthjem.no`.

**Transport solutions**: Helthjem books by *transport solution*, an id the store's agreement gives it (the carrier page asks for
one for home delivery and, optionally, one for service points). A *stand-alone* solution (2 home only; 86 Helthjem's service
points) fails where it does not reach; a *fallback* solution (1, 114) lets Helthjem fall back to a service point itself. Which
is right depends on the shop; the page says so.

**Works now** (Norway)
- **Services at checkout**: *Helthjem home delivery* (up to 5 kg) and *Helthjem service point* (up to 20 kg), **at prices the
  store enters** per service, with VAT, and a free-above value (Helthjem has no price API; the same `checkout_prices` as
  PostNord). A service is left out of a cart heavier than it takes (`maxWeightGrams`).
- **Service points** for the one that needs it, from Nearby Service Points with the store's collect solution and the shopper's
  postal code.
- **Check connection**: gets a token, then asks coverage for a sample address with the store's shop id and solution; an
  address Helthjem does not cover still counts as accepted.
- **Booking** (order page → *Book with Helthjem*, for an order whose customer chose Helthjem): for a home delivery Helthjem is
  asked first whether it reaches the full address and nothing is booked if not; a service point is booked with the point the
  shopper chose (a `servicePoint` party). The order number is the references. A real booking marks the order as sent with the
  shipment number (without the `(401)` prefix) as the tracking number; in the test environment the order is **not** marked sent.
- **Labels** are fetched when printed and never kept (`carrierLabel()`); **tracking** shows the latest event under the shipment.

**Not yet**: Helthjem's own tracking page link (none is given by the API), express (`Helthjem Express`) and parcel lockers,
cancelling a booking, returns, a chosen delivery date, and a coverage check at checkout for home delivery (it needs the street
and city, which checkout does not ask for; a fallback solution makes up for it).

**To verify with real credentials** (nothing here has met Helthjem's servers): that a booking with `shipmentId: null` is
accepted, that service points are found by postal code alone, that the transport solution ids on the carrier's page are the
ones in the agreement, and the weight limits (5 and 20 kg, from Helthjem's delivery methods guide).


## Instabox, DHL Express and UPS (D457)

All three book through one path, `bookCarrierDelivery()` (`src/server/carrier-delivery-booking.ts`), from the order page (*Book with …*,
`carrierDeliveryBookAction`) and *Book labels*: one booking of an order at a time, the parcel's lines checked before the carrier is paid,
customs lines for a parcel across a customs border (D343), `markSent()` for a real booking and only a sentence for a test one. The
customer's choice with that carrier is booked as chosen; UPS and DHL also book an order whose customer chose no carrier (the flat rate or
the store's own method, shipped), with a door service staff choose. UPS and DHL ship from anywhere in Europe, so their pages ask for the
sender's country (`senderCountry`), which checkout and booking read through `senderAddress()`; the four older carriers still ship from
Norway.

### Instabox

`src/lib/instabox.ts` (pure), `src/server/carriers/instabox.ts`. Instabox is Instabee's brand of parcel lockers in Sweden, Norway and
Denmark; it is reached through Instabee's integration API (docs.integration.instabee.com, beta, read 2026-11-05), live
`api.integration.instabee.com`, sandbox `sandbox-api.integration.instabee.com`, every call with `Authorization: ApiKey …` and
`Accept-Version: 1.0.0`. The key comes from Instabee's implementation manager with the agreement; Instabee knows the store's warehouse
(`collectionPointId` only for a store that sends from several).

**Works now**
- **Lockers at checkout** (service `locker`, at most 20 kg), **at prices the store enters** per country (`checkout_prices`): the delivery
  options near the shopper's postal code (`GET /availability/countries/{cc}/postal-codes/{pc}/delivery-options?brand=instabox&product=LOCKER_EXPRESS`),
  nearest first. Each locker's id is its sort code with the availability token it came with (`SORTCODE~token`, `lockerChoice()`), since
  a booking names both and the token holds 14 days.
- **Booking** (`PUT /orders`, booked and confirmed as packed at once): the token and sort code, the recipient (Instabox texts the code,
  so a phone is required), the parcel reference as the order number, weight and size. A choice kept without a token is asked for again,
  and nothing is booked when the locker is gone. The parcel id is the tracking number with Instabox's tracking page; the order id is
  kept as the consignment number.
- **Labels**: `GET /orders/{orderId}/labels?fileFormat=pdf&template=a6`, fetched when printed and never kept.
- **Check connection**: the lockers near Stockholm Central.

**Since D458**: home delivery (`home`, Instabee's post-purchase page names `HOME_DELIVERY` for the `instabox` brand; booked after a
`HOME_DELIVERY` availability answer, the phone with its country code), and locker return labels (`LOCKER_RETURN`, the nearest return locker,
fetched like the label).

**Not yet**: Budbee (Finland, the Netherlands, Belgium), following parcels (Instabee reads an order by its own id, so Instabox is not in
`FOLLOWED_CARRIERS`; the shopper follows Instabox's page), events by webhook, cancelling (Instabee documents no delete for lockers).

**To verify with real credentials**: the sandbox's answer shapes (the documentation is marked beta), whether `deliveryPrice` is the
store's price, and that the sort code is the same in a later availability answer.

### DHL Express

`src/lib/dhl.ts` (pure), `src/server/carriers/dhl.ts`. The MyDHL API 3.4.1 (developer.dhl.com, OpenAPI released 2026-11-01): live
`express.api.dhl.com/mydhlapi`, test `…/mydhlapi/test` (500 calls a day), HTTP Basic with the store's API key and secret, `x-version:
3.4.1` on every call. DHL Express is the one DHL service a store anywhere in Europe can use with one connection; DHL's parcel networks
(Parcel DE, Parcel EU, eConnect, DHL Freight Sweden's Service Point) are separate APIs per country.

**Works now**
- **Services at checkout**, in Europe (`EUROPE`), **priced by DHL** for the parcel: Express, Express 12:00 and Economy Select. DHL names a
  product per lane (Express Worldwide is `P` through customs, `U` within the EU, `N` within one country), so each service is a family of
  product codes (`DHL_SERVICES[].codes`). Rates needs the destination's city: checkout asks only for the postal code, so Address Validate
  gives it first. The price is the billing currency's total less DHL's tax (`STTXA`), with VAT and the store's markup added as for Bring.
- **Booking**: Rates is asked for the lane's product code for the store's service, then `POST /shipments` with a PDF label
  (`ECOM26_84_001`), no pickup (the store hands in or has a standing pickup), and across a customs border the declared value and one
  `exportDeclarations` entry with each line (HS code, origin, unit price, quantity, weight), DDP when the shopper paid the duties.
- **Labels**: DHL gives the label only in the booking's answer (`get-image` has no label), so it is kept in `commerce.carrier_labels`
  with the parcel and served by `carrierLabel()`; retention kind `carrier_labels` deletes it after 30 days, and erasure with the
  person's orders. `label_url` holds the shipment's address at DHL.
- **Tracking**: `GET /shipments/{waybill}/tracking` with each event's GMT offset. DHL's checkpoint codes are read from its reference data,
  so OK (delivered), WC (with courier), CC (awaiting collection) and the others listed in `tracking-phases.ts` are verified.
- **Check connection**: a rate within the sender's own city.

**Since D458**: delivery to a DHL ServicePoint (`servicepoint`: MyDHL's service point locator, `GET /servicepoints`, gives six-character
`facilityId`s; booked with `onDemandDelivery` and `buyerDetails`), and a collection (the shipment's `pickup` with the day and close time,
`dispatchConfirmationNumber` the confirmation).

**Not yet**: Express 9:00 and 10:30, returns (an import account), cancelling (MyDHL has no shipment cancel; only a pickup is cancelled).

**To verify with real credentials**: whether `totalPrice` holds VAT for a Norwegian account (the net is taken as the total less `STTXA`),
that `exportDeclarations` line prices are unit prices, and DHL's portal terms, which say rating data may not be stored or modified (a
quote is kept two hours and marked up as the store chooses).

### UPS

`src/lib/ups.ts` (pure), `src/server/carriers/ups.ts`. UPS's OpenAPI documents (github.com/UPS-API/api-documentation, read 2026-11-05):
OAuth client credentials with HTTP Basic (`/security/v1/oauth/token`, the account as `x-merchant-id`), production `onlinetools.ups.com`,
test `wwwcie.ups.com`, `transId` and `transactionSrc` on every call. The client id and secret come from an app the owner makes on
developer.ups.com with the account number added.

**Works now**
- **Services at checkout**, in Europe, **priced by UPS** (Rating v2409 `Shop`, the negotiated rate when the account has one): Standard,
  Express Saver, Express, and Standard held at a UPS Access Point (`AP`) the shopper chooses from the Locator
  (`/api/locations/v3/search/availabilities/64`, by public access point id).
- **Booking**: Shipping v2409 on the store's account, a GIF label (the only image Shipping makes), the order number as the reference, an
  Access Point delivery as `ShipmentIndicationType` 01 with `AlternateDeliveryAddress` and UPS's notice to the recipient, and across a
  customs border a description and a paperless commercial invoice (`InternationalForms`), duties billed to the store when DDP.
- **Labels**: Label Recovery gives the label again as a PDF from the tracking number when it is printed (`labelUrl()` holds the number
  after `#`), never kept.
- **Tracking**: `GET /api/track/v1/details/{number}`. UPS's status letters are not explained in its documents, so they are unverified.
- **Check connection**: a rate within the sender's own country.

**Since D458**: a collection (the Pickup API after the shipment, its PRN the confirmation), cancelling when a parcel is undone (`void`),
and print return labels (`ReturnService` 9, Standard or Express Saver, recovered as a PDF like a label; none across a customs border).

**Not yet**: UPS's own delivery estimates at checkout.

**To verify with real credentials**: that the Locator answers for a postal code alone, which access point id Shipping takes (the
public id is used; Shipping allows 9 characters, the Locator gives up to 15), how long Label Recovery keeps a label, and the meaning of
the tracking status letters.


## DHL Paket (D458)

`src/lib/dhl-paket.ts` (pure), `src/server/carriers/dhl-paket.ts`. DHL's own OpenAPI documents (developer.dhl.com, read 2026-11-05): Parcel
DE Shipping 2.2.0, Parcel DE Returns 1.1.0, Parcel DE Pickup 1.0.3, Location Finder - Unified and Shipment Tracking - Unified. The store's
own app on DHL's developer portal (its key and secret) and its Business Customer Portal system user: an OAuth password grant
(`/parcel/de/account/auth/ropc/v1/token`, kept until it runs out); sandbox `api-sandbox.dhl.com` (DHL's user `user-valid`, EKP
3333333333), live `api-eu.dhl.com`. DHL approves an app for production after its sandbox use.

**Works now**
- **Services at checkout**, from Germany, **at prices the store enters**: DHL Paket (V01PAK at home, V53WPAK abroad, 31.5 kg), DHL
  Kleinpaket (V62KP, V66WPI abroad, 1 kg) and DHL Paket to a post office or Paketshop (Germany only, the point's retail id with its postal
  code and city). Packstation is left out: it needs the shopper's Postnummer.
- **Booking**: the billing number from the EKP, the product's procedure and the participation; three-letter countries; no recipient phone
  within Germany (DHL's spec forbids it); customs lines abroad. The label is in the answer and kept; DHL gives it again only until the
  day's closing (17:45 by default), so the kept copy is printed after that.
- **Check connection**: a token, then a validate-only order (`validate=true`): nothing is booked.
- **Cancelling** before the day's closing (`DELETE /orders`), **DHL Retoure** return labels (the returns receiver set up in the portal, `deu`
  by default; the label kept with the return), a **collection** (Parcel DE Pickup, chargeable), and **tracking** through Unified Tracking
  (its `statusCode`s verified; no out-for-delivery code).

**To verify with real credentials**: production approval of a store's own app, whether customs item values and weights are per piece, the
1 kg limit of Kleinpaket, the retail id a Filiale shipment takes, the returns receiver, Pick-Up rights, and Unified Tracking's limits (250
calls a day at first, one per 5 s, until DHL upgrades the app).

## nShift (D458)

`src/lib/nshift.ts` (pure), `src/server/carriers/nshift.ts`. nShift Delivery's REST API (formerly Unifaun Online; its API description at
www.unifaunonline.com/rs-docs, read 2026-11-05): `https://api.unifaun.com/rs-extapi/v1`, `Authorization: Bearer {id}-{secret}` with the
store's own API key. There is no test host: the store's test environment books with `test: true` (nShift prints TEST and sends nothing to
the carrier) and asks no collection. nShift books every carrier of the store's own agreements, so which carriers and services a store has is
its nShift account's.

**Works now**
- **At checkout**, the store's own nShift delivery checkout (`checkoutId`): each option is named by nShift's service code with the store's
  price, which holds VAT (only the store's markup is added), and its own pickup points (`ShippingOption.pickupPoints`). Switching on
  `checkout` offers whatever the checkout offers (`switchedOnOption()`); options are named by the carrier that delivers, never "nShift".
- **Booking** the shopper's option with its pickup point (`agent`), or on a flat-rate order the service code on the carrier page
  (`defaultService`), with the sender's quick id, the store's addon codes and a commercial invoice across a customs border.
- **Labels** made again when printed (nShift keeps documents for an hour), never kept; **cancelling** (`DELETE /shipments/{id}`); a
  **collection** (`/pickup-bookings`); **tracking** by nShift's statuses (verified, from its API description).

**Not offered yet**: return labels (built, `bookReturn`, but which party is which on a return shipment is not confirmed). No label cost is
kept from nShift's prices, which are the shopper's.

**To verify with an nShift account**: the checkout's `weight` parameter and whether `priceValue` holds VAT, the return shipment's parties,
`printSet` for customs per carrier, and the licences each call needs (a missing one answers 403).

## After the booking: collection, cancelling and return labels (D458)

- **Collection**: the booking box offers *Ask {carrier} to collect it ({hours})*, ticked, when the carrier has `collection` and its page has
  *Collection hours*, and (PostNord) the sender is in one of its `collectionCountries`. `collectionFor()` asks for today from the next quarter
  hour while two hours of the window are left, else the next weekday. The carrier's answer is told with the booking; a refusal never undoes it.
- **Cancelling**: undoing a parcel (`undoShipment()`) then asks the carrier to cancel it (`cancelAtCarrier()`), for UPS, DHL Paket and nShift;
  the confirmation says so beforehand, the message says what the carrier answered, and the parcel stays undone either way.
- **Return labels**: each carrier's services are in `RETURN_SERVICES` (the settings form groups them by connected carrier; a service chosen for
  another carrier is never sent). A return label given only in the carrier's answer is kept with the return and printed from there.

