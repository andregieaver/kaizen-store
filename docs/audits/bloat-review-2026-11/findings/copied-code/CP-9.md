# CP-9 ✓ Three SQL fragments are typed out in dozens of files: the product title with its fallback, the usage counter and the order event

Copied code (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** 3.15.
- **Second check:** confirmed.
- **Where:** `src/server/catalog.ts:297`, `src/server/catalog.ts:315-322`, `src/server/exchanges.ts:511`, `src/server/wishlist-admin.ts:179`, `src/server/reviews.ts:181-190`, `src/server/request-budget.ts:138-151`, `src/server/order-actor.ts:17-29`, `src/server/return-facts.ts:190`
- **Evidence:** The join that finds a product's title in a language with a fallback to any language is in 33 files and 40 places (second check, multi-line rg; my one-line rg finds 35 in 27 files). Its result is spelled six ways: coalesce(tl.title, tf.title, p.handle) 28 times, coalesce(tl.title, tf.title) 9 times with no fallback to the handle, and four one-offs. `insert into commerce.chat_usage` is written 32 times in 28 files although request-budget.ts wraps the same upsert (:145-151) and 33 files import it. `insert into commerce.order_events` is written 34 times in 23 files beside two helpers: writeOrderEvent (order-actor.ts:17, read) and writeEvent (return-facts.ts:190).
- **Cost today:** About 250 lines; a product with no title row shows a null title in nine reads and its handle in 28. Paid by: Agents and the build; shoppers and owners where the fallback differs.
- **Saving:** About 250 lines (estimate) and one definition of the title a person sees.
- **Risk:** Low for the counter and the event (same statement, one place). The title change alters nine reads' result for a product without a title row: check each caller, and expect a snapshot or an integration test to show a handle where it showed nothing.

## The fix

1. Add src/server/product-title.ts: titleJoin(productAlias, locale) returns the two joins as one sql fragment with the fixed aliases tl and tf; titleOf(productAlias) is coalesce(tl.title, tf.title, p.handle). Replace the 40 places (catalog.ts:297, exchanges.ts:511, wishlist-admin.ts:179, reviews.ts:181-190 and the rest).
2. For the nine reads that coalesce without the handle, read the caller first: where code tests for a null title keep a titleOrNull() variant; otherwise switch to titleOf().
3. src/server/request-budget.ts: export bumpUsage(executor, storeId, bucket, window) from the statement at :145-151 and replace the 32 hand-written upserts in 28 files.
4. Use writeOrderEvent (order-actor.ts:17) for the 34 hand-written inserts in 23 files and make return-facts.ts:190 writeEvent a re-export of it.
5. Add a scan test that only product-title.ts, request-budget.ts and order-actor.ts contain the first line of each statement.

**Done when:** `rg -c 'insert into commerce[.]chat_usage' src --glob '!*.test.ts'` sums to at most 2 (today 32 in 28 files) and `rg -c 'insert into commerce[.]order_events' src --glob '!*.test.ts'` to 1 (today 34 in 23 files).

**Tests and rules that hold today's behaviour, and change with it:**

- request-budget.int.test.ts and budget-fail-closed.test.ts for the counter; the order integration tests that read order_events (order-edit, exchanges, fulfilment, draft-orders, order-archive .int.test.ts) for the event.
- Scan tests that read SQL text in these files and must still find what they look for: src/server/money-reads.scan.test.ts, selling-readers.scan.test.ts, price-readers.scan.test.ts, restricted-orders.scan.test.ts.
- src/server/ratchet.scan.test.ts: run node scripts/ratchet.mjs if a moved read lowers a file's count.
- docs/capacity.md and docs/security.md name request-budget; docs/wave-3-orders.md names the order event's writer (D173: every write of order operations carries an actor, which writeOrderEvent already takes).

**Notes:** A SQL function commerce.product_title(product_id, locale) would also work but needs a migration and hides the join from the planner; the fragment is the smaller change.
