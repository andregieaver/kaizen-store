# The admin redesigned, round 7 (November 2026)

Decision D624. Round 7 takes three pages that spoke in the system's own terms: Inventory, a paragraph on committed and available, four
tiles and a ten-column table with *Set to* and *Adjust by* for the same change; Checkout rules, four forms with two Saves and no picture of
the checkout; and Billing, "No plan yet" with no button, eight usage bars that all said No limit and a big-sale form before the plans.
The proposals are on the owner's design canvas "Admin redesign, round 7"; the owner chose, 15 November 2026, to build them as drawn.

## New rules from this round

- One field per thing to change; the second way to change it lives in Advanced.
- One Save per page section, never one per setting.
- An empty list starts from examples a shop really uses.
- A figure that is all right says so in one line; only what is near a limit shows its bar.

## What was built

| Page | Built |
|---|---|
| Inventory | A sentence on what is sold out or running low; chips for All, Sold out, Running low, On backorder (and Below zero when there is any), with a search; the tabs are the list and its history, the rest under More (the open one shown). In the Basic view each variant is a row with its picture (`variantPictures()`), its SKU and what happens at zero, its state and one count changed with − and + or typed; a bar at the bottom says what changed (*Notatbok 0 → 24*), asks why and saves. The Advanced view, and a store with several locations, keep the full table, the review and the choice of rows. |
| Checkout rules | A sentence on what a shopper gives and sees. *What the checkout asks*: customer accounts as three choices and the phone and the name as two selects, with one Save (`CheckoutAsksCard`, calling the two settings' own actions), beside a picture of the form a shopper fills in that follows the choices; where each is asked, and what Stripe's page and Mollie do, is one fold away. Rules and questions start from examples while there are none (no Klarna under 200 kr, no Express for parcels over 20 kg, stop orders over 30 kg, rename a delivery; a delivery date, a note, a gift message, how they heard of you), each opening its editor filled in; the GDPR warning is said where a question is written. |
| Billing | A sentence on the plan: on a plan, its price and when it renews or ends; with none, the trial's end or "choose one to keep selling". While there is no plan the plans come first and the plan card after; usage is a fold that says "all within your plan" or how many are near a limit (open then), and the big sale is a fold (open while one is planned). |

## Different from the boards

- The page keeps its name, Checkout rules, and the Add a rule and Add a question buttons keep theirs beside the examples.
- The inventory sentence counts the sold-out and low variants rather than naming them.
- On a plan, the invoices card stays at the end of the page.
- The plan cards are the ones Billing already draws, with their real prices; the board's [price] placeholders are filled by them.
- Kaizena Flow sells plans, not goods: Inventory and Checkout rules stay store-only. Billing is the store's own page; the platform's plans
  page is unchanged.
