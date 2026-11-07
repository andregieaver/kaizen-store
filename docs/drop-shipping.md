# Drop shipping: a supplier ships it for you (D482 proposed)

The owner (5 November 2026): "We haven't made a plan for how drop shipping should work. Do that as part of this [the
`/selling-drop-shipping` page], but explain to me how this would work first." The plan below was explained first, and the owner chose the
recommended answer to each of the three questions (section 11). **This file is a plan: nothing in it is built.** Code, tests and texts follow
it; where they disagree, this file is corrected first.

---

## 1. The promise

Homer sells things he never touches. He adds a supplier (a name, an email address, the country it ships from) and marks the products the
supplier sends as **Shipped by {supplier}**. From then on:

1. A customer pays in Homer's shop, as for any product.
2. Half an hour later the supplier gets the order by itself: what to send, to whom, and Homer's packing slip.
3. The supplier types the tracking number on a page from that email. They need no account.
4. The customer gets the tracking email from Homer's shop, as if Homer had sent it.
5. A supplier who is late is reminded, and Homer is told.

He never forwards an email, copies an address or pastes a tracking number. The customer only ever sees his shop. Lisa sets everything else
one step away (section 8).

## 2. What is there today

Most of what drop shipping needs is built and tested. The plan adds to it and replaces none of it.

| Built | Where | Used for |
|---|---|---|
| Stock locations, with online routing by stock then priority (D172, D383) | `inventory_locations`, `allocate()` | A supplier is a location, so routing, holds at checkout and the stock history work unchanged |
| The warehouse connection (D355 on D354, row `orders.3pl-and-fulfilment-network`) | `GET /orders?unfulfilled=true`, `POST /orders/{id}/fulfillments`, `POST /inventory/set` | A supplier with its own system reads orders, posts tracking and posts stock |
| Shipments with carrier and tracking, partial fulfilment, the shipped email (D27, D174, D372) | `markSent()`, `sendShipped()` | Tracking from a supplier ends where a person's would |
| Cost per variant and its history; profit per order (D152, D415) | a variant's cost, purchase orders | The supplier's price is the cost; the margin shows on every order |
| Purchase orders to a supplier (row `catalogue.inventory-transfers-and-purchase-orders`) | `purchase_orders.supplier` (a name today) | Suppliers become records that purchase orders name |
| Shipping profiles (D237) | Shipping settings | A supplier's own shipping price to the customer |
| Customs and duties (D343), IOSS (D157), product safety (D342, D452) | | Goods from outside the EU and the GPSR rule for every product |
| Workflows, outgoing webhooks, the AI manager | D354, D356, D94 | Owners' own rules and questions about supplier orders |

## 3. The model

- **A supplier** (`commerce.suppliers`, per store): name, order email, country it ships from, order language, the time it promises to send
  within (*dispatch days*, 1 to 30), a return address, how orders reach it (`email`, `connected`, or `file`), and an optional note to put on
  every order (*send without your own branding*). Written only by `src/server/suppliers.ts`; audited.
- **A supplier's location.** Adding a supplier makes an `inventory_locations` row of kind `supplier` (a new column, `kind`, `own` for every
  existing row) tied to it, `fulfils_online` on. It is never shown as a place of the owner's own and cannot be the store's first location.
- **A drop-shipped variant** has its stock at the supplier's location. Two ways, chosen per variant:
  - *Always from the supplier* (the default): only the supplier's location holds it.
  - *My stock first, then the supplier*: the store's own locations come first in routing, the supplier's after them, by the existing
    priority rule.
- **The supplier's stock** is what the supplier says: posted by a connected supplier, uploaded as a file (SKU and quantity, with the
  existing dry run), or *Always available* (a level the supplier location never runs down, shown to shoppers as in stock). A level not
  refreshed in a set time is flagged, never guessed.
- **Cost** is the supplier's price: changing it writes the cost history as a purchase order's receipt does, never rewriting old orders.
- **A supplier order** (`commerce.supplier_orders` and its lines): one per customer order and supplier, made when the order is paid, from
  the lines `allocate()` placed at that supplier's location. It carries the delivery address, the lines (SKU, name, quantity, cost), the
  order number and its state: `waiting`, `sent_to_supplier`, `shipped`, `cancelled`, `problem`.

## 4. An order, from payment to the customer's door

1. **Paid.** The order is allocated as today. Lines at a supplier's location make one supplier order per supplier, state `waiting`.
2. **Waiting time.** The supplier order is held for the store's *wait before sending* (30 minutes unless changed; 0 to 24 hours), so a
   cancellation or a quick change never reaches the supplier. A cancellation in that time cancels the supplier order.
3. **Sent to the supplier**, by the five-minute job, according to how the supplier takes orders:
   - *email*: one email per supplier order in the supplier's language: the lines with SKUs and quantities, the customer's name and delivery
     address, the order number, the store's packing slip as a PDF, the store's note, and a link to **the supplier's page** (section 5);
   - *connected*: the order is visible to the supplier's own token (`GET /orders?unfulfilled=true` shows only its lines) and a signed
     `supplier_order.created` event goes to its endpoint;
   - *file*: the supplier orders of the day wait as one file the owner downloads or the supplier fetches.
