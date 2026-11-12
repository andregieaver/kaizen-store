# DQ-3 ✓ "Where is this picture used" scans every page's text for each picture, and the job re-checks every picture daily

How data is asked for (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** M. **Confidence:** medium. **Step:** 0.21.
- **Second check:** confirmed.
- **Where:** `src/server/media-library.ts:317-391`, `src/server/media-library.ts:793-831`, `src/server/media-library.ts:860-876`, `src/server/alt-texts.ts:110`, `src/server/media-compress.ts:77`, `src/server/media-compress.ts:149`, `docs/media-compression.md:59`, `docs/rules/admin/website.md:676`
- **Evidence:** mediaUses() joins each picture to every page of the site and tests position(m.url in pg.draft::text) and the same on published, so both documents of every page are cast to text per picture; it does the same over entries, menus, saved parts, theme looks and settings in 12 union branches (media-library.ts:321-381). Production: 1,831 calls at 145 ms, and other shapes 43 at 925 ms, 198 at 133 ms, 205 at 66 ms, 776 at 47 ms: about 382 s in all, the second most expensive app statement. embedMedia() (media-library.ts:798-831, which I opened) picks every picture whose vector is older than a day ('or e.updated_at < now() - interval ''1 day''', line 810, 'so what uses an item is kept current'), 128 a run, calls mediaUses() for them, then only moves the date on the unchanged ones (822-828): media_embeddings shows 13,414 updates on 468 rows, about 29 daily re-stamps of each. refreshMediaEmbeddings() loops over every site with media, one after another (860-874), every five minutes.
- **Cost today:** About 382 s in 78 days on 699 pictures. It grows with pictures times pages times page size per store, every day, for every store with media and an AI connection, whether or not anything changed. Estimate: a store with 2,000 pictures and 100 pages of 50 KB scans about 20 GB of text a day. Paid by: The database, daily per picture, driven by the five-minute dispatcher; an owner opening the media library (two calls per page of the library).
- **Saving:** Estimate: at least 80% of the 382 s and nearly all 13,414 re-stamps after step 1; the library's read becomes an index lookup after step 4. The larger gain is that the daily cost stops growing with every store's library.
- **Risk:** After step 1 a use in a place whose table has no change stamp would show late; the per-branch daily clause covers it. After step 3 a writer that forgets to record a use leaves 'Used in' stale until the nightly reconcile, and Compress could then miss a place: the scan test of step 5 and media-compress.int.test.ts are the guard. Noticed in the media library's 'Used in' list.

## The fix

1. 1 (S, first). In src/server/media-library.ts embedMedia(): replace the daily clause at line 810 with a change test. Once per site per run read one stamp, the latest change of anything that can hold a picture: greatest of max(updated_at) over the site's rows in the tables the 12 branches of mediaUses() read (lines 321-381: pages, product media and products, content entries, menus, saved parts, theme looks, settings). Pass it into the stale query as 'or e.updated_at < the stamp'. A site where nothing changed since its vectors were stamped then returns no stale rows and mediaUses() is not called. A table without an updated_at column keeps the daily clause for its branch only; say which in a comment.
2. Run the media job hourly, not every five minutes, once DQ-5 gives jobs cadences (the upload path already embeds a new picture).
3. 3 (M). Keep uses in a table. Migration: commerce.media_uses (store_id uuid null, media_id uuid not null references commerce.media on delete cascade, source text not null, ref_id text not null, primary key (media_id, source, ref_id)), an index on (store_id), row level security on as every commerce table has. New src/server/media-uses.ts: recordMediaUses(owner, source, refId, urls), which replaces the rows of (source, refId) in one statement. Call it from the savers of each of the 12 places (pages through pageImageUrls(), products, menus, entries, saved parts, themes, settings); the list of places is the comment at media-compress.ts:205-206.
4. mediaUses() reads commerce.media_uses. Today's 12-branch query becomes reconcileMediaUses(owner): run once a night per site with changes (the stamp of step 1) and from the library's own refresh, writing the table.
5. Add src/server/media-uses-writers.scan.test.ts in the manner of store-writers.scan.test.ts: a module that writes one of the 12 places and does not call recordMediaUses() fails, unless listed with its reason.

**Done when:** After step 1: on production n_tup_upd of commerce.media_embeddings grows by fewer than 50 a day while no content changes (about 468 a day today: 13,414 updates on 468 rows). After step 4: total_exec_time of the statements starting 'with m as (select id, url, thumbnail_url from commerce.media' grows by under 1 s a week.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/media-library.int.test.ts (uses per picture, search by meaning), src/server/media-compress.int.test.ts (docs/media-compression.md:59: a new place is added to rewriteAddresses() and mediaUses() together), src/server/product-media.int.test.ts, src/server/content-grid-custom.int.test.ts, src/server/theme-store.int.test.ts.
- Rules that say a new place that keeps a picture goes in mediaUses(): docs/rules/storefront.md:170 and :186, docs/rules/admin/commerce.md:354, docs/rules/admin/website.md:676 ('used is worked out on request by mediaUses()'), docs/content-grid-custom-items.md:106, docs/wave-6-catalogue.md:143 and :159, docs/wave-7-storefront.md:421. With step 3 each must say: the saver records the use, and the nightly reconcile is the net.
- src/db/commerce.test.ts for the new table (a deleted picture's uses go with it).

**Comes after:** DQ-5 (the hourly cadence of step 2); DQ-8 (owned())

**Notes:** Step 1 is P0-sized and stands alone. The schema dimension describes the same query; do it once.
