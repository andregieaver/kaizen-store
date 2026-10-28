# Wave 10: the must-haves to Full (decisions D364 onward)

The contract for wave 10. Its aim is the owner's (28 October 2026): reach or pass Shopify on every must-have row of the parity tracker
(`docs/parity/rows`, core rows of weight 4 and 5), and start raising the PSI (`docs/audits/psi-2026-10-24.md`, re-scored 28 October in
`docs/audits/psi-2026-10-28.md`).

It was written on 2026-10-28 from the 26 partial must-have rows as rated that day (84.5 % must-have, 82.9 % core) and a read of the code.
Code, tests and texts follow this file. A unit that must change course says so here first.

**Where the 15.5 points are.** Twelve rows Kaizena Flow can close in code (bucket A, 7.3 points); seven that need a partner's account or a
live check as well as code (bucket B, 3.9 points); seven that wait on a person outside the code: an accountant, a lawyer, an independent
audit, an attestation, or a promise the company makes (bucket D, 4.2 points). This wave builds everything the code can do in all three, so
that each remaining row waits on one named thing only, and says what that thing is on the row.

## 1. The units, in the order they are built

| Unit | Decision | What | Rows it closes (or moves to "waits only on…") |
|---|---|---|---|
| A | D364 | Refund to store credit | `orders.partial-and-full-refunds-with-restocking` (weight 5) |
| B | D365 | Customer accounts: optional, required or off | `checkout.guest-checkout-and-optional-account` (weight 5) |
| C | D366 | Customers in the admin: add, edit, notes, tag filter, merge, CSV import | `customers.customer-profiles-notes-csv-import-and-export` |
| D | D367 | Discount combinations between campaigns and codes | `customers.automatic-discounts` |
| E | D368 | Broadcast templates | `customers.email-marketing-broadcasts-and-lifecycle-automations` |
| F | D369 | Sign-up with a password; no live payments before opening | `platform.self-serve-sign-up-and-onboarding` |
| G | D370 | Inventory: the export's `on_hand_was`, a first alert for a new variant, the pages in a browser | `catalogue.inventory-tracking-with-reservations` |
| H | D371 | Personal data: the staff routes and pages tested | `international.gdpr-data-export-and-erasure` |
| I | D372 | Partial fulfilment with a carrier, and Bring's second booking | `orders.fulfilment-workflow-partial-fulfilment` |
| J | D373 | Express checkout on the product page and cart; wallets and domains shown; Klarna's messaging | `checkout.accelerated-checkout-…`, `checkout.klarna` |
| K | D374 | Labels for several orders in one action | `orders.shipping-label-purchase-and-printing` |
| L | D375 | Customers sign in with Google | `customers.customer-accounts` |
| M | D376 | Reduced VAT rates with their sources | `checkout.eu-vat-by-destination-…` |
| P | D377 | PSI: owner and staff erasure, a whole-store export, the documents the audit asks for | PSI REG-03, DATA-05, SEC-01, REG-07, REG-08 |

