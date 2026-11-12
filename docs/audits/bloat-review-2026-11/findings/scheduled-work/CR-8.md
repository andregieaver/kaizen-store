# CR-8 ✓ Kaizena Flow's own payouts are read from Stripe every five minutes

Scheduled and background work (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** 3.3.
- **Second check:** confirmed.
- **Where:** `src/server/platform-books.ts:238-245`, `src/server/platform-payouts.ts:80-107`, `src/server/payouts.ts:184-189`, `src/server/invoice-issue.ts:119`, `src/server/subscriptions.ts:789-810`, `src/server/cron-runs.ts:81-91`
- **Evidence:** runPlatformBooks() calls stripe.payouts.list for the last 40 days in every mode that has keys, on every dispatcher run, with no throttle, and upserts every payout it gets back each time. Payouts arrive at most daily. Stores' payouts, by contrast, are read once a day per store through payout_reads (payouts.ts:184-189). Separately, invoiceJobs() calls ensureSubscriptionEvents for test and live; it remembers the answer only in the instance's memory, so each cold instance asks Stripe for the webhook endpoint again.
- **Cost today:** 1 to 2 Stripe API calls per run: 288 to 576 a day, whatever happens. Once payouts exist, also one upsert per payout of the last 40 days per run. Up to 2 more Stripe calls per cold start (how often is not known). Paid by: The server per run, and Kaizena Flow's Stripe rate limit.
- **Saving:** About 288 to 576 Stripe calls a day to 24 to 48 (hourly) or 1 to 2 (daily).
- **Risk:** A payout is posted to the books up to an hour (or a day) later than now. It would be noticed on Platform, Books as a payout that appears late; nothing is lost.

## The fix

1. src/server/platform-books.ts:238-245: split runPlatformBooks() in two. readPlatformPayoutsDue() does the Stripe read; postPlatformMoney() (no network) stays the five-minute job's part.
2. src/app/api/cron/cart-reminders/route.ts: run the read as its own job 'platformPayouts' with an hourly cadence (CR-2): 24 to 48 Stripe calls a day, and a failed read is tried again within the hour. Without CR-2, use claimDay('daily.platform-payouts', today in Europe/Oslo, 'Europe/Oslo') and tracked('daily.platform-payouts', 86_400, ...) in the same file, as src/server/ui-nightly.ts does; a failed day then waits for the next.
3. Optional, when the file is next touched: src/server/subscriptions.ts:789-810 keeps 'events checked' in memory. Keep the wanted event list beside the endpoint in commerce.platform_webhooks (a text[] column) and call Stripe only when it differs from WEBHOOK_EVENTS; keepStripeWebhooksCurrent() already reads that table each run.
4. Reword the rule 'Kaizena Flow's own money in the books (D508)' in docs/rules/admin and the comment at platform-books.ts:234-237.

**Done when:** In platform-books.int.test.ts a counting Stripe stand-in sees payouts.list once per mode for two runs in the same hour, and in production the ledger row dispatcher.platform-payouts has every_seconds 3600 (or daily.platform-payouts exists).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/platform-books.int.test.ts (runPlatformBooks with a stand-in Stripe: follow the split; add 'two runs in one hour read Stripe once per mode').
- src/lib/platform-payouts.test.ts and src/lib/platform-books.test.ts stay.
- If claimDay is used: src/server/cron-routes.scan.test.ts:29-41 requires the claimed job to run as tracked('<job>', 86_400, ...) in the same file.
- src/server/invoice-issue.int.test.ts and src/server/stripe-endpoints.int.test.ts for step 3.

**Comes after:** CR-2 (the hourly cadence), or use claimDay without it

**Notes:** No payout event is handled in src/server, so a webhook is not an alternative today.
