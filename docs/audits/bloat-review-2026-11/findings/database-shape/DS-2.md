# DS-2 ✓ Each server start waits for a read of the interface-text table, and every warm instance asks again each minute

The database's shape (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P2. **Effort:** S. **Confidence:** medium. **Step:** 0.7.
- **Second check:** corrected.
- **Where:** `src/instrumentation.ts:6-9`, `src/server/ui-text.ts:19-31`, `src/server/ui-text.ts:57-71`, `src/server/ui-text.ts:106-115`, `src/server/ui-text.ts:207-218`, `src/server/ui-text.ts:314-319`, `docs/decisions.md:122`
- **Evidence:** register() awaits startUi() (instrumentation.ts:6-9), which runs `select lang, count(*), max(updated_at) from commerce.ui_translations group by lang` before the instance takes requests, then loads each changed language with its own query, one after the other (ui-text.ts:64-71). A timer repeats the group-by every 60 s in each warm instance (:31, :110-112). Production: 278,393 calls in 78 days, the second most-called statement; it is not in the top-time list, so its total is under 17.5 s while the table is empty. The design is deliberate (D111): t() is synchronous and pages never wait on the database for text. Only three statements write the table, all in ui-text.ts (lines 211, 305, 315).
- **Cost today:** Today: one small query before the first request of each instance and about 3,570 polls a day. After opening the poll counts every row of every machine-translated language (about 100 KB of English text per language by the size of src/lib/messages/en*.ts) in every warm instance every minute, and a cold start reads the languages one by one. Estimate: 20 languages and 20 warm instances give about 29,000 polls a day over 34,000 rows each. Paid by: The first request on every cold instance; the database
- **Saving:** Estimate: the group-by runs only after an edit; the poll becomes a one-row read ten times rarer (about 357 a day at today's instance count). A few milliseconds at most per cold start today; more once languages are translated, because they load in one read.
- **Risk:** Low. An edit to a machine-translated text reaches other instances within ten minutes instead of one; cached pages already lag by hours. What could break: a writer that skips the stamp; the scan test holds it.

## The fix

1. src/db/schema.ts, table platform_settings: add ui_text_version bigint not null default 0; pnpm db:generate (one row; a constant default is instant).
2. src/server/ui-text.ts: saveRows() (:207-218) and clearUiTexts() (:314-319) end with update commerce.platform_settings set ui_text_version = ui_text_version + 1. markUiReviewed() changes no text and needs no bump.
3. refresh() (:57-86): first read only the stamp (select ui_text_version from commerce.platform_settings limit 1) and keep it in State; when it has not moved and the texts are loaded, set checkedAt and return. When it moved, run today's group-by, then load all changed languages with one read (select lang, key, text from commerce.ui_translations where lang = any(…)) instead of one query per language.
4. FRESH_MS (:31) from 60_000 to 600_000; reloadUi() already refreshes the instance that saved. Correct the comments at :22-27 and :122 (a minute becomes ten).
5. Keep the awaited read in src/instrumentation.ts: it is what lets the synchronous t() find the text from the first page (D111).

**Done when:** On production a day after the deploy, calls of the group-by on commerce.ui_translations in pg_stat_statements grow by fewer than 50 a day with no text edited (about 3,570 a day today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/languages.int.test.ts and src/server/ui-nightly.int.test.ts cover loading and the nightly run: add a case that a second refresh with nothing written sends one statement that does not name ui_translations, and that after saveRows() the next refresh loads the language.
- A small scan test (or a case in languages.int.test.ts) that every statement writing commerce.ui_translations is in src/server/ui-text.ts, so a new writer cannot forget the stamp.
- Rules: D111 (docs/decisions.md:122) and the module comment at ui-text.ts:19-27 ('looks for changes each minute; the sync t() never waits on the database'): keep them true and name the stamp and the ten minutes.
- pnpm db:check and src/db/snapshots.scan.test.ts for the new column.

**Notes:** The same work as DQ-12 in the queries dimension; do it once. Do it when ui-text.ts is next opened and before many languages are machine-translated (the nightly run of D436 fills the table).
