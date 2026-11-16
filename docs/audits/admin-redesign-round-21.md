# Admin redesign, round 21: after the parcel has gone, on a phone

Decision D681, 16 November 2026. The boards are on the design canvas of round 21 (today at 390 px and a phone proposal for each page).
On a phone a sent order was eleven cards and about 2,600 px: a date field before Mark delivered, a card that only said the items could
not change, and Payment, Profit and Tags each in a box. Refunding said the money was taken outside Kaizena Flow twice, and an empty inbox
was a blank card.

## A sent order (`/admin/{store}/orders/{id}`)

- Local delivery (`LocalDeliveryPanel`): the place, postal code and phone in one line; *Delivered today* is one wide press (dated the store's
  today), *Another day* folds the date field, as the pickup panel since round 18.
- Paid outside Kaizena Flow: one line under the total (*Paid by bank transfer, recorded by staff*), the long note behind *Why?*; the
  Payment card is left out while it would only repeat that line (no Stripe payment, no dispute).
- *Change the items* is drawn only when it can do something or lists changes: a block the page already shows (sent, copied, unpaid, a
  return, units closed) with no changes so far draws nothing (`SELF_EVIDENT_BLOCKS`); the Refund row says *Items can't change once sent*.
- Refund (or cancel, before anything is sent), Returns and withdrawals, and Notes and history are one card of rows that open in place
  (`FoldRow`, and `FoldOnHash` with `action` for the row the header's menu links to, `#refund-cancel`).

## Refund (`RefundForm`)

- One sentence: what was paid and who sends the money (outside Kaizena Flow: *Pay the customer back yourself, then record it here*); the
  grey box that said it again is gone, kept only for a member who may not record it.
- *Everything* (what is left, chosen first) or *Part of it* (the amount field); the button names the amount: *Record a 599 kr refund*,
  *Refund 599 kr*, still confirmed before Stripe moves money.
- Back in stock with − and + beside a number that stays typeable; the reason folded under *Add a reason*; what Kaizena Flow cannot see, and that a
  credit note is made by itself, in small words under the button for a refund recorded outside.

## The inbox (`/admin/{store}/support`, and Platform → Support)

- The status pill stays beside the title on a phone and says only Available or Away there.
- With alerts off, a strip under the header says so with *Turn on* (shown once the browser's kept choice is read, so it never flashes).
- An empty inbox (any tab but Ended, nothing searched) says *All quiet*, what happens when a shopper asks for a person, and links to the
  storefront (Kaizena Flow's own site on the platform) to see the chat as a shopper. The owner's level, across stores, has no link.

## Figures rounded

The customers list's *spent on average* and a customer's *spent* are rounded to whole units (`moneyByCurrency(…, { whole: true })`), so a
phone's small box shows them whole; orders keep their øre.

## What differs from the boards

- Profit and Tags stay in the side column (below the customer on a phone), folded as before, rather than rows of the main card.
- The tabs of the inbox all stay; only Waiting has a count to tell which are busy.
- *Back in stock* starts at 0, not at what was bought: a sent parcel's goods are not back until they are.
- The header keeps *Sent* and the placed date rather than the customer and amount.

## Tests

`e2e/signed-in/order-send.spec.ts` opens *Notes and history* by its row.
