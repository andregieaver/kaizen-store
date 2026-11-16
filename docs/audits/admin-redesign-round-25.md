# Admin redesign, round 25: a rental product, categories and tags, and price lists on a phone

Decision D693, 17 November 2026. The boards are on the design canvas of round 25 (today at 390 px and a phone proposal for each page).
On a phone a rental product was 4,600 px with twelve rental rules open before its price; categories and tags gave every name three
buttons and a sentence; price lists opened on a paragraph and a blank form. A product's variants were left as round 19 made them.

## A stay or a rental (`RangeSection` in `src/components/admin/product-editor.tsx`)

- On a phone the price and stock come before the rental's rules (the section is ordered after them below 768 px).
- The rules are rows (`PhoneFold`, as round 19's): Pick-up and return (*09:00 to 17:00*), How long (*1 to 14 days, up to 180 days
  ahead*), Items, Fee and seasons (*No fee, no seasons*) and Payment and cancelling (*All at booking, free cancelling until 24 h
  before*), each opening its fields in place; the introduction waits for wider screens. From 640 px the card is as before.
- A stay has the same rows in its words (check-in and check-out, nights, cleaning).

## Categories and tags (`TermsManager`, every place it is used)

- On a phone each category and tag is its name and address with one action, Change; ordering its products, its fields and Delete
  come when it is opened. *No text of its own in search results* is left out on a phone; a text that exists is still said.
- The product page's lead is one line on a phone (*How shoppers find your products in menus and filters.*); the long one stays from
  640 px. From 640 px the rows keep every button, as before.

## Price lists (`/admin/{store}/price-lists`)

- With none yet: one line (*Your own prices for customer groups and companies. None yet.*), then Retailers −20 %, Wholesale −35 % and
  Staff −30 %, each *Make it*, which fills the form below with its name and percentage (`?ready=`); nothing is saved until *Make price
  list*. *Write your own* goes to the empty form, under which the rule of the lowest price is said.

## What differs from the boards

- The categories keep their card per kind with its form on top, rather than a count beside the heading.
- Items and the place a rental is collected are one row.

## Platform

`TermsManager` is the same for pages' and articles' categories, the platform's included, so Kaizena Flow's own page categories get the
phone rows too. Rentals and price lists are store-only: Kaizena Flow sells plans, not goods or bookings.

## Tests

`e2e/signed-in/collections.spec.ts` presses Change and Order products on a row at desktop width, where both stay on the row.
