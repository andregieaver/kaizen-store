# DQ-8 ✓ "is not distinct from" on store_id keeps the index from serving the hottest reads, so they scan all stores' rows

How data is asked for (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.18.
- **Second check:** confirmed.
- **Where:** `src/server/pages.ts:71`, `src/server/pages.ts:691-700`, `src/server/pages.ts:724-733`, `src/server/taxonomy.ts:59-60`, `src/server/cookie-scans.ts:94-99`, `src/server/site-cookies.ts:44-56`, `src/server/page-modals.ts:21-25`, `src/server/content-grid.ts:257-266`, `src/server/support-email.ts:263-270`, `src/server/knowledge.ts:28-29`, `src/server/chat-agent.ts:71`, `src/server/ratchet.baseline.json:1`, `scripts/ratchet.mjs:1-40`, `docs/rules/storefront.md:179`
- **Evidence:** My rg: 145 uses in 52 files, 122 on store_id in 40 files (most: content-types.ts 10, site-tools.ts 9, saved-parts.ts 8, forms.ts 8, pages.ts 6). The ones that run most: pages.ts:71 (ownedBy, behind 79,778 calls), pages.ts:694 and 697 (67,601), pages.ts:728 and 733 (57,930), taxonomy.ts:60 (130,816), cookie-scans.ts:97 and 98 (49,338; 22 table scans a call), site-cookies.ts:46 (70,257) and :55 (70,278), page-modals.ts:23 (68,878), content-grid.ts:257 and 266, support-email.ts:267 (a join of two columns, 40,141). The verified report's EXPLAIN on the local database (PostgreSQL 16.15, generic plans, sequential scans off): with is not distinct from, store_id is only a Filter and the index is entered on type alone; with store_id = $1 or store_id is null it is an Index Cond on pages_store_slug_key. Production: pages 199,789 sequential scans reading 203 M rows, cookie_scans 1.1 M reading 962 M, terms 183,724 reading 11 M. Six files already branch correctly with a private helper of the same name and shape (chat-agent.ts:71, media-library.ts:77, media-compress.ts:51, knowledge.ts:29, google-reviews.ts:38, instagram.ts:140).
- **Cost today:** Cheap per call today (1,389 pages). But each such read looks at every store's rows of that table, or every row of one type: about 1.2 billion rows read by sequential scan on these three tables in 78 days. The cost of one store's page render grows with all stores' data, which is the wrong direction once many stores exist. Paid by: The database, on every cold page render and every cron minute.
- **Saving:** Estimate: the scans of pages, terms and cookie_scans become index scans of one store's rows. Little time saved at today's size; the cost stops growing with other stores' data.
- **Risk:** Passing null into an '=' would return nothing, which is why the helper branches in code and takes string | null. A read that silently stops returning the platform's rows would show as an empty menu or page list on Kaizena Flow's own site; each moved read has an int test with a null owner. The indexes the fix needs exist already (pages_store_slug_key, terms_scope_idx, cookie_scans_store_created_idx).
- **Already tracked:** no (docs/rules/storefront.md:179 is a rule that asks for the current wording for content types; the fix keeps its reason)

## The fix

1. New src/server/owned.ts: export const owned = (storeId: string | null, column = sql`store_id`) => (storeId ? sql`${column} = ${storeId}::uuid` : sql`${column} is null`), with a comment that it is the one way to filter a store's or the platform's rows. Replace the six private copies with the import. scripts/lib/ratchet-count.mjs:39 recognises owned( by its name for the by-id-writes count (code review 1.3), so an imported helper still counts as naming the store.
2. Move the hot ten first: pages.ts:71 (ownedBy), :694 and :697, :728 and :733; taxonomy.ts:59-60 (scopeWhere); site-cookies.ts:46 and :55; page-modals.ts:23; content-grid.ts:257 and :266; cookie-scans.ts:97-98 (with DQ-1 step 1).
3. The join of two columns at support-email.ts:267 (support_settings s on s.store_id is not distinct from c.store_id): write the stores' branch (s.store_id = c.store_id, c.store_id is not null) and the platform's branch (both null) as a union all inside the same statement.
4. Then the other files, most uses first (content-types.ts, site-tools.ts, saved-parts.ts, forms.ts, page-jobs.ts, menus.ts, custom-fields.ts, support-inbound.ts, content-site.ts). Where both sides are columns and a union is not worth it, keep the wording and say why in a comment on the line.
5. Hold it: in scripts/lib/ratchet-count.mjs count per file the lines matching 'store_id is not distinct from' followed by a parameter; write the counts as a new key in src/server/ratchet.baseline.json through scripts/ratchet.mjs; in src/server/ratchet.scan.test.ts add a case that no file's count rises and a file not in the baseline has none.
6. Reword the rule at docs/rules/storefront.md:179 ('every query asks store_id is not distinct from') to 'every query filters with owned(storeId): the store's rows, or the rows with no store for Kaizena Flow'. The rule's reason (one query serves a store and the platform) is kept; only the wording of the SQL changes.

**Done when:** The ratchet's new count sums to at most the commented column-to-column joins left (122 today), and EXPLAIN of listPublishedPages' statement with enable_seqscan off on the local database shows store_id inside the Index Cond of pages_store_slug_key (today it is a Filter).

**Tests and rules that hold today's behaviour, and change with it:**

- The int tests of each moved read run a store and the platform's null: src/server/pages.int.test.ts, redirect-resolve.int.test.ts, country-content.int.test.ts, consents.int.test.ts, cookie-scans.int.test.ts, the support email tests, and the src/db tests of content types and forms.
- src/server/ratchet.scan.test.ts and scripts/ratchet.mjs (the new count, which may only fall); the existing by-id-writes count in the same test must not rise when the helper becomes an import.
- src/lib/sql-raw.scan.test.ts: the helper uses sql templates, not sql.raw.
- docs/rules/storefront.md:179 is the written rule that asks for today's wording; step 6 changes it and keeps its reason.

**Notes:** Mechanical and cheapest before opening: there is no real data to get wrong. Do it first, because DQ-1, DQ-2, DQ-6 and DQ-7 write new reads that should use the helper from birth. The schema dimension describes the same wording; do it once.
