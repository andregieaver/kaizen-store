# The admin redesigned, round 6 (November 2026)

Decision D620. Round 6 takes three pages an owner opens every day or on the first one: Home on a phone, 3,761 px of eleven cards; an
order, which listed the items twice, the customer twice and the total three times; and Integrations, twenty cards of one size with a
green button each and nothing saying what is connected. The proposals are on the owner's design canvas "Admin redesign, round 6"; the
owner chose, 15 November 2026, to build them as drawn.

## New rules from this round

- A page shows the same thing once (the items, the money, the customer).
- Lists of things to look at are one list, ranked, three shown, the rest one press away.
- A hub says what you have before what you could get.
- A green button is the one next step; everything else is a link or a fold.

## What was built

| Page | Built |
|---|---|
| Home on a phone | Below `lg` the two columns are one list in the order a phone needs (`HomeSlot`, `max-lg:order-*`): the next job, the week, what needs you, what Analytics found, setup, the AI manager, then the rest. *Next up* lists the orders to pack as rows (two, then the rest by name) with one wide Start packing in the thumb's reach and the packing slips as a link under it. The week is the figure, the orders and seven small bars, linking to Analytics; the large chart stays from `sm` up. *Needs a look* shows three on a phone and the rest behind *n more*. Latest orders, milestones, the Dream Factory link, the briefing offer and the Basic note are left out on a phone (each has its place one press away). |
| An order | A sentence while it waits to be packed: who paid what and when, for how many items, and "Pack them and send them today". *Send the order* shows each item's picture; the Items table is folded under *Items and totals* while the parcel is being packed (open otherwise). The customer bar at the top is gone: the customer, their facts and address lead the side, then the payment, the profit and the tags, folded while there are none (`TagsCard folded`). Holding fulfilment moved into the *More* menu (the held notice stays at the top). Notes and history, and returns and withdrawals, are folds with their counts. |
| Integrations | A sentence on what is connected (or that nothing is, and what most shops start with) and a search (a GET form). *Connected* lists what is on first, with its state. *A good start for your shop*: a carrier for the store's countries (the one green button), its accounting where it sells in Norway, Google reviews, each only while nothing of its kind is connected. *Every service* as short rows under what they do (Delivery in your countries, Accounting, Sell elsewhere, On your pages, Automate), with chips to narrow it (links, `?show=`); carriers for other countries are folded under one line. |

## Different from the boards

- What Analytics found and *Needs a look* are still two lists on a phone, one after the other: Analytics' alerts are read after the page
  is shown, so they cannot be ranked into the same list without waiting for them.
- The briefing email is not offered inside *Needs a look* on a phone; it is offered on a computer, as before.
- On the order, *Change the items* keeps its own card rather than a link beside Send this parcel; the steps keep their present look.
- Instagram keeps its Connect link, which opens its page saying whether this installation can connect it.
- Kaizena Flow's own integrations page (`/admin/platform/integrations`, D465) keeps its cards: the same rows are its next step.
