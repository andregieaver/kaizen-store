# SD-7 ✓ Every instance loads the interface-text tools and reads the translations table before its first request, then polls it each minute

What the server does for a storefront request (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P2. **Effort:** M. **Confidence:** medium. **Step:** 0.7.
- **Second check:** corrected.
- **Where:** `src/instrumentation.ts:6-10`, `src/server/ui-text.ts:1-15`, `src/server/ui-text.ts:59-63`, `src/server/ui-text.ts:92-116`, `.next/server/chunks/src_1e-os9re011nz._.js`
- **Evidence:** register() imports ui-text.ts and awaits startUi() before the instance takes a request (instrumentation.ts:8-9); a timer repeats the read each minute (ui-text.ts:109-116). ui-text.ts holds the reader and the platform admin's translating tools in one file, so it imports ai.ts and auth.ts (:14-15). My walk: 383 modules and 7.6 MB of source from ui-text.ts; with the four tool imports cut (ai.ts, auth.ts, ui-translate.ts, query-understanding.ts) the reader reaches 93 modules, 2.2 MB, and 47 once the schema import is gone. /api/health reaches 54 modules, so for a light route almost all of the 383 are extra. The verifier timed register() in a bare process at 408 to 528 ms and 107 MB and found all 383 modules are also in the store layout's graph today. Production ran the poll 278,393 times in 78 days (3,569 a day): it counts instance-minutes of every function, cron routes included. The poll is count(*) and max(updated_at) over the whole table grouped by language, so it gets heavier once languages are translated.
- **Cost today:** Up to about 0.4 to 0.5 s per cold instance of a light function (local, upper bound, the verifier's timing); less on storefront functions today, more once SD-1 has slimmed them. One statement per live instance per minute, for every function, growing with instances and with the size of the table. Paid by: The first request on each new instance (cron and API routes most of all); the database.
- **Saving:** Step 1, by the walk: 290 fewer modules at the start of every instance (383 to 93; to 47 with the schema gone); the 0.4 to 0.5 s on light functions was not re-timed after the cut. Step 2, estimate: one statement per instance per minute for instances that never need a translated language (3,569 a day today).
- **Risk:** Step 1: low, a move with a re-export. Step 2: medium; a cold instance could draw a page in English where a translated language was expected if the cached read is not awaited before t() is used; the new test shows it.

## The fix

1. Step 1, with SD-1: split src/server/ui-text.ts. The reader (state, loadLanguage, refresh, ensureUi, startUi, reloadUi and the texts getter, lines 29-125) moves to a new src/server/ui-text-read.ts that imports the database client and pure lib only. The translating tools stay in ui-text.ts and re-export the reader, so no other import changes. src/instrumentation.ts:8 imports the reader. Add src/instrumentation.ts to the graph test of SD-1 step 5 with a ceiling of 100 modules.
2. Step 2, when the first language is translated by AI in production: stop waiting at start. Give the market layout a cached read of that language's texts ('use cache', tagged, refreshed by the platform's translating tools through reloadUi()) and register the texts from it before drawing; poll only on instances that have loaded such a language. An uncached read in a prerendered layout would block the route (Next's caching guide), so it must be the cached one.
3. a test draws a page in a language that is not built in, in a fresh process, before any poll has run.

**Done when:** The import walk from src/instrumentation.ts reaches 100 modules or fewer (383 today), held by the graph test of SD-1 step 5.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/ui-catalog.test.ts, src/lib/ui-translate.test.ts, src/lib/ui-nightly.test.ts, src/server/ui-nightly.int.test.ts; the email senders that call ensureUi() import it through the old path, which still works.
- The written design D111 (the comment at src/server/ui-text.ts:17-27): t() is synchronous, a page never waits on the database for its texts and never reads it while prerendered. Step 1 keeps it untouched; step 2 must keep it through the cached read.
- docs/platform-admin-i18n.md if step 2 changes when a new language reaches every instance.

**Comes after:** SD-1

**Notes:** Step 1 is small (S) and should ride with SD-1. Step 2 is the part that needs care and has no gain until the table holds a language, so it waits; the poll's database time today is negligible.
