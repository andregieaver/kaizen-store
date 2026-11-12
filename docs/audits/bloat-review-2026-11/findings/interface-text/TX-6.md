# TX-6 ✓ Every server instance asks the table of AI translations every minute, whether or not it serves such a language

Interface text (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P3. **Effort:** S. **Confidence:** high. **Step:** 0.7.
- **Second check:** corrected.
- **Where:** `src/instrumentation.ts:6-10`, `src/server/ui-text.ts:31`, `src/server/ui-text.ts:57-62`, `src/server/ui-text.ts:92-99`, `src/server/ui-text.ts:106-116`, `src/server/ui-text.ts:127-129`, `src/app/s/[store]/[market]/layout.tsx:131`, `docs/rules/storefront.md:69-71`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md:18`, `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md:329-333`, `evidence/prod-db-stats.md:87`
- **Evidence:** The statement's caller is refresh() in ui-text.ts:57-62. instrumentation.ts awaits startUi() when an instance starts (Next: register must complete before requests are taken), and startUi() then runs refresh() every 60 s for the instance's life (lines 106-116). It is not cached because it is the cache check: each instance keeps the languages in its own memory so the synchronous t() never waits, and nothing tells an instance that a language changed. Production: 278,393 calls in 78 days, 2.5 a minute. The answer to the owner's question is yes: the table is empty because no store sells in an AI-translated language yet. The finding does not need it to be empty: the check runs per instance per minute whatever the instance serves.
- **Cost today:** About 3,570 small queries a day today and one round trip before the first request of each new instance. Each live instance adds 1,440 a day, so it grows with traffic, not with use of the feature. Once languages exist, each check also counts every row of the table (1,863 rows a language). The statement's time is not in the statistics; small. Paid by: The database and its connection pool; the server at every cold start.
- **Saving:** Nine in ten of the per-minute queries for an instance that serves only hand-written languages: today about 3,570 a day falls to about 360. One query per cold start stays. No visible change.
- **Risk:** Low. An instance that has served no translated language for a while learns of an edit within ten minutes instead of one; pages are cached for hours anyway, and reloadUi() refreshes the instance where the edit was made at once. If the chain's tick throws, the chain stops: catch inside the tick, as refresh() already does.

## The fix

1. In src/server/ui-text.ts (or the reader file split out of it, see notes) add used: boolean to the state. uiTextsFor(lang) (line 127), which the storefront layout already calls for every market (layout.tsx:131), sets state().used = true when the language is not built in. It reads no clock and no database: Next guards Date.now() while a page is prerendered (08-caching.md:331), and the written rule forbids reading the texts while rendering.
2. Replace setInterval in startUi() (lines 109-114) with a setTimeout chain. Each tick: note and clear used, run refresh() unless one is in flight, then schedule the next tick after FRESH_MS (60 s) if the instance was asked for a translated language since the last tick, and after a new IDLE_MS (600,000) if not. Keep timer.unref().
3. Leave the read at start (line 108) and ensureUi() before emails (shopper-emails.ts:108, notifications.ts:367) as they are. Do not call ensureUi() from a page: it reads Date.now() (line 99) and may wait on the database.
4. Update the module comment (ui-text.ts:19-27) and docs/rules/storefront.md:69-71: an instance looks for changes each minute while it serves a translated language and every ten minutes otherwise.

**Done when:** The new unit test passes, and on production the calls of the ui_translations group-by statement in pg_stat_statements grow by fewer than 200 a day per running instance that serves no translated language (1,440 today).

**Tests and rules that hold today's behaviour, and change with it:**

- New unit test with fake timers and a counting stub for readDb(): no call of uiTextsFor() for a translated language gives one refresh in ten minutes; a call gives one each minute until a minute passes without one.
- src/server/languages.int.test.ts:123 uses reloadUi(), which is unchanged.
- Rule kept: 'never read the texts from the database while rendering (they are in memory)' (docs/rules/storefront.md:69-71) and the read before the first request.

**Notes:** P3 because the cost is tiny; do it when ui-text.ts is opened for TX-3 or TX-12. The verified fix was to drop the timer and call ensureUi() from resolveShop(); I did not keep that, because ensureUi() reads Date.now(), which Next guards during prerender, and a page must not start or wait on a database read. The flag keeps the cost following use without either. DQ-12 and CA-12 propose a plainer form (ten minutes while the table has no language); this one also stays cheap once languages exist. SG-5 proposes splitting the reader (src/server/ui-load.ts) from the admin's tools so the start hook loads 208 modules instead of 856; these steps apply to whichever file holds the reader.
