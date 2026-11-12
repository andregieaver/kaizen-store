# DQ-4 ✓ Each request for an AI connection sums the store's whole month of AI usage

How data is asked for (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.21.
- **Second check:** confirmed.
- **Where:** `src/server/ai.ts:207-239`, `src/server/limits.ts:121-153`, `src/server/usage-sql.ts:36-57`, `src/server/ai-price-sql.ts:16-36`, `src/server/usage-meter.ts:40-48`, `docs/capacity.md:606-612`
- **Evidence:** aiFor() is named on 92 lines in 65 files (my rg). For a store on the platform's key whose plan has a limit it calls aiRoomLeft(), which sums every ai_usage row of the month with a lateral price lookup per row and a euro conversion per day (usage-sql.ts:48-57, which I opened). The one-minute memo (limits.ts:122, 139-144) lives in one function instance and ticks are five minutes apart, so it helps only within one run. The daily totals already exist: usage-meter.ts:45 writes ai_cost_micros per store and day. docs/capacity.md:610-612 describes month keys as the month's daily rows plus today's live count; the code sums the whole month live instead, though storage_bytes at limits.ts:145-153 already does it the described way. Production: 6,782 calls at 37 ms and 1,732 at 57 ms, about 352 s, the third most expensive app statement, on 19,104 rows.
- **Cost today:** About 352 s in 78 days; 37 to 57 ms in front of AI features and of each job that asks per store. It grows with a store's usage through the month and with the number of stores the five-minute jobs ask for. Paid by: The database; a shopper or owner waiting for an AI answer; each five-minute job that asks per store.
- **Saving:** Estimate: about 90% of the 352 s (one day's rows instead of a month's), and the cost stops growing through the month.
- **Risk:** A day counted twice or missed at the boundary would move a store's limit: the two new test cases hold it. Past days are as good as the nightly measure; a price added later is covered by step 3. A wrong figure would show on Usage and limits and as a store refused AI early.
- **Already tracked:** not as a step. docs/capacity.md:610-612 already describes the intended shape (daily rows plus today's live count); the code does not follow it.

## The fix

1. In src/server/limits.ts liveValue(), case 'ai_cost_micros' (lines 138-144): month to date = the sum of this month's store_usage_daily rows for the metric, plus a live aiCostSql() from the start of the day after the latest measured day (or from the month's start when no day is measured yet) to now. Take the day bounds from the dayBounds() of usage-meter.ts:18 (export it), so a call is counted once: never in a measured day and in the live part. Keep the 60 s memo.
2. The same for 'marketing_emails' (lines 135-136) with emailsSql().
3. A price added later for past dates must re-measure: in the writer of model prices (src/server/ai-prices.ts) call measureDay(day, false) for each day of the current month after a price with a start date in the past is saved, or the limit reads low. Add an int test for it.
4. Read the new sum through typedRow() with the file's column helpers, as money-reads.scan.test.ts asks of reads that carry money.
5. docs/capacity.md:610-612 already describes this shape: leave the text, and add one line that the live part starts after the latest measured day.

**Done when:** limits-enforce.int.test.ts passes with a month of seeded usage split across measured days and today, and on production a week after the deploy the mean_exec_time of the ai_usage cost statement issued from limits.ts is under 5 ms in pg_stat_statements (37 to 57 ms today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/limits.int.test.ts and src/server/limits-enforce.int.test.ts (docs/dpia-ai.md:62 names the second as the proof that a store on Kaizena Flow's key stops at its plan's monthly limit): add a case with usage spread over measured days and today, and one where yesterday is not measured yet.
- src/server/usage-meter.int.test.ts (measureDay), src/server/ai-cost.int.test.ts, src/server/ai-usage.int.test.ts, src/lib/limits.test.ts.
- src/server/money-reads.scan.test.ts and src/server/ratchet.scan.test.ts (no new unchecked read).
- docs/capacity.md:606-612 is the written rule; the fix makes the code follow it.

**Notes:** Production's statement text is an older shape than today's code (before the euro conversion), so today's cost per call is at least as high.
