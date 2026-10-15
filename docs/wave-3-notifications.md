# Wave 3: customer notifications, delivery tracking and staff alerts (D238)

This file is the contract for the run `parity-wave` with `wave: 3`, `spec: docs/wave-3-notifications.md`. Code, tests and texts follow it; a disagreement is settled
here first (the agent that must deviate changes this file in the same edit, in a "3.x As built" paragraph, and says so in its report). It was written from the tracker
rows, `docs/parity-plan.md`, CLAUDE.md and the code as it is on 2026-10-14 (commit `737e0c6`, after D237), in the shape of `docs/returns.md` and the other wave 3 files.
It builds on what exists (`sendEmail()` and `email_messages`, `renderEmail()`, `emailText()`, `orderNotice()`, the senders in `shopper-emails.ts`, `return-emails.ts`,
`order-edit-emails.ts`, D41's event queue and triggers, `markSent()`, `markDelivered()`, `carrierTracking()` and the four carrier adapters, `changeOrderTags()`,
`sendLowStockNotices()`, `runReturnJobs()`, `periodTotals()`) and invents no second email pipeline, event system, tag writer or tracking client.

**What was found in the code that shapes everything below** (verified 2026-10-14):

- **One sending path.** Every email goes through `sendEmail()` (`src/server/email.ts`): kept in `email_messages` first, idempotent by `idempotency_key`
  (unique), sent through Resend with the kept row's id as Resend's idempotency key, held back for erased orders and for shoppers of a store template. That
  is where "once" comes from; this run adds no second store of emails.
- **The layout is fixed and plain**: `renderEmail()` (`src/lib/email-layout.ts`) draws heading, paragraph, button, lines, code and divider blocks, all text escaped,
  no pictures but line thumbnails, no logo and no store colour. The row's gap says "the store's logo and colours reach the layout": **they do not** (the layout has
  `#171717` buttons and no logo). This spec does not add them (section 7) and the gap text should be corrected (6.4).
- **Words** are `emailText(lang)` (`src/lib/email-text.ts`, nb, sv, da and en by hand, other languages from the AI catalogue through `registeredEmail()`), plus the
  hand-written sets `vatEmailText()` and `deliveryEmailText()` (D237). Subjects and intros are **functions** (`orderSubject(store, number)`), not templates.
- **Order emails are built in two shapes**: `sendOrderConfirmation()` builds its blocks inline (lines, VAT statement, bonus, company, address, delivery, gift,
  appointments, documents, the withdrawal block, subscription); every other order email goes through `orderNotice(storeId, orderId, kind, key, build, documents)`,
  whose `build` returns `{ subject, heading, intro, extra, attachments, withdraw }`. Returns use `returnMail()` in `return-emails.ts` in the same shape. **The three
  editable slots of this spec (subject, heading, body) are exactly the `subject`, `heading` and `intro` these builders already return**, so a template replaces
  three strings at one place per shape and never touches the blocks the law or the money needs (4.2).
- **Switches are per action**: the order page's send, refund and cancel forms have a `notify` checkbox (`orders/actions.ts`, the carrier actions, `runBulk()`,
  the AI tools' `notify`), and the confirmation is always sent. There is no per-event switch anywhere.
- **Email kinds are not all classified**: `EMAIL_KINDS` (`src/lib/personal-data.ts`) has `order.confirmation`, `order.changed`, `order.ready_for_pickup`,
  `order.out_for_delivery` and others, but **not** `order.sent`, `order.refunded`, `order.cancelled`, `return.approved`, `return.declined`, `return.received`,
  `return.refunded`, because those kinds are passed to `orderNotice()`/`returnMail()` as an argument and the scan in `personal-data.test.ts` only reads `kind:`
  literals. `emailClassOf()` therefore returns `null` for them (harmless today: a store template takes no orders). The notification catalogue of this run lists
  every kind it covers and the test holds the catalogue to `EMAIL_KINDS` (5.1).
- **Tracking exists for staff only**: `carrierTracking(storeId, carrier, number)` (`src/server/carrier-tracking.ts`) asks the carrier live on the staff order page
  (`CarrierStatus`, newest event only) through the adapters' `track()` (Bring, PostNord, Helthjem; Porterbuddy's `parseStatus()` gives one status). Events are
  `{ at, status, description, location? }` with the carrier's **own** status codes and times: Bring's `at` is built from `displayDate`/`displayTime` (local, no
  zone), PostNord's `eventTime` has no zone, Helthjem prefers `eventTimeUtc`. Nothing is stored, nothing is mapped to a common phase, and the shopper's pages show
  only the carrier, number and link (`shopperFulfilment()`).
- **Delivery is staff's**: `orders.delivered_at` is written by `markDelivered()` (noon of the staff's day, refused before the order's day, in the future, or while
  partly sent), by *Collected* and by the local driver's *Delivered* (D237), cleared by a later `markSent()` (event `order.delivery_reopened`) and by
  `undo_shipment()`. Nothing records **who** set it. The withdrawal window (`withdrawalWindow()`, D153) counts from it.
- **D237 already sends** *Ready for pickup* (`order.ready_for_pickup`, key `order-ready:{order}`) and *Out for delivery* for the store's own driver
  (`order.out_for_delivery`, key `order-out:{shipment}`, only for a `local` handover). Carrier parcels have no out-for-delivery or delivered email.
- **Events already queue in the database**: D41's triggers (`integration_order_events` on `orders`, skipping copied orders since the store-copy rules;
  `integration_shipment_events`, `integration_refund_events`, …) call `commerce.queue_integration_event()`, which inserts one `integration_deliveries` row per
  connected integration that asks for the event; `/api/cron/integrations` (every minute) delivers them. With no integration connected **nothing** is queued, so
  that queue cannot carry staff alerts; this run adds its own queue written by triggers in the same transaction as the payment (3.2), in the same pattern.
- **Staff emails today**: `stock.low` (one digest per store per run to the **owners**, `ownersOf()` in `stock-alerts.ts`), `return.overdue` (to the store's
  **contact address**, once per return, `sendRefundOverdueReminder()`), `booking.staff` (to the booked staff resource), `support.waiting` (to the desk's people),
  `form.message`. All English, all through `sendEmail()`, each with its own recipient rule. No new-order email exists.
- **Tags** are written only by `changeOrderTags(storeId, orderId, change, actor, { runner, audit })` (`src/server/order-tags.ts`, `SYSTEM_ACTOR` exists).
- **Five-minute work** runs from `/api/cron/cart-reminders` (`runReturnJobs()`, `sendLowStockNotices()`, …); **every-minute work** from `/api/cron/integrations`;
  daily work from `/api/cron/subscription-reminders` (`runRetention()` and the rest).
- **The admin can now be tested signed in** (D234: `e2e/signed-in/`, `E2E_SIGNED_IN=1`, an owner, a read-only member and a member who never acts). This run's
  admin screens get signed-in specs, not only view tests.
- **The order page `/order/{orderId}` is a pay route** (D158: `checkoutCsp()`, nothing from `OffPayRoutes`, entered by full page loads). The tracking shown there is
  server-rendered from stored rows, with no script, no map, no third-party picture and no carrier call in the request.

---

## 1. Purpose and scope

### 1.1 Rows this run closes, and what each can honestly reach

| Row | Weight | Now | Bucket | What this run can honestly reach |
|---|---|---|---|---|
| `orders.editable-notification-email-templates` | 3 | missing | A | **Full** by its criteria: per language subject, heading and one text block of every order email in the catalogue, named placeholders only, a preview with a sample order and a test send to oneself, the claims filter and the placeholder check before saving, the fixed text as the fallback per language, a switch per event with the legally required ones locked on (also in the database), the order's language and currency kept, and edits copied with a store only when the owner ticks *Email texts*. Held by unit, render, PGlite, integration and signed-in e2e tests. It does **not** edit HTML, the layout, a logo or colours (Shopify does: section 7); the criteria do not ask for them and the skeptic should not hold the row for it. |
| `orders.delivery-status-notifications-tracking-page` | 3 | partial | A | **Full for parcels with Posten / Bring**, by its criteria, held by unit tests of the mapping and integration tests with a faked carrier: the shopper's order pages show each parcel's events and phase, and say plainly when the carrier has none; Bring's delivered event records `delivered_at` once (never before the order, never over a date staff gave, never while partly sent) and starts D153's 14 days; out-for-delivery and delivered emails once per parcel, only when switched on, in the order's language; a carrier that does not answer leaves the link and no error. **PostNord, Helthjem and Porterbuddy** events are shown, but their codes could not be read from their documentation (1.2), so their mapping is marked unverified and **an unverified code never records a delivery or sends an email** (4.4). The lead may hold the row at partial until one real Bring parcel has been followed in production (9.6); the honest claim is "Full for Bring, events shown for the others". |
| `orders.staff-alerts-for-new-orders-order-automation` | 3 | partial | A | **Full** by its criteria: one email per paid order to the recipients the owner chose (by default the owners), with number, total and link, never twice for a retried webhook; recipients per event (new order, return requested, refund overdue, low stock) and a daily or weekly summary; rules *when an order is paid and {conditions} then tag, notify or hold*, run once per event and logged; nothing in a staff email names a shopper's phone or address. Push to a mobile app and a general workflow builder (Shopify Flow) are not built (section 7: decision 6 of the plan, and wave 9). |

No row is bucket B, C or D. Nothing needs a third party's approval or a credential that does not exist (the carriers' tracking runs on the agreements the
stores already saved, D133 to D138; Resend is set up), and no decision of `docs/parity-plan.md` section 5 is needed to build this run (decision 6, *mobile admin*,
only concerns push, which is not a criterion), so **`blockers` is empty**. Weights are not changed (tracker rule 6).

Rows this run touches but does not close: `orders.local-pickup-at-own-location` and `orders.local-delivery` (their emails become editable and switchable; ratings
unchanged), `orders.self-serve-withdrawal-and-return-requests` (the return emails become editable within 4.2; the acknowledgement is locked), the D216 support
desk (`support.waiting` keeps its own recipients).

### 1.2 What Shopify does, and what the carriers document (pages read on 2026-10-14)

