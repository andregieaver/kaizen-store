# Admin redesign, round 10: Campaigns, Broadcasts, Company

Decision D633, 15 November 2026. The boards are on the design canvas of round 10 (today and proposal for each page). Built as drawn,
for Homer first, with Lisa's depth one step away.

## Campaigns (`/admin/{store}/campaigns`)

- A sentence: *No sale is running.* or *{n} sales are running.*, then that prices change by themselves, without a code. The 60-word
  description of every kind is gone from the page; the form still explains each kind with an example.
- Four ready sales (`src/lib/campaign-offers.ts`): 3 for 2 (some products, the owner chooses the category), a 20 % weekend sale (the
  coming Friday 00:00 to Sunday 23:59, Oslo time, `nextWeekend()`), free shipping over 800 and a free product over 1 000 in the main
  currency (the gift chosen by the owner). *Make it* opens New campaign with `?sale=`: kind, name, dates and thresholds filled in.
  The name is written in the shop's language (Norwegian for a Norwegian main market), since shoppers read it in the cart.
- *Write your own* (secondary) opens the blank form; existing campaigns stay listed above the ready sales.

## Broadcasts (`/admin/{store}/broadcasts`)

- A sentence: *{n} people can get your emails.* (subscribed people, `subscriberCounts()`), or, with nobody on the list, how people join.
- *Who is on the list* (the subscribers page) and *Write your own* beside it.
- Three emails to start from, the templates of D368: *New in the shop*, *An offer for the list* and *A thank-you*. *New in the shop*
  now starts with the store's three newest products already in it (`startingBroadcast()`, `withProducts()`), their pictures and prices
  drawn per recipient when the email is made (D352).

## Company (`/admin/{store}/settings/company`)

- A sentence: how many of the three things the law needs (legal name, registered address, country) are missing, or that all are there.
- While something is missing, the business form is first, in a yellow-edged card titled *Fill in what is missing*, naming what is.
- *What shoppers see*: the business (or, while it is incomplete, the store name and contact), the office and the stores and pickup points,
  one row each with its summary; *Change* or *Add* opens that part's form in place (native `<details>`).
- Selling to businesses and changing the business are one fold away at the bottom, open by themselves while a change is planned.

## What differs from the boards

- Company: the missing-fields form is the whole business form, not only the three missing fields: its save writes every business field
  at once, and splitting it would change what the action checks. The card names the missing fields instead.
- Company: Selling to businesses and the change of business sit in a fold at the bottom rather than a More menu in the header; a menu
  would have had to link to sections hidden in that fold.
- Broadcasts: *An offer for the list* does not make a code of its own (NEWS15 on the board); it is the offer template, where a running
  campaign is added from the store's facts. *A thank-you* goes to the whole list, not only this year's buyers.
- Campaigns: the first ready sale is green only while no sale runs; the others are secondary buttons.

## Platform

Kaizena Flow sells plans, not goods: it has no campaigns of this kind. Its own broadcasts and its business details
(`/admin/platform/settings`) keep their layout; the same sentence and rows for them are the next step.

## Tests

`src/lib/campaign-offers.test.ts` (new), `withProducts` in `src/lib/broadcast-templates.test.ts`; `e2e/signed-in/business-change.spec.ts`
opens the fold first.
