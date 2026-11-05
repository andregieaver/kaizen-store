# Labels without a carrier agreement: Sendcloud (D454)

The owner (5 November 2026), on the Shopify comparison's *Where Shopify is the better fit*: "You want to buy labels from Shopify itself, with
no carrier agreement of your own, shipping from a country such as Germany or France ... we should be able to solve easily", then "Write the
plan for the Sendcloud labels integration", and chose the recommended answer to each of the three decisions (section 12). **This file is a
plan: nothing in it is built.** Code, tests and texts follow it; where they
disagree, this file is corrected first.

Sendcloud's facts below were read on its own pages on 5 November 2026 (developer docs at `sendcloud.dev`, `sendcloud.com`'s pricing, terms
and security pages); the Help Center refused direct reading, so what rests on a search excerpt says so. They change: read them again before
each step is built.

---

## 1. The promise

Gerda sells from Germany. She has no contract with DHL, DPD or GLS. In Flow:

1. She opens a free Sendcloud account, pastes its two keys into Flow and presses **Check connection**.
2. Her checkout offers DHL home delivery, a DPD pickup point or GLS, with a price she set or Sendcloud's price plus her margin.
3. On the order she presses **Book with Sendcloud**: Flow shows what each option costs her, books the one the customer chose and prints the
   label. The customer gets Flow's shipped email with the tracking link.
4. Sendcloud invoices her for the labels; Flow never touches that money.

She needs no carrier agreement and buys labels at Sendcloud's own rates. What she still needs is a Sendcloud account, which is the one
difference left from Shopify (section 9).

## 2. Who it is for, and who it is not

| Shop's country (where it ships from) | With Sendcloud |
|---|---|
| Germany, France, the Netherlands, Belgium, Austria, Italy, Spain, the UK | Full: Sendcloud's own rates, no carrier contract |
| Denmark, Sweden, Czechia, Poland, Portugal | Only with an invoice address in one of the eight above and a direct carrier contract (pricing page); Portugal cannot open an account (excerpt) |
| **Norway, Finland** | **Not offered.** Norwegian shops keep Posten / Bring, PostNord, Porterbuddy and Helthjem on their own agreements (D134 to D138) |

So Sendcloud is for Flow's shops in western and central Europe: exactly the countries the Shopify line names. It does not change anything for
a shop shipping from Norway; Flow's answer there stays the Nordic carriers. Whether Sendcloud accepts a Norwegian company with a German
warehouse is not settled: ask Sendcloud (section 11).

## 3. Two ways to do it, and the one proposed

| | **A. The shop's own Sendcloud account** (proposed) | B. Flow sells labels itself |
|---|---|---|
| Who holds the account | Each shop, on any Sendcloud plan | Kaizena Flow, one account for all shops |
| Who pays Sendcloud | The shop, by Sendcloud's invoice (every two weeks, direct debit or card) | Flow; Flow charges each shop |
| What Flow keeps | The shop's two keys, encrypted, like every carrier agreement (D133) | Nothing per shop, but every label's cost and Flow's own invoicing |
| Allowed by Sendcloud's terms | Yes: it is how its integrations work | Only with Sendcloud's **written consent** (General Terms 9.2: rights "cannot be transferred, pledged or sublicensed"); its marketplace guide describes this "centralized" model |
| Closes the Shopify line | Narrows it: no carrier agreement, but a Sendcloud account | Closes it: labels from Flow itself |
| Risk to Flow | None beyond the code | Credit risk, prepayment Sendcloud may ask for, surcharges billed after the fact, VAT on resold transport, a reseller agreement |

**Chosen by the owner (5 November 2026): A now, B only as a later commercial step** with Sendcloud's written agreement, Flow's own billing of label costs and an
accountant's reading of the VAT. A gets every shop in the countries above buying labels without a carrier agreement within the build order
below, with nothing Flow has to invoice.

## 4. What is there today

The carrier connections (D133 to D138) were built so a new carrier is an adapter, not a new system. Sendcloud is a fifth `CarrierId`.

