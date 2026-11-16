# Admin redesign, round 18: orders and returns on a phone

Decision D657, 16 November 2026. The boards are on the design canvas of round 18 (today at 390 px and a phone proposal for each page).
The orders list already worked on a phone; a return was about 5,000 px of forms, the returns list opened on a filter form, and a pickup
order explained before it let you press. Wide screens get the same changes, laid out for their width.

## A return (`/admin/{store}/returns/{id}`)

- While the goods are awaited, a *Next step* card: *Waiting for the goods*, with *The goods have arrived* and *They are on their way* as one
  press each, dated today (`DayStepForm` `quick`), and *Another day* as a fold holding the dated forms as before.
- Everything that is not the next step is a row that opens in place (`FoldRow`): the customer's request (the statement and the lines, open
  while the request waits for an answer), return instructions, return shipping, exchange instead of money, the note, ending the return (open
  once it is refunded) and the history. Approving, inspecting and refunding stay cards: each is the next step when it comes.

## Returns (`/admin/{store}/returns`)

- Chips with counts: Open, To approve, Past the refund deadline, All, and *Acknowledgement not sent* when there is one; they scroll sideways
  on a phone (`CHIP_STRIP`). The search is one field; status, kind, exchange and the deadline tick are under *More filters*, open while one
  of them is chosen. The tiles went: the sentence and the chips say it.

## A pickup order (`/admin/{store}/orders/{id}`)

- *Ready for pickup* is one wide press with the email it sends said under it; *Collected today* follows (the main press once the order is
  ready), and *Another day* holds the dated form and what collecting does. *Send the email again* sits under them once marked ready.

## What differs from the boards

- The chip reads *To approve* (the queue's own word) rather than *Waiting on you*.
- The order's money, the store's rules and what the customer was told stay in the side column (under the rows on a phone), not a fold.

## Tests

`e2e/signed-in/admin-exchange.spec.ts` opens the exchange row; the pickup e2e presses *Collected today*.
