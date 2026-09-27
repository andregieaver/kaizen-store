# Bookings: appointments, stays, rentals and hosts

What stores can sell besides goods, and how it is built. Decided in D65
(`decisions.md`); this file is the design and the order of work.

## What stores sell

| Kind | Time | What is booked | At once | Examples |
|---|---|---|---|---|
| Appointment | Slots of N minutes, with buffers | A staff member (and maybe a room) | 1 per staff member, or a class size | Doctor, spa, hairdresser, course |
| Stay | Nights, check-in and check-out | A room type, or one property | N rooms, or 1 | Hotel, holiday home, Airbnb-like listing |
| Rental | Days or hours | Items of a kind | N items | Bikes, cars, tools, boats |

Stays can be listed by **outside hosts**: the store runs a marketplace, the
hosts are its sellers.

## Shape

- **The product stays the sellable.** Title, pictures, pages, search,
  prices per market, VAT, B2B, categories, cart, checkout, emails and orders
  are the same for every kind. `products.kind` is `goods` (today's physical
  and digital products), `appointment`, `stay` or `rental`; it decides the
  editor's sections and the product page's picker.
- **One booking module a store switches on** (`stores.modules`, later part
  of plans). It holds what is not a product:
  - **Resources**: staff, rooms, room types, properties, rental items, each
    with a capacity.
  - **Schedules**: working and opening hours, exceptions, holidays, blocked
    dates (the opening-hours editor of D40 again).
  - **Availability**: schedules minus bookings minus holds, worked out in
    the database under row locks, like stock today, so nothing is booked
    twice.
  - **Bookings**: a cart line carries a start, an end and what is booked;
    checkout holds it for the length of payment (as stock is held); paying
    confirms it. Moving and cancelling follow the store's cancellation rule.
  - **Admin**: a calendar, a bookings list, staff and their schedules.
  - **Emails**: confirmation with a calendar file (.ics), a reminder before,
    changes and cancellations.
- **Settings per kind** live in a table per kind, not on the product:
  appointments (length, buffers, booking window, which staff), stays
  (check-in/out, minimum nights, price per night and season, cleaning fee,
  guests), rentals (per hour or day, deposit, pickup and return).

## What the core needs first

- **VAT per product.** One standard rate per market is not enough:
  accommodation has reduced rates (Norway and Sweden 12 %, Germany 7 %) and
  health care is exempt. Products get a VAT category (`standard`,
  `accommodation`, `exempt`); rates per country and category are reference
  data (`commerce.vat_rates`), kept up to date by Kaizen and needing human
  review like the legal texts. A category without a rate for a country
  falls back to the standard rate, which never charges too little. Checkout,
  prices without VAT (D63) and the product editor use the product's rate.
- **Withdrawal per kind.** Accommodation and leisure services for a set date
  have no right of withdrawal (CRD Art. 16(l)); health care is outside the
  Directive. The kind decides, as digital content does today (D24).
- **Paying.** Stores choose per service or listing (D65):
  - **Now**, at booking, as today.
  - **At the venue**: no online payment; the booking is confirmed and the
    order waits for staff to mark it paid.
  - **Later**: the card is saved at booking (Stripe Checkout in setup mode,
    or `setup_future_usage`) and charged when due, off session; a hold on the
    card lasts only about seven days, so this is a saved card, not a hold.
  - Deposits, cancellation fees and no-show fees are charges on the saved
    card.

## Hosts (a store as a marketplace)

Stripe Connect has one platform: Kaizen. Stores are its connected accounts
(D17), and a store cannot be a platform of its own. So hosts become Kaizen's
connected accounts too, linked to the store that lists them, and money
moves like this (D71):

- A booking with a host is a **direct charge on the host's account**: the
  host is the seller of record, refunds and chargebacks come from the host.
  The `application_fee_amount` holds the store's commission and Kaizen's
  fee; Kaizen then **transfers the store's commission** to the store's
  account. One checkout pays one host, as one checkout starts one
  subscription today.
- The store's owners add hosts; hosts onboard with Stripe (their own
  account, full Dashboard) and keep their calendars and see their bookings
  and payments in a host area of the admin with only their own data. The
  store writes their listings.
- **VAT**: a host who is not VAT registered charges none (their listings
  are kept `exempt`); the store's commission carries VAT.
