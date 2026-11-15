# Admin redesign, round 12: Returns, Gift cards, Reviews

Decision D637, 16 November 2026. The boards are on the design canvas of round 12 (today and proposal for each page). Built as drawn,
for Homer first, with Lisa's depth one step away.

## Returns (`/admin/{store}/returns`, `ReturnsQueueView`)

- The header's sentence is what waits (`countsSentence()`: *No returns are open.*, or what is past its deadline, unacknowledged or to approve).
- Counters show only when not zero; the filters show once there is something to filter (a return open, any in the list, or a filter chosen).
- With none open: *Nothing is waiting for you.*, how customers withdraw, how to register one that came by email or phone, and *Find the order*.
- The law (withdrawal against return request, registering by hand) is in a fold at the bottom, *Withdrawals and returns, the rules*.

## Gift cards (`/admin/{store}/gift-cards`)

- A sentence: *Gift cards are off.*, *No gift cards yet.*, or *Customers hold {amount}.* *Issue a card* is the secondary header button.
- Off: *Sell gift cards in your shop* with *Sell gift cards*, which switches the feature on from the page (`switchOnFromPageAction`, the
  owner alone, as on Features); the note that sold cards keep working stays under it.
- On with no card: *Make a gift card to sell*, opening a new product (of the kind Gift card).
- The tiles show once there are cards; how long new cards last is a row with *Change* opening its form.

## Reviews (`/admin/{store}/reviews`)

- A sentence: *Reviews are off.*, *No reviews yet.*, *{n} reviews wait to be checked.* or *{n} reviews are published.*
- Off: *Show reviews* in the header (owners) switches them on from the page; import and export are under *More*.
- Counters show only when not zero; checking and asking buyers are two rows (*Change*, or *Ask buyers* while no requests are sent) with
  their forms in place.

## What differs from the boards

- *Sell gift cards* switches gift cards on but does not make the product with 250, 500 and 1 000 by itself: a Gift card product's
  amounts are prices per country, set through the product form. The page offers *Make a gift card* as the next press instead.
- Returns has no *See what customers see*: the withdrawal page's address depends on the market, and the order emails carry it.

## Platform

Kaizena Flow sells plans through Stripe: it has no returns, gift cards or product reviews. Nothing to carry over.

## Tests

`src/components/admin/returns/queue-view.test.ts` passes unchanged (stats and filters while there are returns, the empty queue's words).