| Built | Where | Used for Sendcloud |
|---|---|---|
| The registry and the store's agreement, secrets encrypted, never copied | `src/lib/shipping-carriers.ts`, `commerce.shipping_carriers`, `carrierContext()` | The two keys, the sender address, the environment |
| `ShippingCarrierAdapter`: `check`, `rates`, `pickupPoints`, `book`, `bookReturn`, `track` | same file | Sendcloud implements all six |
| Checkout services, `carrier`- or `store`-priced, quotes held on the cart, the flat rate kept when a carrier fails | D135, D136, `delivery-options.ts`, `delivery-choice.ts` | Sendcloud's options and service points |
| Booking from the order, one at a time, parcels checked, `markSent()`; *Book labels* on the Orders list | `carrier-booking.ts` (D372), `bulk-labels.ts` (D374) | Booking and bulk labels |
| Labels fetched from the carrier when printed, never stored | `carrier-label.ts` | Sendcloud's label documents |
| Customs lines checked before any booking | `bookingCustomsProblem()` (D343) | Sendcloud's parcel items and customs invoice |
| Tracking kept and the delivered date recorded once | `shipment-tracking.ts`, `carrier-tracking.ts` (D238) | Sendcloud's tracking |
| Return labels from an approved return | `return-labels.ts` (D239) | Sendcloud's returns |

These files name their carriers one by one (`carrierLabel()` accepts `bring`, `porterbuddy` and `helthjem`; `trackedCarrier()` the four);
each gains `sendcloud` where it applies.

## 5. Sendcloud's side (read 5 November 2026)

- **API v3** (`https://panel.sendcloud.sc/api/v3`). v2 is in maintenance and closed to accounts made after 13 April 2026, so Flow builds on
  v3 only.
- **Keys:** a public and a secret key per integration (Settings → Integrations in Sendcloud's panel), sent as Basic auth; OAuth exists only
  as `client_credentials` on the same keys. There is **no consent flow** that connects a shop to a platform: the shop pastes its keys.
- **Tech Partner programme:** apply, build, Sendcloud approves; an approved partner sends its `Sendcloud-Partner-Id` on every call. What
  joining asks beyond that is not settled.
- **Options and prices:** `POST /shipping-options` with the sender's and recipient's country and postal code and the parcel's weight and size,
  `calculate_quotes: true`, returns each option's code, carrier, price (`quotes[].price.total`), lead time and requirements (email, phone,
  dimensions). Whether the price includes VAT is **not stated**; surcharges are estimates and can change what is billed.
- **Booking:** `POST /shipments/announce` (synchronous, one parcel returns its label) with `to_address`, `from_address` or
  `sender_address_id`, `ship_with` (the option's code and the contract), the parcel's weight, and `external_reference_id`: the same id again
  answers 409 with the shipment already made. A carrier's refusal can come back as **HTTP 200 with status *Announcement Failed*** (not charged).
- **Labels:** `GET /parcels/{id}/documents/label` (and `customs-declaration`) as PDF in A4, A5 or A6, ZPL or PNG.
- **Cancelling:** `POST /shipments/{id}/cancel` within 42 days and before it moves; the cost comes back "on your next invoice". The Help
  Center's pages disagree on whether the label fee comes back, and some carriers do not process cancellations (excerpt).
- **Service points:** `GET /service-points` by country, carrier and address, on the same keys, server-side only (v3 has no browser token);
  the integration's *Service Points* setting must be on.
- **Tracking:** `GET /parcels/tracking/{number}` with events and a phase (`ready_to_send`, `in_transit`, `delivered`); webhooks
  (`parcel_status_changed`) are set by the shop in Sendcloud's panel, signed with HMAC-SHA256 of the body (`Sendcloud-Signature`), retried
  up to 10 times, possibly out of order.
- **Returns:** `POST /returns` (asynchronous), the label from the same documents endpoint.
- **Customs:** each item's description, quantity, weight, price, HS code and origin; an invoice number and export reason; tax numbers (VAT,
  EORI, IOSS). Sendcloud makes the commercial invoice or CN22/CN23.
- **No sandbox.** A free test label is the option `sendcloud:letter` (`sendcloud:letterreturn` for returns); anything else is a real label.
- **Limits:** 1,000 reads and 100 writes a minute (15 a second), 429 beyond.
- **Plans:** Free (20 parcels a month), Lite, Growth, Premium, Pro, Enterprise, with a per-label processing fee. Own carrier contracts from
  Lite. Whether the API is on every plan is **not settled**.
- **Data:** AWS EU (Frankfurt and EU North), ISO 27001, a data processing agreement the shop accepts with its account; the sub-processor list
  could only be seen as an excerpt dated 1 August 2024.

## 6. How it works in Flow

**Connecting (Integrations → Shipping carriers → Sendcloud).** The registry gains Sendcloud: countries as in section 2, features rates,
pickup points, labels, tracking, return labels; fields *Public key* and *Secret key* (secret), and the environment. The steps on the page tell
Homer where the keys are in Sendcloud's panel and that *Service Points* must be on. **Check connection** reads the account's sender addresses
(a harmless read) and keeps the answer as the other carriers do. The sender is chosen from Sendcloud's own sender addresses
(`sender_address_id`), so the address on the label is the one Sendcloud already verified. Flow's `Sendcloud-Partner-Id` (Flow's, once
approved) is a platform setting, never a shop's field.