- **Editing a template** (https://help.shopify.com/en/manual/orders/notifications/edit-template): "Edit the Email subject and Email body (HTML)"; Liquid
  variables and conditionals in the body; preview in the admin or "Send test email" to "the account that you used to log in"; "Revert to" Default or Previous;
  "Reverting replaces only the template's content, so your logo and color changes stay in place"; templates have no separate version per language: the language
  "depends on your theme's language and any edits that you've made to the templates", translations are edited elsewhere.
- **Customer notifications** (https://help.shopify.com/en/manual/fulfillment/setup/notifications/customer-notifications): "Most customer notifications are sent
  automatically and can't be deactivated." Order canceled, refund, shipping confirmation and shipping update are deselected per action (when cancelling, refunding,
  fulfilling or editing tracking). "Out for delivery and Delivered" are switched off under Settings > Notifications and are "sent when a tracking event with the
  corresponding status is received from the carrier or fulfillment app"; "Tracking event sources, accuracy, and timing vary by carrier"; "These notifications
  aren't available for local delivery orders."
- **Staff notifications** (https://help.shopify.com/en/manual/fulfillment/setup/notifications/staff-notifications): Store order summary, New order, New return
  request, Sales attribution ended, New draft order, Order dispute updates. "Account owners receive notifications on all new orders by default"; a recipient is a
  staff member or a plain email address; per POS location a separate notification; the summary covers "store orders, sales, and top products for the week",
  weekly on Monday 9 AM by default, or daily, and "Recipients get it regardless of their order or location permissions".
- **Order status page** (the row's URL, read 2026-10-03): a section per shipment with Confirmed, On its way, Out for delivery, Delivered, Attempted delivery, and a
  map for integrated carriers.
- **Posten / Bring Tracking API** (https://developer.bring.com/api/tracking/, read 2026-10-14, the first 100,000 characters): event `status` values
  `ATTEMPTED_DELIVERY`, `CUSTOMS`, `COLLECTED`, `DELIVERED`, `DELIVERED_SENDER`, `DELIVERY_CANCELLED`, `DELIVERY_CHANGED`, `DELIVERY_ORDERED`, `DEVIATION`,
  `HANDED_IN`, `INTERNATIONAL`, `IN_TRANSIT`, `NOTIFICATION_SENT`, `PRE_NOTIFIED`, `READY_FOR_PICKUP`, `RETURN`, `TRANSPORT_TO_RECIPIENT`, `TERMINAL`, `UNKNOWN`
  (`ARRIVED_COLLECTION` and `ARRIVED_DELIVERY` removed in June 2022); an event has `dateIso`, `displayDate` (required) and `displayTime`; `lang` is `en`, `no`,
  `sv` or `da`. **Verified** for the mapping (4.4).
- **PostNord** Track and Trace v5: the developer portal's code list could not be read (a search found no public list). The repo's test fixture uses `EN_ROUTE` and
  `DELIVERED`. **Unverified.**
- **Helthjem** tracking (`eventType.apiKey`): no public documentation found (a search returned aggregator pages only). The fixture uses `001`. **Unverified.**
- **Porterbuddy** order status (`orderStatus`): the fixture uses `ready`; the status list was not read. **Unverified.**

What Kaizen matches: editable subject and wording per notification (as words with placeholders, not HTML), preview and test email, revert to the fixed text,
per-event switches with the confirmation always on, out-for-delivery and delivered emails from carrier events and off by default, a section per parcel with its
events on the order page, a new-order email to the owners by default, chosen staff recipients, a daily or weekly summary, simple rules.
**Where Kaizen goes further on purpose**: templates per language (Shopify keeps one), the claims filter on owner text (D76's rule for words that reach
shoppers), a database-enforced lock on the legally required emails, delivery recorded from the carrier for the right of withdrawal (D153) only on a verified
code and never over staff's date, and staff emails without the shopper's phone, address or email.
**What it deliberately does not match**: section 7.

### 1.3 Terms used in this file

- **Notification**: one kind of email a store sends about an order or a return on an event, listed in `NOTIFICATIONS` (`src/lib/notifications.ts`), with an id equal to
  its email kind (`order.sent`). **Required**: a notification the law (or this spec, 4.1) needs sent; it has no switch and the database refuses to store it off.
  **Locked**: required and not editable either (the withdrawal acknowledgement).
- **Template**: a store's own subject, heading and body for one notification in one language (`email_templates`). **Slot**: one of the three. **Fixed text**: what
  `emailText()` (or `deliveryEmailText()`) gives for the slot when the store has no template in that language.
- **Placeholder**: `{name}` in a slot, from the notification's own list (4.2). **Sample order**: the made-up order the preview and the test email use.
- **Action email**: an email staff send by pressing a button (a draft's pay link, a change's pay link, *Send again*, a test email); not a notification, never switched.
- **Tracked parcel**: a `shipments` row of method `parcel`, not undone, with a tracking number, whose carrier `trackedCarrier()` recognises and whose store has
  that carrier's agreement saved and active. **Phase**: Kaizen's own word for where a parcel is (`TRACKING_PHASES`, 4.4). **Verified code**: a carrier status
  code whose meaning was read in the carrier's documentation and is marked `verified: true` in the mapping.
- **Store event**: a row of `store_events` (3.2): something that happened to an order or a return that staff alerts and rules react to, once.
- **Alert event**: one of `STAFF_ALERT_EVENTS`: `new_order`, `return_requested`, `refund_overdue`, `low_stock`, `summary`, `automation`.
- **Rule**: a store's `when an order is paid and {conditions} then {actions}` (`order_rules`). **Run**: one rule's evaluation for one store event (`order_rule_runs`).
- **Hold**: an order's fulfilment hold (`orders.held_at`): nothing of it can be sent or handed over until staff release it.

### 1.4 Decisions this spec makes (the lead may veto any before the build; each is argued where it is used)

1. **Templates are words, not HTML.** An owner edits the subject, the heading and one text block (the intro) of a notification per language, with named placeholders;
   everything else in the email (lines, totals, VAT statements, documents, the withdrawal block, tracking, pickup details, addresses, links) stays the code's. The
   law's sentences cannot be removed by an edit, the layout stays one that works in every mail app, and no owner text is ever HTML (4.2).
2. **A missing template falls back per slot and per language** to the fixed text of the order's language, never to another language's template (4.2).
3. **Required notifications** are the order confirmation, the renewal confirmation, the order change confirmation, the withdrawal acknowledgement, and the return
   approved and declined emails. The acknowledgement is also **locked** (evidence, D153). Everything else in the catalogue has a switch (4.1).
4. **Switches decide automatic sending and the default of the action's *Notify* box**; an explicit *Send again* or a test email by staff is always sent (Shopify:
   per action).
5. **Carrier events are polled and stored** (`shipment_tracking`), never fetched while a shopper's page renders; the shopper reads the stored events (4.5).
6. **Only a verified *delivered* code records `delivered_at`**, through one SQL function under the order's lock, only when the order is sent in full, every standing
   parcel is delivered by the carrier, and staff have not given a date; it never overwrites a date (4.6).
7. **Out-for-delivery and delivered emails are off by default** and go once per parcel (Shopify: the owner switches them off; here they start off, because the
   carriers send their own messages in the Nordic countries and the first email a store's customers get from a carrier event should be the owner's choice).
8. **Staff alerts read their own queue** (`store_events`), written by triggers in the paying transaction, consumed every minute; the new-order email's key is per
   order and recipient, so a retried webhook, a replayed session or a second run sends nothing more (4.7).
9. **Recipients are members of the store, or the store's contact address**; never another address (section 7: an arbitrary address would let a member send the
   store's orders anywhere). Each event needs the recipient's role to read what the email shows, checked at sending (4.7).
10. **Staff emails carry no shopper's name, email, phone or address**, only the order's number, total, lines, delivery method and country, and a link (4.8).
11. **Rules are a closed list** of conditions and three actions; facts are read once per event before any rule runs, so rules do not chain; *hold* is a fulfilment
    hold the database enforces (4.9).
12. **English for staff**, as every staff email and the admin are.

---

## 2. Behaviour

### 2.1 Staff side: customer notifications (`/admin/{store}/settings/notifications`)

A page in Settings (`settings:read` to see, `settings:write` to change; *Part of the online shop*: hidden while `shop` is off, `requireFeature(member, "shop")`).

1. **The list**: every notification of `NOTIFICATIONS` in groups *Orders* (confirmation, renewal, change, sent, out for delivery, delivered, refunded, cancelled),
   *Pickup and local delivery* (ready for pickup, out for delivery with the store's driver; shown only when the store has a pickup option or a local area, else
   with a note) and *Returns* (acknowledgement, approved, declined, received, refunded). Each row: name, one line on when it is sent, a status chip (*On*, *Off*,
   *Always on* for required, *Fixed* for locked), and for each of the store's languages whether it has the store's own text (*Your text* or *Standard text*).
   A switch per switchable row, saved at once (an `ActionForm` per row; refused with the reason for a required one). The page says, in a sentence, that the
   withdrawal acknowledgement and the order confirmation are required by law and cannot be switched off, and that switching an email off also unticks *Notify the
   customer* where staff send, refund or cancel.
2. **The editor** (`/admin/{store}/settings/notifications/{id}`, `id` the notification's kind with `.` as `-`: `order-sent`): a language picker of the store's
   languages (`store.localization.locales`; a language kept but no longer offered shows its saved text read-only with *Delete*), and for the chosen language three
   fields: **Subject**, **Heading**, **Text** (multi-line). Each field shows the fixed text of that language, filled with the sample order, as its placeholder, so an
   empty field visibly means "standard text". Beside the fields, the notification's placeholders as chips with what each becomes (a press puts it at the cursor).
   A note under the text: *This is a message about an order. Do not add offers or advertising: an email that promotes is marketing and needs the customer's
   consent.* (4.3).
3. **Preview**: a panel that renders the email as `renderEmail()` would send it, in the chosen language, with the sample order, the store's real name and footer, and
   the fixed parts drawn as they would be (the sample's lines and totals, and stand-ins for parts that need a real order: *Your invoice will be linked here*, the
   withdrawal block with the sample's dates). It updates on a press of *Preview* (a server action, `settings:read`), not on every key. Problems are listed above it
   with the field they belong to (4.2): an unknown placeholder, a stray brace, a web address, a slot too long, a claim (`findClaims()`, with the phrase and its
   label). *Save* is refused while there is a problem.
4. **Send a test**: sends the previewed email (the draft as typed, or the saved text) to the signed-in person's own account address, kind `notification.test`,
   subject prefixed *[Test]*, at most 10 per person per hour (refused with the time it opens again). Needs `settings:write`.
5. **Save** writes the language's template (only the slots filled; all three empty deletes it). **Use standard text** deletes the language's template after a
   confirmation. Both audited (`notification.template_saved`, `notification.template_reset`: the notification, the language, which slots, never the words).
   Saving refreshes nothing cached: emails read templates fresh (4.2).
6. **What is not editable** is said on the editor in one line per notification: *The order lines, totals, VAT statement, invoice link and the right of withdrawal are
   always added by Kaizen.* The acknowledgement's editor shows only the preview and says *This email is the legal acknowledgement of a withdrawal and cannot be
   changed.*

### 2.2 Staff side: the switches where staff act

- Send (`markSent` forms, carrier bookings, bulk *Mark as sent*), refund and cancel forms keep their *Notify the customer* box. Its default is the notification's
  switch; while the notification is off the box is unticked and disabled with *Switched off in Notifications* (a link), and the server ignores a `notify` sent anyway
  (`notificationOn()` is asked by the sender, 4.1). The AI manager's tools with `notify` do the same.
- *Send again* on the order page (confirmation, a parcel's shipped email) sends whatever the switch says: it is an action email (1.3).

### 2.3 Staff side: delivery tracking on the order page

- Each tracked parcel shows its **phase** chip and its latest events (time in the store's time zone, the carrier's description, the place), read from
  `shipment_tracking` (not live any more; the live `CarrierStatus` call is replaced), with *Last checked {time}* and **Check now** (`orders:read`; at most once a
  minute per parcel; runs the same poll for that parcel and shows the result). A parcel the carrier reported as `returned_to_sender` or `problem` shows a warning
  chip; a delivery the carrier recorded shows *Delivered (from {carrier}, {date})* beside the receipt, a delivery staff recorded *Delivered (marked by staff)*.
- *Mark delivered* keeps working as before and wins over the carrier: a staff date is never overwritten by a carrier event, and staff may correct a carrier's date.
- A parcel whose carrier is not connected shows its link only and the sentence *Kaizen follows parcels from carriers you connect under Shipping.*

### 2.4 Staff side: staff alerts (`/admin/{store}/settings/notifications/staff`, owner only)

`requireOwnerRole()`; everyone else gets the 404 (D158). The page:

1. **Recipients**: a table of the store's members (active, not expired) and the store's contact address (when set), with a column per alert event: *New order*,
   *Return requested*, *Refund overdue*, *Low stock*, *Summary*, *Automation*. A box is offered only where the member's role may read what the email shows (4.7);
   otherwise the cell says *Needs {area} access*. Until the owner saves this page once, the defaults hold and the page says so: owners get new order, return
   requested and low stock; refund overdue goes to the contact address (to the owners when there is none); nobody gets the summary or automation emails.
2. **Summary**: *Off* (default), *Daily* or *Weekly*, with the day of the week (Monday default) and the hour (8 default) in the store's time zone.
3. **Send a test** per event to the owner's own address (`staff.test`, 10 per hour).
4. Saving writes the whole page at once and is audited (`notification.staff_saved`: counts of recipients per event, never addresses).

### 2.5 Staff side: automation rules (`/admin/{store}/settings/automation`)

`settings:read` to see the rules and the log; `settings:write` to change them.

1. **List**: the store's rules in order (drag or Move up/down), each with name, an *On* switch, a sentence written by code from the rule (*When an order is paid and the
   total is at least 2 000 kr and the country is Sweden, tag "Big order" and hold it*), and its last run.
2. **Editor**: name; match *all* or *any* of the conditions; up to 10 conditions from the closed list (4.9), each with the inputs it needs (an amount in the store's
   main currency, countries from the store's markets, products from the store's catalogue, …); up to 5 actions: *Add tag* (a tag, `normaliseTag()`), *Notify staff*
   (a note of at most 200 characters, to the recipients of *Automation*), *Hold fulfilment* (a reason of at most 200 characters). At most 50 rules a store.
3. **Log** (`/admin/{store}/settings/automation/log`): the runs of the last 12 months, newest first, filterable by rule and by matched/not matched: time, order number
   (a link), rule, whether it matched, what each action did or why it could not (`not_found`, `limit`, `no_rate`, …).
4. Saving, switching, ordering and deleting a rule are audited (`automation.rule_saved`, `.rule_switched`, `.rules_ordered`, `.rule_deleted`). A rule is deleted for good
   (its runs keep its name in `rule_name`).

### 2.6 Staff side: holds

- An order on hold shows a banner on its page: *On hold: {reason}* (*by the rule {name}* or *by {person}*), with **Release** (`orders:write`), and staff can put an
  order on hold themselves (**Hold**, with a reason). The Orders list gains the filter value `held` (*On hold*) through `parseOrderListParams()`/`orderListWhere()`
  (the one place, D173). *To send* still lists a held order, with the chip.
- While held: *Mark as sent*, the carrier bookings, *Ready for pickup*, *Collected*, *Out for delivery* and bulk *Mark as sent* refuse it (`held`, *This order is on hold:
  release it first.*). Refunds, cancelling, editing, notes, tags and emails are not affected.

### 2.7 Shopper side

- **The order pages** (`/order/{orderId}`, a pay route, and `/account/orders/{orderId}`) draw, for each parcel of `shopperFulfilment()`, a **tracking piece**
  (`ParcelTracking`): the phase as a short line in the order's language (*On its way*, *Out for delivery*, *Ready to collect at {place}*, *Delivery attempted*,
  *Delivered {date}*, *On its way back to us*, *Something has happened to this parcel: contact us*), and below it up to 10 of the carrier's events, newest first
  (date and time in the store's time zone, the carrier's own description as it gave it, the place), with the carrier's link. A tracked parcel with no events says
  *{carrier} has no news about this parcel yet.*; a parcel of a carrier Kaizen does not follow shows only the link (*Follow the parcel at {carrier}*), as today; a
  parcel whose last check failed shows what was last stored, never an error. No script, no map, no picture from the carrier: plain server-rendered text, so the pay
  route's policy is untouched.
- **Emails** (both off until the owner switches them on, 2.1): *Out for delivery* (`order.parcel_out_for_delivery`, key `parcel-out:{shipment}`) when a parcel first
  reaches the phase `out_for_delivery` by a verified code; *Delivered* (`order.parcel_delivered`, key `parcel-delivered:{shipment}`) when it first reaches
  `delivered` by a verified code. Each lists the parcel's lines (as the shipped email does), the carrier and link, and *See your order*; neither says anything about
  the right of withdrawal or a date it ends (section 8). A parcel that becomes `delivered` without ever being seen `out_for_delivery` gets only the delivered email. A
  parcel already delivered when the poll first sees it (first check more than 24 hours after the event) gets no email at all (the news is stale).
- **The customer's edits never reach the shopper as HTML**: every slot is text escaped by `renderEmail()`.

### 2.8 Emails, all of them

| Kind | To | When | Key | Switch |
|---|---|---|---|---|
| `order.confirmation`, `subscription.renewed`, `order.changed` | buyer | as today | as today | required |
| `order.sent`, `order.refunded`, `order.cancelled`, `order.ready_for_pickup`, `order.out_for_delivery` | buyer | as today | as today | on by default |
| `order.parcel_out_for_delivery` (new) | buyer | first verified out-for-delivery event of a parcel | `parcel-out:{shipment}` | off by default |
| `order.parcel_delivered` (new) | buyer | first verified delivered event of a parcel | `parcel-delivered:{shipment}` | off by default |
| `return.acknowledgement` | buyer | as today | as today | locked |
| `return.approved`, `return.declined` | buyer | as today | as today | required |
| `return.received`, `return.refunded` | buyer | as today | as today | on by default |
| `notification.test` (new, staff class) | the signed-in person | *Send a test* | random | none |
| `staff.new_order` (new) | recipients of `new_order` | the order's `order.paid` store event | `staff-order:{order}:{recipient}` | the page |
| `staff.return_requested` (new) | recipients of `return_requested` | a return the shopper made | `staff-return:{return}:{recipient}` | the page |
| `return.overdue` | recipients of `refund_overdue` | as today | `return.{id}.overdue` (+ `:{recipient}` for every recipient but the contact address, so today's key still stops a repeat) | the page |
| `stock.low` | recipients of `low_stock` | as today | `{lowStockKey}:{recipient}` (as today for owners) | the page |
| `staff.summary` (new) | recipients of `summary` | the period's hour | `staff-summary:{store}:{period}:{recipient}` | the page |
| `automation.notify` (new) | recipients of `automation` | a rule's *Notify* action | `rule-notify:{run}:{recipient}` | the rule |
| `staff.test` (new) | the owner | *Send a test* | random | none |

`{recipient}` is the account id, or `contact` for the store's contact address. Every new kind is added to `EMAIL_KINDS` (shopper or staff) in the same change.

**The staff new-order email**: subject *New order {number}: {total}*; heading *New order*; lines: each line's quantity and title (at most 20, then *and {n} more*), the
total charged in the order's currency (`formatMoney()`, with *excl. VAT* never added: it is the charged amount; for an appointment paid at the venue or by a
deposit, D66, the rows are *Order total*, *Charged now* (total less `balance_minor`) and *Due at the venue*, so the email never says more was charged than was), the delivery method's name (`order.delivery?.label ?? m.shipping`
in English), the delivery country's name, *Business buyer* when it is one, *Host's listing* for a host order, *Gift* when it is one, *On hold by a rule* when a rule
held it before the email was built (rules run first, 4.7); the button *Open the order* to `/admin/{store}/orders/{id}`. No name, email, phone, address, gift message,
note or company name of the buyer.

**The return-requested email**: return number, order number, the lines and quantities, *Withdrawal* or *Return*, the button *Open the return*. No reason note.

**The summary**: the period (yesterday, or the last seven store days ending yesterday), paid orders and net sales in the store's main currency without VAT
(`periodTotals()`, D152's definitions; a currency without a rate is said: *{n} orders in {currency} are not included: no exchange rate*), refunds, returns
requested, open returns, orders to send, variants at or below their level now, conversations waiting in support (when the desk is on), each figure with a link.
Nothing per customer. Sent at the chosen hour in the store's time zone by the five-minute job (4.7); a store with no paid order and nothing open still gets it
(*No orders yesterday*), so the owner knows it works.

### 2.9 Platform side

- Platform admins see the new emails in the existing email log (`listEmails()`), as today. They never see or edit a store's templates, recipients or rules
  (a store's settings, D158).
- `/admin/platform/plans/features` gains the plan-feature rows of 5.6 (a migration seeds them, granted to every plan; D132 describes, it enables nothing).
- Kaizen's own emails (sign-up, approval, billing) are not in the catalogue and are not editable (section 7).

### 2.10 Copied orders, host orders, other kinds, other currencies, other languages, privacy, closed stores

- **Copied orders** (D129): never a store event (the triggers skip `copied_from is not null`), never a rule run, never tracked (their shipments, if copied, are
  never polled: the tracking query filters copied orders), never emailed (`orderNotice()` and `sendOrderConfirmation()` already return null; the new senders do the
  same), never held. A copied order's `delivered_at` is never written by a carrier.
- **Host orders** (D71): a store event like any order (the store lists the host's stay or rental); the staff email says *Host's listing: {host's display name}*. Hosts
  themselves get no staff alert (section 7). Stays and rentals have no parcel and no tracking.
- **Bookings, downloads, subscriptions, weekly boxes**: a booking-only or download-only order has no parcel and no tracking; a subscription renewal is a new order
  and alerts staff (its email says *Subscription renewal*); a weekly box's delivery order (`standing_deliveries`) is charged when staff mark it sent and is **not** a
  new-order alert (staff just acted on it) but rules still run on it. Drafts paid by the buyer (`source = 'draft'`) alert as any order.
- **Pickup and local orders** (D237): no carrier, no tracking; their handovers keep their own emails, now switchable and editable.
- **Other currencies** (D109): every money value in a template's placeholders and in staff emails is the order's own amount in the order's currency,
  `formatMoney(minor, order.currency, market.locale)`, never converted; the summary converts to the store's main currency by D152's `inMain()`, counting what has
  no rate; a rule's amount is compared in the store's main currency at the store's current rates (`toMain()`), and an order whose currency has no rate never
  matches an amount condition (logged `no_rate`). Each of these is a euro scenario (6.4).
- **Other languages**: a template exists per language; an order in a language with no template uses the fixed text of that language (an AI-catalogue language
  included); a store that stops offering a language keeps its templates (read-only in the editor, used for orders already in that language). Staff emails are
  English.
- **Privacy** (D162): `store_events`, `order_rule_runs` and `shipment_tracking` link to orders; the register entries are 3.6. Carrier descriptions can hold a name
  ("signed by …"): the stored events are free text, exported with the parcel, cleared when the order is anonymised (`anonymise_order()` sets them to `[]`; no
  delete), and cleared 90 days after the parcel's tracking stopped. Staff emails hold no shopper's personal field (4.8). Templates are the owner's words.
- **Closed or suspended stores, website mode, store templates** (D171, D178, D175): no polling, no store events processed, no alerts and no summaries for a store
  that is not open (`commerce.store_is_active()`), and none while `shop` is off; a store template never emails shoppers (`sendEmail()` already holds them back) and
  takes no orders. Templates, switches and rules are kept and work again when the store reopens.

### 2.11 Failure behaviour

- **A template that cannot be read** (database error) gives way to the fixed text; the email is sent. A template that is invalid when read (a placeholder removed
  from the catalogue later) gives way to the fixed text per slot and is shown with a warning in the editor.
- **A switch that cannot be read** counts as **on** (an email too many is better than a confirmation never sent; the required ones are always on anyway).
- **A carrier that fails** (timeout of 4 s, an error, a 4xx, a parse failure): the parcel keeps its stored events, `failures` is counted, the next check backs off
  (4.5); after 20 failures in a row the parcel stops being polled (`stopped = 'carrier_failing'`) and staff see *Kaizen could not reach {carrier} for this parcel*
  with *Check now*. The shopper sees the last stored events and the link, never an error.
- **An email that fails** for a tracking event is retried by the next poll that sees the phase (the key stops a second success); a failed staff alert stays in the
  queue with `attempts` and `next_attempt_at` (1, 5, 15, 60 minutes, then every 6 hours, at most 10 tries, then `failed` and shown on the store's Home as *Staff
  alerts could not be sent*).
- **A rule's action that fails** is recorded in the run (`ok: false`, the reason) and does not stop the other actions or rules; the run is not retried (it ran once).
- **The queue consumer crashes mid-way**: each event's work is in its own transaction with `for update skip locked` and the idempotency keys; a run that died is
  claimed again after its lease (5 minutes) and the keys and the runs' unique key stop anything twice.

---

## 3. Data

All new tables are in `commerce`, with `store_id` and composite keys like the rest, row-level security on and no policies, and indexes on every foreign key
(the performance advisor).

### 3.1 Columns added to existing tables

- `orders.delivered_source text`: who set `delivered_at`: `staff` (*Mark delivered*), `handover` (*Collected*, the local driver's *Delivered*), `carrier`.
  Check: `(delivered_at is null) = (delivered_source is null)` for rows written after the migration (the check is `delivered_source is null or delivered_at is not
  null`; rows before it keep a null source with a date, read as `staff`). Every writer of `delivered_at` sets it: `markDelivered()` `staff`, `pickup.ts` and
  `markDelivered()`'s local branch `handover`, `commerce.record_carrier_delivery()` `carrier`; `markSent()`'s reopening and `undo_shipment()` clear both.
- `orders.held_at timestamptz`, `orders.held_reason text` (≤ 200), `orders.held_by_rule uuid` (the rule, no foreign key: a deleted rule leaves its id),
  `orders.held_by uuid references accounts` (a person). Check: reason and by-fields only with `held_at`; never both `held_by_rule` and `held_by`.
- `shipments`: nothing (tracking lives in its own table, 3.2).

### 3.2 New tables

| Table | Columns (beyond `store_id`, `created_at`, `updated_at`) | Keys and checks |
|---|---|---|
| `notification_settings` | `notification text`, `enabled boolean`, `updated_by uuid → accounts` | PK `(store_id, notification)`; `notification` in the catalogue's ids (a check listing them); **`notification_settings_required`: `enabled or notification not in (the required ids)`** |
| `email_templates` | `notification text`, `locale text` (a language code, `^[a-z]{2,3}$`), `subject text`, `heading text`, `body text`, `updated_by uuid → accounts` | PK `(store_id, notification, locale)`; `notification` in the editable ids (the catalogue's minus the locked); `subject` ≤ 150, `heading` ≤ 120, `body` ≤ 2000 characters; at least one slot not null; no slot an empty string |
| `staff_alert_settings` | `configured_at timestamptz` (null: the defaults hold), `summary text default 'off'`, `summary_weekday smallint default 1`, `summary_hour smallint default 8`, `summary_last_period text`, `contact_events text[] default '{}'`, `updated_by uuid → accounts` | PK `store_id`; `summary in ('off','daily','weekly')`; weekday 1–7, hour 0–23; `contact_events <@ STAFF_ALERT_EVENTS` |
| `staff_alert_recipients` | `account_id uuid → accounts`, `events text[]` | PK `(store_id, account_id)`; `events <@ STAFF_ALERT_EVENTS`, not empty (a member with none has no row) |
| `store_events` | `id uuid`, `event text`, `subject_id uuid`, `occurred_at`, `alerts_done_at`, `rules_done_at`, `attempts int`, `next_attempt_at`, `lease_until`, `last_error text` (≤ 500), `failed_at` | PK `id`; **unique `(store_id, event, subject_id)`** (once per event); `event in ('order.paid', 'return.requested')`; index on `(next_attempt_at) where alerts_done_at is null or rules_done_at is null` |
| `order_rules` | `id uuid`, `name text` (1–80), `event text default 'order.paid'`, `match text default 'all'`, `conditions jsonb`, `actions jsonb`, `enabled boolean default true`, `position int`, `version int default 1`, `created_by`, `updated_by` | PK `id`, unique `(store_id, id)`; `event = 'order.paid'`; `match in ('all','any')`; `jsonb_array_length(conditions) between 0 and 10`, `actions` between 1 and 5; at most 50 per store (a trigger, `order_rules_limit`) |
| `order_rule_runs` | `id uuid`, `rule_id uuid` (no foreign key: runs outlive a deleted rule), `rule_name text`, `rule_version int`, `event_id uuid → store_events` (on delete set null), `order_id uuid`, `matched boolean`, `outcome jsonb` (`{ conditions: [{ kind, met, why? }], actions: [{ kind, ok, problem? }] }`) | PK `id`; **unique `(rule_id, event_id)`**; `orderRef` to `orders`; index `(store_id, created_at desc)` |
| `shipment_tracking` | `shipment_id uuid` (composite FK to `shipments`), `order_id uuid` (FK to `orders`), `carrier text`, `phase text`, `phase_verified boolean`, `events jsonb default '[]'` (at most 30, newest first: `{ at, code, phase, verified, description, location }`), `checked_at`, `next_check_at`, `failures int`, `out_at`, `delivered_at`, `stopped text`, `stopped_at`, `emailed_out boolean`, `emailed_delivered boolean` | PK `(store_id, shipment_id)`; `phase in TRACKING_PHASES`; `stopped in ('delivered','returned','old','undone','carrier_failing','no_agreement')`; index on `(next_check_at) where stopped is null` |

`notification_settings` and `email_templates` hold the store's own choices and words; a missing row means the default (on, or the notification's default) and the
fixed text. Rows are made only by saving.

### 3.3 What the database itself enforces (PGlite tests in `src/db/notifications.test.ts`, 6.4)

1. **A required notification cannot be off**: `notification_settings_required` refuses `enabled = false` for the required ids; a locked notification cannot have a
   template (the `email_templates` check lists only the editable ids).
2. **One event once**: `store_events` unique `(store_id, event, subject_id)`; the queue triggers insert `on conflict do nothing`.
3. **The queue triggers** (`commerce.store_event_order_paid()` after insert or update of `status` on `orders`: `NEW.status = 'paid'` from `pending_payment` or on
   insert, `copied_from is null`, the store not a starter; `commerce.store_event_return_requested()` after insert on `returns` with `status = 'requested'`, the order not
   copied) call `commerce.queue_store_event(store, event, subject)`, in the same transaction as the payment or the return. A weekly box's delivery order is queued
   too (rules run on it); the consumer leaves out its alert (2.10).
4. **One run per rule and event**: `order_rule_runs` unique `(rule_id, event_id)`.
5. **A held order sends nothing**: `commerce.shipments_not_held()`, a trigger before insert on `shipments`, refuses a row for an order with `held_at is not null`
   (`shipments.held`), so every path (the order page, bulk, carrier bookings, handovers, weekly boxes, AI tools, raw SQL) is covered.
6. **A carrier never overwrites a delivery**: `commerce.record_carrier_delivery(p_store, p_order, p_at)` is the only writer of `delivered_source = 'carrier'`; under
   the order's row lock it writes only when `delivered_at is null`, the order is `fulfilled` (sent in full, D174) and not copied, every standing (`undone_at is null`)
   parcel of the order has `shipment_tracking.delivered_at` from a verified code, and it writes `greatest(p_at, placed_at)` capped at `now()`; it writes the event
   `order.delivered` (`{ by: 'carrier', carrier, at }`, actor `system`) and returns whether it wrote. A trigger `orders_delivered_source` refuses
   `delivered_source = 'carrier'` written outside it (a transaction-local setting `kaizen.carrier_delivery` set by the function).
7. **`undo_shipment()`** is patched to clear `delivered_source` with `delivered_at`, and to set the parcel's `shipment_tracking.stopped = 'undone'`.
8. **`anonymise_order()`** is patched to set the order's `shipment_tracking.events = '[]'` (an update, no delete) and `held_reason` to the marker when it was typed by a
   person (a rule's reason is the owner's words about rules, kept).
9. **Rules per store**: `order_rules_limit` refuses a 51st rule.

### 3.4 Functions and the shared reads

- `commerce.queue_store_event(uuid, text, uuid)`, the two queue triggers, `commerce.record_carrier_delivery(uuid, uuid, timestamptz)`,
  `commerce.shipments_not_held()`, `order_rules_limit`, `orders_delivered_source` (all `set search_path = ''`, `security invoker`).
- No SQL reader of templates or switches: `src/server/notifications.ts` is the only module that reads `notification_settings` and `email_templates` (a scan test,
  `notification-readers.scan.test.ts`), `src/server/staff-alerts.ts` the only reader of `staff_alert_recipients`/`staff_alert_settings` (the same test).

### 3.5 Retention (application code in `runRetention()`; no `DELETE` in a SQL function)

- `store_events`: deleted 30 days after both parts are done or after `failed_at`.
- `order_rule_runs`: deleted 12 months after they ran (the log shows a year; no law is claimed, a choice of Kaizen's like the audit log's 24 months).
- `shipment_tracking.events`: set to `[]` 90 days after `stopped_at` (the phase, times and flags stay with the parcel as long as the order). The poll writes
  `stopped = 'old'` on every row still followed whose parcel is older than `FOLLOW_DAYS` (no check would), and the prune also clears the events of a parcel sent
  more than `FOLLOW_DAYS` + 90 days ago whatever its row says (a store closed or a carrier disconnected before a stop was written).
- `email_templates`, `notification_settings`, `staff_alert_*`, `order_rules`: the store's settings, kept while the store is.

### 3.6 What is private, what is copied, and the registers

| Table | `COPY_RULES` | `PERSONAL_DATA` / `NOT_PERSONAL` |
|---|---|---|
| `notification_settings` | `settings`: the switches are the store's set-up | `NOT_PERSONAL`: switches |
| `email_templates` | **`emails` (new group)**: *Email texts, copied when the owner ticks Email texts in the copy wizard* (`StoreCopyOptions.emailTexts`, default `false`); `duplicate_store()` copies them only then. `clone_store()` copies none (a template store's texts would be another business's words). | `NOT_PERSONAL`: the owner's own words for the store's emails (the `body` column trips detector C) |
| `staff_alert_settings` | `settings` (summary choice and the contact address's events) | `NOT_PERSONAL` |
| `staff_alert_recipients` | `never`: the original's people; a copy starts with the defaults (its own owners) | `NOT_PERSONAL`: staff accounts, not shoppers |
| `store_events` | `never`: the original's queue | `NOT_PERSONAL`: ids and times; `last_error` is code text |
| `order_rules` | `settings`: a rule naming a product that was not copied loses that condition and is switched off (`duplicate_store()` maps product ids as campaigns do, D114) | `NOT_PERSONAL` |
| `order_rule_runs` | `never`: the original's log | `PERSONAL_DATA`: shopper via order, no personal field, `keep` with the order's events, deleted after 12 months |
| `shipment_tracking` | `never`: copied orders are history and are not followed | `PERSONAL_DATA`: shopper via order, `events` (carrier text can name a person), export section `orders` (with the parcel), erasure `anonymise` (events cleared with the order) |

The new `CopyGroup` `emails` gets an entry in `COPY_GROUPS`, a line in the copy wizard (*Email texts: your own wording of the customer emails*), and a summary line
in `docs/store-copy.md`. `KNOWN_COOKIES`: nothing new (no cookie or storage anywhere in this run, 4.10).

### 3.7 Migrations expected (9.1)

Four: `notifications` (generated from `schema.ts`: the tables and columns of 3.1 and 3.2), `notifications_rules` (custom: RLS, the checks Drizzle cannot express,
the functions and triggers of 3.3 and 3.4, the patches of `undo_shipment()` and `anonymise_order()`), `notifications_copy` (custom: `duplicate_store()` gains the
`emails` choice and copies `notification_settings`, `staff_alert_settings` and `order_rules` with product mapping), `notifications_plan_features` (custom: the
plan-feature rows of 5.6, granted to every plan).

### 3.8 As built (foundation, 2026-10-15)

The four migrations are `20261015001011_notifications`, `20261015001113_notifications_rules`, `20261015001242_notifications_copy` and
`20261015001332_notifications_plan_features`. Where the build differs from the text above:

- **Email texts in a copy** are a function of their own, `commerce.copy_email_templates(source, store)`, which `startStoreCopy()` calls in the same
  transaction as `duplicate_store()` when `StoreCopyOptions.emailTexts` is true. `duplicate_store()` keeps its signature, because the code running until the
  deploy finishes calls it with the arguments it has. `emailTexts` is optional in the schema and defaults to false.
- **`staff_alert_settings` in a copy** keeps the summary choice and the contact address's events, with `configured_at` null. The recipients are never copied,
  so the copy's defaults hold: its own owners get the alerts.
- **The plan-feature rows** (positions 421 to 425 in Operations) are granted to no plan. This follows D172's, D174's and D237's precedent: a migration that ticks
  plans would decide for the platform's admin.
- **Bring `COLLECTED`** was re-read on 2026-10-15. Bring describes it as "The parcel has been collected at pickup address", which is Bring collecting the
  parcel from the sender. It is mapped to `in_transit` and verified, so it never records a delivery. The recipient collecting at a service point is `DELIVERED`.
- **Times**: the parsers return an instant when the carrier gives a zone (Bring's parser now prefers `dateIso`). Otherwise they keep the local text as
  before, and `storedEvents()` / `toInstant()` in `tracking-phases.ts` read it in the delivery country's zone. Bring's `lang` comes from `bringTrackingLang()`.
- **Email timing**: an out-for-delivery or delivered email is due only for news at most 24 hours old (`trackingEmailsDue()`, `STALE_HOURS`). Spec 2.7 says
  this of the first check; the build applies it to every check. The out-for-delivery email is never sent once the parcel is delivered.
- **Rules**: the limit trigger is `order_rules_limit` on the function `commerce.order_rules_rules()`. It also keeps a rule with its store. `has_tag` keeps the
  tag's key and its label. `delivery_is` and `source_is` take a list. Facts and outcomes are `RuleFacts` and `RunOutcome` in `src/lib/order-rules.ts`.
- **The order list's `held` value** came with its SQL case in `order-list-sql.ts` and its label in `filter-bar.tsx`, so the switch over the values stays
  exhaustive and typecheck passes.
- **Words**: `parcelOut*` and `parcelDelivered*` are in `emailText()` (nb, sv, da, en), and `m.tracking` is in the four message files. `ready_for_collection`
  with a place is `readyAt(place)`, and `delivered` with a date is `deliveredOn(date)`. Both sets are flagged `legal: needs review`. Changed in the fix step:
  they are in `HAND_WRITTEN_ONLY` (`email:parcelOut`, `email:parcelDelivered`, `ui:tracking.`) until the review of section 8 clears them, because the run's rule
  is that texts waiting for legal review are hand-written, never machine-translated.
- **Shared filler**: `fillNamed()` is in `src/lib/placeholder-fill.ts`. Saved replies use it as before. Templates call it with `dropBareLines`.
- **Neither patched function** (`duplicate_store()`, `anonymise_order()`) contained a `DELETE` before or after the patch. No new function holds one.

### 3.9 As built (server, 2026-10-15)

- **One wiring point per shape.** `orderNotice()` takes a seventh argument `{ action?, templated? }`: a catalogue kind is sent only while
  `notificationOn()` says so unless `action` (*Send again*, a change's pay link), and its subject, heading and intro go through `templatedSlots()` unless
  `templated: false` (the change's pay link keeps its own words, since it is not the applied change's notification). A builder's fixed words that follow
  the intro and that the law or the money needs (the reverse-charge VAT note of a refund, the reason of a change) are `introTail`: joined to the fixed
  intro as before, and drawn as their own paragraph under the owner's text when the body is templated, so an edit can never remove them.
  `returnMail()` asks and templates the same way; the withdrawal acknowledgement is not sent through it and is untouched.
- **The parcel emails** are one sender, `sendParcelEvent(store, order, shipment, "out" | "delivered")`, with `sendParcelOutForDelivery()` and
  `sendParcelDelivered()` as names for it.
- **The carrier adapter's `track()`** takes an optional third argument `{ lang }` (Bring uses it through `bringTrackingLang()`); `fetchCarrierEvents()`
  in `carrier-tracking.ts` is the poll's call (4 s, and it tells a failure from a carrier with nothing); `carrierTracking()` stays for the staff page
  until the admin agent moves it to the stored rows.
- **The poll claims a parcel** (its row made, or its due check moved ten minutes on) before asking the carrier, so two runs never ask about one parcel.
  *Check now* on a parcel stopped as `carrier_failing` or `no_agreement` clears the stop and tries again.
- **Holds**: `holdOrder()` refuses an order that is not paid (`unpaid`) as well as one sent in full (`sent`), copied or already held. *Ready for pickup*
  and *Collected* refuse a held order (`PICKUP_REFUSALS.held`), as `markSent()` and `parcelPrecheck()` do (`SHIPMENT_PROBLEMS.held`).
- **A rule's *Notify staff*** email is sent after the run's transaction commits (an email never goes for a run that rolled back); if the process stops
  between the two, that email is not sent and the run says so only as far as it got (a run is never repeated, 4.9).
- **Staff emails carry the order's id** (`email_messages.order_id`), so they are listed with the order and blanked by an erasure with it; their words hold
  no personal field (the canary test).
- **Refund overdue with the defaults** goes to the contact address with today's key, or to the owners when the store has none (4.7's defaults; before
  this run the reminder was not sent at all without a contact address).
- **`processStoreEvents({ storeIds })`** limits a run to some stores (the tests use it: the queue is shared).
- **The staff summary's figures** are `staffSummaryFigures()` in `src/server/staff-summary.ts`, defined in `docs/analytics.md` *Staff summary* (written
  by the server step, as the summary's sender needed them).
- **Retention** has three new steps in `runRetention()`: `store_events`, `order_rule_runs`, `tracking_events` (3.5).
- **Not held by an integration test**: a weekly box's delivery order getting no new-order alert (the code leaves it out by `standing_deliveries`; a
  fixture for weekly boxes was not built here), and the copied order's exclusion (held by the trigger's PGlite test only).

### 3.10 As built (shopper, 2026-10-15)

- **The piece** is `ParcelTracking` in `src/components/parcel-tracking.tsx` (a server component, no zod, no script, no picture), drawn by `OrderShipments`
  inside each parcel, so both order pages (`order-section.tsx`'s `parcelsBlock()`, which also serves the `order_parcels` piece of D117, and My account's order page)
  draw it the same way. Both pages read `parcelTrackingFor()` beside `shopperFulfilment()` (the order page only for a paid order that ships, like the parcels).
- **The phase line is said only from a verified code** (`trackingPhaseLine()`): 2.7 shows a phase for every parcel, but an unverified mapping (PostNord, Helthjem,
  Porterbuddy) telling a consumer *Delivered* would be Kaizen's guess about the day the 14 days may start from. Their events are listed in the carrier's own words
  with no phase line. An unlisted code after a verified one reads *On its way*, as 4.4 says.
- *Delivered {date}* takes the parcel's `shipment_tracking.delivered_at` (the first verified delivered event), else the newest event's time; *Ready to collect at
  {place}* takes the newest event's place, else *Ready to collect*. An event with no description shows its phase's words (verified) or the carrier's code.
- **A parcel Kaizen does not follow** shows its link as before (`m.fulfilment.track`, *Track the parcel*); `m.tracking.followAt` is not used, so the existing
  parcel link and its tests stay as they were.
- Tests: V `src/components/parcel-tracking.test.ts`, `order-section.test.ts` extended, `pay-routes.graph.test.ts` (the piece reaches no server code, zod,
  script or forbidden extra), E `e2e/parcel-tracking.spec.ts` (Bring events and phase, *no news*, a carrier not followed, a failed check, an unverified code,
  axe in light and dark). `e2e/fulfilment-fixtures.ts`'s `sendParcel()` now returns the shipment's id.

### 3.11 As built (analytics and AI, 2026-10-15)

- **The three owner tools** are `notification_settings`, `order_rules` and `parcel_tracking` (`src/lib/owner-tools.ts`; handlers in `src/server/notification-tools.ts`,
  pure shaping in `src/lib/notification-tools.ts`), read-only and ungated, with `TOOL_WORDS`, `TOOL_PERMISSIONS` (4.10) and, beyond 5.5, `TOOL_FEATURES` `shop`
  (they are the online shop's, like the other order tools). They answer from the pages' own readers: `listNotifications()`, `listRules()`/`ruleLog()` with
  `describeRule()` (amounts by `formatMoney()` in `mainCurrency(store)`) and `parcelTrackingFor()`. `notification_settings` gives no staff-alert recipients
  (that page is the owner's alone and the tool needs only `settings:read`). `parcel_tracking` gives at most five events per parcel and says when a carrier's
  codes are unverified.
- **The `emails` translation scope** lists, per editable notification, the slots the main language's template has (`emailUnit()`, unit `email:{notification}`,
  not legal), skips a target language kept under the same language code, and writes through `saveTemplate()` with the language's other slots kept. Beyond
  5.5, a suggestion whose `{placeholders}` differ from the source's (`samePlaceholders()`) is refused before saving, and the model is told in each item's label
  to keep them.
- The playbook is `order-emails-and-alerts` in `ASSISTANT_SKILLS`. The staff summary's figures were built by the server step (3.9); nothing else here.
- Tests: U `src/lib/notification-tools.test.ts`; I `src/server/notification-tools.int.test.ts` (a euro order's rule run, the owner's words never in the answer,
  another store's order not found, roles refused, the emails scope end to end).

### 3.12 As built (admin, 2026-10-15)

- **Pages**: `settings/notifications/` (`page.tsx`, `[notification]/page.tsx`, `staff/page.tsx`, `actions.ts`, `staff/actions.ts`) and `settings/automation/`
  (`page.tsx`, `new/`, `[ruleId]/`, `log/`, `actions.ts`, `rule-context.ts`), each with `loading.tsx`; components in `src/components/admin/notifications/` and
  `src/components/admin/automation/`. *Notifications* and *Automation* are in Settings' *Selling* group (`feature: "shop"`); `ADMIN_PAGES` has seven entries
  (`notifications`, `notifications.edit`, `notifications.staff` with `needs: "owner"`, `automation`, `automation.new`, `automation.rule`, `automation.log`).
  The staff alerts page is linked from Notifications for owners only, not from the navigation.
- **Permissions**: the preview (`previewNotificationAction`) and *Check now* (`checkParcelNowAction`, 4.10's `orders:read`) are read-only actions in
  `READ_ONLY_ACTIONS` of `permissions.scan.test.ts`; the staff alerts actions ask `owner`; the rest `settings:write` or `orders:write`. `/settings/automation/new`
  is a 404 without `settings:write`.
- **The pickup group** of 2.1 is always listed; when the store offers neither pickup nor local delivery it says these emails are not sent (rather than hiding them).
- **Order page**: the hold is `HoldPanel` (banner with *Release*, or *Hold fulfilment* with a reason for a paid order that ships); each parcel's tracking is
  `ParcelStatus` from `parcelTrackingFor()` (the live `CarrierStatus` call is gone); who recorded the receipt is a line under the parcels from
  `deliverySourceOf()` (`src/server/delivery-source.ts`). The *Notify the customer* boxes of the send form, the three carrier bookings, the refund and the
  cancel forms are drawn off with a link (`NotifySwitchedOff`) while `notificationStates()` says the email is off. **Not changed**: the Orders list's bulk
  *Mark as sent* box (it already starts unticked) and the handover panels (their emails ask the switch when sent).
- **Orders list**: a held order carries an *On hold* chip (`OrderListRow.held`, read in `src/server/order-list.ts`).
- **Home**: an owner sees *Staff alerts could not be sent* (`StaffAlertsFailed`, from `failedStoreEvents()`) as its own note under the attention list, not as
  an item of `attentionFor()` (the control center's figures are not changed).
- **Copy wizard**: the *Email texts* box (`options.emailTexts`, unticked by default) in `store-copy-wizard.tsx`.
- **A rule is deleted** by its *Delete* button at once (no second confirmation; its runs keep its name, 2.5 point 4).
- Tests: V `notifications-views.test.ts`, `automation-views.test.ts`, `orders/hold-tracking-views.test.ts`, the wizard's test; E `e2e/signed-in/notifications.spec.ts`
  and `e2e/signed-in/automation.spec.ts` (written, not run by the admin step: they need the signed-in build of CI's `signed-in` job).

---

## 4. Rules and law

### 4.1 Which notifications, which are required (`NOTIFICATIONS`, `src/lib/notifications.ts`; a unit test pins the sets)

| Id (= email kind) | Group | Default | Required | Editable | Why required |
|---|---|---|---|---|---|
| `order.confirmation` | orders | on | yes | yes | CRD (Directive 2011/83/EU) Art. 8(7): the trader confirms the contract "on a durable medium within a reasonable time after the conclusion of the distance contract, and at the latest at the time of the delivery of the goods" (as read for D158, `docs/wave-1-trust.md`) |
| `subscription.renewed` | orders | on | yes | yes | Kaizen's choice: a renewal charges the card without the shopper present; this email is their only notice of the charge and carries the invoice (D159) |
| `order.changed` | orders | on | yes | yes | the change confirmation of D174 (an amendment of the contract confirmed on a durable medium, Art. 8(7) applied to the changed contract; and Art. 22: the customer's consent to an extra payment is asked through it) |
| `order.sent` | orders | on | no | yes | |
| `order.parcel_out_for_delivery` | orders | **off** | no | yes | |
| `order.parcel_delivered` | orders | **off** | no | yes | |
| `order.refunded` | orders | on | no | yes | |
| `order.cancelled` | orders | on | no | yes | |
| `order.ready_for_pickup` | pickup | on | no | yes | |
| `order.out_for_delivery` | pickup | on | no | yes | |
| `return.acknowledgement` | returns | on | yes | **no (locked)** | CRD Art. 11a (inserted by Directive (EU) 2023/2673): the trader acknowledges receipt of a withdrawal made through the function on a durable medium without undue delay; D153 keeps it as evidence |
| `return.approved` | returns | on | yes | yes | Kaizen's choice: it carries the return address, instructions and label the consumer needs to send goods back within 14 days (Art. 14(1)) |
| `return.declined` | returns | on | yes | yes | Kaizen's choice: a refusal must reach the customer, with the statement that statutory rights are not affected (D153) |
| `return.received`, `return.refunded` | returns | on | no | yes | |

Action emails (`draft.pay_link`, the change pay link `order-change-pay:*`, *Send again*, test emails), security emails (`account.*`), invoice and credit-note
emails sent by staff (`invoice.issued`, `credit_note.issued`, whose carrying in order emails stays the invoice settings' switch, D159; when the store switches `order.refunded` or `return.refunded` off, the
refund's credit note goes in its own `credit_note.issued` email, so a notification switch never silences a document), booking emails, subscription
reminders, bonus and referral emails, weekly-box emails and support emails are **not** in the catalogue (section 7). `notificationOn(storeId, id)` is the one
question every sender in the catalogue asks before an automatic or `notify` send; it returns `true` for required ids without reading anything.

### 4.2 Templates: slots, placeholders, checks and fallback (`src/lib/email-template.ts`, pure)

- **Slots**: `subject` (≤ 150 characters typed, the filled subject cut at 200), `heading` (≤ 120), `body` (≤ 2000, at most 20 lines; a blank line is a paragraph break,
  drawn as `\n` in one paragraph block as today).
- **What a slot replaces**: in `orderNotice()` and `returnMail()` the built `subject`, `heading` and `intro`; in `sendOrderConfirmation()` the subject, the heading and
  the intro paragraph (the renewal's own ones for `subscription.renewed`); in the parcel emails their subject, heading and intro. Nothing else. `preview` (the mail app's
  preview line) is the filled body's first 140 characters, or the fixed intro.
- **Placeholders** (`{name}`, `[a-z_]+`): common to all: `{store_name}`, `{order_number}`, `{customer_first_name}` (the first word of the order's shipping, else billing
  name; left out when unknown, never the email address). Per notification: confirmation and renewal `{order_total}`; sent and the parcel emails `{carrier}`,
  `{tracking_number}`; refunded `{refund_amount}`; returns `{return_number}`; ready for pickup `{pickup_place}`; change `{change_number}`. A money placeholder is the order's
  own amount in the order's currency and language (`formatMoney(minor, order.currency, market.locale)`).
- **Filling** is `fillTemplate(slot, values)`: the same rule as D216's `fillPlaceholders()` (`src/lib/support-replies.ts`), generalised and shared: a placeholder with
  no value is left out with its leading space, and a line left with only punctuation goes; values are text (escaped by the renderer).
- **Problems** (`templateProblems(slots, notification)`), each refusing the save, with the slot: `unknown_placeholder` (a `{word}` not in the notification's list),
  `stray_brace` (a `{` or `}` not part of a placeholder), `address` (anything that reads as a web address: `https?://`, `www.`, or any dotted host whose last part is two or more
  letters of any script or punycode, also with the ideographic or fullwidth full stop, never a list of top-level domains, since mail apps link any of them; a few
  dotted abbreviations such as *f.eks.* and *t.ex.* are words; links stay the code's buttons), `too_long`, `too_many_lines`, `empty_after_fill` (the subject or heading would be empty with every placeholder left out),
  `claim` (`findClaims()` on the slot with placeholders removed: urgency, best price, an amount of money, stock, green claims; `{order_total}` is a placeholder and so is
  not an amount), `control` (control characters other than the line break). The editor shows the same problems before saving (the pure function runs in the browser;
  it imports no zod: the editor is admin, but keep `email-template.ts` free of server modules).
- **Fallback**: per slot: the store's template of the order's language when it has that slot and it passes `templateProblems()` now; else the fixed text of the
  order's language (`emailText(lang)`, which falls back to English). Never another language's template. A missing template is not a problem.
- **Read** fresh in each send (not cached: emails are written by jobs and webhooks; one small read per email), by `templatesFor(storeId, notification, lang)`.

### 4.3 Owner text is transactional, not marketing

An order email that also promotes becomes direct marketing, which needs consent (Directive 2002/58/EC, ePrivacy, Art. 13(1) and (2): electronic mail for direct
marketing only with prior consent, or to own customers for similar products with a clear opt-out in each message). Kaizen cannot judge intent; it refuses web addresses
and the claims filter's phrases (4.2) and tells the owner in the editor (2.1). It does not add an unsubscribe link to transactional emails. *Not read for this run*:
the ePrivacy text was not re-fetched; the reading is the one D33 (cart reminders) relies on. **Verify** before the editor's note is final (section 8).

### 4.4 Tracking phases and carrier codes (`src/lib/tracking-phases.ts`, pure)

`TRACKING_PHASES`: `info_received`, `in_transit`, `out_for_delivery`, `ready_for_collection`, `attempted`, `delivered`, `returned_to_sender`, `problem`, `unknown`.
`phaseOf(carrier, code)` returns `{ phase, verified }` from a table per carrier; an unlisted code is `{ phase: 'unknown', verified: false }` (shown as *On its way* to the
shopper only if an earlier event had a phase; else the description alone).

| Bring (verified, 1.2) | Phase |
|---|---|
| `PRE_NOTIFIED`, `DELIVERY_ORDERED` | `info_received` |
| `HANDED_IN`, `IN_TRANSIT`, `TERMINAL`, `INTERNATIONAL`, `CUSTOMS`, `DELIVERY_CHANGED`, `NOTIFICATION_SENT` | `in_transit` |
| `TRANSPORT_TO_RECIPIENT` | `out_for_delivery` |
| `READY_FOR_PICKUP` | `ready_for_collection` |
| `ATTEMPTED_DELIVERY` | `attempted` |
| `DELIVERED`, `COLLECTED`* | `delivered` |
| `RETURN`, `DELIVERED_SENDER` | `returned_to_sender` |
| `DEVIATION`, `DELIVERY_CANCELLED` | `problem` |
| `UNKNOWN` | `unknown` |

\* `COLLECTED`: the documentation's table lists it among event statuses; the foundation agent re-reads its description (the page beyond 100,000 characters) and, if it
means collected **from the sender** (pickup by Bring), moves it to `in_transit` before the table is frozen. Until confirmed it is `verified: false`.

PostNord (`EN_ROUTE` → `in_transit`, `DELIVERED` → `delivered`), Helthjem and Porterbuddy start with the codes their fixtures use, every entry `verified: false`;
a code becomes verified only with the documentation's URL and date in the table's comment (section 7, 9.6).

**Times**: an event's instant is the carrier's zoned time when it gives one (Bring `dateIso`, Helthjem `eventTimeUtc`); a time without a zone (PostNord `eventTime`,
Bring without `dateIso`) is read in the delivery country's time zone (`COUNTRY_ZONES`: NO Europe/Oslo, SE Europe/Stockholm, DK Europe/Copenhagen, FI Europe/Helsinki;
else the store's). The parsers in `src/lib/bring.ts` and the others keep returning `TrackingEvent` with `at` as an ISO instant (Bring's parser prefers `dateIso`).

### 4.5 Polling (`pollTracking()`, `src/server/shipment-tracking.ts`, every five minutes)

- **Which parcels**: tracked parcels (1.3) of orders not copied, in open stores with `shop` on, created in the last 30 days, not `stopped`, `next_check_at <= now()`,
  oldest due first, at most 60 per run and 15 per carrier per run, at most 4 calls at once. A parcel gets its `shipment_tracking` row on its first check.
- **When next**: 30 minutes after a check that found a new event; else doubling up to 6 hours; `out_for_delivery` or `ready_for_collection` every 30 minutes; after a
  failure 30 minutes doubling up to 12 hours. *Check now* (staff) at most once a minute per parcel.
- **Language**: Bring is asked in the order's language when it is `no` (nb), `sv`, `da` or `en`, else `en`; the others as they are.
- **What a check does**: merge the carrier's events with the stored ones (by time and code, keep the newest 30), set `phase` and `phase_verified` from the newest event that
  has a phase, `out_at`/`delivered_at` the first time a verified code says so; stop on `delivered` (verified), `returned_to_sender` (verified), 30 days, an undone parcel,
  or an agreement removed (`no_agreement`). Then, in the same run: the emails of 2.7 when switched on (`emailed_*` set after a kept send), and `record_carrier_delivery()`
  when the parcel became delivered.
- **Never** while a page renders, never in a pay route, never with another store's agreement (`carrierContext()` only), never a host other than the adapter's own.

### 4.6 Recording a delivery from the carrier (D153's 14 days)

The period of withdrawal for goods ends 14 days "from the day on which the consumer or a third party other than the carrier and indicated by the consumer acquires
physical possession of the goods", for goods delivered separately the last of them (CRD Art. 9(2)(b), as `docs/returns.md` reads it). A carrier's *delivered* event is
the best evidence a store has; Kaizen records it as the receipt only when (3.3 point 6): the code is verified; the order is sent in full; **every** standing parcel was
delivered by the carrier (an untracked parcel, or one still on its way, leaves the receipt to staff); `delivered_at` is null (never over staff's date, never twice). The
time written is the latest parcel's delivered instant, raised to the order's `placed_at` and capped at now. A later parcel (`markSent()`) reopens it as today; staff may
correct it with *Mark delivered* (source becomes `staff`). `READY_FOR_PICKUP` at a service point is **not** delivery (the consumer has not taken possession); the
collection there is (`DELIVERED`). *Whether a "delivered" event of a parcel left in a mailbox or at the door is acquisition of possession* is a legal reading flagged in
section 8.

### 4.7 Staff alerts (`src/lib/staff-alerts.ts` pure, `src/server/staff-alerts.ts`)

- **Events and the permission each needs** (`ALERT_NEEDS`): `new_order` `orders:read`, `return_requested` `orders:read`, `refund_overdue` `orders:read`, `low_stock`
  `products:read`, `summary` `analytics:read`, `automation` `orders:read`. A member receives an event's email only while they are an active, unexpired member of an open
  store whose role holds the key (`memberCan()`, D158; a collaborator after `expires_at` gets nothing); checked at sending, so a member whose role changed stops at once.
  The contact address is offered for every event (it is the store's own address).
- **Defaults** (`defaultRecipients()`, while `configured_at` is null): owners get `new_order`, `return_requested`, `low_stock`; `refund_overdue` to the contact address,
  or to the owners when there is none (today's behaviour of D153 and D172, unchanged until the owner saves).
- **The consumer** (`processStoreEvents()`, every minute from `/api/cron/integrations`): claims due events (`for update skip locked`, a 5-minute lease), per event first
  the **rules** (4.9; `rules_done_at`), then the **alerts** (`alerts_done_at`): reads the order or return fresh, skips it (marked done, no email) when the store is not open,
  `shop` is off, the order is copied, a weekly box's delivery (for the alert only), cancelled before the alert was built, or anonymised; else one `sendEmail()` per
  recipient with the key of 2.8. A key already kept is `duplicate` and counts as done. A webhook retried, a session replayed, `applySession()` called from the order page
  and the webhook both: one store event (the unique key), one email per recipient (the keys).
- **Summary** (`sendDueSummaries()`, five-minute job): for each store with `summary` not `off`, when the store's local time has passed the chosen hour (and the weekday for
  weekly) and `summary_last_period` is not this period, build once and send to each recipient (keys of 2.8), then set `summary_last_period`. The figures are
  `staffSummaryFigures()` (5.5), defined in `docs/analytics.md` first.
- **Existing senders move to the recipients**: `sendLowStockNotices()` and `sendRefundOverdueReminder()` ask `alertRecipients(storeId, event)` instead of `ownersOf()`
  and the contact address; with the defaults nothing changes for any store.

### 4.8 What a staff email may hold

Order and return numbers, line titles and quantities, the total charged in the order's currency, the delivery method and country, the buyer's kind
(business/consumer), host, gift and hold flags, store figures, links into the admin. **Never** the buyer's name, email, phone, address, company name, organisation or VAT
number, gift message, notes, return reason note, or a token. A test renders each staff email for an order whose name, email, phone, address and gift message hold
canary strings and asserts none is in the subject, html or text (6.3). Source: GDPR Art. 5(1)(c) (data minimisation; the email log keeps every email, D162), and the
row's criterion.

### 4.9 Rules (`src/lib/order-rules.ts` pure, schemas in `src/lib/order-rules-schema.ts`, `src/server/order-rules.ts`)

- **Facts** (`ruleFacts()`, read once per event, before any rule): total charged and its currency, the total in the store's main currency (`toMain()` at the store's
  rates now, `null` without a rate), market code, buyer kind, whether the signed-in customer has an earlier paid order (`null` for a guest: never matched by email,
  D162), product ids of the lines, delivery kind (`shipping`, `pickup`, `local`, `none`), any backordered unit, gift, source (`checkout`, `draft`, `subscription`,
  `delivery`), tags at that time, host or store.
- **Conditions** (closed): `total_at_least` / `total_below` (amount in the main currency; no rate: not met, `no_rate`), `country_in` (market codes of the store),
  `buyer_is` (`business`, `consumer`), `first_order` (true/false; a guest: not met, `unknown`), `has_product` (store product ids, kept to the store's own on save), `delivery_is`,
  `has_backorder`, `is_gift`, `source_is`, `has_tag` (a tag key), `seller_is` (`store`, `host`). `match` all or any; no condition: always.
- **Actions**: `tag` (`changeOrderTags()` with `SYSTEM_ACTOR`, `audit: false`; refused tags reported `limit`); `notify` (an `automation.notify` email to the recipients of
  `automation`, the rule's name and note and the order's facts of 4.8); `hold` (`holdOrder()` with `held_by_rule`; an order already held keeps its first hold, `already_held`;
  an order already sent in full is `not_held: sent`).
- **Once**: the run row is inserted first (`on conflict do nothing`); only the transaction that inserted it acts. Rules run in `position` order, each in its own
  transaction; facts do not change between them (no chaining: a tag added by one rule does not satisfy another's `has_tag` for this event).
- **A rule changed after an event** runs in its version at processing time (`rule_version` kept in the run); a rule switched off is skipped (no run row).

### 4.10 Who may do what

| Action | Key |
|---|---|
| See notifications, templates, preview | `settings:read` |
| Switch, edit, reset a template, send a test | `settings:write` |
| Staff alerts page (recipients, summary, tests) | `owner` (`requireOwnerRole()`) |
| See rules and the log | `settings:read` |
| Create, change, order, switch, delete rules | `settings:write` |
| Hold and release an order | `orders:write` |
| *Check now* on a parcel | `orders:read` |
| The AI manager's `notification_settings`, `order_rules`, `parcel_tracking` (read-only) | `settings:read`, `settings:read`, `orders:read` (`TOOL_PERMISSIONS`) |

No cookie or storage is set by any of it; the shopper's tracking needs no consent.

---

## 5. Where things live

Areas: **foundation** (schema, migrations, pure libraries, words, registers), **server** (`src/server`, cron routes, the senders), **shopper** (storefront),
**admin** (admin pages and components), **analytics-and-ai** (figures, AI tools, translation worklist). Areas share files only through the registries of 5.6.

### 5.1 Foundation

- `src/db/schema.ts` (3.1, 3.2); migrations of 3.7; `src/db/notifications.test.ts` (PGlite, 3.3).
- `src/lib/notifications.ts`: `NOTIFICATIONS` (id, group, label, when, default, required, editable, placeholders), `REQUIRED_NOTIFICATIONS`, `isNotificationId()`,
  `notificationPath()` (`order.sent` ↔ `order-sent`). Test `src/lib/notifications.test.ts` pins 4.1 and holds every id to `EMAIL_KINDS`.
- `src/lib/email-template.ts`: slots, limits, `PLACEHOLDERS`, `fillTemplate()`, `templateProblems()`, `withTemplate(built, template, values)`; `src/lib/support-replies.ts`
  keeps `fillPlaceholders()` built on the shared filler. Test `src/lib/email-template.test.ts`.
- `src/lib/notification-sample.ts`: `sampleOrder(store, market, lang)` (a made-up `OrderView`-shaped order: two lines, a parcel, a return number), pure.
- `src/lib/tracking-phases.ts`: `TRACKING_PHASES`, the carrier tables, `phaseOf()`, `COUNTRY_ZONES`, `mergeEvents()`, `nextCheck()`; test `src/lib/tracking-phases.test.ts`.
  Parser changes in `src/lib/bring.ts` (`dateIso`, `lang`), `postnord.ts`, `helthjem.ts`, `porterbuddy.ts` with their tests.
- `src/lib/staff-alerts.ts`: `STAFF_ALERT_EVENTS`, `ALERT_NEEDS`, `defaultRecipients()`, `recipientsFor()` (pure over members and settings); test.
- `src/lib/order-rules.ts`, `src/lib/order-rules-schema.ts` (zod; admin only), `ruleMatches()`, `describeRule()` (the sentence), `RULE_LIMITS`; test.
- Words: `emailText()` gains `parcelOut*`, `parcelDelivered*` in nb, sv, da and en, hand-written (consumer, not legal; the AI catalogue may translate other languages);
  `m.tracking.*` (phase lines, *no news*, *follow at*) in `src/lib/messages/{nb,sv,da,en}.ts`; staff and admin words in English in their modules.
- Registers: `EMAIL_KINDS` (the new kinds, and the missing `order.sent`, `order.refunded`, `order.cancelled`, `return.approved`, `return.declined`, `return.received`,
  `return.refunded`), `PERSONAL_DATA`/`NOT_PERSONAL` (3.6), `COPY_RULES` and `COPY_GROUPS` (3.6), `StoreCopyOptions.emailTexts`, `AUDIT_AREAS` (`notification.` and
  `automation.` → `settings`; `order.held`, `order.hold_released` are `order.` → `orders`), `ORDER_LIST` filter value `held` in `src/lib/order-list.ts`.

### 5.2 Server

- `src/server/notifications.ts`: `notificationOn()`, `listNotifications()`, `getTemplate()`, `templatesFor()`, `saveTemplate()`, `resetTemplate()`, `setNotification()`,
  `previewNotification()`, `sendTestNotification()` (rate limit through `chat_usage` bucket `notify:test`). Test `src/server/notifications.int.test.ts`.
- Wiring: `src/server/shopper-emails.ts` (`orderNotice()` and `sendOrderConfirmation()` apply `withTemplate()`, ask `notificationOn()` for automatic and `notify` sends;
  `sendParcelOutForDelivery()`, `sendParcelDelivered()`), `src/server/return-emails.ts` (`returnMail()` the same), `src/server/order-edit-emails.ts` (the change email's slots).
  Callers with `notify` keep their argument; the sender decides.
- `src/server/shipment-tracking.ts`: `pollTracking()`, `checkParcel()`, `parcelTrackingFor(storeId, orderId)` (the stored read for pages), the emails and
  `record_carrier_delivery()` call. `src/server/carrier-tracking.ts` keeps `trackedCarrier()` and `carrierTracking()` (used by the poll; its live use on the staff page
  goes). Test `src/server/shipment-tracking.int.test.ts` with an injected adapter.
- `src/server/order-delivery.ts`, `src/server/pickup.ts`, `src/server/order-admin.ts`: `delivered_source` on every write and clear; `markSent()` refuses `held`
  (`SHIPMENT_PROBLEMS.held` in `src/lib/fulfilment.ts`), `parcelPrecheck()` too.
- `src/server/order-hold.ts`: `holdOrder()`, `releaseHold()` (events `order.held`, `order.hold_released`, audit).
- `src/server/staff-alerts.ts`: `alertRecipients()`, `saveStaffAlerts()`, `processStoreEvents()`, `sendDueSummaries()`, the staff emails; test `src/server/staff-alerts.int.test.ts`.
  `src/server/stock-alerts.ts` and `src/server/return-emails.ts` (`sendRefundOverdueReminder()`) move to `alertRecipients()`.
- `src/server/order-rules.ts`: `listRules()`, `saveRule()`, `orderRules()`, `deleteRule()`, `runRulesFor(event)`, `ruleLog()`; test `src/server/order-rules.int.test.ts`.
- Cron: `/api/cron/integrations` adds `processStoreEvents()`; `/api/cron/cart-reminders` adds `pollTracking()` and `sendDueSummaries()`; `runRetention()` gains 3.5;
  `exportCustomerData()` adds the parcels' tracking to the order section; `eraseSubject()` relies on `anonymise_order()` (3.3 point 8).

### 5.3 Shopper

- `src/components/parcel-tracking.tsx` (server component, no `use client`, no zod), drawn by `src/app/s/[store]/[market]/order/[orderId]/order-section.tsx` and
  `src/app/s/[store]/[market]/account/orders/[orderId]/page.tsx` from `parcelTrackingFor()`; render test `src/components/parcel-tracking.test.ts` (phases, no news, no
  carrier, a failed check) and the existing `order-section.test.ts` extended. The pay route's scan (`FORBIDDEN_ON_PAY_ROUTES`) must stay green.

### 5.4 Admin (English; colour roles; `PageHeader`, `Card`, `List`; every page with `loading.tsx` and its own permission check)

- `src/app/admin/(gated)/[store]/settings/notifications/` (`page.tsx`, `[notification]/page.tsx`, `staff/page.tsx`, `actions.ts`), `.../settings/automation/` (`page.tsx`,
  `[ruleId]/page.tsx`, `new/page.tsx`, `log/page.tsx`, `actions.ts`); components in `src/components/admin/notifications/` and `src/components/admin/automation/`.
- The order page (`orders/[orderId]/page.tsx`): the hold banner and buttons, the tracking per parcel from stored rows with *Check now*, the *Notify* boxes' defaults;
  the send, refund and cancel forms and the carrier actions; the Orders list's *On hold* filter.
- Signed-in e2e `e2e/signed-in/notifications.spec.ts` (owner edits a Norwegian subject with a placeholder, sees the preview, a claim refused, the confirmation's switch
  absent; the read-only member sees and cannot save), `e2e/signed-in/automation.spec.ts` (owner makes a rule; the read-only member gets no editor), and view tests.

### 5.5 Analytics and AI

- `docs/analytics.md` gains *Staff summary* (each figure's definition, pointing at D152's where one exists) **before** code; `src/server/staff-summary.ts`:
  `staffSummaryFigures(storeId, period)` over `periodTotals()` and the counts; test `src/server/staff-summary.int.test.ts` with a euro order.
- Owner tools (read-only, ungated): `notification_settings` (switches and which languages have the owner's text, never the words), `order_rules` (the sentences and the last
  runs), `parcel_tracking` (an order's parcels' phases and newest events from the stored rows). Each with zod arguments, `TOOL_WORDS`, `TOOL_PERMISSIONS`, served over MCP
  like every owner tool. No tool switches, edits, holds or changes a rule (section 7).
- `src/lib/store-translate.ts`/`src/server/store-translate.ts`: scope `emails`: the main language's templates as units, suggested into the other languages, ticked by a
  person, written by `saveTemplate()` (so `templateProblems()` runs on every applied suggestion).
- `ASSISTANT_SKILLS`: a playbook *Set up order emails and alerts*.

### 5.6 The registries, and who edits each

| Registry | File | Area |
|---|---|---|
| Store navigation (*Notifications* and *Automation* items in Settings, `feature: "shop"`) | `src/lib/store-nav.ts` | admin |
| Admin map (`/settings/notifications`, `/settings/notifications/{id}`, `/settings/notifications/staff`, `/settings/automation`, `/settings/automation/log`) | `src/lib/admin-map.ts` | admin |
| Interface words (`m.tracking`) | `src/lib/messages/*.ts`, `src/lib/i18n.ts` | foundation |
| Email words | `src/lib/email-text.ts` | foundation |
| `EMAIL_KINDS`, `PERSONAL_DATA`, `NOT_PERSONAL` | `src/lib/personal-data.ts` | foundation |
| `COPY_RULES`, `COPY_GROUPS`, `StoreCopyOptions` | `src/lib/store-copy-rules.ts`, `src/lib/store-copy.ts` | foundation (the wizard's checkbox: admin) |
| `AUDIT_AREAS` | `src/lib/audit.ts` | foundation |
| `KNOWN_COOKIES` | `src/lib/cookie-consent.ts` | nothing to add |
| Plan features | migration `notifications_plan_features`: *Editable customer emails*, *Delivery tracking on the order page*, *Delivery emails from carrier events*, *Staff order alerts and summaries*, *Order automation rules* | foundation |
| Owner tools, `TOOL_WORDS`, `TOOL_PERMISSIONS`, skills | `src/lib/owner-tools.ts`, `src/server/owner-tools.ts`, `src/lib/assistant-skills.ts` | analytics-and-ai |
| Store translation scopes | `src/lib/store-translate.ts` | analytics-and-ai |
| Order list filters | `src/lib/order-list.ts`, `src/server/order-list-sql.ts` | foundation (the value), server (the SQL) |
| Sitemap, structured data | nothing: order pages are `noindex` | none |

---

## 6. Acceptance criteria, row by row, mapped to tests

Kinds: **U** unit (`pnpm test`), **P** PGlite (`src/db/*.test.ts`), **I** integration against a real database (`pnpm test:int`), **E** e2e (storefront, or
`e2e/signed-in/` with `E2E_SIGNED_IN=1`), **V** `renderToString` view test.

### 6.1 `orders.editable-notification-email-templates`

| Criterion (as in the row) | How it is held |
|---|---|
| An owner edits the subject and a text block of an order email per language, with named placeholders only (no code), and a preview shows it with a sample order (unit and render tests). | U `email-template.test.ts` (placeholders found, filled, left out when unknown; no other syntax is read: `{{x}}`, `{% if %}` and `<b>` are refused or stay text); U `email-template.test.ts`, render cases (`withTemplate()` into `renderEmail()`: the slots replaced, every fixed block still there, escaped); I `notifications.int.test.ts` (save an nb template; `previewNotification()` renders it with the sample order; a real nb order's sent email uses it, an sv order of the same store uses the sv fixed text); E `signed-in/notifications.spec.ts`. |
| Every order email can be switched off or on per event, and legally required ones (the withdrawal acknowledgement, the order confirmation) cannot be switched off. | U `notifications.test.ts` (required set; every catalogue id in `EMAIL_KINDS`); P `notifications.test.ts` (`notification_settings_required` refuses; the acknowledgement cannot have a template); I: switched off, `markSent()` with `notify` keeps no `order.sent` row in `email_messages`; switched on again, it does; `setNotification()` refuses a required id; E: the confirmation has no switch. |
| An edited text passes the claims filter and the placeholder check before it is saved; a missing translation falls back to the fixed text. | U `templateProblems()` for each problem code; I: `saveTemplate()` refuses a claim and an unknown placeholder and writes nothing; an order in a language without a template, and a template slot left empty, give the fixed text per slot. |
| Emails keep the order's language and currency, and edits are copied with a store only if the owner chooses. | I `notifications.int.test.ts` euro scenario: an order paid in a euro view (`no-eur`) with `{order_total}` shows the euro amount equal to the order's `total_minor`, in the order's language; a `checkout-kinds.int.test.ts` case asserts the confirmation's filled subject in the euro scenario; I `store-copy.int.test.ts` (or the copy suite that exists): `duplicate_store()` with `emailTexts` false copies switches and no template, with true copies both. |

### 6.2 `orders.delivery-status-notifications-tracking-page`

| Criterion | How it is held |
|---|---|
| The shopper's order page shows a parcel's events from the carrier (unit test of the mapping, integration test with a faked carrier) and says plainly when the carrier gives none. | U `tracking-phases.test.ts` (every Bring code of 1.2 to its phase, verified; an unknown code `unknown`; times with and without a zone); U parser tests; I `shipment-tracking.int.test.ts` (an injected adapter returns events; `pollTracking()` stores and merges them; `parcelTrackingFor()` returns them; an adapter returning `[]` gives the *no news* state); V `parcel-tracking.test.ts` and `order-section.test.ts` (events drawn, *no news* sentence, carrier not followed). |
| A carrier's delivered event records `delivered_at` once, never earlier than the order and never over a staff date, and it starts the 14-day count of D153 (integration test). | I: a fully sent order's Bring parcel delivered → `delivered_at` = the event, `delivered_source = 'carrier'`, one `order.delivered` event; a second poll writes nothing; an event dated before `placed_at` writes `placed_at`; an order staff marked delivered keeps staff's date; a partly sent order, or a second parcel not delivered, writes nothing; an unverified code writes nothing; `withdrawalWindow()` (D153) ends 14 days after the recorded day; P: `record_carrier_delivery()` refuses a copied order and the trigger refuses `delivered_source = 'carrier'` outside it; `undo_shipment()` clears source and stops tracking. |
| Out-for-delivery and delivered emails go once per shipment, only when the store switched them on, in the order's language. | I: switched off (default), no email; switched on, one `order.parcel_out_for_delivery` and one `order.parcel_delivered` per parcel (keys), two parcels two of each, a third poll none; the email is in the order's language (sv order, Swedish subject); a parcel first seen delivered more than 24 hours late sends none. |
| A carrier that does not answer leaves the tracking link and no error. | I: the adapter throws and times out: stored events stay, `failures` counts, `next_check_at` backs off, no exception escapes `pollTracking()`; V: the piece with a failed last check shows the link and the stored events, no error text; E (storefront, existing order page spec extended): a parcel with no tracking row shows its link. |

### 6.3 `orders.staff-alerts-for-new-orders-order-automation`

| Criterion | How it is held |
|---|---|
| Each paid order emails the staff the owner chose (default the owners) once, with the order number, total and a link; a retried webhook sends no second email (integration test). | I `staff-alerts.int.test.ts`: `complete_order_payment()` then `processStoreEvents()` → one `staff.new_order` per owner with number, formatted total and the admin link; `applySession()` again (a retried webhook) and `processStoreEvents()` again → no new row; a copied order and a weekly box's delivery order → none; a euro order → the euro total; a member without `orders:read` chosen as recipient → none; an expired collaborator → none. P: `store_events` unique, the triggers' conditions. |
| Owners choose recipients and events (new order, return requested, refund overdue, low stock) and a daily or weekly summary (integration test). | I: `saveStaffAlerts()` by an owner (a non-owner refused); `return_requested` on a shopper's return; `refund_overdue` and `low_stock` go to the chosen recipients and, with the defaults, exactly as before (the existing `returns.int.test.ts` and `stock-alerts.int.test.ts` stay green); `sendDueSummaries()` sends daily at the store's hour, once per period, weekly only on its day; I `staff-summary.int.test.ts` (figures equal `periodTotals()`, a currency without a rate counted); E `signed-in/` the read-only member gets the 404 on the staff page. |
| A rule `when {event} and {condition} then {action}` (tag, notify, hold) is stored per store, runs once per event and is logged (unit test of matching, integration test). | U `order-rules.test.ts` (each condition, all/any, no rate, guest `first_order`, `describeRule()`); I `order-rules.int.test.ts` (a rule tags, notifies and holds a paid order; processing twice gives one run and one email; a not-matching order is logged unmatched; another store's rule never runs; a held order's `markSent()` is refused and *Release* lets it); P: `shipments_not_held()` refuses a shipment of a held order; `order_rules_limit`; E `signed-in/automation.spec.ts`. |
| Nothing in a staff email names a shopper's phone or full address. | I (and U on the builders): an order with canary name, email, phone, address, company and gift message; every staff email (`staff.new_order`, `staff.return_requested`, `automation.notify`, `return.overdue`, `staff.summary`) holds none of them in subject, html or text. |

### 6.4 Criteria changes (for the lead; the rows are not edited here)

1. `orders.editable-notification-email-templates`, criterion 2: proposed *"Every notification an order or return event sends automatically can be switched off or on
   per event (action emails staff send with a button are not notifications), and legally required ones (at least the withdrawal acknowledgement and the order
   confirmation; the spec adds the renewal and change confirmations and the return decision emails) cannot be switched off, also in the database."* The present text
   could be read as covering pay links and sign-in codes, which must never be switched off.
2. The same row's gap says *"The store's logo and colours reach the layout"*: they do not (`renderEmail()` has neither). Correct the gap when re-rating; no criterion asks for
   them.
3. `orders.staff-alerts-for-new-orders-order-automation`, criterion 1: proposed *"Each paid order (not a copied order, a store template's or a weekly box's delivery,
   which staff charge themselves) emails the staff the owner chose who may read orders (default the owners) once…"*. Criterion 3: proposed *"… (tag, notify, hold
   fulfilment) …"*, saying what hold means.
4. `orders.delivery-status-notifications-tracking-page`, criterion 2: proposed *"A carrier's delivered event with a code verified against the carrier's documentation
   records …"*; the honest limit (PostNord, Helthjem and Porterbuddy unverified) belongs in the gap after the run.

### 6.5 Cross-cutting tests and scans

- `notification-readers.scan.test.ts`: only `notifications.ts` reads `notification_settings`/`email_templates`; only `staff-alerts.ts` reads the alert tables; only
  `record_carrier_delivery()` writes `delivered_source = 'carrier'`; every sender of a catalogue kind calls `notificationOn()` (the scan lists the senders).
- `personal-data.test.ts`, `privacy.test.ts`, the COPY_RULES test, `audit.test.ts`, `store-nav.test.ts`, `admin-map.test.ts`, `permissions.scan.test.ts`,
  `storefront-bundle.scan.test.ts` and the pay-route scan stay green with the new entries.
- `checkout-kinds.int.test.ts`: the euro scenario's confirmation subject with `{order_total}` (6.1) and a rule's `total_at_least` in the main currency for the euro order (I).

---

## 7. What is deliberately NOT done, and why

- **HTML or Liquid templates, the layout, a logo and brand colours in emails** (Shopify has them): owner HTML would break mail clients, hide the legal blocks and need
  sanitising and a second review path. Words with placeholders meet the row. A logo and the theme's accent in `renderEmail()` are a small later change (wave 7, the
  storefront's look), not this row.
- **Editing action, security, invoice, booking, subscription-reminder, bonus, referral, weekly-box and support emails**: not order event notifications; booking and
  subscription emails come with wave 5 (customers and marketing) where reminders and marketing consent are handled.
- **A plain email address as a staff recipient** (Shopify allows one): a member could route the store's orders anywhere; only members and the store's own contact address.
  Revisit with a confirmation email to the address (wave 9, with webhooks and apps).
- **Push notifications to a phone** (Shopify's app): decision 6 of `docs/parity-plan.md` section 5 (*PWA with push*), not made; bucket C work, not a criterion here.
- **Alerts to hosts** (D71), **draft-order and dispute staff notifications**, **per-location new-order notifications**: no criterion; disputes come with wave 4 (payments).
- **A general workflow builder** (Shopify Flow: triggers beyond *order paid*, delays, branching, apps): wave 9 (extensibility). Rules here are one event, a closed list of
  conditions and three actions.
- **A map on the tracking page**, **a public tracking page without the order link**, **SMS**: a map needs a third-party script on a pay route (D158); the order page's own
  link is the tracking page; SMS is decision 5.
- **Webhooks from carriers** (push instead of polling): needs each carrier's subscription set-up per agreement; polling within the limits of 4.5 meets the row.
- **Verifying PostNord, Helthjem and Porterbuddy codes**: their documentation could not be read here; a code is verified only with its source (9.6). Until then they
  show events and never record a delivery or send an email.
- **AI tools that switch emails, edit texts, change rules or hold orders**: read-only tools only; changes stay with a person on the page (gated tools can follow).
- **Exchanges and return labels**: their own run (wave 3, shipping).

---

## 8. Needs human legal review

1. **The two new consumer emails** (`order.parcel_out_for_delivery`, `order.parcel_delivered`, nb, sv, da, en, hand-written): that they imply nothing about the right of
   withdrawal or its dates, and that *Delivered* says only what the carrier reported (*{carrier} reports that the parcel was delivered*). Their subjects speak of one
   parcel of the order (*A parcel from order {number} at {store} has been delivered*), never of the order as delivered, since an order may come in several parcels
   and the 14 days run from the last (CRD Art. 9(2)(b)). Until this review, these emails and the words of item 2 are `HAND_WRITTEN_ONLY` (never machine-translated:
   another language shows the English).
2. **The tracking piece's words** (`m.tracking.*`): *Something has happened to this parcel: contact us*, *On its way back to us*: not a promise of a refund or a new parcel.
3. **Recording the receipt from a carrier event** (4.6): whether a carrier's *delivered* (including a parcel left in a mailbox or at the door, Helthjem's doormat
   delivery) is acquisition of physical possession under CRD Art. 9(2)(b) and the Norwegian, Swedish and Danish acts that implement it (their sections not read for this run), so that the 14 days may start from it; and whether `READY_FOR_PICKUP` must never start them (this spec: never).
4. **The set of required notifications** (4.1): Art. 8(7) for the confirmation; whether the change confirmation, the renewal confirmation and the return decision emails must
   also be required, or may be switched off by an owner who tells customers another way.
5. **The editor's note on marketing** (4.3) and the reading of ePrivacy Art. 13 it rests on.
6. **Owner-edited texts** are the owner's responsibility; the editor says so in a line. No starter or suggested wording is written by Kaizen for them, and AI translation
   suggestions (5.5) are ticked by a person.

---

## 9. For the lead

### 9.1 Migrations expected

1. `pnpm db:generate` → `{timestamp}_notifications`: `notification_settings`, `email_templates`, `staff_alert_settings`, `staff_alert_recipients`, `store_events`,
   `order_rules`, `order_rule_runs`, `shipment_tracking`; `orders.delivered_source`, `held_at`, `held_reason`, `held_by_rule`, `held_by`.
2. `pnpm exec drizzle-kit generate --custom --name notifications_rules`: RLS on every new table; the checks of 3.2 that list catalogue ids and alert events; the
   functions and triggers of 3.3 and 3.4; `CREATE OR REPLACE` of `commerce.undo_shipment()` and `commerce.anonymise_order()` (patched, 3.3 points 7 and 8).
3. `--custom --name notifications_copy`: `CREATE OR REPLACE` of `commerce.duplicate_store()` (the `emails` choice; copies switches, `staff_alert_settings`, rules with
   product mapping).
4. `--custom --name notifications_plan_features`: the five plan-feature rows, granted to every plan.

All additive (add, never rename or drop; D5). The code that runs until the deploy finishes does not read the new columns.

### 9.2 Statements the Supabase migration tool would cancel, and things only the lead can do

- **No `DELETE` or `DROP` inside a new function** (pruning is application code, 3.5). The patched `duplicate_store()` and `anonymise_order()` keep the bodies they have:
  if either already holds a `DELETE` (the foundation agent checks and says so in 3.x As built), it is applied by CI's `release` job over a direct connection
  (`docs/ci-migrations.md`), as every migration is; **nothing is to be run by hand**. Never apply these to production first.
- After the deploy: record the four versions in `docs/decisions.md` (Migration versions).

### 9.3 Advisors to check after the deploy

Security: RLS enabled with no policy on the eight new tables (expected, as every commerce table); functions with a fixed `search_path`. Performance: indexes on
`email_templates.updated_by`, `notification_settings.updated_by`, `staff_alert_settings.updated_by`, `staff_alert_recipients.account_id`, `order_rules.created_by`/`updated_by`,
`order_rule_runs.event_id` and `order_id`, `shipment_tracking.order_id`, `orders.held_by`; no duplicate index on `store_events`.

### 9.4 Performance

`processStoreEvents()` reads at most 100 events a minute; `pollTracking()` at most 60 parcels per five minutes with 4 calls at once and a 4 s timeout each (worst case
well under the route's limit); the order pages add one indexed read of `shipment_tracking` by `(store_id, order_id)`; a template read is one primary-key read per email.

### 9.5 Draft of the decision row

| D238 | **Customer notifications, delivery tracking and staff alerts (wave 3).** `docs/wave-3-notifications.md` is the contract. **Notifications**: the order and return emails are a catalogue (`NOTIFICATIONS`), each with a per-event switch (`notification_settings`) asked through `notificationOn()`; the order confirmation, renewal and change confirmations, the withdrawal acknowledgement and the return decisions are required (the database refuses them off), the acknowledgement also locked. Owners write the subject, heading and one text block per language (`email_templates`) with named placeholders only, checked by `templateProblems()` (placeholders, braces, no web addresses, `findClaims()`), filled by `fillTemplate()` in the order's language and currency, falling back per slot to the fixed text; preview with a sample order and a test email; copied with a store only when the owner ticks *Email texts* (copy group `emails`). **Tracking**: tracked parcels are polled every five minutes (`pollTracking()`, `shipment_tracking`), carrier codes mapped to phases (`phaseOf()`; Bring verified, PostNord, Helthjem and Porterbuddy not yet), shown on the shopper's order pages from the stored rows; out-for-delivery and delivered emails once per parcel, off by default; a verified delivered code records `delivered_at` only through `record_carrier_delivery()` (sent in full, every parcel delivered, never over a date, `delivered_source = 'carrier'`). **Staff**: `store_events` (queued by triggers in the paying transaction, once per event) feed new-order and return-requested emails to the recipients the owner chose (members whose role may read them, or the contact address; owners by default), refund-overdue and low-stock move to the same recipients, a daily or weekly summary from D152's figures; no shopper's name, email, phone or address in a staff email. **Rules**: `when an order is paid and {conditions} then tag, notify or hold fulfilment` (`order_rules`, a closed list), run once per event (`order_rule_runs`), logged; a held order cannot be sent (`shipments_not_held()`). | 2026-10-1x | *Why:* the rows `orders.editable-notification-email-templates`, `orders.delivery-status-notifications-tracking-page` and `orders.staff-alerts-for-new-orders-order-automation`. Migration versions: (to fill). Still to do by a person: the legal review of section 8; verifying the PostNord, Helthjem and Porterbuddy codes; following one real Bring parcel to delivery in production. |

### 9.6 After the deploy (by a person)

1. Book one real Bring parcel on a store with tracking, watch the order page through *out for delivery* to *delivered*, and check `delivered_at` and the two emails
   (switched on).
2. Read PostNord's, Helthjem's and Porterbuddy's status lists from their portals with the stores' agreements and mark the verified codes with the URL and date.
3. Switch on a daily summary on a real store and read one.

### 9.7 Draft of the CLAUDE.md bullet

- **Customer notifications, tracking and staff alerts (wave 3, D238, `docs/wave-3-notifications.md`)**: the order and return emails are `NOTIFICATIONS`
  (`src/lib/notifications.ts`); every sender of one asks `notificationOn()` (`src/server/notifications.ts`, the only reader of `notification_settings` and
  `email_templates`) before an automatic or `notify` send, and required ones (confirmation, renewal, change, withdrawal acknowledgement, return decisions) cannot be off,
  also in the database. Owner text is only the subject, heading and intro of a notification per language, applied by `withTemplate()` with placeholders filled by
  `fillTemplate()` (`src/lib/email-template.ts`) after `templateProblems()` (no web address, no claim); the blocks the law and the money need stay the code's, and a
  missing template is the fixed text of the order's language. A new notification is an id in `NOTIFICATIONS`, `EMAIL_KINDS`, the database checks and its sender's
  `notificationOn()`. Carrier events are polled into `shipment_tracking` (`pollTracking()`), mapped by `phaseOf()` (`src/lib/tracking-phases.ts`: only a `verified`
  code sends an email or records a delivery), and shown to shoppers from the stored rows (`ParcelTracking`), never fetched while a page renders; `delivered_at` from a
  carrier is written only by `commerce.record_carrier_delivery()` and never over a date, and every writer of `delivered_at` sets `delivered_source`. Staff alerts read
  `store_events` (queued by triggers, once per event) and go to `alertRecipients()` (members whose role may read the email, or the contact address; owners by default),
  with no shopper's name, email, phone or address; rules (`order_rules`, a closed list in `src/lib/order-rules.ts`) run once per event and log `order_rule_runs`; a held
  order (`orders.held_at`) cannot get a shipment (`shipments_not_held()`).
