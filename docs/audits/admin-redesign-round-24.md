# Admin redesign, round 24: return rules, order settings and checkout rules on a phone

Decision D692, 16 November 2026. The boards are on the design canvas of round 24 (today at 390 px and a phone proposal for each page).
On a phone the return rules were 3,300 px and the order settings 3,000 px, every choice open with its paragraph of law; checkout rules
showed a mock checkout and seven example chips before anyone wanted a rule. Shipping, shipping methods and payments read well on a phone
already and were left as they are.

## Return rules (`/admin/{store}/settings/returns`, `ReturnSettingsForm`, `ExchangeSettingsForm`)

- One line under the title: the store's rules in words (*Your rules: 14 days to change their mind, the customer pays the shipping, refund
  when goods are back.*); the paragraph on the law is the first thing *How long customers have* says when it is opened.
- How long, Who pays and when, What can come back, Where goods are sent back and Instructions are one card of rows (`FoldRow`), each
  saying what is chosen (*The store's address*, *None yet*) and opening its fields in place; *Save the return rules* is wide on a phone,
  right under them.
- Exchanges (*Offered*) and Return labels (*Connect a carrier first*, *Booked from a return*) are rows of their own form, with its Save.

## Order settings (`/admin/{store}/settings/orders`, `OrderSettingsForm`)

- Gift messages, Archive finished orders, Draft orders, Request a quote, Money taken outside Kaizena Flow and Take payment are one card
  of rows, each with its choice in words (*Off*, *Pay links last 7 days*, *When the order is placed*); one wide Save under them. Every
  field and explanation is kept inside its row, and a field in a closed row is still sent.

## Checkout rules (`/admin/{store}/settings/checkout`)

- On a phone, what a shopper fills in is a row with *See it* rather than a mock a screen tall (`CheckoutAsksCard`); from 640 px it is the
  card beside the choices, as before.
- The examples to start from (rules and questions) open with *Add a rule* / *Add a question*, above a blank one, rather than before anyone
  wants one; Add is the strong button.

## What differs from the boards

- The checkout's account choice and contact fields stay as they are (the tiles and two selects), not rows: they save together with a
  preview that changes as they are chosen.
- Rules and questions stay as their cards with Add; they are not one card of rows.

## Platform

Return rules, order settings and checkout rules are store-only: Kaizena Flow sells plans through Stripe, with no parcels, returns or
checkout of goods.

## Tests

`e2e/signed-in/checkout-questions.spec.ts` (Add a question, the preview's links at desktop width) needs no change.