**Test mode.** Sendcloud has no sandbox, so Flow's *test* environment books only `sendcloud:letter`: free, nothing shipped, and, as with
Bring's test bookings, the order is **not** marked sent. *Live* books what the customer chose.

**Checkout.** Sendcloud's options become checkout services like the other carriers', in the countries the shop ticked:
- **`store`-priced first** (as PostNord and Helthjem, D136): the shop picks options (for example DHL home, DPD pickup point) and enters the
  price with VAT per country and a free-above value. Safe while Sendcloud's VAT basis is unread.
- **`carrier`-priced** (Sendcloud's quote plus VAT plus the shop's markup, as Bring) only once a real account shows whether quotes include VAT.
- Pickup points from `/service-points` near the shopper's postal code, kept on the quote and the order as today. A Sendcloud that does not
  answer leaves the flat rate, and no point is required.

**Booking (order page and *Book labels*).** `sendcloudBook()` through `carrier-booking.ts`: the parcel's weight from the variants (or typed),
the options with what they cost the shop (each quote's price, marked *may change with surcharges*), then `announce` with
`external_reference_id` = Flow's shipment id, so a retry never makes a second label. Flow reads the shipment's status, not only the HTTP code:
*Announcement Failed* is a refusal shown with Sendcloud's own sentence. A booked parcel keeps its tracking number and link, Sendcloud's parcel
id and the label's address on `shipments`, and goes through `markSent()`. Bulk labels pace their writes under Sendcloud's 15 a second and
back off on 429.

**Customs.** A parcel that crosses a customs border passes `bookingCustomsProblem()` first, then goes with its lines as parcel items, the
order number as the invoice number, export reason *commercial goods*, `commercial_b2c` or `commercial_b2b` for a business buyer (D63), and
the store's VAT number and IOSS number (D157) as tax numbers. Rules for Norway (VOEC), the UK and Switzerland are not in Sendcloud's docs:
read again before step 2 ships them.

**Labels.** *Print label* fetches `documents/label` with the shop's keys and never keeps it, in the shop's chosen size (A6 by default, A4,
or ZPL for a label printer), with the customs declaration beside it when there is one.

**Undoing a parcel.** Undoing a Sendcloud parcel (D174's undo) cancels it at Sendcloud within 42 days; Flow says plainly that the cost comes
back on Sendcloud's invoice and that some carriers do not take cancellations. A new optional adapter method, `cancel()`, carries it.

**Tracking.** First by polling, as for the other carriers (`GET /parcels/tracking/{number}`, well inside the read limit): events shown on both
order pages, the delivered phase recorded once through `record_carrier_delivery()` after its code is checked against `GET /parcels/statuses`,
the out-for-delivery and delivered emails as D238. Webhooks later (step 4b): they need the shop to paste Flow's address into Sendcloud's panel,
which is a step Homer should not need for the first version.

**Returns.** `bookReturn()` with `POST /returns`; asynchronous, so the label is fetched by the five-minute job once Sendcloud has made it, then
offered as D239 does (email button and status page, fetched never stored).

## 7. The EU's rules and the data

- **The shop is the seller and Sendcloud's customer.** Flow is a tool that sends the shop's order data to the shop's own Sendcloud account on
  its instruction; Sendcloud's data processing agreement is between the shop and Sendcloud.
- **Personal data:** Sendcloud receives the recipient's name, address, email and phone (when an option requires them), and the carrier
  receives them as with any shipping. The store's privacy notice starter names Sendcloud as a recipient when it is connected
  (`docs/wave-1g-gdpr.md`), as it does for the other carriers. Sendcloud's hosting is in the EU; carriers outside the EU (UPS, FedEx) receive
  data as their own service requires.
- **Keys:** encrypted with the settings key, shown as their last four characters, owner-only, never in a store copy, never logged.

## 8. Lisa, one step away

On the Sendcloud page: the environment, the sender address, the label size (A6, A4 or ZPL), the default export reason, the options offered
at checkout per country with their prices or markup, and whether undo also cancels at Sendcloud. On the order: every option Sendcloud offers
for the parcel, not only the customer's choice.

## 9. What the comparison pages may say, and when

- After step 2 works on a real account: Flow's label line names Sendcloud: *Labels with Sendcloud in Germany, France, the Netherlands, …,
  with no carrier agreement of your own*.
- Shopify's line stays fair but changes: *You want to buy labels from Shopify itself, without an account elsewhere*. It goes only with way B.
- The parity rows move only after a real account is used (bucket B until then): `orders.shipping-label-purchase-and-printing`,
  `orders.carrier-calculated-live-rates` (prices outside Norway), `orders.pickup-points-and-lockers-at-checkout` (criterion 3: DPD, GLS and
  others), `orders.return-labels`, `orders.delivery-status-notifications-tracking-page`.

## 10. Build order

| Step | Builds | Done when |
|---|---|---|
| 0 (people) | A Sendcloud account Flow can test with (a shop in Germany or the Netherlands); the Tech Partner application; the questions of section 11 sent | Flow can make free `sendcloud:letter` labels with its own test keys |
| 1 | The registry entry, the keys, *Check connection*, the sender addresses, test mode | A shop's keys are checked and its sender address chosen |
| 2 | Booking from the order and *Book labels*, labels fetched never stored, customs, `cancel()` on undo | A test order is booked, its label printed and the parcel undone, all on a real account |
| 3 | Checkout options (`store`-priced), pickup points; `carrier`-priced after the VAT basis is read | A test checkout in Germany offers DHL home and a DPD pickup point, and the order books the chosen one |
| 4 | Tracking by polling, the delivered phase, the emails; 4b webhooks | A real parcel is followed to *delivered* and its date recorded once |
| 5 | Return labels | An approved return gets a Sendcloud return label by email |
| 6 (only if chosen) | Way B: Flow's own account and its billing | Sendcloud's written consent, Flow's label invoicing and an accountant's reading of the VAT |

Each step gets its tests (pure request and response code in `src/lib/sendcloud.ts` tested on Sendcloud's documented examples, the adapter in
`src/server/carriers/sendcloud.ts`, integration tests with a faked Sendcloud, `checkout-kinds.int.test.ts` for the checkout prices in a euro
scenario), its decision and the rows of section 9.

## 11. Questions for Sendcloud (step 0)

1. Can a Norwegian company open an account to ship from a warehouse in Germany or the Netherlands, and is Norway on the road map as a sender
   country?
2. Is the API on every plan, the Free plan included?
3. Do `shipping-options` quotes include VAT?
4. For an integration whose shops paste their own keys, which key signs the webhooks?
5. Is the label fee refunded when a label is cancelled in time, and which carriers do not take cancellations?
6. What does the Tech Partner programme ask of a platform, and what would way B need (the reseller terms)?
7. The current sub-processor list.

## 11a. The message to Sendcloud (for the owner to send)

To Sendcloud's Tech Partner programme (the form at `sendcloud.com/ecosystem`), with the questions as the message. Plain text; change the
signature and company details.

> We build Kaizena Flow (kaizenaflow.com), an e-commerce platform for shops selling across the EU, with servers in Dublin. We would like to
> join your Tech Partner programme and build a Sendcloud integration on API v3, where each shop connects its own Sendcloud account with its
> own API keys, books labels from its orders, offers your shipping options and service points at checkout, follows its parcels and makes
> return labels. Before we build, could you help with these questions?
>
> 1. Can a Norwegian company open a Sendcloud account to ship from a warehouse in Germany or the Netherlands? Is Norway planned as a
>    sender country?
> 2. Is API access included on every plan, the Free plan too?
> 3. Do the prices returned by `POST /api/v3/shipping-options` (`calculate_quotes: true`) include VAT?
> 4. For an integration where each shop uses its own API keys, which key signs the webhooks (`Sendcloud-Signature`)?
> 5. When a label is cancelled within 42 days, is the label processing fee refunded too, and which carriers do not accept cancellations?
> 6. What does the Tech Partner programme ask of a platform, and could we later offer labels under our own account to our shops (your
>    "centralized" model), with your written consent?
> 7. Could you send your current list of sub-processors?
>
> We would also be glad of a test account in Germany or the Netherlands to build against.

## 12. Decisions, answered by the owner on 5 November 2026

1. **The model:** each shop's own Sendcloud account now; Flow selling labels itself only later, with Sendcloud's written consent.
2. **Apply to the Tech Partner programme now:** it gives Flow a contact for section 11 and a place in Sendcloud's app store. The owner sends
   the application and the questions (section 11a); a person, not the code, holds that conversation.
3. **Checkout prices:** the shop's own prices first; Sendcloud's prices with a markup once the VAT basis is known.

## 13. Not in the first version

Way B; Sendcloud's own checkout widgets and shipping rules (plan-gated on the shop's Sendcloud plan); several parcels in one booking
(multicollo); webhooks (step 4b); other label hubs (Packlink, Boxtal, Shippo), which could follow the same adapter later.
