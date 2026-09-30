# Duplicating a store (D129)

An owner makes a new store from one of theirs and chooses what comes along. The wizard is under `/admin/stores`
(`src/components/admin/store-copy-wizard.tsx`); this note is about what the server does and why. The contract the wizard
and the server share is `src/lib/store-copy.ts`; the audit of every table is `src/lib/store-copy-rules.ts`.

## What the owner chooses

Pages, products and blog posts (all, some, none), customers, and order history. A store's settings always come. Customers
and orders need the owner's say-so that they may use that data in the new store (`confirmDataUse`). Only an **owner** of the
source store may copy it (staff may not; platform admins may copy any store), and the new store is checked as
`createStoreForOwner()` checks one: a free, well-formed address (made from the name when empty), at most
`MAX_STORES_PER_OWNER` stores, and no more than three copies running at once. The new store is owned by the person copying
and nobody else, is not set up yet (`setup_completed_at` is null, so it is a preview), and has no Stripe account, so
checkout stays off until its owner connects payments.

## What is copied

| Group | Tables | Meaning |
|---|---|---|
| Settings (always) | `markets`, `store_currencies`, `shipping_rates`, `payment_methods`, `payment_providers` (switches), `economic_operators`, `producer_registrations`, `inventory_locations`, `store_locations`, `booking_resources`, `customer_tiers`, `customer_companies`, `discount_codes`, `campaigns`, `cart_reminder_steps`, `delivery_schedules`, `chat_agents`, `knowledge_documents`, `cookie_notes`, `store_themes`, `saved_parts` (as private ones), `template_activations`, `terms`, `menus`, `field_groups`, `page_roles`, and the `stores` columns (business details, languages, theme, navigation, custom CSS, modules but Work; tracking ids and the store's own code are NOT copied: they belong to the original's site) | The store's set-up, but for secrets and other people's rights. Headers, footers and product layouts (page types) are settings too. |
| Products (chosen) | `products` (not archived), `product_translations`, `product_media`, `product_variants`, `prices` (current only, as new prices), `inventory_levels` (stock on hand), `selling_plans`, `product_terms`, `product_schemes`, `appointment_settings`, `booking_seasons`, `product_resources`, `field_values` of them | Statuses are kept, but a download whose files stay behind waits as a draft. |
| Pages and posts (chosen) | `pages` (draft and published, with the dates a post was first published) | Category, tag, menu, field group and saved part ids are the copies'. |
| Customers (chosen) | `customers`, `email_opt_outs` | See below. |
| Orders (chosen) | `orders`, `order_lines`, `order_events` (one `copied` event) | See below. |
| Rebuilt | `field_search`, `knowledge_chunks`, `media`, `media_embeddings`, `product_embeddings`, `search_cache` | Made again by code (search, chunks, vectors) or by the media phase. |
| Never | Stripe accounts, payment credentials, domains, integrations and their queue, AI provider keys, billing, invoice/credit note/order/Work numbering (`document_series` starts again), the team, hosts, Work (`work_*`), consents, carts, wish lists, sessions and sign-in codes, subscriptions and subscription box lists, payments, refunds, invoices, shipments, returns, bookings, logs (audit, search, email, webhook, AI, chat), calendar feeds and blocks, cookie scans, form submissions | Secrets, things that only make sense for the original, or personal data with no use in a new store. |

The exact list, with a reason for each table, is `COPY_RULES`. `src/db/commerce.test.ts` fails when a table with a
`store_id` column is not in it.

### What copying a thing leaves out

- **Things not copied are not referred to.** A menu link to a product that was not copied goes, with the items under it; a
  campaign or discount code for products that were not copied is switched off (it would otherwise reach the whole store); a
  campaign that gives a product that was not copied is left out; a relation or link in a custom field to a product, page or
  term that was not copied is taken out. This is `commerce.copy_remap()` (ids of copied things become the copies', ids of
  things left behind are pruned) and `commerce.copy_menu_items()`; nothing of the new store names the original's things
  (tested).
- **Ids** of copied things are `commerce.clone_id(new_store, old_id)`, as for the demo template (`clone_store()` is
  unchanged).
- **Team and hosts**: only the requester is a member; hosts and their resources stay with the original.

## Phases

`startStoreCopy()` runs the content step at once, in one transaction: `commerce.duplicate_store(source, slug, name, owner,
page_ids, product_ids, post_ids)` (a null array is all, an empty one none) and the row in `commerce.store_copies`. The owner
has the new store, with its settings, pages, products and posts, when it returns. The rest is a job, started at once with
`after()` and taken up again by the five-minute cron (`runStoreCopies()` in `/api/cron/cart-reminders`), one run at a
time per copy (a claim in `claimed_until`), each run within 40 seconds:

