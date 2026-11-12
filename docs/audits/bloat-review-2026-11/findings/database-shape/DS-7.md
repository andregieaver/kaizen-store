# DS-7 ✓ `store_id is not distinct from` keeps Postgres from using the store indexes

The database's shape (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P0. **Effort:** M. **Confidence:** high. **Step:** 0.18.
- **Second check:** confirmed.
- **Where:** `src/server/pages.ts:71`, `src/server/pages.ts:694`, `src/server/pages.ts:728`, `src/server/page-modals.ts:23`, `src/server/site-cookies.ts:46`, `src/server/cookie-scans.ts:97`, `src/server/taxonomy.ts:60`, `src/server/page-versions.ts:53`, `src/server/media-library.ts:77`, `supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:106-112`, `docs/rules/storefront.md:179`
- **Evidence:** 122 uses in 40 files (my rg, tests left out). Postgres does not answer IS NOT DISTINCT FROM from a btree index; the verified check ran EXPLAIN ANALYZE in a local Postgres 18.6 on 50,000 rows of the pages shape: a sequential scan (3.5 ms) against an index scan for `=` (0.46 ms) and for `is null`. Production agrees: pages had 199,789 sequential scans reading 203 M rows although (store_id, type, slug) exists; cookie_scans 1,101,927 scans and 962 M rows; terms 183,724. The every-minute cookie-scan claim runs two such subqueries for each site (49,338 calls, 192 s). Other files already write the indexable form through a private owned() helper (media-library.ts:77). The written rule at docs/rules/storefront.md:179 asks for today's wording.
- **Cost today:** About 1.2 billion rows read by scan in 78 days. Small in time today. It grows with stores times rows per table, and the cookie-scan claim grows with stores squared: every site's subquery scans every site's scans, every minute. Paid by: The database
- **Saving:** Estimate: the sequential scans on pages, cookie_scans, terms and menus become index reads; a few seconds of database time a day now, and at scale the difference between an index probe and a full scan on each cache fill and each minute.
- **Risk:** Low. Only where clauses change. What could break: a call that passed null and now needs the `is null` branch; the int tests that run the platform's rows catch it.

## The fix

1. New src/server/owned.ts: export const owned = (storeId: string | null, column = sql`store_id`) => (storeId ? sql`${column} = ${storeId}::uuid` : sql`${column} is null`). The branch must be in code: `store_id = null` matches nothing. Replace the private copies (media-library.ts:77 and the others rg 'const owned' src/server finds) with the import.
2. Move the hot reads first: pages.ts:71 (ownedBy), :694, :697, :728, :733; page-modals.ts:23; taxonomy.ts:59-60; site-cookies.ts:46 and :55; cookie-scans.ts:97-98; page-versions.ts:53 and :71. In the cookie-scan claim, handle the platform's row apart so each subquery is a plain equality.
3. Then the other files, most uses first (rg -i -c 'store_id is not distinct from' src). Where both sides are columns of a join, write the store branch and the platform branch as a union all, or keep the wording with a comment saying why.
4. Leave unique keys, on-conflict targets and the pg_cron retention job at baseline_4:106-112 as they are (the job runs once a day; change it when the scheduler block is next folded).
5. Hold it: in scripts/lib/ratchet-count.mjs count per file the lines with `store_id is not distinct from` followed by a parameter; write the counts into src/server/ratchet.baseline.json through node scripts/ratchet.mjs; add a case to src/server/ratchet.scan.test.ts that no file's count rises.
6. Reword docs/rules/storefront.md:179 ('every query asks store_id is not distinct from') to 'every query filters with owned(storeId)'. The rule's reason, one query for a store and for Kaizena Flow, is kept.

**Done when:** The ratchet's new count of `store_id is not distinct from` sums to no more than the commented column-to-column joins left (122 today by rg -i -c over src), and on production seq_scan of commerce.cookie_scans in pg_stat_user_tables grows by fewer than 1,000 a day (about 14,000 a day today: 1,101,927 in 78 days).

**Tests and rules that hold today's behaviour, and change with it:**

- The int tests that run a store and the platform's null through these reads: src/server/pages.int.test.ts, redirect-resolve.int.test.ts, country-content.int.test.ts, consents.int.test.ts, cookie-scans.int.test.ts, page-versions.int.test.ts.
- src/server/ratchet.scan.test.ts and scripts/lib/ratchet-count.mjs:39, which recognises owned( by name for the by-id-writes count: an imported helper must still count.
- src/lib/sql-raw.scan.test.ts: the helper uses sql templates, not sql.raw.
- Rule: docs/rules/storefront.md:179, changed in step 6.

**Notes:** The same work as DQ-8 in the queries dimension, with the same helper and ratchet: do it once, and first, so the new reads of DS-4 and DS-5 are written with the helper from the start. The ten hot reads alone are S.
