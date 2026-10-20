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
section is written here before it is built; units E to J are outlined in section 7.

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

## 4. Unit B (D296): segments and customer tags

### 4.1 Who a segment is about

A **person** is one email address of the store, as the Customers page counts them (D35): everyone with an account, every guest with a paid order,
and, new here, every address on the subscriber list (D295). Their facts are read by one reader, `segmentPeople()` (`src/server/segments.ts`), in one
query keyed by the lower-case address: the account (id, verified, language, customer group, company), the paid orders (D152's `PAID`: count, first
and last order day, net revenue without VAT per currency, the country of the last one, copied and host orders never counted), the subscriber row
(status, language, market) and the person's tags. Revenue is converted to the store's main currency in code (`toMain()`); a person with revenue in a
currency without a rate has `spentMinor = null` and matches no money condition, and the page says how many were left out. The RFM group is
`rfm()` of D152 over these people (customers with a paid order only, so a store's figures and its segments agree); under `RFM_MIN_CUSTOMERS` the
groups are not offered (*not enough customers yet*). The reader stops at `SEGMENT_CAP` (100,000) people and says so.

### 4.2 A segment

`commerce.segments` (store, name, rules, who made it, times; at most `SEGMENTS_MAX` 100 a store, names unique per store). Its `rules` are
`{ match: "all" | "any", conditions: Condition[] }` with at most 20 conditions from a closed list (`src/lib/segments.ts`, checked by
`segmentRulesSchema`, read only through `matches()`):

| Condition | Means |
|---|---|
| `consent` (statuses) | Their place on the subscriber list: `subscribed`, `pending`, `unsubscribed`, or `none`. |
| `orders` (at least / at most / exactly n) | Paid orders. |
| `spent` (at least / at most an amount) | Net revenue without VAT, in the main currency (minor units). |
| `lastOrder` (within n days / more than n days ago / never) | Their last paid order, in whole days at the store's today. |
| `firstOrder` (within n days / more than n days ago) | Their first paid order. |
| `rfm` (groups) | D152's group. |
| `country` (codes) | The country of their last paid order, else their subscriber row's market. |
| `language` (codes) | The account's language, else the subscriber row's, as a two-letter code. |
| `group` (customer group ids) | Their customer group (D108), their own or their company's. |
| `company` (yes / no) | They belong to a company account. |
| `account` (yes / no) | They have an account. |
| `tag` (any of tags) | Staff tagged them. |

A segment is never a stored list of people: it is counted when read, so it is always current. Its page shows how many people match, how many of them
want the store's emails (`subscribed`), and the first 100 by last order. *Preview* counts a rule set before it is saved. The words of every rule are
`describeCondition()` (English, staff), so the list reads as sentences (*Ordered at least 2 times · Last order more than 90 days ago*).

Starting points: *New segment* offers a few ready rule sets (`SEGMENT_STARTERS`: people who want your emails, VIPs, at risk, one order only, no order
in 180 days, never bought but subscribed), each a normal segment once saved.

### 4.3 Customer tags

`commerce.customer_tags` (store, the person's lower-case address, the words as typed, a case-folded key; `normaliseTag()` of D173: 40 code points,
at most 50 per person), added and removed on the customer's page by staff with `customers:write`, audited as `customer.tag_added`/
`customer.tag_removed` with the words but never the address. A tag belongs to the address, so a guest can be tagged too. Tags are personal data: in
the export's `marketing` section, deleted on erasure, never copied.

### 4.4 Who may

The Segments pages are Marketing (`marketing:read`, saving and deleting `marketing:write`, audited `segment.saved`/`segment.deleted` with the name and
rule count, never people). Showing the people of a segment shows addresses, as the Customers page does, so it also needs `customers:read`; without it
the page shows the counts only.

### 4.5 Tests

Unit: `matches()` for every condition and both matches, `describeCondition()`, the schema's limits and the starters. Integration
(`segments.int.test.ts`): the reader's facts for an account, a guest, a subscriber only and a copied order (never counted); money in two currencies
and one without a rate; RFM groups match `rfm()`; tags (normalised, limit, another store's never seen); saving, the limit and names; one store's
segment never sees another's people. A signed-in e2e makes a segment and opens it.

## 5. Unit C (D297): broadcasts

### 5.1 A broadcast

`commerce.broadcasts`, one row per email the store writes once and sends to many:

| Column | Meaning |
|---|---|
| `title` | The staff's own name for it (1 to 80 characters), never shown to subscribers. |
| `audience`, `segment_id` | `everyone` (every address on the list that is `subscribed`) or `segment` (that segment's people who are `subscribed`). A deleted segment leaves `segment_id` null and the broadcast cannot be sent until another is chosen. |
| `content` | Per language of the store (`{ [locale]: { subject, preview, blocks } }`, `broadcastContentSchema` in `src/lib/broadcasts.ts`). The store's main language is required to send; the others are optional. |
| `status` | `draft`, `scheduled` (with `scheduled_for`), `sending`, `sent`, `cancelled`. |
| `audience_words`, `recipient_count`, `started_at`, `finished_at` | Written when the send starts: who it went to in words (the segment's name and rules then) and how many addresses were frozen. |
| `schedule_problem` | Why a scheduled send could not start (it is back to `draft`). |
| `counts` | The report's figures, frozen when the recipients are pruned (5.6). |

The database's rules (`broadcasts_rules()`): the status moves only `draft → scheduled | sending`, `scheduled → draft | sending`, `sending → sent |
cancelled`; `scheduled` needs `scheduled_for`, `sending` needs `started_at`, `sent` and `cancelled` need `finished_at`; the title, audience and content
change only while `draft` or `scheduled`; only a `draft` is deleted, so a send's report stays.

**Content** is blocks, as Kaizena Flow's own emails are (`renderEmail()`, plain HTML that works in every mail app): a heading, a paragraph (plain
text, line breaks kept), a button (words and an address), a picture (from the store's media library, with its alt text, optionally linked) and a
divider; at most 40 blocks, each text with its limit. An address is `https://…` or a path of the store (`/products`, `/category/x`), written under the
recipient's market when sent (`marketPath()`). A picture is accepted only when its address is one of the store's own `media` rows, so no third
party's pixel rides along; pictures for email are uploaded as JPEG (never WebP or AVIF, which some mail apps cannot show). There are no
placeholders in this unit (names are often missing, and an empty greeting reads worse than none).

### 5.2 Who gets it

A recipient gets the language of their subscriber row when the broadcast has it, else the main language. The email is the store's: its name as the
sender and its contact address for replies (D26), the store's details at the foot (`emailFooter()`), a line *You get this email because you asked
for news and offers from {store}* and *Unsubscribe* with the subscriber's own token (`/unsubscribe/{token}`), and the headers `List-Unsubscribe`
(the one-click address) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Every button is sent through the click address (5.5).

### 5.3 Testing and sending

- **Send a test** (`marketing:write`): to the staff member's own address, in a language they choose, the subject marked `[Test]`, its buttons
  straight to their targets and its unsubscribe link to the test page; email kind `marketing.broadcast.test` (staff). It counts nowhere.
- **Send now** or **Schedule** (`marketing:write`): refused while the store is not open or is a store template, without the main language's
  subject and a block, with a segment that is gone, or when nobody would get it. Starting a send is one transaction under the broadcast's lock: it
  reads the audience (`segmentPeople()` and `matches()` for a segment; the subscriber list for everyone), freezes the addresses that are
  `subscribed` at that moment into `broadcast_recipients` (one row per address, with the subscriber, its language and market), writes the count and
  the audience in words, and sets `sending`. A segment over `SEGMENT_CAP` people is refused (it would not be every one of them). A scheduled
  broadcast is started by the every-minute job (`/api/cron/broadcasts`) once its time has come, with the same checks; one it cannot start goes back to `draft` with the
  reason in `schedule_problem`.
- **Sending** (`runBroadcasts()`, from `after()` the press and the every-minute job, never throws): recipients are claimed a batch at a time
  (`for update skip locked`, a claim that runs out), each checked again (an address unsubscribed since the start is `skipped`), kept in
  `email_messages` with the idempotency key `broadcast:{id}:{subscriber}` (so a retried batch never sends twice) and handed to Resend's batch
  endpoint, 100 at a time, paced under its rate, within the run's time. A broadcast with nobody left queued is `sent`. Without email settings, the
  emails are only kept (`logged`), as every email is.
- **Stop** (`marketing:write`) a broadcast while it sends: `cancelled`, and the addresses not yet sent are `skipped`. A store that closes while a
  broadcast sends stops it the same way.

Audit (`marketing`): `broadcast.saved`, `broadcast.deleted`, `broadcast.scheduled`, `broadcast.unscheduled`, `broadcast.started` (with the
recipient count), `broadcast.stopped`; never an address.

### 5.4 Bounces and complaints

Resend's events (`applyEmailEvent()`): a hard bounce (`Permanent`) of any email a store sent unsubscribes that address from the store's list with
`bounce`; a complaint (marked as spam) with `complaint` (3.3). A soft bounce changes nothing.

### 5.5 Clicks

A button's address in a sent email is `/api/marketing/c/{broadcast}/{link}?m={market}`: the route looks the link up in the broadcast's own content
(so it never redirects anywhere the store did not write), adds one to `broadcast_link_clicks` (the broadcast, the link and a count: no person, no
time, no address) and redirects to it. There is no open-tracking pixel. The report says plainly that a count includes mail apps that open links to
check them.

### 5.6 The report

A sent broadcast's page shows: how many it went to, sent (accepted by the email service), delivered, bounced, marked as spam, failed and skipped,
the addresses that unsubscribed since it started, and the presses per button. While it sends, how many are left. Counts are counted from the
recipients and their emails; `pruneBroadcastRecipients()` (daily) freezes them into `counts` and deletes the recipients 90 days after the send ended,
and the report reads the frozen figures after that.

### 5.7 Written with AI

*Write with AI* (`marketing:write`, feature `marketing_email`) takes the staff's few words about what to say and the language, and suggests a subject,
a preview line, a heading, up to four paragraphs and a button's words; the model gets the store's name, the words and the language, never prices,
products or people. Every text passes `findClaims()`; a suggestion with a claim is refused with what was found. A suggestion is put into the editor,
never saved or sent: the person reads it, adds the button's address and saves.

### 5.8 Personal data and copies

`broadcast_recipients` is personal data (`PERSONAL_DATA`: by the address; the export's `marketing` section lists which broadcasts went to it and
when; erasure deletes them); `broadcasts` and `broadcast_link_clicks` are `NOT_PERSONAL` (the store's own words and counts). None is copied
(`COPY_RULES`: `never`). Email kinds: `marketing.broadcast` (shopper), `marketing.broadcast.test` (staff).

### 5.9 Tests

PGlite: the status rules, content fixed once sending, only drafts deleted, recipients unique. Unit: the content schema (limits, addresses, a picture
needs a library address), rendering per language and the fallback, the click link, the AI suggestion's parser and claims. Integration
(`broadcasts.int.test.ts`): a send to a segment freezes only subscribed addresses, sends each once across two runs (a retried batch is a duplicate),
skips an address unsubscribed since, stops; a schedule starts when due and goes back to draft when it cannot; a hard bounce and a complaint
unsubscribe; the click route counts and redirects only to the content's link; another store's broadcast is never read; erasure removes the
recipients. A signed-in e2e writes a broadcast, sends a test and sends it.

## 6. Unit D (D298): automations

Four emails a store switches on once and that then go by themselves: three to people on the list (welcome, after a purchase, win-back) and one
to people who asked about a sold-out variant (back in stock). Each is a switch, words and, for the three, a number of days. Nothing here sends to
anyone who did not ask: the three lifecycle emails go only to addresses that are `subscribed` (rule 1), and back in stock only to an address that
asked for that variant and confirmed it.

### 6.1 The settings

`commerce.automations`, one row per store and kind (`welcome`, `after_purchase`, `win_back`, `back_in_stock`), made when the owner first saves one:

| Column | Meaning |
|---|---|
| `enabled`, `enabled_at` | Whether it runs, and since when (set each time it is switched on, null while off). **Only what happens after `enabled_at` starts an email**: switching one on never writes to everyone who subscribed, bought or lapsed before. |
| `delay_days` | Welcome: days after subscribing (0 to 30, default 0: at the next run). After a purchase: days after delivery (1 to 90, default 7). Win-back: days without an order (30 to 730, default 90). Null for back in stock. |
| `content` | The email per language, as a broadcast's (`broadcastContentSchema`, 5.1: subject, preview, blocks, pictures from the library only); null for back in stock, whose words are Kaizena Flow's (6.5). |

A lifecycle automation is switched on only with the main language's subject and a block (`sendProblems()`); its words start from hand-written
starters per language (`AUTOMATION_STARTERS`, `src/lib/automation-starters.ts`, nb, sv, da and en, in `HAND_WRITTEN_ONLY`'s spirit: never machine
translated), which the owner edits before saving. The database: `enabled` needs `enabled_at`, `delay_days` within its kind's range, `content` null
exactly for `back_in_stock`. Switching and saving are `marketing:write`; audit `marketing_automation.saved`, `marketing_automation.switched` (area `marketing`).

### 6.2 Who gets which, once

The runner (`runAutomations()`, from the every-minute marketing job beside broadcasts, `/api/cron/broadcasts`, never throws; only stores that are
open, `commerce.store_is_active()`, and never a store template) finds, per enabled automation:

| Kind | Who | Key (once each) |
|---|---|---|
| `welcome` | A subscriber `subscribed` whose subscribing moment (`confirmed_at`, else `consented_at`) is after `enabled_at` and at least `delay_days` ago | `welcome:{subscriber}` |
| `after_purchase` | A paid order (D152's `PAID`: captured payment, never copied or host; status `paid`, `fulfilled` or `closed`, not restricted or anonymised) delivered (`delivered_at`) after `enabled_at` and at least `delay_days` ago, whose email is a `subscribed` address on the list | `after_purchase:{order}` |
| `win_back` | A `subscribed` subscriber whose address's latest paid order (as above, by lower-case address, as segments match, D296) was placed `delay_days` ago or more, that moment being after `enabled_at` | `win_back:{subscriber}:{latest order}` (so a new order and a new lapse may send it again) |

Each moment must also be within the last seven days (`CATCH_UP_DAYS`): a store whose job was down for longer does not send old news, and the
keys only need keeping that long. An order with no delivery date (downloads, services, bookings, pickup not marked collected) is not after a
delivery and starts nothing in this unit.

A send is a row of `commerce.automation_sends` (store, kind, key, subscriber, order, outcome, time; primary key store and key) written first, so a
key is never sent twice even by two runs at once; then the email through `sendEmail()` with the idempotency key `automation:{store}:{key}`. A
failed email is recorded `failed` and not tried again. Up to `AUTOMATION_BATCH` (200) a kind a run, within the run's time.

### 6.3 The email

The subscriber's language when the automation has it, else the main language, links under their market (5.1), the store as the sender, its footer,
*You get this email because you asked for news and offers from {store}*, the subscriber's own unsubscribe link and `List-Unsubscribe` with
`List-Unsubscribe-Post` (rule 3). Links go straight to their targets (no click counting in this unit). Email kinds `marketing.automation`
(shopper) and `marketing.automation.test` (staff; *Send a test* to the staff member's own address, subject marked `[Test]`, counted nowhere).

### 6.4 Back in stock: the request

When the store has back in stock on and the shop on, the product page offers *Email me when it's back* under a chosen variant that is sold out
(physical, not digital, stock policy `deny`, offered to this shopper). The shopper types an address (a signed-in customer's is filled in) and
presses once; `/api/stock-requests` (same site only, a resolved selling shop, the variant the store's and offered) keeps
`commerce.stock_requests`: the store, the variant and its product, the address (lower case), language, market, the customer when signed in, a
status, a confirmation hash and expiry, an own token, and a visitor key that changes every day (as forms', D93, never an IP address).

- A **signed-in customer whose email is verified** asking for their own address is `waiting` at once (the account is the proof, rule 2).
- **Anyone else** gets one email, *Confirm that {store} may email you when {product} is back* (`stock.confirm`), whose link opens
  `/account/stock/{token}` with a button (acting from a page, never from opening the link); pressing it makes the request `waiting`. The link
  works for seven days; an unconfirmed request is deleted after that.
- Asking again for the same variant and address while one is open answers the same, and sends no second confirmation within a day. A visitor
  key makes at most 10 requests a store a day, an address at most 5 open confirmations a store; over that the answer is *Try again later*.
- The answer never says whether the address was known.

The status moves only `pending → waiting | cancelled` and `waiting → sent | cancelled` (`stock_requests_rules()`); one open request per store,
variant and address (a unique index over `pending` and `waiting`).

### 6.5 Back in stock: the email

Every run (6.2) the waiting requests whose variant is in stock again (`commerce.variant_availability`'s `in_stock` > 0, read the one way, D172),
whose product is offered (active, the shop on, its kind's feature on) and whose store has back in stock on are sent one email each, *{product} is
back at {store}* (`stock.back_in_stock`): the product's and variant's name, a button to its page in the request's market (no picture: product pictures are WebP, which some mail
apps cannot show), and *You
get this email once, because you asked for it on {date}.* The request is `sent` before the email goes (claimed under `for update skip locked`), so
it is never sent twice. When the variant has fewer units than people waiting, every one is still told (the email promises nothing about how many
there are). Its words are hand-written (`m.backInStock`, nb, sv, da, en, in `HAND_WRITTEN_ONLY` until a legal review). A request does not
subscribe anyone to marketing.

Switching back in stock off hides the form and sends nothing; waiting requests are kept and the page says how many people would not hear. A request
waiting longer than 180 days is deleted; a sent or cancelled one 30 days after.

### 6.6 What the owner sees

*Email automations* under Marketing (beside, and apart from, Settings → Automation's order rules): four cards, each saying what it does in words (*Welcomes people who join your list*), whether it is on, how many it
sent in the last 30 days, and one main action (*Switch on*, or *Edit*). A lifecycle automation's page has its days, its words per language (the
broadcast editor's fields), *Send a test* and the switch. Back in stock's card shows how many requests wait and the products most asked for, and its
switch.

### 6.7 Personal data and copies

`automation_sends` is personal data (by the subscriber; the marketing export lists which automations wrote to the address and when; erasure deletes
them; kept 90 days, `pruneAutomations()`); `stock_requests` too (by the address and the customer; exported in the marketing section with the product
and status; erased; pruned as 6.5 says). `automations` is `NOT_PERSONAL` (the store's own settings and words). None is copied (`COPY_RULES`:
`never`: a copied store writes its own). Email kinds: `marketing.automation`, `marketing.automation.test`,
`stock.confirm`, `stock.back_in_stock`.

### 6.8 Tests

PGlite: the settings' checks, the request status rules and the one-open-request index. Unit: the starters exist for every kind and language and pass
`findClaims()`; the delay ranges; the request's address check. Integration (`automations.int.test.ts`): a welcome goes once to a subscriber who joined
after switching on and never to one before, nor to a pending or unsubscribed one; an after-purchase email goes once per delivered paid order to a
subscribed address only, never for a copied order; win-back goes after the lapse and again only after a new order lapses; nothing for a closed store;
a back-in-stock request from a typed address waits for its link, a verified customer's waits at once, stock rising (through a stock change) sends one
email per waiting address and only once, an unoffered product sends nothing; another store's requests are never read; erasure removes sends and
requests. A signed-in e2e switches on the welcome email; the storefront e2e asks for a sold-out variant.

## 7. Units E to J, outlined

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
