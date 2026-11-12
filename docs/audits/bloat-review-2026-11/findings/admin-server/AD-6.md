# AD-6 ✓ The platform Home holds its first paint for 18 statements and reads whole lists to show a number

What the server does for an admin navigation (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** 4.4.
- **Second check:** confirmed.
- **Where:** `src/app/admin/(gated)/platform/page.tsx:38-44`, `src/server/platform-overview.ts:22-47`, `src/server/platform-overview.ts:58`, `src/server/billing.ts:104-122`, `src/server/ai-usage.ts:134-153`, `src/server/platform-briefing.ts:81-112`, `src/server/plan-analytics.ts:44-82`, `src/app/admin/(gated)/platform/layout.tsx:67`, `src/components/admin/admin-shell-parts.tsx:25-31`, `src/server/platform.ts:206-210`
- **Evidence:** The page awaits five loaders in one Promise.all with no Suspense. platformOverview() calls listPlans() (3 statements with sub-counts and the Stripe sync table) to show plans.length, and usageRows() (a grouped join over ai_usage with prices, accounts and stores) to show two totals. planAnalytics(30) returns one row per store's plan and every plan move of the period and sums them in code. Pending access requests are counted four times on a hard load: layout line 67, the level switcher's own cached copy, the overview and the snapshot. Two definitions are in use: platform.ts:208 leaves out unconfirmed self-serve requests, the overview (platform-overview.ts:24-26) does not, so the tab's badge and the Home's figure can disagree.
- **Cost today:** 18 statements before the page paints and 6 or 7 in the layout; 4 of them count the same thing. Only the platform's own team opens this page, so the total is small; the plan lines grow by one row per store per view once stores sign up. Paid by: The platform's team on each visit; the database.
- **Saving:** Estimate: 18 statements to about 11, and the attention list after about 5.
- **Risk:** Low. Choosing one definition of 'waiting' changes the Home's figure where unconfirmed self-serve requests exist; say so in the commit. The plan lines' sums must stay per currency, never across currencies.

## The fix

1. src/server/platform-overview.ts:44: count plans with one select count(*) from commerce.plans instead of listPlans().
2. src/server/platform-overview.ts:45: sum AI requests and failures of the last 7 days in one aggregate over commerce.ai_usage without the joins (a small aiTotals(days) in src/server/ai-usage.ts, read through typedRows()).
3. src/server/platform.ts:206-210: make countPendingRequests() the one count, behind React cache(), and use it in the layout (line 67), the switcher (admin-shell-parts.tsx:25), the overview and the snapshot. Keep its definition (unconfirmed self-serve requests are not yet waiting for the team); the overview keeps its own read only for the oldest date, with the same filter.
4. src/server/plan-analytics.ts:44-82: sum the plan lines in SQL (group by plan and currency) instead of returning one row per store.
5. src/app/admin/(gated)/platform/page.tsx: draw the attention list from the overview first and put the month's figures (platformSnapshot) and the last-7-days section behind Suspense, as the store Home does.

**Done when:** AD-12's budget test holds the platform Home's loaders to 11 statements or fewer (18 today), and rg finds one definition of pending requests (the filter of platform.ts:208) in src/server.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/platform-overview.int.test.ts, src/server/plan-analytics.int.test.ts, src/server/store-starters.int.test.ts (it reads the overview).
- e2e/signed-in/platform-reports.spec.ts and the platform cases of e2e/signed-in/a11y.spec.ts.
- src/server/ratchet.scan.test.ts (new reads through typedRows()).
- Rule: docs/rules/admin/platform.md:16 names platformOverview() as the platform's twin of the control center; the parity rule in CLAUDE.md is why this page gets the same care as the store Home.

**Comes after:** AD-12 step 1 (the statement counter)

**Notes:** Few people ever load this page, so it comes after the store shell and Home. It is listed because the platform must not lag the stores (the parity rule), and the two definitions of one number are a small correctness matter worth fixing on their own.
