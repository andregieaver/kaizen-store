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
section is written here before it is built; units H to J are outlined in section 10, J detailed in section 11 and I in section 12.

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

## 7. Unit E (D299): discounts in depth

Codes (D31) and campaigns (D114 to D116) get what the parity rows miss, without a second engine: the arithmetic stays `applyDiscount()` and
`evaluateCampaigns()`, used by both `cartSummary()` and `placeOrder()`, and every new rule has a scenario in `checkout-kinds.int.test.ts`
(one in euro). The fixed order of what comes off stays as it is unless a step below changes it: campaigns, the group's discount (D108), the
friend's welcome discount (D131), codes, then bonus credits (D130). Built in four steps, each its own commit and migration:

| Step | What |
|---|---|
| E1 | Codes in depth: reach by category and tag, a minimum quantity, limited to customer groups or named customers, and generated single-use codes with their CSV |
| E2 | Several codes on one order under each code's combination choice; the best for the shopper when two cannot combine, and the cart says why |
| E3 | Campaigns in depth: an amount off and free shipping without a code, and tiers by quantity or spend (the highest reached applies), with the ladder on the product page and how far the next tier is in the cart |
| E4 | Buy X get Y: a buy set (a quantity or an amount of chosen products, categories or tags) and a get set that is free, a percentage or an amount off, cheapest first, with a limit of uses per order |

### 7.1 E1: codes in depth

`discount_codes` gains:

