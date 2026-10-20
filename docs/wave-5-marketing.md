# Wave 5: customers and marketing (decisions D295 to D304)

The contract for wave 5 of `docs/parity-plan.md`: the people a store may write to, what it sends them, the discounts it gives them, gift cards and
reviews, and the channels that bring them back. Written on 2026-10-20 from the wave 5 rows of `docs/parity/rows`, the plan, CLAUDE.md and a read of
the code at commit `864bc18` (D33 cart reminders, D58 consent, D93 forms, D114 campaigns, D31 codes, D130 bonus, D131 referrals, D152 analytics, D162
personal data, D165 data files). Code, tests and texts follow this file; a unit that must change course says so here first.

**What exists today.** Transactional email and cart reminders (D33, with `email_opt_outs` and one-click unsubscribe). A newsletter form (D93) emails
a confirmed sign-up to up to five addresses the owner typed and keeps nothing: `form_submissions` is a throttle pruned after 30 days. No customer has a
marketing consent, so the customer CSV's `marketing_consent` column says `not_recorded` (D165). RFM segments are computed in analytics (D152) and
cannot be used for anything.

**SMS (the plan's decision).** Not built in this wave. Kaizena Flow has no SMS vendor that processes in the EU and is chosen; a text message needs
its own consent, its own sender rules per country and its own costs. The row `customers.sms-marketing` stays missing with this reason, and
everything here keeps email as the only channel so a second one is a new sender, not a new model.

## 1. The units, in the order they are built

| Unit | Decision | What | Rows it moves |
|---|---|---|---|
| A | D295 | The subscriber list: who agreed to marketing email, when, to which words and how (forms, checkout, My account), double opt-in, one-click unsubscribe, the admin's list, export and erasure | `customers.signup-forms-and-popups-building-a-list`, `storefront.signup-and-contact-forms-feeding-customers-and-consent`, `customers.customer-profiles-notes-csv-import-and-export` (consent column) |
| B | D296 | Segments: saved rules over customers and subscribers (orders, money, dates, RFM group, country, language, tags, consent), counted live | `customers.customer-segments-and-tags`, `analytics.dynamic-segments-for-marketing`, `analytics.rfm-segments-and-customer-lists`, `ai.ai-or-rule-based-customer-segmentation` |
| C | D297 | Broadcasts: an email written in the store's languages from blocks, a test to staff, sent now or later to a segment's subscribed addresses, once each, in batches, with bounces and complaints suppressed and a report | `customers.email-marketing-broadcasts-and-lifecycle-automations`, `ai.ai-written-marketing-email` |
| D | D298 | Lifecycle automations: welcome, after a purchase, win-back, and back in stock (a notify-me form on a sold-out variant) | `customers.email-marketing-broadcasts-and-lifecycle-automations`, `customers.back-in-stock-notifications` |
| E | D299 | Discounts in depth: codes scoped to categories and tags, for some customers or groups, minimum quantity, several codes on one order under stacking rules, bulk codes, tiered and volume prices, automatic discounts, richer buy X get Y | `customers.discount-codes`, `customers.automatic-discounts`, `customers.buy-x-get-y`, `customers.tiered-and-volume-discounts`, `customers.discount-stacking-and-customer-targeted-discounts`, `checkout.discount-codes-and-automatic-discounts` |
| F | D300 | Gift cards: sold as a product kind, sent by email, spent at checkout as a payment, balances and a liability report | `customers.gift-cards`, `analytics.liabilities-gift-card-and-store-credit` |
| G | D301 | Product reviews: asked for after delivery, verified purchase, moderation, pictures, the product page's rating, structured data | `customers.product-reviews-and-ugc` |
| H | D302 | Product feeds: one normalised feed, written as Google Merchant Center, Meta, TikTok and Pinterest files | `catalogue.product-feeds-to-google-and-other-channels`, `customers.social-channels-facebook-instagram-tiktok-pinterest` |
| I | D303 | Ad pixels and server-side conversion events behind consent, UTM campaigns on D152's visits | `customers.ad-pixels-and-conversion-events`, `analytics.third-party-analytics-and-pixels-with-consent`, `customers.marketing-campaign-tracking-and-attribution`, `analytics.marketing-and-channel-attribution` |
| J | D304 | Accounts in depth: several addresses, order history search, the shopper's own data export from My account; forms that give a code for signing up and tag their subscribers | `customers.customer-accounts`, `customers.signup-forms-and-popups-building-a-list` |

Each unit is its own commit (or a few) with its own migration(s), tests and decision row, shipped before the next starts. Each unit's detailed
section is written here before it is built; units B to J are outlined in section 4.

## 2. Rules for every unit

1. **Consent is a record, never a flag.** Marketing email goes only to an address with a subscriber row in `subscribed`, whose consent says who
   agreed, to which words, when, from where, and when they confirmed it. A customer is never subscribed because they bought, signed up for an
   account or typed an address; staff can unsubscribe a person but never subscribe one (an import with proof of consent is the one exception, and
   comes with unit B's tools, saying where the proof is).
2. **A typed address proves nothing** (D162): every address that was typed is confirmed by its owner (double opt-in) before it is subscribed. Only a
   signed-in customer whose email is verified subscribes at once, from My account or checkout.
3. **Unsubscribing always works and is one press**: every marketing email carries a link and `List-Unsubscribe` plus `List-Unsubscribe-Post`
   (RFC 8058); the store's unsubscribe page, the one-click POST, My account and staff all write the same `unsubscribed` state, at once.
4. **Nothing invented.** Counts are counted; a figure that cannot be known says what is missing. AI text for subscribers passes `findClaims()` and a
   person's approval (gated), as the AI manager's `email_customer` does.
5. **Store-scoped.** Every new table holds `store_id` on every row, every query takes it, and an integration test shows one store cannot reach
   another's list. Kaizena Flow's own newsletter forms keep D93's behaviour (emailed to the recipients); a platform list is not in this wave.
6. **Every new table** is in `COPY_RULES` (people's data: `never`), in `PERSONAL_DATA` with its export section and erasure step, or in
   `NOT_PERSONAL`; every new email kind is in `EMAIL_KINDS`.
7. **Shopper and email words are nb, sv, da and en by hand**, in `HAND_WRITTEN_ONLY` until a legal review; staff words are English.
8. **Copied stores and orders** (D129): subscribers and consents are never copied; copied orders never count in a segment's money.
9. **Homer and Lisa.** The default screen says what the owner gets (*People who want your emails*), one main action; the details (each person's
   consent history, filters, export) are one step away.

## 3. Unit A (D295): the subscriber list

### 3.1 The model

`commerce.marketing_subscribers`, one row per store and address (unique on `store_id, lower(email)`):

| Column | Meaning |
|---|---|
| `email` | Lower case. |
| `customer_id` | The store's customer, set only when a signed-in customer with a verified email subscribed (My account, checkout), or when that customer later proves the address; never by matching a typed address. |
| `name`, `locale`, `market_code` | What the form asked, the language of the page or account, the market it came from. |
| `status` | `pending` (waiting for the confirmation link), `subscribed`, `unsubscribed`. |
| `source`, `source_ref` | `form` (the block's id), `checkout` (the order's id), `account`. |
| `consent_text`, `consented_at` | The words the person agreed to, as shown, and when they pressed. |
| `confirmed_at` | When they opened the confirmation link (double opt-in); null for a signed-in, verified customer, whose own account is the proof, and for a form whose owner switched confirmation off (D93), which the list says. |
| `confirm_hash`, `confirm_until` | sha256 of the confirmation link's token, and its end (7 days); gone once used. |
| `token` | The address's own unsubscribe token (32 random bytes), in every marketing email; it can only unsubscribe. |
| `unsubscribed_at`, `unsubscribe_source` | `link`, `one_click`, `account`, `staff`, `complaint`, `bounce`. |

`commerce.marketing_consent_events` is the history, append-only (a trigger refuses an update; a row goes only with its subscriber): `requested`,
`subscribed`, `unsubscribed`, each with its source and the consent words, so the store can show what a person agreed to and when (GDPR art. 7(1)).

The database's rules (`marketing_subscribers_rules()`): a status moves only `pending → subscribed`, `pending → unsubscribed`, `subscribed →
unsubscribed` and `unsubscribed → pending` or `→ subscribed` (a person who comes back gives consent again: new words, new time); `subscribed`
needs `consented_at`; `unsubscribed` needs `unsubscribed_at`; an event is written by the same trigger for every change of status, so no writer can
change one silently.

### 3.2 How people join

- **A newsletter form on a store's page** (D93): a sign-up still goes through `submitForm()` with its limits and robots check, and its own
  confirmation link (`form_submissions`) is the waiting record: the address is not on the list until the link is opened, when it is written
  `subscribed` with `confirmed_at` and the form's own words and time. A form with confirmation switched off subscribes at once with `confirmed_at`
  null, which the list says. The form's recipients still get their email; the list is kept either way.
- **Checkout**: an unticked box under the contact details, *Email me news and offers from {store}* (the store's words for it are not editable in
  this unit). Pressing pay with it ticked asks for consent for the address typed: a confirmation email (`marketing.confirm`) for a guest, at once
  for a signed-in verified customer. The box is drawn by the checkout piece, only while the store keeps a list (always, in this unit) and the shop is
  on; it is a plain checkbox in the pay route's client bundle (no zod).
- **My account**: a switch *Emails with news and offers*, on or off, for the signed-in customer. On with a verified email subscribes at once
  (`source = account`); on with an unverified email sends the confirmation link; off unsubscribes (`account`).
  An unverified customer is never told that their address is subscribed already: they are asked to open the link like anyone typing it, and an
  existing subscriber is never linked to them.
- **Staff** do not add people. A subscriber's row has *Unsubscribe* (for a person who asked by other means, `staff`).

### 3.3 Leaving

`/s/{store}/{market}/unsubscribe/{token}` (the cart reminders' page) and the one-click `POST /api/unsubscribe/{token}` look up the subscriber's token
as well as the cart reminders' and plan reminders'; both unsubscribe the address, and the page says so in the store's language. My account's switch
and the admin's *Unsubscribe* write the same. Email providers' bounces and complaints (`email-events.ts`) unsubscribe the address with `bounce`
(a hard bounce only) or `complaint` from unit C, where marketing email is first sent.

### 3.4 What the owner sees

Marketing → **Subscribers** (`/admin/{store}/subscribers`, `marketing:read`): the number of people who want the store's emails, waiting for their
link and who left, and the list of addresses newest first with status, source and date (search by address, filter by status, 50 a page). Opening one
shows its consent history with the words. *Unsubscribe* needs `marketing:write`. **Export** (owner only, `requireOwnerRole`, a POST): a CSV through
`writeCsv()` of every row with its consent facts, audit-logged as `subscribers.exported` with the count only. The customer CSV's
`marketing_consent` (D165) becomes `subscribed`, `pending`, `unsubscribed` or `none`: the address's place on the list (the account's own
subscriber first); `not_recorded` is no longer written. The file is staff's own; nothing of it reaches a shopper.

### 3.5 Personal data

Both tables are in `PERSONAL_DATA`: linked by `customer_id` or by the account's proven email (`resolveSubject()`), exported in the shopper's export
as `marketing` (the row and its history), erased by `delete` (the row and its history go; nothing is kept to prove the opt-out of an erased person:
erasure is the stronger request). `pruneSubscribers()` (daily) deletes `pending` rows whose link ran out more than 30 days ago and their events.
Neither table is copied (`COPY_RULES`: `never`). Email kind `marketing.confirm` is `shopper`.

### 3.6 Tests

PGlite: the status rules, the event trigger, append-only history, the unique address. Integration (`marketing-subscribers.int.test.ts`): a form
sign-up pending then subscribed; confirm-off subscribes at once; checkout as a guest is pending and as a verified customer subscribed; My account on
and off; the unsubscribe token from the page and one-click; a store cannot read or unsubscribe another's; re-subscribing writes new consent;
export and erasure; the customer CSV's column. Unit: the CSV's columns, the token's shape. A signed-in e2e opens the Subscribers page.

## 4. Units B to J, outlined

- **B, segments (D296).** `commerce.segments` (store, name, `rules` JSON from a closed list: has ordered, orders count, money spent in the main
  currency from D152's `PAID`, last order before or after, RFM group from `src/lib/analytics-customers.ts`, country, language, customer group, company,
  tag, consent status), counted live by one SQL builder (like `orderListWhere()`), never a stored member list; a segment of subscribers is the
  segment's people whose address is `subscribed`. Customer tags (`customer_tags`, like D173's order tags). The AI manager proposes rules only.
- **C, broadcasts (D297).** `commerce.broadcasts` (draft, scheduled, sending, sent, cancelled), its content as email blocks per language
  (`renderEmail()`), a test to staff, a send that freezes the recipients at its start into `broadcast_recipients` (one row per address, the
  idempotency key `broadcast:{id}:{subscriber}`), sent in batches by the five-minute job within the provider's rate, `List-Unsubscribe`. Bounces and
  complaints unsubscribe (3.3). The report counts sent, delivered, bounced, unsubscribed after it; no open tracking pixel, clicks only through a
  redirect that keeps no person.
- **D, automations (D298).** Welcome (after subscribing), after a purchase (days after delivery), win-back (no order in N days), each a switch with
  its email per language, firing once per person and trigger (`automation_sends` keys); back in stock: a notify-me form on a sold-out variant (an
  address, consent, double opt-in), one email per waiting address when stock rises above zero by any path (the inventory movement trigger queues it).
- **E, discounts (D299).** Extends `discounts` (D31) and campaigns (D114) without a second engine: scope by category and tag, customer groups and
  named customers, minimum quantity, several codes per order under each code's stacking choice, bulk generation of single-use codes, tiered and
  volume rules, automatic discounts as code-less campaigns; `cartSummary()` and `placeOrder()` keep agreeing (`checkout-kinds.int.test.ts`).
- **F, gift cards (D300).** A product kind `gift_card` sold in a currency, issued at payment (codes kept as hashes, the last four shown), emailed to
  the buyer or a recipient, spent at checkout as a payment (never a discount: VAT is charged when goods are bought, not when the card is sold), a
  ledger like the bonus program's, and the liability report (outstanding balance per currency).
- **G, reviews (D301).** Asked for by email after delivery (a token per order line), written by the buyer (verified purchase), moderated by staff,
  shown on the product page with the average, in the product's JSON-LD only for approved reviews; no reward for a good review.
- **H, feeds (D302).** One normalised feed per store and market (title, description, price as shown with VAT, availability, GTIN/brand from custom
  fields, pictures, unit price), written as Google Merchant Center XML and the Meta, TikTok and Pinterest CSVs at a private, token-addressed URL.
- **I, pixels and attribution (D303).** Meta, Google, TikTok and Pinterest pixels as tracking tools (D58: only after `marketing` consent, from
  `ConsentManager`), their server-side conversion events sent only for orders whose cart had that consent, and UTM parameters kept on D152's visit.
- **J, accounts and incentives (D304).** Several saved addresses, search in My account's orders, the shopper's own data export from My account (the
  D162 export, signed in afresh); a form can give a single-use code once per address after confirmation, and tag its subscribers.