Rows that this wave can only bring to "waits only on…": staff two-step and staff roles (one sign-in against the real Supabase Auth,
recorded), PCI (one test payment under the enforced policy, recorded, and the SAQ A), PayPal (Kaizena Flow's Mollie app), pickup points
and labels (a carrier's live service), OSS and IOSS and the VAT reports (an accountant), legal pages, unit price and accessibility (a lawyer
and an audit), hosting and support (a promise the company publishes).

## 2. Unit A: refund to store credit (D364)

**The criterion.** "Staff can refund to a store credit balance the shopper can use at checkout, recorded in an append-only ledger
(integration test, euro scenario)."

**Design.** Store credit is a gift card (D300) issued from a refund, so the shopper spends it at checkout as any card, its balance is the
gift card ledger, and nothing new is needed at checkout.

- A refund row of kind `store_credit` (`REFUND_KINDS`): no provider call, no provider reference, created `succeeded`, split over the order's
  captured payments as any refund (`splitRefund()`), so it lowers what can later be refunded to the card. It is a refund everywhere a refund
  is counted (sales, VAT through its credit note, bonus and affiliate reversals); Kaizena Flow's fee is not returned, as Stripe is not asked.
- In the same transaction one card is issued for the whole amount: `gift_cards.source = 'refund'` with the order and the refund
  (`gift_cards.refund_id`), in the order's currency and mode, for the order's customer, through `commerce.gift_card_issue()`. The code is
  made and emailed to the order's own address (never an address typed) after the commit, and shown once to the staff member.
- Refused: an order on payment terms not yet paid, a host's order, a copied order, an amount of zero; a store without the gift card
  feature on still may refund to credit (the card is the store's own liability, not a product sold).
- Staff choose *Refund to: the original payment / store credit* in the refund form; the AI manager's refund tool is unchanged (money only).
- Tests: an integration test in kroner and euros (the card, its balance, the refund, the credit note, the restock, a later card refund
  capped by what is left), the card spent at checkout through `giftCardsPay()`.

## 3. Unit B: customer accounts optional, required or off (D365)

**The criterion.** "An owner switches accounts to required or off, and checkout, express payment and the cart obey it (integration test)."

**Design.** `stores.customer_accounts`: `optional` (today, the default), `required`, `off`, saved on Settings → Checkout (owners and
`settings:write`), audited.

- `required`: the cart shows *Sign in to check out* instead of the checkout button; `placeOrder()` refuses a cart without a signed-in
  customer (`sign_in_required`); express payment is drawn only for a signed-in shopper. Draft orders, pay links, changes and exchanges are
  staff's and unaffected; subscriptions already need an account.
- `off`: the store draws no sign-in or account link (header, menus' account link, checkout's *create an account*), the sign-in and account
  pages answer 404 except the paths a shopper reaches after a sale by a link (order, invoice, withdrawal, review, pay links); products that
  need an account (subscriptions, payment terms, company buying, the bonus and referral programmes) cannot be switched on while it is off and
  it cannot be switched off while they are (`featureBlockers()` style refusal with the reason).
- One reader: `accountsMode(store)`, and `signInRequired()` in `placeOrder()` and `cartSummary()`'s `blocks`.

## 4. Units C to M (outline; each is detailed here when it starts)

- **C (D366).** Staff add and edit a customer (name, email, phone, address, company) through one writer that refuses another customer's email
  in the store and audits the change; `customer_notes` (author, time, text, personal data); the list filters by tag; merging two customers
  moves orders, subscriptions, wishlists, addresses, tags, notes and the bonus balance (an entry granted, never an edit) to the one kept and
  refuses a merge that would lose a company or a subscription's link; a customer CSV import is a D165 job (`customer_import`, dry run,
  per-line errors), never subscribing anyone.
- **D (D367).** A campaign's `combines_with_codes` and a code's `combines_with_campaigns` (both default on, as today). When they do not
  combine, the basket takes whichever gives the shopper more (the campaigns, or the code), worked out once in `applyCode()`'s caller for
  `cartSummary()` and `placeOrder()` alike, with scenarios in kroner and euros.
- **E (D368).** Hand-written broadcast templates in nb, sv, da and en (`BROADCAST_TEMPLATES`, block content only: no price, no claim) and an
  owner's own broadcast saved as a template; *New broadcast* starts from one.
- **F (D369).** A password chosen at sign-up (the password rules of `src/lib/password.ts`, set when the address is confirmed); a store that
  has not completed setup takes no live payment (`placeOrder()` refuses `not_open` for a live-mode payment; test mode stays open so the owner
  can try it).
- **G (D370).** `on_hand_was` in the stock export; a variant created or changed to at or below its level is a crossing at once; a signed-in
  e2e spec opens the Inventory, history and stock-file pages.
- **H (D371).** Route tests for the staff export (headers, `customers:write`, same site) and a signed-in e2e of the customer page's export
  and erase preview and the privacy requests and retention pages.
- **I (D372).** Integration tests that book part of an order with each carrier; a second Bring booking within two minutes waits and retries
  instead of failing.
- **J (D373).** Stripe's Express Checkout Element on the product page (loaded on the press of the area, never in the first scripts) and in the
  cart, each making the cart and the order through the existing checkout path; the Payments page lists each wallet's state and each host's
  registration; Klarna's messaging element where Klarna is active; a fake-Stripe integration test that an express payment ends as a paid
  order with the wallet's address and delivery choice.
- **K (D374).** *Book labels* as a bulk action: one booking at a time per carrier, each failure named, and the labels printed together.
- **L (D375).** Sign in with Google for customers, through Kaizena Flow's own OAuth client on the platform's host and a one-time hand-over
  to the store's host; only a verified email matched to an account; tested against a stubbed provider; live when the client exists.
- **M (D376).** The reduced rates of every EU country for the existing categories (food, books, periodicals, medicines, children's goods,
  culture, accommodation) entered through `commerce.set_vat_rate()` in a migration, each with the address of the official source read and
  the date it was read, `verified` left to a person.
- **P (D377).** Owner and staff erasure of their own account (refused while the last owner of an open store), a whole-store export as a D165
  job, `docs/security.md` (assets, boundaries, controls and the tests that hold them), the breach runbook and a DPIA draft for the AI
  features, each marked for the owner's or a lawyer's review.
