# PM-6 ✓ Facts about a page are dug out of its JSON on each read; the table has no column for them

The page builder's model and a built page's render (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** M. **Confidence:** medium. **Step:** 2.19.
- **Second check:** confirmed.
- **Where:** `src/server/page-modals.ts:16`, `src/server/site-cookies.ts:100`, `src/components/consent/site-consent.tsx:52`, `src/server/pages.ts:724`, `src/server/content-grid.ts:265`, `src/db/schema.ts:8785`, `src/db/schema.ts:2752`, `src/server/global-parts.ts:166`, `supabase/migrations/20261111172839_baseline_1_schema.sql:7818`
- **Evidence:** `pages` holds an id, a type, a slug, two JSON documents and dates (schema.ts:8785-8806). usesRememberedModals() runs jsonb_path_exists over every published page of a site for one yes or no (page-modals.ts:20-26); the consent banner asks it on every page outside the pay routes (site-consent.tsx:52 through siteCookies): 68,878 calls and 121 s in production. publishedPageNames() pulls each title out by path for the menus of every page (pages.ts:724): 57,930 calls returning 497,123 rows. Counted in this pass: the documents are written by 9 insert statements in 4 server files, at least 18 update statements in 10 files, four SQL functions of the baseline (lines 4049, 4354, 5283, 7818) and the seed. So a column that each writer must fill would be a second truth with about 30 writers. Every one of those inserts names its columns, and the schema already has the pattern that avoids the problem: stored generated columns (schema.ts:2752, :3587, two search columns).
- **Cost today:** Two of production's most-called statements; each opens every published document of the store (and, until PM-4, passes over every other store's rows). Both are under `use cache`, which runs once per cold instance per store, not once per change. Paid by: The database; the server per cache miss
- **Saving:** Estimate: after PM-4 each call reads about 30 documents instead of the table; with the columns it reads none. Not measured.
- **Risk:** Low with generated columns: no writer can forget them. The modal rule then lives in SQL and in lib/page-modal.ts; the test in step 5 holds them together. The table rewrite is instant at 1,389 rows and would not fit a 15 s statement on a table of some gigabytes, so this is one of the few changes here that gets harder with every store.

## The fix

1. First PM-4 and PM-2: they confine both reads to the store's own rows and take most callers off whole documents, with no migration.
2. A custom migration for a helper (pnpm exec drizzle-kit generate --custom --name page_titles_fn, then node scripts/prune-snapshots.mjs): function commerce.page_titles(p jsonb) returns jsonb, language sql, immutable, with an empty search_path: the object of each locale's non-empty title under p -> 'translations', or an empty object.
3. src/db/schema.ts, table pages: three stored generated columns with generatedAlwaysAs(): published_title text as (published ->> 'title'); published_titles jsonb as (commerce.page_titles(published)); remembered_modal boolean as (coalesce(jsonb_path_exists(published, the path at page-modals.ts:24), false)). pnpm db:generate writes one alter table. No writer changes and no backfill: the database fills them, for every writer.
4. src/server/pages.ts publishedPageNames() (:724): the title becomes coalesce(nullif(p.published_titles ->> the locale, ''), p.published_title). src/server/page-modals.ts: select exists (select 1 from commerce.pages where the owner's filter and published_at is not null and remembered_modal). PM-2's publishedPageIndex() selects the two title columns instead of JSON operators.
5. docs/rules/admin/website.md (Pages): say the three columns are derived by the database and never written, and that the modal rule now lives in the column's expression, so changing it is a migration that drops and adds the column. Keep lib/page-modal's own test of the same rule, and add a test that holds the SQL path and the code's rule together over sample modals.
6. Record the versions in docs/decisions.md; check the advisors after the deploy.

**Done when:** rg -n "published (->>|#>>)|jsonb_path_exists\(published" src/server/pages.ts src/server/page-modals.ts prints no line inside publishedPageNames() or usesRememberedModals(), and the new cases in src/db/commerce.test.ts pass.

**Tests and rules that hold today's behaviour, and change with it:**

- src/db/commerce.test.ts: every migration on PGlite; add cases that the columns follow an insert, an update of `published` and an unpublish. pnpm db:check; src/db/snapshots.scan.test.ts.
- src/server/pages.int.test.ts (menus' titles in two languages), src/server/consents.int.test.ts and the cookie list's tests (a remembered modal lists its preference cookie), src/components/page-modal.test.ts.
- Migration rules (CLAUDE.md, Database): add only; pages is not on the hot-table list, but a stored generated column rewrites the table under a lock, and production allows a statement 15 s.

**Comes after:** PM-4; PM-2

**Notes:** The verified report proposed columns written when a page is saved and named the risk itself (a second source of truth). Counting the writers in this pass (about 30) settles it for columns the database derives, as DS-4 (schema) also plans; do it once. The saving is not measured, so it is P1 for its timing, not for its size: before opening the rewrite is free.