4. **Shipped.** The supplier types carrier and tracking on its page, or posts them through the API. That calls `markSent()` for exactly the
   supplier order's lines and `sendShipped()`: the customer gets the shop's own shipped email. An order with own stock and supplier goods
   goes as two parcels, each with its tracking, as partial fulfilment does today.
5. **Late.** A supplier order not shipped by its dispatch days gets one reminder to the supplier, then a notice to the owner (and the AI
   manager's notices), never more than one of each a day.
6. **A problem** (the supplier marks a line out of stock on its page): the owner is told at once and decides: refund the line, wait, or
   send it from another place. Nothing is refunded by itself.

## 5. The supplier's page

A page at a long signed address from the supplier's email (`/supply/{token}`), one per supplier order, kept for 60 days:
- what to send and where, the packing slip to print, the store's note;
- **Mark as sent**: carrier (Posten, Bring, PostNord, DHL, UPS or another with a link) and tracking number, per parcel; a second parcel
  for the rest of the lines;
- **Can't send a line**: why (out of stock, discontinued, other), which tells the owner;
- nothing else of the store and no other order. The address works only for its supplier order; a used *Mark as sent* cannot be sent twice.
  Personal data on it goes when the supplier order is done and the retention rule says so.

## 6. What the customer sees

The customer buys from the shop, and nothing tells them a supplier exists unless the owner chooses to say so.
- **Delivery estimate:** the product page and checkout add the supplier's dispatch days to the shipping method's delivery time, so the
  promise is honest. A cart with own stock and supplier goods says it may come in more than one parcel.
- **Shipping price:** a supplier's products may sit in a shipping profile of their own (built, D237).
- **Withdrawal and returns:** as for any product (D153). The return address shown is the supplier's when the line came from a supplier
  with one, else the store's.

## 7. The EU's rules

- **The shop is the seller.** The contract, VAT, invoices, the 30-day reference price, the withdrawal right, refunds and complaints are the
  shop's, exactly as for its own stock. The screens say so plainly; the supplier's terms with the shop are the shop's affair.
- **Product safety (GPSR):** a drop-shipped product needs its manufacturer and, where required, the EU or EEA responsible person, like any
  product (D452 decides per destination). A supplier is not taken to be the manufacturer.
- **Suppliers outside the EU** (the owner's answer, section 11): allowed. Their products are flagged in the editor and on Lisa's supplier
  page: customs and duties (D343) and IOSS (D157) apply as for goods sent from outside the EU, and the delivery estimate is longer. The
  checks that apply to goods from abroad (producer responsibility, what may be sold where, D335, D342) are unchanged.
- **Personal data:** a supplier receives the customer's name and delivery address (and phone where the carrier needs it), nothing more; the
  store's privacy notice names suppliers as recipients (`docs/wave-1g-gdpr.md`); the supplier order is in the personal-data register.

## 8. Lisa, one step away

On the supplier's page in the admin (Stock → Suppliers): how orders reach it, its language and note, dispatch days, the return address, the
stock method and how old its stock is, its token for a connected system, and the supplier orders with their states. On the store's
settings: the wait before sending. On a variant: *always from the supplier* or *my stock first*. Reports: supplier orders by state,
on-time dispatch per supplier, what the shop owes each supplier at cost (a list and a file; paying it stays outside Flow).

## 9. The AI manager

Read tools first: *Which supplier orders are late?*, *What do I owe Nordic Wool this month?*, *How fast does each supplier send?* Its actions
on supplier orders (resend, cancel, mark a problem solved) go through the same gates as order changes (`NEVER_AUTOMATIC` for anything that
refunds). A supplier's emails and notes reach the AI only as data under `UNTRUSTED_TEXT`.

## 10. Build order

| Step | Builds | Done when |
|---|---|---|
| 1 | Suppliers, supplier locations (`kind`), drop-shipped variants, cost from the supplier, the admin's supplier page | An owner adds a supplier, marks products, and a test order is allocated to the supplier's location |
| 2 | Supplier orders, the wait, the email, the supplier's page, tracking back to the customer, partial parcels | A paid test order reaches a supplier by email and its tracking reaches the customer's inbox |
| 3 | Connected suppliers (scoped token, `supplier_order.created`), stock by file and API, *Always available*, delivery estimates | A connected test supplier reads only its lines, posts tracking and stock |
| 4 | Late and problem handling, returns to the supplier's address, what the shop owes | A late supplier is reminded once and the owner told |
| 5 | Reports, workflows' trigger, the AI manager's tools and eval cases | The briefing names a late supplier |

Each step gets its parity row (a new row `orders.drop-shipping`, an app-tier feature on Shopify), its tests (PGlite rules, integration
tests with a fake supplier, the signed-in supplier page), and its decision.

## 11. Decisions, answered by the owner on 5 November 2026

1. **When the supplier gets the order:** 30 minutes after payment unless the store changes it (0 to 24 hours), so a quick cancellation
   never reaches the supplier.
2. **Suppliers outside the EU:** allowed, with customs and import VAT handled as for any goods from outside the EU and a longer delivery
   estimate, flagged to the owner.
3. **The page while it is not built:** `/selling-drop-shipping` explains how it will work, marked as coming, and links to the warehouse
   connection that works today.

## 12. Not in the first version

Paying suppliers through Flow; connections to drop-ship networks and marketplaces (AliExpress, Printful, BigBuy and the like), which could
come later as apps (D441); print-on-demand files; splitting one line between several suppliers; suppliers' own logins to the admin.
