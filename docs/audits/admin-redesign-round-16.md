# Admin redesign, round 16: Kaizena Flow's discounts, pages and emails

Decision D650, 16 November 2026. The boards are on the design canvas of round 16 (today and proposal for each page). Rounds 9 to 15 gave
stores ready offers, rows that open in place and a sentence on top; this round brings them to Kaizena Flow's own admin. The platform's
subscriber list and broadcasts were meant first; they live in Kaizena Flow's own store (D467), which already had those rounds, so the
platform's Pages and Emails took their place.

## Plan discounts (`/admin/platform/discounts`)

- A sentence: *No campaign is running and no codes are live.*, or how many codes are on and which campaign runs; then that Kaizena Flow
  puts each in Stripe.
- *Start from an offer*: four ready offers (`src/lib/plan-offers.ts`): First month free (WELCOME, 100 % off the first payment), 20 % off for
  three months (START20), a partner's code (PARTNER10, 10 % off every payment) and a weekend sale (a campaign, 30 % off the first payment,
  the coming Friday to Sunday). Each opens its form filled in (`?offer=`, `PlatformDiscountFields` `draft`), to change before Make.
- *Live now*: the codes and campaigns as before, or a row saying none yet.
- *Write your own code* and *Write your own campaign* are folds, open when an offer filled them.

## Kaizena Flow's pages (`/admin/platform/pages`)

- A sentence: how many pages, and how far the legal pages are (*No pages yet, and the legal pages are not written.*).
- With no page, *Your first page* with Create with AI and New page, in place of the header's buttons.
- The missing business details are one line with *Fill them in*; the legal pages are rows with their state, and *Write the legal pages* stays
  one press under them.
- The front, blog and 404 pages are rows saying what each shows; Change opens the choice and the starter in place (`PagePlaceForm`).

## Emails (`/admin/platform/emails`)

- A sentence: *Email is not set up: {n} emails were kept, none sent.*, or what was sent and failed in the last seven days.
- The setup steps are behind *Show the steps* while email is not set up; once it is, the Sending card is as before.
- Chips: All, Not sent, Failed, Tests, each with its count (`src/lib/email-log.ts`).
- Emails are grouped by day (Today, Yesterday, the date), each with its time. The store's own Emails page groups the same way.

## What differs from the boards

- Categories and tags stays a button in the Pages header rather than moving to a More menu.
- Writing the legal pages is one button under the three rows, not a Write on the first row.

## Tests

`plan-offers.test.ts` (the offers and the weekend's dates), `email-log.test.ts` (chips, the week, the days).