| Column | Meaning |
|---|---|
| `term_ids` | Product categories and tags it reaches (a category reaches the ones under it), beside `product_ids`; with neither, everything. A line is reached when its product is chosen or has one of the terms, read by `termsOfProducts()` as campaigns read them. |
| `min_quantity` | The least number of units of what it reaches, bought once (1 to 1000; null for none), beside the minimum amount. Short of it the code is refused as `minimum_quantity`. |
| `tier_ids`, `customer_ids` | Only signed-in customers in one of these customer groups (theirs or their company's, `customerTierIds()`), or one of these named customers (at most 100). Not signed in: `sign_in`; signed in and outside: `not_eligible`. Customers are chosen by their email on the form and kept by id; an email the store does not know is refused on save. |
| `unique_codes` | The code's own text is its name only and is not accepted at checkout; shoppers use its generated codes. |

**Generated codes** are `commerce.discount_code_items` (store, discount, code, batch, made at): each works once (on an order not cancelled and
not copied, as a code's uses are counted), is looked up when the text is no code of the store's own, and is locked with its code when an order
is placed, so two checkouts cannot take it at once. A code's text is unique across the store's codes and generated codes (a trigger). *Generate
codes* (`marketing:write`) makes 1 to 10,000 at a time (100,000 a code), each a prefix the owner chooses (optional) and eight characters from
an alphabet without look-alikes (no 0, O, 1, I or L), as many as asked; *Download codes* gives the CSV (`writeCsv()`: code, used, made on).
An order keeps which generated code it used (`orders.discount_code_item_id`) beside the code itself. A code with generated codes ignores its
total limit and once per customer (each generated code is once).

The words for a refusal are `m.codeProblems.not_eligible` and `minimum_quantity` (nb, sv, da, en by hand). Audit: `discount.codes_generated`
with the count, `discount.codes_exported`; never a code's text in the log beyond the discount's own.

**Tests.** Unit: reach by term, the minimum quantity, eligibility, the generator's alphabet and uniqueness. PGlite: a generated code unique
against codes and the other way, the new checks. Integration: a code reaching a category reaches a product in a child category and not
another; a group-only code refuses a guest (`sign_in`) and an outsider (`not_eligible`); a generated code works once, and two orders taking
it at once leave one; `checkout-kinds.int.test.ts` holds the cart and the order together for a category code in NOK and a generated code in
euro.

### 7.2 E2: several codes on one order

**A code's class and its combinations.** Every code is of one class, worked out from what it is (`codeClass()`): `shipping` for free shipping,
`products` for a code that names products, categories or tags, `order` for one on everything. `discount_codes.combines_with` (a set of classes,
empty by default, so every code there today keeps working alone) says which classes it may be used with. Two codes are used together only when each
allows the other's class (`combines()`), and never two of the same code (two generated codes of one code are one code). The editor asks it as
*Can be used with* and three boxes: other product codes, other order codes, free shipping codes.

**The cart holds up to five codes** (`CODES_MAX`): `carts.discount_code` is the first entered and `carts.more_codes` the rest in the order typed
(the old column stays the first, so the code running until the deploy finishes reads what it always read). Applying a code adds it; one already
there is not added twice; a sixth is refused (`codes_full`). Each can be taken off by itself; the restore link of a cart reminder adds its code.

**The best for the shopper.** Which of the cart's codes apply is only `stackCodes()` (`src/lib/discounts.ts`, pure), which `cartSummary()`,
`placeOrder()` and the checkout's code field all use: from the codes that can be used at all (`availability()`, as today), every set whose members
all combine with each other is tried, its codes applied one after another (products codes first, then order codes, then free shipping; within a
class in the order typed), each counting what the ones before it left (a line's price after them; a recurring percentage's lowered unit), and a set
counts only if every code in it still applies. The set that takes the most off wins; on a tie, the one holding the codes typed first. No line ever
goes below zero. Each code not used says why: its own reason when it does not apply alone, `not_combinable` with the code it cannot be used with
(*Can't be used together with SOMMER*), or its reason after the others (most often the minimum). Five codes give 31 sets at most, so this is cheap
and exact.

**The order.** `orders.discount_code` keeps the codes used, joined by ` + ` (one code: as today), so invoices, emails, exports, integrations and
Stripe's coupon name need nothing new; `discount_code_id` and `discount_code_item_id` are the first code's. Every code used is a row of
`commerce.order_discount_codes` (store, order, position, code, discount, generated code, amount off in the order's currency), written by
`insertOrder()` with the order; a code's uses and a generated code's use count these rows as well as the order's own column (orders placed before).
`orders.entered_codes` keeps every code the cart held, so the check for a changed cart compares what the cart holds now with what it held, not with
what applied. All the codes are locked in one statement, in id order, before any is checked, so two checkouts never wait on each other in a circle.
Stripe still gets one coupon for the sum.

**Analytics.** *Discount codes used in the period* (D152) counts each code of an order from `order_discount_codes`, with its own amount, and orders
placed before from the order's columns as today; an order with two codes is one order in the totals.

**Words.** `m.codeProblems.not_combinable` (*Can't be used together with {code}.*) and `codes_full` (*You can use up to five codes.*), nb, sv, da
and en by hand. The cart lists each code with *Remove* and its reason when it does not apply; the checkout's field the same.

**Copying.** `duplicate_store()` carries `combines_with`. `order_discount_codes` is `never` in `COPY_RULES` (a copied order keeps its codes' words in
`discount_code`).

**Tests.** Unit: `codeClass()`, `combines()`, `stackCodes()` (two that combine add up; two that cannot keep the better one with the other's reason;
the tie keeps the first typed; a second percentage counts what the first left; a minimum that fails after another code; no line below zero; free
shipping beside a product code). PGlite: the new checks (`combines_with` classes, `order_discount_codes` position). Integration: a cart with two
codes that combine places an order with both rows and the joined text; two that cannot keep the better one in the cart and the order alike; a
code's uses count its second place; `checkout-kinds.int.test.ts` holds two codes in NOK and in euro.

### 7.3 E3: campaigns in depth

Three more kinds of campaign (D114), worked out by the same `applyCampaigns()` in the cart and in `placeOrder()`:

| Kind | What it gives | New columns |
|---|---|---|
| `amount` | An amount off the lines it reaches, per country in the country's own currency (`amounts`), optionally only once those lines come to an amount (`thresholds`) | `amounts` |
| `free_shipping` | No shipping on the order, optionally only once the lines it reaches come to an amount (`thresholds`) | none |
| `tiered` | A percentage off the lines it reaches, the higher the more is bought: by number of items (`tier_basis = 'quantity'`) or by what they come to (`'spend'`, an amount per country); the highest step reached applies | `tier_basis`, `tiers` |

`tiers` is two to five steps, each `{ "quantity": n, "percent": p }` or `{ "amounts": { "NO": minor, … }, "percent": p }`, each step asking for
more than the one before and giving more (the database checks the shape and the count; the server the order and the currencies). A step without
an amount for a country is not offered there. `thresholds` stays per country: required for a gift (as today), optional for an amount and free
shipping (no amount for a country: no minimum there). Amounts are converted to the currency shown with `shown()`, as thresholds are.

**The arithmetic** (`src/lib/campaigns.ts`, pure):

- An **amount** competes with the percentages and the "3 for 2" for the lines still free, as they compete with each other (the one taking most
  off wins a line; ties to the older campaign). It takes `min(amount, what the lines come to)`, split over the lines it reaches by what each
  costs (largest remainder, the earlier line first on a tie), never more than a line costs. It counts only when the lines it reaches, of those
  still free, come to its threshold. It does not stack (a check).
- A **tiered** campaign counts the units (or what they come to, before any reduction) of the lines it reaches that are still free, takes the
  highest step they reach, and is then a percentage off those lines (`percentOff()`). It may stack like a percentage: it then counts the lines it
  reaches before any reduction, and takes its percentage off what is left of each.
- **Free shipping** is decided after the price campaigns and the gifts: of the running ones, the oldest whose reached lines, after the
  reductions, come to its threshold makes the order's first shipping free (whatever the delivery: the flat rate, a method, a carrier's service,
  pickup costs nothing anyway). Never on a basket with a subscription (a renewal pays its shipping, D25), and only when the basket ships. It
  comes before codes (D31), so a free-shipping code beside it has nothing to take (`not_applicable`, as over the flat rate's free limit today).
- **How far the next step is** (`nextSteps()`): for each tiered campaign below its last step, the units or the amount still missing for
  the next step and its percentage; for an amount or free shipping with a threshold not yet reached, the amount missing; only where the basket
  has lines the campaign reaches and no other campaign holds them, so adding to them would give it (free shipping: the nearest one only).

**The order.** An amount and a tiered campaign are on the lines as every campaign is (`campaign_discount_minor`, `campaign_parts`). Free shipping is
the order's: its amount is part of `orders.discount_minor` and `campaign_discount_minor` (so the invoice's campaign row and the shipping's VAT
follow, as a free-shipping code's does), and the campaign is `orders.campaign_shipping` (`{ id, name, minor }`, null without). A campaign's uses,
its orders and what it gave count `campaign_shipping` beside the lines' parts. The discounts analytics count campaigns from the lines as today
(the shipping's discount is in neither a code's nor a campaign's line figure, as before).

**What shoppers see.** The product page's notice says each: *NOK 100 off*, *NOK 100 off when you spend NOK 500*, *Free shipping*, *Free
shipping when you spend NOK 500*, and a tiered campaign its ladder (*10 % off when you buy 2 · 15 % off when you buy 4*, or *… when you spend
NOK 500*). A card carries the price offers that need no amount (a tiered campaign as *Up to 15 % off*), never an amount off or free shipping. The cart
says how far the next step is: *Buy 2 more to get 15 % off*, *Spend NOK 120 more to get 15 % off*, *Spend NOK 120 more to get NOK 100 off*,
*Spend NOK 120 more for free shipping* (with the campaign's name), and shows free shipping as the shipping's row. Words in `m.campaigns`, nb, sv,
da and en by hand. The chat agent's offers say the same through `noticeText()`.

**The editor.** Three more choices on *What it gives*: *An amount off*, *Free shipping*, *Bigger discounts for buying more* (steps added and
removed, by number of items or by amount per country). The list says what each gives (`describeCampaign()`).

**Copying.** `duplicate_store()` carries `amounts`, `tier_basis` and `tiers` (patched in place). `orders.campaign_shipping` is history like the rest
of the order.

**Tests.** Unit: an amount split and capped; an amount's threshold; an amount competing with a percentage; tiers by quantity and by spend, the
highest step; a stacking tiered campaign; free shipping with and without a threshold, after reductions; `nextSteps()` for each; the notices'
words. PGlite: the new kinds' checks (`amounts` only on `amount`, `tiers` only on `tiered` with two to five steps, no stacking amount or free
shipping). Integration: a free-shipping campaign gives an order with no shipping to pay, its `campaign_shipping` and a use counted; a tiered
campaign's limit counts its orders; `checkout-kinds.int.test.ts` holds the cart and the order together for an amount, a tiered campaign and free
shipping, in NOK and in euro.

### 7.4 E4: buy X get Y

A campaign of kind `bxgy`, worked out by the same `applyCampaigns()` in the cart and in `placeOrder()`:

| Column | Meaning |
|---|---|
| `product_ids`, `term_ids` | The **buy set**, as every campaign's reach (none: everything). |
| `buy_min_quantity` or `buy_min_amounts` | What one use asks for: so many units of the buy set (1 to 100), or what they come to per country in its own currency. Exactly one. |
| `get_product_ids`, `get_term_ids` | The **get set**; both empty: the same as the buy set. |
| `get_quantity` | Units given per use (1 to 20). |
| `get_kind`, `get_percent`, `get_amounts` | What each given unit gets: `free`, `percent` (1 to 100, the lowered price as every percentage) or `amount` per unit per country (never more than the unit costs). |
| `uses_per_order` | How many times one order may use it (1 to 100; null: as often as the basket allows). |

**The arithmetic** (`bxgyOff()`, pure). Units of goods bought once, that cost something and are still free of other campaigns, are laid out one by one.
A use takes the **dearest** units of the buy set that are still unused until it has its quantity (or its amount), then gives up to `get_quantity`
of the **cheapest** units of the get set still unused, never a unit it counted as bought; a use that can give nothing does not count, and uses
stop at `uses_per_order` or when the basket runs out. So "buy 2, get 1 free" on one set gives the cheapest of every three, and on two sets gives the
cheapest of the get set once two of the buy set are in the basket. The shopper adds the given units themselves (unlike a free product, D114,
nothing is added). The campaign competes for lines with the others (the one taking most off wins; ties to the older), takes every line whose units it
counted or gave, and does not stack (a check). The order keeps it as every price campaign: on the given lines' `campaign_discount_minor` and
`campaign_parts`, so its uses count as before.

**What shoppers see.** The product page tells it on the products of both sets: *Buy 2, get 1 free*, *Buy 2, get 1 at 50 % off*, *Buy 2, get 1 at
NOK 100 off*, or with an amount *Spend NOK 500, get 1 free*; a card carries it when it needs no amount (a quantity and free or a percentage).
Words in `m.campaigns`, nb, sv, da and en by hand.

**The editor.** *Buy one thing, get another*: what they buy (the campaign's own reach), how much (items or an amount per country), what they get
(the same products, or chosen products, categories and tags), how many, and free, a percentage or an amount off; the uses per order under it.

**Copying.** `duplicate_store()` carries the new columns, the get set remapped to the copy's own products and terms; a get set that named products and
lost them all is switched off rather than left to mean "the same as the buy set" (patched in place).

**Tests.** Unit: one set "buy 2 get 1 free" over six units of three prices; two sets; a percentage and an amount per unit; by amount; the uses per
order; a unit never both bought and given; competition with a percentage; the notices' words. PGlite: the kind's checks (exactly one buy measure,
get kind and its value, no stacking). Integration: `checkout-kinds.int.test.ts` holds the cart and the order together for one set and two sets, in
NOK and in euro.

## 8. Unit F (D300): gift cards

A gift card is money the buyer pays now for someone to spend later in the same store. Under the EU's voucher rules (Directive 2016/1065) a
card that can be spent on goods with different VAT rates, or in more than one country, is a **multi-purpose voucher**: selling it is not a
supply, so no VAT is charged when it is sold, and the goods it is spent on carry their VAT as always. Kaizena Flow sells multi-purpose
vouchers only (a single-purpose voucher, whose VAT is known when sold, is not offered); this and the expiry rules below need an accountant's
and a lawyer's look before real use, and the words a shopper reads are flagged for legal review.

Built in four steps, each its own commit:

| Step | What |
|---|---|
| F1 | The model: `gift_cards` and their append-only ledger `gift_card_entries`, written only by SQL functions; codes kept as hashes; the database allows the feature `gift_cards` (the switch reaches the Features page with F2, which gives it something to sell); PGlite tests |
| F2 | Selling one: a product of kind `gift_card` with its amounts per country, bought in the cart like goods; at payment one card per unit is issued and emailed to the buyer or a recipient on a chosen day |
| F3 | Spending one: a *Gift card* field at checkout, up to three cards on an order as payments (never a discount), held when the order is placed, captured with the order, back on the card when the order is cancelled or refunded |
| F4 | The owner's screens and figures: Gift cards (issued, balances, a card's history, issue one by hand, adjust, deactivate), the liability report, the CSV, the AI manager's read-only tool; docs and parity |

### 8.1 F1: the model

- **`commerce.gift_cards`**: `store_id`, `id`, `code_hash` (HMAC-SHA-256 of the normalised code with a key made from `SETTINGS_ENCRYPTION_KEY`
  for this use alone; unique per store), `last4`, `currency` (ISO 4217, fixed), `initial_minor` (> 0), `issued_at`, `expires_at` (null: never),
  `status` (`active`, `deactivated`; spent or expired is read from the balance and the date, never stored), how it came to be (`source`: `order`
  with `order_id` and `order_line_id`, or `staff` with `issued_by` and a `note`), the recipient (`recipient_email`, `recipient_name`,
  `message`, `send_at`, `sent_at`; null for a card the buyer keeps) and `customer_id` (who it was issued to when signed in, else null).
  A code is 16 characters from the same alphabet as generated discount codes (D299 E1, no look-alikes), shown in groups of four, made by
  `randomBytes()`, shown to people only in the email that delivers it and once to staff who issue one by hand; the database never holds it.
- **`commerce.gift_card_entries`**, append-only (a trigger refuses update and delete): `kind` `issue` (+), `hold` (−, an order placed and not yet
  paid), `release` (+, that order cancelled unpaid or its hold expired), `spend` (a hold turned final when the order is paid: amount 0, it
  marks the hold), `refund` (+, a refund of an order paid with the card), `adjust` (±, staff, with a reason), `expire` (−, the balance left at
  expiry) and `void` (−, the balance when staff deactivate it); each with `amount_minor`, `order_id` where there is one, `account_id` for
  staff, and an `idempotency_key` unique per card. **A card's balance is only `commerce.gift_card_balance(card)`** (the sum), never stored or
  worked out in code; the functions `gift_card_issue()`, `gift_card_hold()`, `gift_card_release()`, `gift_card_spend()`, `gift_card_refund()`,
  `gift_card_adjust()`, `gift_card_expire()` and `gift_card_void()` are the only writers, each locking the card row and refusing a balance below
  zero, a currency that is not the card's, a card deactivated or expired (except release, refund and expire), and a second call with the same key.
- **Feature**: `gift_cards` in `FEATURE_IDS` (needs `shop`), off by default; off means no gift card products are offered and the checkout's field
  is gone, while cards already sold can still be spent and refunded (the money is the customer's), and the admin's Gift cards page stays.
- **Copying, personal data**: both tables are `never` in `COPY_RULES`. Recipient fields and `customer_id` are personal data (`PERSONAL_DATA`:
  export section `gift_cards`; erasure clears the recipient and message and the customer link, never the balance or the ledger, which are money).
- **Expiry**: the store's `gift_card_settings.expiry_months` (default 36, at least 12, or none), fixed on the card when issued. Norway's and
  the Nordic consumer rules give at least three years in practice; flagged for review per market. The daily job writes `expire` for a card past
  its date with a balance, once.

### 8.2 F2: selling one

- A product of kind `gift_card` (a kind in `PRODUCT_KINDS` and the `products_kind` check, offered only while the feature is on, through
  `OFFERED`): its variants are its amounts, a variant's price per market being the card's value in that market's own currency; delivery
  `digital`, no stock, no shipping, no unit price, never backordered, never a subscription. A demo product (`Demo: Gift card`) in the template.
- **No VAT on the sale**: a gift card line takes the VAT category `voucher` (a new row of `vat_categories` whose rate is 0 in every country,
  through `set_vat_rate()`, verified, source the directive), so `decideTax()`, the cart and `placeOrder()` need no case of their own; the
  invoice line says *Gift card: multi-purpose voucher, VAT is charged when it is spent* (`invoice-text.ts`).
- **Nothing comes off a gift card**: campaigns, group discounts, codes, the friend's discount and bonus credits never reach a gift card line,
  and a gift card cannot pay for a gift card (F3). Free shipping thresholds count without it.
- On the product page the shopper chooses the amount and, optionally, *Send it to someone*: their name, email, a message (the D173 gift
  rules: `cleanShopperText()`, refused not cut) and a day (today up to a year). These ride on the cart line and are frozen on the order line.
- **Issued at payment**: `commerce.complete_order_payment()` (and `authorize → paid` the same way) calls `gift_card_issue()` for each unit of
  each gift card line, once (key `order_line:{id}:{n}`), never for a copied order, a host's order or a Stripe test-mode payment (a test card is
  issued as `test` and cannot be spent in live mode). The code is made in application code right after (`issueCodes()`, in `after()` and the
  five-minute job for any missed): the card row exists first with a pending code, the code is made, its hash written once, and the email sent.
- **Delivered by email** (`gift_card.issued`, in `EMAIL_KINDS` and `NOTIFICATIONS`, required): to the recipient on `send_at` (the buyer gets
  a copy saying it is on its way, without the code) or else to the buyer at once; the card's amount, the code, the expiry and the store's
  link, hand-written nb, sv, da and en. A bounced recipient email is told to the buyer; staff can send it again from the card's page.
- **Withdrawal (D153)**: a gift card is a digital service that has not started until it is spent; while its whole balance is unspent the
  buyer may withdraw within 14 days, which voids the card and refunds the line. Once any of it is spent, the line is not eligible
  (`lineEligibility()` reason `gift_card_spent`). Flagged for legal review.

**As built (F2):** the cards are issued by deferred triggers on the payment and on the order, whichever comes last, rather than inside
`complete_order_payment()`; a card's code is made when its email is sent (on its day), and made again while the card was never delivered,
so an email that failed never leaves a card nobody can use; the day starts at 08:00 in the store's time zone. A new store's demo gift card
waits as a draft, as every digital product does. The invoice line's own words and Finance leaving vouchers out of sales come with F4, and
spending a card with F3: a store should not switch gift cards on before F3.

### 8.3 F3: spending one

- **At checkout**, a *Gift card* field beside the discount code (never in the same field: a card is money, a code is a discount): the code is
  checked live (`findGiftCard()`, by hash, the store's own, the cart's currency, active, not expired, a balance), at most three cards on a
  cart (`cart_gift_cards`), each shown with the amount it will pay and its balance after. Attempts are limited per cart and per client like
  VIES checks (`chat_usage` buckets `giftcard:*`), and a wrong code says only *This gift card can't be used*, never whether it exists.
- **A payment, never a discount**: the order's total and its VAT are what they would be without the card; the cards pay first, in the order
  added, up to what is due online (`giftCardsPay()`, pure: never more than a card's balance or the amount due); Stripe or Mollie is asked only
  for the rest (`dueNowMinor`), and an order the cards pay in full is confirmed without a provider (`confirmPaidByGiftCards()`, like
  `confirmAtVenue()`). `cartSummary()` and `placeOrder()` both use `giftCardsPay()`, and `checkout-kinds.int.test.ts` gets a NOK and a euro
  scenario (part paid, all paid, two cards).
- **Held, then spent**: `placeOrder()` writes, under each card's row lock, a `payments` row of provider `gift_card` (pending) and a `hold`
  entry; `complete_order_payment()` captures it and writes `spend`; `cancel_unpaid_order()` and an expired checkout write `release`. A
  `gift_card` payment is a captured payment like any other, so an order paid with a card is a sale (`PAID`) and its invoice lists the card as a
  payment, with VAT on the goods as always.
- **Refunds** go back where the money came from: `refundOrder()` splits a refund over the captured payments as it does (`splitRefund()`),
  and the gift card's part goes back on the card through its provider (`providerOf('gift_card').refund()`, a `refund` entry, no API call),
  even after the card expired (its new balance then expires with the next daily run). Exchanges (D239), order edits (D174) and payment terms
  (D293) never take a gift card: their pay links are Stripe's.
- **Never spent on**: a gift card line, a subscription's later renewals (the first order only), a booking deposit's balance at the venue, a
  draft order (D173), another store, another currency (a card in NOK is not spent in a euro view: the view is changed, or the field says
  *This gift card is in NOK*).

**As built (F3):** cards are kept on the cart by id (`cart_gift_cards`) and found by hash; the hold is written by a trigger on the `gift_card` payment
row itself (not by `placeOrder()` calling the ledger), and spending and releasing follow the order's status by trigger (`complete_order_payment()` and
`cancel_unpaid_order()` are unchanged). A rest smaller than the provider's smallest charge is left for it (the cards pay less). Stripe gets the rest as
one line of the order with the shipping inside. An order the cards pay in full is placed from the cart, which asks who pays (as for Mollie) with the
terms of sale; the checkout's field sends the shopper back there in that case. Refunds give the shopper's money back first and the cards' last. An
order paid after it was cancelled does not take its cards again (`gift_card.unpaid` for staff). Order changes and exchanges do not yet refund to a card.

### 8.4 F4: the owner's screens and figures

- **Products → Gift cards** (`products:read`; writing `products:write`, issuing by hand and adjusting `owner` or a role with `orders:write`
  and a reason): the list (last four, value, balance, status, issued, to whom), a card's page (its ledger in words, the orders it paid,
  *Send again*, *Deactivate*), *Issue a gift card* (an amount, a currency the store sells in, an optional recipient; the code is shown once),
  and the settings card (expiry). Audited `gift_card.*` with ids and amounts, never a code.
- **The liability report** (Analytics → Finance, `docs/analytics.md` first): outstanding balance per currency now, and per period issued,
  spent, refunded back, expired and voided, each currency on its own (never added across currencies); a gift card's sale is not net sales
  (Finance's sales leave `voucher` lines out, and say so), its spending is. The CSV `finance.gift_cards`.
- **AI manager**: `gift_card_overview` (read-only, `products:read`): counts and the outstanding per currency, never a code or a recipient.
- **Parity**: `customers.gift-cards` and `analytics.liabilities-gift-card-and-store-credit`.

**As built (F4):** issuing, changing, deactivating and the settings need the right to change products (the page is the Products section's, and a
page's key is its section's, `permissions.scan.test.ts`); a card issued
by hand is in the store's payment mode, shown once and marked delivered at once (its code is then fixed), and emailed when an address is given. A
delivered code can never be sent again: *Send again* is for a bought card whose email failed. The liability report counts the cards of the store's
payment mode now (a store still testing sees its test cards), and an order of gift cards only is no order in Finance; a refund of a mixed order is
shared by its goods. The invoice's words come with a `voucher` mark on its gift card lines (migration `gift_card_admin`). Not built: a custom amount,
opening and closing balances, and a card's refund from an order change or an exchange.

### 8.5 Tests

PGlite: the ledger's functions (balance never below zero, idempotent, currency fixed, refused on a deactivated or expired card, release and
refund allowed after expiry), the trigger refusing update and delete. Unit: `giftCardsPay()`, code shape and normalising, eligibility of a
gift card line for withdrawal. Integration: issued once at payment with its email; test mode not spendable live; spending part and all, two
cards, held then released on cancel, refunded back on a refund, another store's or currency's card refused, the attempts limit; NOK and euro
scenarios in `checkout-kinds.int.test.ts`; personal data export and erasure. e2e: buying a card, the email's code spent at checkout.

## 9. Unit G (D301): product reviews

A product review is a buyer's own words about something they bought and received in the store: stars from one to five, an optional title and
text, the name they choose to show. The EU's rules on reviews (Directive 2005/29/EC as amended by the Omnibus Directive 2019/2161, Annex I
points 23b and 23c, Article 7(6)) say a trader who shows reviews must say whether and how it checks they come from people who used or bought the
product, must not claim they do when it does not, and must not hide or misrepresent reviews to make the whole look better. Kaizena Flow answers
by construction:

- **Only buyers write.** A review is written from an order line the person bought and received (9.2), so every written review is a verified
  purchase; a review imported from elsewhere (9.6) is marked imported, never verified. There is no form for anyone else.
- **Staff never write or change one.** Staff publish, hide (with a reason, 9.4) and answer; the database refuses any change to a review's
  rating or words except by its author (9.1). No review is rewarded: there is no field, credit or code for one, and the page says so.
- **What is shown is counted.** The stars, the average and the structured data count only published reviews of that product, worked out in SQL,
  never by a model.

The checking statement, the review words and the request email are hand-written nb, sv, da and en and flagged for legal review; the rule that a
review request is marketing (9.5) needs a lawyer's look before stores rely on it.

Built in four steps, each its own commit:

| Step | What |
|---|---|
| G1 | The model and writing: `product_reviews` and `review_settings`, the database's rules, the feature `reviews`, *Reviews* in My account (what can be reviewed, write, edit, delete), registers and erasure; PGlite and integration tests |
| G2 | Checking and showing: the admin's Reviews page (queue, publish, hide with a reason, answer, the publish setting), the product parts `rating` and `reviews`, *How reviews are checked*, `aggregateRating` and `review` in the product's JSON-LD; docs and parity |
| G3 | Asking and importing: the request email after receipt (subscribed addresses only), its token page, importing reviews from CSV (a D165 job), the AI manager's read-only `reviews_overview`, the control center's count of reviews waiting |
| G4 | Pictures: up to three per review, shrunk in the browser, kept private until the review is published, moderated with it |

### 9.1 G1: the model

- **`commerce.product_reviews`**: `store_id`, `id`, `product_id` (the store's product), `variant_id` (the variant bought, kept for *Size M*; null
  for an import), `source` (`buyer` or `import`), for a buyer's: `order_id`, `order_line_id` (unique per store: one review per order line) and
  `buyer_key` (`c:{customer}` for a customer; G3's guests `e:{hash of the order's email}`), `customer_id` (null for a guest or an import); for an
  import: `imported_from` (1 to 80 characters, *Trustpilot*) and `written_on` (the date it was written there). `author_name` (1 to 60),
  `rating` (1 to 5), `title` (up to 120, may be null), `body` (up to 5 000, may be null), `locale` (the language it was written in), `status`
  (`pending`, `published`, `hidden`), `hidden_reason` (`not_about_product`, `offensive`, `personal_data`, `spam`, `other`; set exactly when
  hidden), `moderated_at`, `moderated_by`, `answer` (up to 2 000) with `answered_at` and `answered_by`, `created_at`, `edited_at`.
  One buyer review per product and buyer (a unique index on `store_id`, `product_id`, `buyer_key` where `source = 'buyer'`): buying it again
  lets them edit theirs, never add a second.
- **The database's rules** (`product_reviews_rules()`): the store, product, source, order, line, buyer and customer are fixed once written; a
  buyer's line must be of that order and of a variant of that product, and the order the store's; the rating, title, body and name change only
  inside the author's write (the transaction setting `kaizen.review_author` names the review, set only by `src/server/reviews.ts`); the status
  moves `pending → published | hidden`, `published ↔ hidden`, and back to `pending` only in the author's write; a review is deleted only in a
  transaction marked `kaizen.review_delete` (the author's delete, erasure, retention). Staff therefore cannot change a word or a star.
- **`commerce.review_settings`**, one row per store: `publish` (`after_check`, the default: a new or edited review waits for staff; or
  `at_once`: published when written, staff may hide it after), and for G3 `requests_on`, `requests_enabled_at`, `request_days` (3 to 60,
  default 14).
- **Feature**: `reviews` in `FEATURE_IDS` (group Customers, needs `shop`), off by default. Off: nothing is shown or asked for and My account's
  Reviews is gone; reviews are kept, and the admin's page stays (it says the feature is off). `featureFacts()` counts published reviews; the
  warning on switching off says how many stop showing.
- **Copying, personal data**: `product_reviews` is `never` in `COPY_RULES` (a copied store gathers its own; a template's demo reviews would be
  invented, so there are none), `review_settings` `settings`. A review is personal data (`PERSONAL_DATA`, by the customer or the order's email
  through its order; export section `reviews` with product, stars, words, status and dates; erasure **deletes** it: its words are the person's,
  and the average follows).

### 9.2 What can be reviewed

Only `reviewableLines()` (`src/server/reviews.ts`, one SQL reader) says what a person may review, and the write checks it again under the line's
lock. A line is reviewable when its order is sold (D298's `SOLD`: a captured payment, status `paid`, `fulfilled` or `closed`, never copied, not
restricted or anonymised), it has a variant of a product that is not a gift card, the product still exists, and it was **received**:

| The line | Received when |
|---|---|
| Goods (`physical`) | The order has `delivered_at` (sent in full and delivered, or collected) |
| A download (`digital`) | The order is paid |
| A service (an appointment, a stay, a rental) | Its booking is `confirmed`, has ended and is not a no-show |

and the moment it was received is within `REVIEW_WINDOW_DAYS` (365) ago. Writing needs the feature on and the store open. A person is the
signed-in customer whose own orders the line is on (`ownsOrder()`, as My account reads them); G3 adds the order's token.

### 9.3 Writing, in My account

*Reviews* in My account (`/account/reviews`, a link on My account and *Write a review* beside each reviewable line of an order's page) lists
what can be reviewed, newest first, and the reviews already written with their state in words (*Waiting to be checked*, *Published*, *Not
shown*, and the store's answer). The form: stars (a radio group, required), a title, the text and the name to show (filled with the first
name and the surname's initial, editable). The words are cleaned (`cleanReviewText()`: trimmed, control characters out, refused not cut), and a
press writes through `writeReview()` (at most 20 writes a customer a day, counted in `chat_usage` bucket `review:*`). An edit
writes the new words and, with `after_check`, sends it back to the queue; a delete is one press with a confirm. The review is written in the
market's language. A hidden review can be edited (it goes to the queue again) but its reason is not shown to the buyer.

### 9.4 G2: checking

Products → Reviews (`/admin/{store}/reviews`, `products:read`; every change `products:write`, the Products section's, as gift cards'): the queue
of reviews waiting first, then all by state, searched by product, stars and words; each with its stars, words, product and variant, *Verified
purchase* or *Imported from …*, the order (linked for staff who may read orders) and buttons *Publish*, *Hide* (a reason from the list,
required) and *Answer* (shown under the review as the store's answer; editing or removing it is allowed). The settings card chooses
`after_check` or `at_once`. Audit `review.published`, `review.hidden`, `review.answered`, `review.settings` (area products) with ids only.
Every change refreshes `reviewsTag(store)`. Hiding is for the reasons listed; the page says *Hiding a review because it is negative is not
allowed* beside the button (Annex I 23c).

### 9.5 G2: showing

Two product parts (`PRODUCT_PARTS`, feature `reviews` in `PRODUCT_PART_FEATURES`), both drawing nothing while there is no published review:

- **`rating`**: the stars, the average to one decimal and *(12 reviews)*, linking to the reviews below; placed under the title in the default
  layout.
- **`reviews`**: the heading, the average, the count and how many gave each number of stars; the newest ten published reviews (stars, title,
  text, name, date, the variant bought, *Verified purchase* or *Imported from {source}*, the store's answer), *Show more* fetching the next ten
  from `/api/reviews` (GET, the store's published reviews of one product, keyset, cached briefly), and *How reviews are checked* (a disclosure
  with the hand-written statement: who can write, that staff check them before they show or may hide them after, the reasons a review is not
  shown, that no one is rewarded, that imported reviews were written elsewhere). Placed last in the default layout. A review's words are text
  in its own language (`lang`), never HTML, never translated.

The reads are cached (`'use cache'`, tags `reviews:{store}` and the product's catalogue tag); the product page stays prerendered. The product's
JSON-LD (`productJsonLd()`) gets `aggregateRating` (`ratingValue` to one decimal, `reviewCount`, `bestRating` 5, `worstRating` 1) and up to five
newest `review`s (`author` a `Person` by the shown name, `datePublished`, `reviewRating`, `name`, `reviewBody`) only when there is a published
review, from the same read (`reviewFacts()`). Stars on product cards are not in this unit.

### 9.6 G3: asking and importing

- **The request.** With `requests_on`, the every-minute marketing job (`runReviewRequests()`, beside `runAutomations()`) emails each sold order
  once (`review_requests`, key `review:{order}`, claimed before sending) when its newest reviewable line was received `request_days` ago, after
  `requests_enabled_at` and within D298's `CATCH_UP_DAYS`, **only when the order's email is `subscribed`** on the list: asking for a review is
  treated as marketing (the German Federal Court of Justice, VI ZR 225/17, 2018), so rule 1 holds, with the subscriber's unsubscribe link and
  headers (`marketingEmail()`'s shape). The email names up to five products and has one button to `/account/review/{token}` (a token per order,
  kept as a hash, 90 days, `review_invitations`), where the order's reviewable lines are written without signing in (`buyer_key` the customer's
  when the order has one, else the hash of its email). Kind `review.request` (shopper). Every buyer can still review from My account.
- **Importing.** Reviews from another service come in as a D165 job (`review_import`, the CSV's `product_handle`, `rating`, `title`, `body`,
  `author`, `date`, `source`): only for the store's products by handle, each an `import` review published or waiting as the owner chooses,
  never verified, never more than 10 000 a file, an error per refused row. `review_export` writes the published and waiting ones.
- **AI manager.** `reviews_overview` (read-only, `products:read`, feature `reviews`): counts by state, the average and count per product (the
  best and worst ten with at least three reviews), how many wait; never an author's name.
- **Control center.** *Reviews waiting* beside the store's other waiting things.

### 9.7 G4: pictures

Up to three pictures a review, shrunk in the browser to WebP (1600 px and a 480 px thumbnail, `compressPicture()` without AVIF), sent with the
review and checked on the server (WebP by its bytes, at most 600 KB and 1600 px), kept in the private bucket `review-pictures` and served by
`/api/reviews/picture/{id}` only while their review is published (staff see them through the admin); staff may hide one picture alone. Personal
data (`storage:review-pictures`, deleted with the review).

### 9.8 Tests

PGlite: the rules (fixed columns, words changed only in the author's write, status moves, delete only when marked, one review per line and per
product and buyer, the line of that order and product). Unit: `cleanReviewText()`, the average and histogram, the JSON-LD (no `aggregateRating`
without a published review, imports and pending excluded), the checking statement in four languages. Integration (`reviews.int.test.ts`): a
delivered line can be reviewed and an undelivered one cannot; a download at payment; a booking after it ended, never a no-show; a copied order
never; another customer's order never; another store's product never; after_check waits and at_once publishes; an edit goes back to the queue;
staff cannot change the words; the average counts published only; erasure deletes the person's reviews. G3: the request goes once, only to a
subscribed address, never for a copy; the token page writes for its order only. e2e: a buyer writes a review and staff publish it, and the
product page shows it.

### 9.9 As built

- **G1** (D301): as 9.1 to 9.3. A product deleted or a customer deleted takes their reviews with it (the database's own cascade, the only delete
  besides the author's and erasure). The account's Reviews page lists one line per product, the newest receipt of it; buying it again lets the
  buyer edit the review they wrote, never add a second.
- **G2** (D301): the queue, the decisions and the publish setting are one page, Products → Reviews, each review with its buttons; a review's page
  of its own was not needed. *Rating* sits under the title and *Reviews* at the end of the details column of the default layout, both drawing
  nothing without a published review, so a store's pages are unchanged until it has one. The browser e2e of a buyer writing and staff publishing
  comes with G3, whose token page lets a test write without a shopper's sign-in.

## 10. Units H to J, outlined (J is detailed in section 11, I in section 12)

- **H, feeds (D302).** One normalised feed per store and market (title, description, price as shown with VAT, availability, GTIN/brand from custom
  fields, pictures, unit price), written as Google Merchant Center XML and the Meta, TikTok and Pinterest CSVs at a private, token-addressed URL.
- **I, pixels and attribution (D303).** Meta, Google, TikTok and Pinterest pixels as tracking tools (D58: only after `marketing` consent, from
  `ConsentManager`), their server-side conversion events sent only for orders whose cart had that consent, and UTM parameters kept on D152's visit.
- **J, accounts and incentives (D304).** Several saved addresses, search in My account's orders, the shopper's own data export from My account (the
  D162 export, signed in afresh); a form can give a single-use code once per address after confirmation, and tag its subscribers.

## 11. Unit J (D304): accounts in depth and sign-up incentives

What the code had before J (surveyed at HEAD): one address on `customers.address` (edited by `updateCustomerDetails()`, falling back to
`lastShippingAddress()` on My account); checkout does not prefill it for a signed-in customer (only the D293 terms path reads it);
`listCustomerOrders()` returns at most 200 orders, no paging, no search; the shopper's own export **already exists** (D162,
`account/privacy/export`, a fresh sign-in, `EXPORTS_PER_HOUR`), so the parity row's "data export" gap is stale and is closed by re-rating, not
by building; forms (D93) call `joinList()` on confirmation but give no code and set no tag; single-use codes (`generateCodes()`) are staff-only
and tied to no one; customer tags (`addTag()`) are keyed by address. J has three parts, each its own commit.

### 11.1 J1: saved addresses

- **Model.** `commerce.customer_addresses` (`id`, `store_id`, `customer_id`, `label` (the shopper's own word, optional), `address` jsonb in the
  shape orders keep, `country` (ISO, from the address), `is_default_shipping`, `is_default_billing`, `created_at`, `updated_at`), composite key
  with `store_id`, at most `ADDRESSES_MAX` (20) per customer, one default of each kind per customer (partial unique indexes). Written only by
  `src/server/customer-addresses.ts` (`saveAddress()`, `removeAddress()`, `setDefault()`), each checking the address belongs to the signed-in
  customer of that store (another's is `not_found`, never a different answer).
- **Moving in.** A migration copies every non-empty `customers.address` into a row marked default for both; `customers.address` stays (add, never
  drop) and is kept equal to the default shipping address by the writer, so code still reading it keeps working until a later cleanup.
  `updateCustomerDetails()` stops writing it directly and goes through `saveAddress()`.
- **My account.** An *Addresses* page (`/account/addresses`, a shop component `account_addresses`, `afterSale`): the list, add, edit, remove, make
  default. Homer sees his addresses and *Add an address*; labels and the billing default are one step away.
- **Checkout.** A signed-in customer's checkout offers the saved addresses (`Dropdown`, never a native select), the default shipping one chosen;
  the choice fills the same fields the shopper could type, so `placeOrder()` still reads what was sent and the order keeps its snapshot (an
  address edited later never changes an order). Only addresses in the market's country are offered for shipping (D237's rule); a *Save this
  address* tick on a new one writes it after the order is paid, never before. No zod in the pay route (the picker's list is plain data).
- **Personal data.** `PERSONAL_DATA` (export section `addresses`, erasure `delete`), `COPY_RULES` `never` (store copies carry customers without
  credentials; addresses go with the copied customer only if D129 copies `customers.address` today: follow it), the AI support tools read the
  default address only where they read `customers.address` now.
- **Tests.** One store cannot read or write another's address; one default of each kind; the migration's copy; checkout prefill and the order
  snapshot; erasure removes them; the export carries them.

**As built (J1, D304):** the Addresses page is a plain My account route (`/account/addresses`, server forms), not a shop component; new
addresses take the market's country (no country choice yet); checkout offers saved addresses where Kaizena Flow asks the address itself
(Mollie, gift cards paying it all, payment terms), since Stripe's hosted page asks its own; the *Save this address* tick after payment is not
built yet.

### 11.2 J2: finding an order in My account

- `listCustomerOrders()` gains keyset paging (`placed_at`, `id`; 20 a page) and a search `q` that matches the order number, a line's title or SKU
  and a tracking number, every `LIKE` word escaped and bound (D173's `escapeLike()`), within the customer's own orders only; a filter by state
  (`open`, `sent`, `delivered`, `returned`) from the order's own fields. The address carries `q`, `state` and the cursor (`parseAccountOrderParams()`,
  pure, unknown keys dropped). The support tool keeps its own call (first page, no search).
- Words in `m.account` (nb, sv, da, en by hand). Tests: paging without gaps or repeats, search scoped to the customer, a restricted order (D162)
  never found by another account.

**As built (J2, D304):** a page of its own, *Your orders* (`/account/orders`), with state chips as links (no form control to choose) and a
search box; My account shows the newest five. The search drops D173's email and name arms (the customer's own orders only).

### 11.3 J3: forms that give a code and tag their subscribers

- **The form's settings.** A newsletter block gains `incentive` (a discount of the store with `uniqueCodes`, chosen by id; kept through
  `ownProducts()`-style id checks: `keepOwnRuleIds()` drops another store's) and `tags` (up to 5 customer tags, `normaliseTag()`). Both are
  kept in the page, never sent to the browser (`publicForm()` leaves them out, like `recipients`), and dropped by `sanitizeTemplate()` and
  `withoutRecipients()` when a page is copied to another owner.
- **When a code is given.** Only when the address is confirmed (the link press that calls `joinList()`), never on the typed address; once per
  store, discount and address (`signup_incentives`: `store_id`, `discount_id`, `email_hash`, `code_item_id`, `given_at`; unique on the first three),
  so signing up again, from another form or after unsubscribing gives nothing new. The code is one new `discount_code_items` row made by
  `issueIncentiveCode()` in `discounts.ts` (the same generator and uniqueness as `generateCodes()`, under the discount's lock, batch
  `signup:{form}`), shown on the confirmation page and sent in the `marketing.welcome_code` email (a new `EMAIL_KINDS` entry, transactional: it
  is what the person asked for, and goes even with automations off). A discount that has ended, is used up or lost `uniqueCodes` gives no code,
  and the page says only that they are subscribed (never why not). The confirmation page never says whether the address had a code before.
- **Tags.** On the same confirmation, the form's tags are added with `addTag()` by the confirmed address (actor: none, audited as
  `marketing.form_tagged` with the form and count, never the address); unsubscribing removes no tag.
- **Popups.** A modal row holding the form (D121) needs nothing new; its report is a later unit (the parity row keeps that gap, said plainly).
- **Personal data.** `signup_incentives` in `PERSONAL_DATA` (by the address's hash; export section `marketing`, erasure `delete`), `COPY_RULES`
  `never`. Words: the confirmation and email in `m.news` and `email-text.ts`, hand-written, `HAND_WRITTEN_ONLY`.
- **Tests.** No code before confirmation; one code per address and discount across forms and repeats; a used-up discount gives none and says
  nothing more; tags land on the confirmed address; copying a page drops the incentive and tags; one store's form cannot name another's discount.

**As built (J3).** The settings are `NewsletterBlock.incentive` (a discount id) and `tags` (up to `SIGNUP_TAGS_MAX`, 5), checked by the
schema; another store's discount is refused where the code is made (`issueSignupCode()` reads the discount by the form's store), not on save.
`publicForm()`, `withoutRecipients()` and `sanitizeTemplate()` drop both. The table keeps the lower-case address (as `customer_tags` does) rather
than a hash, so export and erasure match it like the other marketing tables, with `form_id` and `created_at`; the code items of one discount's
sign-ups share one numeric batch. The code goes **by email only** (`form.welcome_code`, prefixed with the discount's own code, logged without
it through `secrets`), not on the confirmation page, which stays as it was. A code is given only by `confirmSignup()`, so a form with its email
confirmation switched off gives none (the builder's hint says so). Tags are `tagFromForm()` (no actor, one `marketing.form_tagged` audit entry with
the count). The builder offers the store's discounts with single-use codes (`signupCodeChoices()`, `PageOwnerContext.signupCodes`); Kaizena
Flow's own pages offer neither field. Tests: `src/server/signup-codes.int.test.ts`, the table's checks in `src/db/discount-codes.test.ts`.

### 11.4 Rows

J1 and J2 with the stale export gap close `customers.customer-accounts` except social sign-in (said in its gap; bucket B). J3 closes
`customers.signup-forms-and-popups-building-a-list` except the popup report. Each part re-rates its rows with a `history` entry and runs
`pnpm parity:write`.

## 12. Unit I (D303): ad pixels, conversion events and campaigns

What the code has before I (surveyed at HEAD, 24 October 2026):

- **Tracking tools (D58).** `stores.tracking` and `platform_settings.tracking` hold `ga4`, `gtm` and `metaPixel` ids (`TrackingSettings` in
  `cookie-consent.ts`, edited in `cookie-settings.tsx`). `ConsentManager` loads them only after consent (GA4 with Consent Mode v2 under
  `statistics`, Meta under `marketing`) and sends **page views only** (`gtag('config')`, `fbq('track','PageView')`, again on client navigation).
  No view-item, add-to-cart, checkout or purchase event; no Google Ads, TikTok or Pinterest tag; no server-side event.
- **Pay routes (D158).** `/cart`, `/checkout` and `/order` draw nothing from `OffPayRoutes` (so no `ConsentManager`) under `checkoutCsp()`. A
  purchase therefore **cannot** be sent from the browser on the order page, and must not be: the server sends it (12.3).
- **Visits (D152).** `/api/visit` keeps per store day a hashed visitor, device, `channel`, `source`, `campaign` (from `utm_*`, tidied), landing
  page and whether `gclid`/`fbclid`/`ttclid` were present (booleans only, never the value); a cart made that day is tied to its visit
  (`carts.visit_id`), so an order knows its channel. No cookie, no storage.
- **Marketing page (D152).** Channels with sessions, orders, revenue, conversion, spend, CAC, ROAS and profit ROAS; `marketing_spend` is typed by
  hand per day, channel and **campaign**. No per-campaign table, no UTM builder, no spend import, last-touch same-day only.
- **Consent records.** `commerce.consents` keeps each choice by a random visitor id (the consent cookie's); carts and orders know nothing of it.

I has three parts, each its own commit: **I1** events in the browser and the new tags, **I2** consent on the cart and server-side conversions,
**I3** campaigns and attribution.

### 12.1 Rules for I

1. **Consent first, always.** No tag loads and no event is sent, from the browser or the server, for a visitor who has not accepted the category
   the tool needs: `marketing` for Meta, Google Ads, TikTok and Pinterest, `statistics` for GA4 (and GTM by what it is set to carry, as today).
   Withdrawing consent stops the browser at once and stops server events for carts made after it.
2. **Kaizena Flow states the facts, the tool counts.** Events carry product ids (the variant's SKU, else its id), quantity, value and currency
   **as the shopper was charged** (the order's own currency, VAT included, as the platforms expect), never a margin, a cost or a guess.
3. **No personal data unless the owner chose it.** The default data level is *Standard*: no email, phone, name or address leaves Kaizena Flow.
   *Enhanced* (the owner's explicit choice, per store, with the words *Send hashed email and phone with purchases*) adds SHA-256 hashes of the
   normalised email and phone to server events only, never in the browser. Hashes are made in code at send time and never stored.
4. **Never for orders that are not sales**: copied (`C-…`), host, Stripe test-mode, draft-made-by-staff-without-a-visit, gift-card-only and
   `restricted_at` orders send nothing; an order sends its purchase once per platform (`event_id` = the order id, shared with any browser event
   so the platform deduplicates).
5. **Secrets are store settings** (D15): access tokens are encrypted with `SETTINGS_ENCRYPTION_KEY` (`secret-box.ts`), shown as hints, never sent
   to a page; every call to a platform goes through one module per platform with an injectable fetch, a fixed host list and a 5 s timeout.
6. **Data in the EU where we choose.** The platforms are the owner's own processors, named in the privacy starter (`legalFacts().trackingTools`
   lists every tool switched on, so the new ones are added there and in `TRACKING_TOOL_NAMES`).

### 12.2 I1: events in the browser and the new tags

- **Settings.** `TrackingSettings` gains `googleAds` (`AW-…`, with an optional `googleAdsPurchaseLabel`), `tiktokPixel` and `pinterestTag`
  (ids checked by shape in `cookie-consent-schema.ts`). Each is a `marketing` tool: `usedCategories()` adds `marketing`, `KNOWN_COOKIES` lists
  their cookies (`_gcl_*`, `_ttp`, `_pin_unauth`, `_epik`) with purpose and category, the cookie scan knows them, and `TRACKING_TOOL_NAMES` names
  them for the privacy starter. Kaizena Flow's own site keeps GA4, GTM and Meta only (no ads tags offered there).
- **Loading.** `ConsentManager` loads each by its official snippet, only from the tool's own host (added to no CSP: storefront pages have none;
  pay routes never load them). Google Ads shares the gtag loaded for GA4 (one `gtag.js`, `config` per id, Consent Mode v2's `ad_storage`,
  `ad_user_data` and `ad_personalization` granted only with `marketing`).
- **Events.** A small typed bus, `trackShop(event)` (`src/lib/shop-events.ts`, pure shape and mapping; the client part in `consent-manager.tsx`),
  that components call without knowing which tools exist: `view_item` (the product page, once per variant shown, from `VariantChoice`),
  `view_item_list` (a category, tag, products or search page's first page), `search` (the search page, the words only when longer than 2 and
  never containing a digit run of 6+, which could be a person's number), and `add_to_cart` (after the server accepted the add, with the quantity
  added and its price as shown). The bus drops events when no tool is loaded and queues none before consent. `mapEvent()` writes each tool's own
  name and shape (GA4 `items[]`, Meta `ViewContent`/`AddToCart`/`Search` with `content_ids`, TikTok `ViewContent`/`AddToCart`, Pinterest
  `pagevisit`/`addtocart`, the data layer's GA4 ecommerce object for GTM); a unit test holds every mapping.
- **Not in the browser:** `begin_checkout` and `purchase`, which happen on pay routes. They are sent by the server (12.3); the settings page says
  so in one line (*Checkout and purchases are sent from our server, so they are counted even with ad blockers*).
- **Tests.** Unit: mappings, the number filter on search words. E2E (`e2e/ad-events.spec.ts`, tools pointed at a stub host): nothing loads or is
  sent before consent; after `marketing` consent a product view and an add send one event each to every switched-on tool; a pay route loads none.

### 12.3 I2: consent on the cart and server-side conversions

- **Consent on the cart.** When the shopper's current choice includes `marketing`, the browser (from `ConsentManager`, never on a pay route)
  posts to `/api/ads/signals` the platforms' click and browser ids that the tags set or the landing address carried: Meta `fbp`/`fbc`, Google
  `gclid`/`gbraid`/`wbraid`, TikTok `ttclid`/`_ttp`, Pinterest `epik`, each checked by shape and length in `cleanAdSignals()` (`src/lib/ad-signals.ts`,
  no zod: it is imported near the cart). The route finds the store's open cart by its cookie (never another's), writes `carts.ad_consent_at` and
  `carts.ad_signals` (only those keys), and with `marketing` withdrawn clears both. A cart without `ad_consent_at` never sends anything.
  `placeOrder()` copies them to `orders.ad_consent_at`/`ad_signals` (set once, by trigger), so a later change of mind on another device does not
  rewrite an order.
- **Connections.** `commerce.ad_connections` (store, `platform` in `meta`, `ga4`, `tiktok`, `pinterest`; the platform's id (pixel id, GA4
  measurement id, TikTok pixel code, Pinterest ad account id), the encrypted token (Meta access token, GA4 Measurement Protocol API secret, TikTok
  access token, Pinterest conversion token) with its hint, `data_level` `standard`/`enhanced`, `test_code` for the platform's test events, `on`),
  written only by `src/server/ad-connections.ts` (owner-only, audited without the token), `settings` in `COPY_RULES` **without** the token
  (`duplicate_store()` blanks it). Google Ads conversions by API (OAuth and a developer token) are bucket B; Google Ads is measured through the
  gtag tag and GA4 linking, which the settings page says.
- **The queue.** `commerce.ad_conversions` (store, order, platform, `event` `begin_checkout` or `purchase`, `event_id`, status `pending`, `sent`,
  `skipped`, `failed`, tries, `next_at`, the platform's answer code; unique on order, platform and event): rows are made only by
  `queueAdConversions()` (when a checkout starts, `begin_checkout`; when an order becomes paid with a captured payment, `purchase`, from
  `applyPaymentAnswer()`'s paid path and the terms/manual paths through the same function), for each connection that is on, only when the order
  passes `conversionEligible()` (12.1 rule 4 and `ad_consent_at`). `sendAdConversions()` in the every-minute marketing job sends due rows through
  `src/server/ad-platforms/{meta,ga4,tiktok,pinterest}.ts` (request built by a pure `*Payload()` in `src/lib/ad-payloads.ts`, tested), three tries
  with backoff, then `failed` with the answer code shown to the owner. A payload holds the event id, time, the order's value and currency, the
  lines (SKU or id, quantity, unit price as charged), the click ids, the page address of the store's order page without its key, and only at
  *Enhanced* the hashes. The client's IP address and user agent are **not** sent (we never keep them); the settings page says this lowers match
  rates.
- **Refunds** send nothing in I (the platforms' refund events are optional); said in the as-built note.
- **Personal data.** `ad_signals` on carts and orders are personal data (pseudonymous ids): `PERSONAL_DATA` entries (export section `marketing`,
  erasure clears them and deletes the order's `ad_conversions`), cleared from orders 90 days after the purchase was sent (`pruneAdSignals()` in the
  daily job) and from carts with the cart. `ad_conversions` keeps no personal field. `EMAIL_KINDS` is untouched.
- **What the owner sees.** Marketing → *Ads and pixels* (`/admin/{store}/marketing/ads`, `marketing:write`, the token fields owner-only): per
  platform its browser tag id, its server connection, *Send a test event*, and the last 7 days' sent, skipped (by reason) and failed counts, never a
  person.
- **Tests.** Unit: payloads per platform (euro and NOK), eligibility, hashing normalisation. Integration (`ad-conversions.int.test.ts`, platforms
  stubbed): a consented cart's paid order sends one purchase per connected platform with the same event id; an order without consent, a copied,
  host or test-mode order sends nothing; a failure retries then fails; erasure clears signals; another store's cart cannot be written.

### 12.4 I3: campaigns and attribution

- **Campaign table.** Marketing gains *Campaigns*: rows by `source` and `campaign` from `visits` (only visits with a campaign), with sessions,
  orders and revenue through `carts.visit_id` (D152's `PAID`, without VAT, main currency, copied and host orders out), spend from
  `marketing_spend` where its campaign matches (case-insensitive, tidied as visits are), CAC and ROAS by `docs/analytics.md`'s definitions (the
  campaign rows are defined there first). A campaign with no spend shows *No spend entered*, never 0 ROAS. CSV `marketing.campaigns`.
- **UTM builder.** *Make a campaign link* on Marketing: a store page (the store's own addresses only, through `marketLink()`), source, medium (a
  choice that matches a channel rule), campaign name; it shows the link and the channel the visit will be sorted into (`classifyChannel()`), and
  copies it. Nothing is stored.
- **Spend import.** A CSV of day, channel, campaign, amount, currency (the platforms' exports mapped by a header choice) as a D165 job
  `spend_import`, through `csv.ts`, owner-only, adding to `marketing_spend` with a source note; a re-import of the same file adds nothing (rows
  keyed by day, channel, campaign and a file hash). Syncing spend from an ad platform is bucket B.
- **First touch, with consent only.** For a visitor who accepted `statistics`, `VisitBeacon` keeps the first channel, source and campaign of the
  last 30 days in `kaizen_touch_{storeId}` (first-party, a `statistics` entry in `KNOWN_COOKIES`, no id, only the three words and a date), sent
  with each visit; a cart made with it keeps `carts.first_touch` (copied to the order). Without consent nothing changes: same-day, no cookie,
  and D152's claims stay true. The Marketing page offers **Last visit** (default, as today) or **First visit in 30 days** for the period; the
  first-touch view counts only orders that have one and says how many orders it covers (*First visit known for 312 of 480 orders*), never filling
  the rest.
- **Tests.** Unit: campaign rows, the builder's links and channel. Integration: campaign revenue in a euro scenario, copied and host orders out,
  spend import idempotent. E2E: the touch cookie only after `statistics` consent.

**As built (I1).** As 12.2, with these differences: a Google Ads conversion label is not kept (with no purchase in the browser there is
nothing to attach it to; Google Ads purchases come from GA4 linking until I2's server events); `view_item` carries the product's title and no
variant name; the product page gives its variants' data only while the store has a tag (`shopTrack()`); `ConsentManager` replays this page
view's events that came before it listened (`takeRecentShopEvents()`, in memory, at most ten), so a product page's first view is heard on a
returning visitor's page load. Tests: `src/lib/shop-events.test.ts`, `e2e/ad-events.spec.ts`.

**As built (I2).** As 12.3, with these differences: events are queued by the every-minute job (`queueAdConversions()`) from the orders
themselves rather than at the checkout and payment paths, so they go within a minute; an order takes its cart's consent by trigger
(`orders_ad_consent()`) rather than in `placeOrder()`; GA4's Measurement Protocol is sent to its EU host with the order's id as the client id
(the visitor's `_ga` is never read); Pinterest has no checkout-started event, so it gets the purchase only; a platform with nothing to match an
event by (no click id and the standard level) is `skipped` with `nothing_to_match`. Staff with `marketing:read` see the page, only the owner
changes it. Tests: `src/lib/ad-payloads.test.ts`, `src/server/ad-conversions.int.test.ts`, the trigger in `src/db/discount-codes.test.ts`.

**As built (I3).** As 12.4, with these differences: the first visit is kept on the visit (`visits.first_channel`, `first_source`,
`first_campaign`, `first_day`) by its own endpoint (`/api/visit/touch`, `TouchKeeper`), not sent with each page view and not copied to carts,
because the visit beacon must stay cookie-free and the order already reaches its visit through `carts.visit_id`; the import is a form on the
page (`importSpend()`, any member with `analytics:write`, as typing spend is), not a D165 job, idempotent by the table's own key (day,
channel, campaign) with no file hash, and the platforms' own export layouts are not mapped (the four column names are asked for). No e2e for
the cookie yet: the consent gate is `TouchKeeper`'s first line and `siteCookies()` declares it.

### 12.5 Rows

I1 and I2 close `customers.ad-pixels-and-conversion-events` and `analytics.third-party-analytics-and-pixels-with-consent` except a purchase event
in the browser, which pay routes forbid by design (said in both gaps, with the server event as the measure); I3 closes
`customers.marketing-campaign-tracking-and-attribution` and moves `analytics.marketing-and-channel-attribution` to full except ad-platform spend
sync (bucket B). Each part re-rates its rows with a `history` entry and runs `pnpm parity:write`.

## 13. Unit H (D302): product feeds

What the code had before H (surveyed at HEAD): no feed route, no channel admin; variants carry `gtin` (8 to 14 digits), products a
manufacturer (D125's economic operator), and `productJsonLd()` already says what Google reads from a page (brand = manufacturer, else the
store). H is one normalised list written four ways, behind a secret address per store.

- **The item.** `feedItems(store, market)` (`src/server/feeds.ts`) reads the store's offered products through the catalogue's own cached
  reads (`listProducts()`, `getProduct()`; stock per request through `getVariantStock()`), one `FeedItem` per active variant: id (SKU, else
  the variant id), item group (the product id), title (with the variant's options), description (plain text), link (`marketUrl()` to the
  product), pictures (the variant's own first, then the product's, absolute), price **as the storefront shows it** (with VAT, in the market's
  currency through the same `PriceView`), the 30-day reference when it is a genuine reduction (then `price` is the reference and
  `sale_price` the price, Google's rule), the unit price's measure (D160: `unit_pricing_measure` and `unit_pricing_base_measure`), GTIN,
  brand (manufacturer, else the store's name), condition new, availability from stock (`in_stock`, `out_of_stock`, `backorder`), shipping (the
  market's flat rate and free-over amount from `getShippingFacts()`, for goods only) and the country.
- **What is left out, with why.** `feedProblems()` (pure, `src/lib/feeds.ts`) names each reason: not goods or a download (appointments,
  stays, rentals and gift cards are not catalogue ads), sold only by subscription, for businesses only, no picture, no price, a title or
  description too long for a channel (cut to the channel's limit instead, not refused). The admin lists every left-out product with its
  reasons.
- **The files.** `googleFeed()` (RSS 2.0 with the `g:` namespace, escaped, Google's required attributes), `metaFeed()`, `tiktokFeed()` and
  `pinterestFeed()` (CSV through `writeCsv()`; their own column names), each from the same items, unit-tested against each format's
  required columns. Amounts are written `123.45 NOK` from minor units in code.
- **The address.** `commerce.feed_settings` (one row per store: `token_hash`, the token encrypted with `SETTINGS_ENCRYPTION_KEY` so the owner
  can see the address again, `on`, timestamps), written only by `src/server/feed-settings.ts` (switch on, make a new address, switch off;
  `marketing:write`, audited without the token). `/api/feeds/{token}/{market}-{channel}.{xml|csv}` finds the store by the token's hash only,
  answers a 404 for anything else (an unknown token, a store that is not open, a template or demo store, the shop switched off, a market not
  offered), and is cached for 15 minutes (`s-maxage=900`), the stated refresh time; `takeBudget()` limits each token to 60 requests an hour.
- **The page.** Marketing → *Product feeds* (`/admin/{store}/feeds`): Homer sees a switch and, when on, one address per country and channel to
  copy; Lisa sees the products left out and why, and *Make a new address* (the old one stops at once). Live in a channel only once the owner
  connects their own Merchant Center, Meta Commerce Manager, TikTok or Pinterest account to the address (bucket B: no channel API is called).
- **Tests.** Unit: each writer's columns and escaping, `feedProblems()`, the sale price rule, the amounts. Integration: the feed's price equals
  `shown()` in a euro market, a left-out product is reported, the route answers only with the right token and a 404 otherwise.
- **Rows.** Closes `catalogue.product-feeds-to-google-and-other-channels` and `customers.social-channels-facebook-instagram-tiktok-pinterest`
  except syncing through each channel's API (bucket B), said in both gaps.

**As built (24 October 2026, D302).** As above. The Google feed's shipping is the market's flat rate (methods and carriers' prices are not in it); a product's brand is its manufacturer, else the store's name; custom labels are not mapped yet. Migrations `20261024144431_feed_settings`, `20261024144459_feed_settings_rules`.
