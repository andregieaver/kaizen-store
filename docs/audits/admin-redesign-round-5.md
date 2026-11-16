# The admin redesigned, round 5 (November 2026)

Decision D615. Round 5 takes three settings pages that an owner meets before the first sale and that spoke in the system's terms: Payments,
a wall of switches and a store-wide log before anything could be paid; Shipping, seven boxes about rules and none about the shopper; and
the Pages list, three pages of the owner's own followed by sixteen forms saying "the standard". The proposals are on the owner's design
canvas "Admin redesign, round 5"; the owner chose, 15 November 2026, to build them as drawn.

## New rules from this round

- A settings page opens with a sentence saying what a shopper gets now ("Shoppers in Norway pay 99 kr for delivery …").
- Where a setting shows at checkout, the page shows what the shopper will see beside it.
- A list of things that are all at their default is one line each, with the change one press away, not a form each.
- A log belongs to the page it is about, folded, in words.

## What was built

| Page | Built |
|---|---|
| Payments | A sentence on whether shoppers can pay; *Four steps to real money* (business details, connect Stripe, a test payment, go live), each saying done, needs you, opens soon or then, with a button on the one step to press; when no way to pay is open yet, one line saying so (the unavailable card is for platform admins only); the log folded as *Payment changes*, only the store's payment entries (`recentAudit()` takes prefixes), in words and on the store's clock. |
| Shipping | The sentence (`deliverySentence()`); *What delivery costs* with each country's price and free-from in its currency, beside *What a shopper in {country} sees* (the delivery choice at checkout and the free-from note); *More ways to deliver* as four cards with their state and one action (carriers connected, your own options per country, pickup places, delivery areas); zones, profiles and the default weight folded under *For large or heavy catalogues*, with their facts on the fold's line. |
| Pages | A sentence on how many pages are live and which the shop opens on; More (categories and tags), Create with AI and New page; the owner's pages as cards with their picture (or the name in large type), what each is to the shop (front page, All products, a special page), live or draft and when it changed, and a small menu with Edit, View and Duplicate; a dashed card for a new page; *The shop's own pages* one row each (front page, All products and every special page the store's features offer) with the page shown or Standard, and Change opening a small window (a popover, no script) with the choice and *Start from a new page*. |

## Different from the boards

- Payments does not draw *How shoppers in Norway pay* with its checkout preview while no way to pay is open on the installation; it says
  so in one line. The country's ways to pay and their switches are unchanged where a provider is connected.
- The shipping preview shows the flat rate's choice; the store's own methods and carriers' services are not drawn in it.
- The front page and the All products page are rows in *The shop's own pages*, changed in the same small window as the others, rather
  than chosen from a card's menu.
- Kaizena Flow's own pages list keeps its table: the platform's pages get the cards as the next step.