1. **Media** (`src/server/store-copy-media.ts`): see below.
2. **People**: `commerce.copy_customers()` in batches of 250 by id (the cursor is in the row), then `commerce.copy_opt_outs()`.
3. **Orders**: `commerce.copy_orders()` in batches of 100.
4. **Finishing**: the chat agent's documents cut, field search and vectors rebuilt (best effort), a last check that no table
   copied names a file of the original (`tablesPointingAtOriginal()`), caches refreshed, `status = done`.

Every batch is its own transaction and idempotent (`on conflict do nothing` on the `copied_from` key), so a run that dies is
taken up again where it was. A run that fails leaves the claim; a copy taken up more than six times without progress is
stopped (`status = failed`, a plain `problem`); progress is in `counts` and `phase` and read by `copyProgress()`.
`commerce.copy_customers()` and `copy_orders()` only run into a store a copy is running for (`assert_copy_running()`).

## Customers

Shoppers only (staff are accounts, never copied), with name, contact details, address, company details, group and company
(the copies of them), locale and dates. **Never** a password, sign-in, session, verified email, profile picture, wish list, cart or
consent: the shopper signs in again and proves the email is theirs. No `customer.created` integration event is queued
(`integration_customer_events()` skips copies). **People who unsubscribed stay unsubscribed**: `email_opt_outs` is copied
when customers or orders are. Custom field values of customers (staff notes) come with them.

## Order history

A copied order is **read-only history**: `orders.copied_from` is the original's id (unique per store), the number is
`C-{original number}` (so it never collides with the new store's own series, which starts again at 1001), and it keeps its
lines, addresses, totals, dates, discount, campaign and group snapshots as they were. The customer link is kept where that
customer was copied, else the contact details on the order are all there is. Orders still waiting for payment are not
history and are not copied. The order has no cart, subscription, host, commission or balance to collect, and one event:
`copied` (the original's number, status and date). Nothing is reserved or taken from stock.

It is enforced in the database (`store_copy_rules` migration), not left to readers:

- the order cannot change (`orders_copied_read_only`; only its customer link may be let go when that customer deletes their
  account), nor can its lines;
- payments, shipments, invoices, download links, bookings, stock reservations, returns, withdrawals, host commissions, emails
  about it, standing deliveries and any event but `copied` are refused for it (`refuse_copied_order()`);
- `integration_order_events()` queues nothing for it;
- `complete_order_payment()` and `cancel_unpaid_order()` find nothing to do (it is never waiting for payment).

Readers that add up money, count uses, list work to do or reach customers also skip it by name, so no figure moves:
`owner-insights` (`paid` and the funnel), the control center (sales, to send, latest orders), discount and campaign usage,
customers' spend and their My account (`claimOrders()`, `listCustomerOrders()`, `ownsOrder()`), the admin order list (shown
as history, never as to send or unpaid), the assistant's tools (overview, sales, checkup, get order readable, everything that
changes, sends or refunds refused), the integrations' test payload, shopper emails, and the order admin actions
(`COPIED_ORDER_MESSAGE`). Cart reminders, subscription boxes, host commissions, bookings, DAC7 and the subscription code read
orders through a cart, subscription, host, booking or payment that a copy has none of.

## Pictures and files

`copyStoreMedia()` finds every address of a file in the original's folder of the public buckets (`{bucket}/{storeId}/…`) that
the copy holds, in product and variant pictures, pages and posts, menus, saved parts, the theme, logos and icon, custom CSS,
the chat agent's picture, cart reminder content and custom field values (customers' and orders' values are never read). Each
file is copied once inside Storage (`copyToLibrary()` for a library item, with its small copy and alt texts; `copyStoredFile()`
for a file the library never registered, and for custom fields' files) into the new store's folder and registered in its
library. `store_copy_files` remembers the new address of each, so a run that stops goes on without copying twice. Then every
address is rewritten: pages through `mapTemplateMedia()` (blocks, backgrounds, videos) and everything else by
`rewriteFiles()` (`src/lib/store-copy-media.ts`). A file that cannot be copied is left out, never left pointing at the
original: a picture or video object goes whole, a list loses the item, a text loses the address, a product picture is
removed (a product left with none and on sale becomes a draft). They are counted in `media_left_out`. Other sites' files and
Kaizen's demo pictures are not the original's and stay as they are.

## Adding a store-owned table

1. Add it to `COPY_RULES` with a group and a reason (the test fails until you do).
2. If it is copied: settings and products go in `commerce.duplicate_store()`, customers in `copy_customers()`, orders in
   `copy_orders()`, in a new migration (custom, `pnpm exec drizzle-kit generate --custom --name …`) that replaces the
   function; add a case to `src/db/commerce.test.ts` and a scenario to `src/server/store-copy.int.test.ts`.
3. If it holds a picture or file address, add its column to `CARRIERS` in `store-copy-media.ts`.
4. If it acts on an order (a table with `order_id`), add the `refuse_copied_order()` trigger.
5. A new reader of orders that adds up money, counts uses or sends mail excludes `copied_from is not null`.