- **DAC7**: a platform that facilitates rentals of property must collect
  each host's identity and tax details and report what it paid them each
  year (by 31 January). The store is the platform operator; whether Kaizen
  is too needs legal advice. Hosts give their tax details in their area.

## Order of work

| Phase | What | Ships |
|---|---|---|
| **B0 Core** | VAT categories and rates; `products.kind`; the booking module switch; withdrawal per kind | Nothing visible to shoppers yet; the editor gains VAT category |
| **B1 Appointments** | Staff, schedules, services; slot availability with holds; time picker; bookings from checkout; admin calendar and list; emails with .ics and reminders | Stores sell appointments, paid now |
| **B2 Paying later** | Pay at the venue; saved card charged later; deposits, cancellation and no-show fees; cancellation rules | Stores choose how each service is paid |
| **B3 Stays and rentals** | Date ranges over units; nightly and seasonal prices; minimum stay, cleaning fee, deposits; calendar sync with Airbnb and Booking.com (iCal in and out) | Stores sell rooms, homes and rentals |
| **B4 Hosts** | Hosts, their Stripe accounts and area; commission; payouts; DAC7 data and yearly report | Stores run marketplaces |

B1 is done, in three parts: B1a (the module, staff and their hours,
appointment products), B1b (free times on the product page, times in the
cart, held at checkout and confirmed on payment) and B1c (the week calendar
where the store can cancel a booking, calendar files with the confirmation,
a notice to the member of staff, reminders a set number of hours before,
and cancellation emails).

B2 is done (D66), in three parts: B2a (each appointment paid now, with a
deposit, or at the venue; the venue's share as the order's balance, marked
paid by staff), B2b (shoppers cancel and move their own bookings until the
appointment's hours before, with refunds of what Stripe took) and B2c
(staff mark no-shows and may charge the fee to the card saved with the
deposit).

B3 is under way (D67). B3a is done: products of kind `stay` and `rental`
booked by whole nights or days over rooms and homes (`unit`) or rental items
(`item`), managed under Bookings → Rooms and items and seen night by night
under Stays and rentals; check-in and check-out (pick-up and return) times,
shortest and longest, and D66's payment and cancellation rules per product;
a four-week date picker on the product page (`RangePicker`,
`src/server/ranges.ts`, pure rules in `src/lib/booking-ranges.ts`); the cart
line's quantity is the nights or days, and checkout holds the whole span.
Shoppers cancel, but do not move, stays and rentals. B3b is done (D68):
blocked dates on each room, item or member of staff (time off), other
sites' calendars read in every 15 minutes, and each room's or item's taken
days published at a secret iCal address (`src/server/calendar-sync.ts`,
pure parts in `src/lib/calendar-sync.ts`). Rentals can also be offered by
the half day or hour, per variant (D69). B3c is done (D70): seasons that
raise or lower the price of the nights or days they cover, every year,
and a fee per booking such as final cleaning (`src/lib/booking-prices.ts`).
Seasons are named in each of the store's languages (`booking_seasons.names`,
`seasonName()`), the date picker shows the total, seasons and fee included,
before adding, and items rented by the half day or hour are published to
other calendars with their times rather than as whole days.
B3 is done. B4 (hosts, D71) is under way: B4a is done (hosts added by the
store's owners with a commission, their own area at `/admin/hosting/{store}`
with their listings, bookings and calendars, and no VAT for hosts not VAT
registered). B4b is done: hosts' bookings are charged on their own Stripe
accounts with the store's commission in the application fee (no-show fees
too), sent on to the store and given back in part with refunds
(`src/server/host-payments.ts`).
B4c is done: hosts give their tax details and their homes' addresses in
their area, and the store's owners download the year's DAC7 report
(`src/server/dac7.ts`, pure parts in `src/lib/dac7.ts`) to file by 31
January. B4 is done.

Every new kind comes with a demo product in the template store, which new
stores are copied with: appointments have `Demo: Massasje, 60 minutter`
with a member of staff (`commerce.add_demo_appointment()`), stays have
`Demo: Hytte ved vannet`, dearer in summer and at weekends, with final
cleaning (`commerce.add_demo_stay()`) and rentals
`Demo: Leie av elsykkel` with three bikes, rented by the day, half day or
hour (`commerce.add_demo_rental()`, D69).

Each phase ends with its migrations applied, tests and a decision entry, as
before.
