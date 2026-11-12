# DS-4 ✓ A page's title, its titles by language and its flags live only inside its content JSON, so lists read and parse whole pages

The database's shape (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 2.16.
- **Second check:** confirmed.
- **Where:** `supabase/migrations/20261111172839_baseline_1_schema.sql:28427-28440`, `src/server/pages.ts:664-683`, `src/server/pages.ts:715-737`, `src/server/page-modals.ts:16-28`, `src/server/pages.ts:362`, `src/server/design-presets.ts:567`, `src/server/home-takes.ts:190`, `src/server/submission-content.ts:177`, `supabase/migrations/20261111172839_baseline_1_schema.sql:4049`, `supabase/migrations/20261111172839_baseline_1_schema.sql:7818`
- **Evidence:** pages has 12 columns and no title: everything is in draft and published (baseline_1:28427-28440). listPublishedPages selects `published` for every page of a store and parses each (pages.ts:668-679); production: 79,778 calls, 781 s, 29 whole pages a call, the costliest app statement. publishedPageNames digs titles out with JSON operators (57,930 calls, 66 s) and usesRememberedModals runs jsonb_path_exists over every published page (68,878 calls, 121 s). All three are cached, so the counts are cache fills by builds, instances and revalidations. I timed the three shapes in PGlite on 1,392 pages made from ten real page documents: the whole documents 4.2 ms a call (252,719 bytes), the title by JSON operator 1.5 ms, a plain column 0.8 ms; the modal check 1.4 ms by path against 0.6 ms from a flag. I also added the three columns below to the real pages table in PGlite as stored generated columns: the statement runs, and an insert that names its columns gets them filled. Every insert into pages names its columns (9 in src, 4 in SQL functions).
- **Cost today:** About 968 s of database time per 78 days in three statements (41% of the app's listed statements), plus parsing about 29 documents per call in Node. After opening it grows with stores times deploys and with cache fills per instance. Paid by: The database; the server per uncached render and at build time
- **Saving:** Estimate. DQ-2 and DS-7 take most of the 781 s. The columns take what is left: about half of each title read and of each modal check (1.5 to 0.8 ms and 1.4 to 0.6 ms a call in PGlite), which is most of 187 s per 78 days today.
- **Risk:** Low to medium. What could break: a writer that copies a pages row without naming columns (none found); the copy, duplicate, staging and house-site tests would fail with 'cannot insert a non-DEFAULT value'. The modal rule moves from TypeScript text into a column expression; a test compares both on the modal fixtures before the old path is deleted.
- **Already tracked:** no (code review step 3.9 covers the catalogue, not pages)

## The fix

1. First the callers: DQ-2 in the queries dimension moves the 12 readers of one page to a publishedPageById() and the slug and title readers to a publishedPageIndex(). That removes most of the cost with no migration. The steps here are the structural part.
2. Custom migration for a helper (pnpm exec drizzle-kit generate --custom --name page_titles_fn, then node scripts/prune-snapshots.mjs): create function commerce.page_titles(p jsonb) returns jsonb, language sql, immutable, set search_path to '': select coalesce(jsonb_object_agg(t.key, t.value ->> 'title') filter (where coalesce(t.value ->> 'title', '') <> ''), '{}'::jsonb) from jsonb_each(case when jsonb_typeof(p -> 'translations') = 'object' then p -> 'translations' else '{}'::jsonb end) t.
3. src/db/schema.ts, table pages: add three stored generated columns with generatedAlwaysAs(): published_title text as (published ->> 'title'); published_titles jsonb as (commerce.page_titles(published)); remembered_modal boolean as (coalesce(jsonb_path_exists(published, '<the path at page-modals.ts:24>'), false)). pnpm db:generate writes one ALTER TABLE; pages is not a hot table, and the rewrite covers 1,389 rows today. No backfill and no writer changes: the database fills them.
4. src/server/pages.ts publishedPageNames() (:724): the title becomes coalesce(nullif(p.published_titles ->> ${locale ?? ''}, ''), p.published_title). src/server/page-modals.ts: select exists (select 1 from commerce.pages where <owned(storeId)> and published_at is not null and remembered_modal).
5. DQ-2's publishedPageIndex() selects published_title and published_titles instead of JSON operators.
6. Say in the Pages rule (docs/rules/admin/website.md, Pages) that the three columns are derived by the database and never written, and that the modal rule now lives in the column's expression: changing it is a migration that drops and adds the column.
7. Record the versions in docs/decisions.md; check the advisors.

**Done when:** rg -n "published (->>|#>>)|jsonb_path_exists\(published" src/server/pages.ts src/server/page-modals.ts prints no line inside publishedPageNames or usesRememberedModals, and on production a week after the deploy the two statements (57,930 and 68,878 calls so far) no longer grow in pg_stat_statements.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/pages.int.test.ts holds publishedPageNames and usesRememberedModals: add a page with a Norwegian title and a timed modal and expect the same answers as before; add a case that an update of the draft alone leaves the three columns as they were.
- src/db/commerce.test.ts: a new case that a published page gets published_title and published_titles, and that unpublishing empties them.
- Every path that inserts pages must still pass: src/server/page-duplicate.int.test.ts, src/server/store-copy.int.test.ts, src/db/house-site.test.ts (the site copied into the house store), src/db/design-presets.test.ts, src/db/store-starters.test.ts, the site staging tests, src/db/sandboxes.test.ts. A generated column refuses a written value, so a copy that selected every column would fail here.
- src/server/store-export.scan.test.ts and src/db/privacy.test.ts (the registers' detectors read new columns).
- pnpm db:check, src/db/snapshots.scan.test.ts, src/db/migration-safety.scan.test.ts.

**Comes after:** DQ-2 (the queries dimension's fix for the same reads; do the callers first); DS-7 (the owned() helper for the changed where clauses)

**Notes:** The verified report proposed columns written at publish by every publishing path; stored generated columns need no writer, which removes that risk. Before opening is the cheap moment: the table rewrite is 1,389 rows now.
