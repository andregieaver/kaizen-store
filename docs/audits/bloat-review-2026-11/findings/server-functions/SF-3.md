# SF-3 ✓ Every instance waits on a start hook that loads 2.3 MB of unrelated code before it asks the database for the interface texts

Server functions: size, cold start, per-request overhead (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.7.
- **Second check:** corrected.
- **Where:** `src/instrumentation.ts:6-10`, `src/server/ui-text.ts:5-15`, `src/server/ui-text.ts:29-129`, `src/lib/ui-catalog-all.ts:1-7`, `src/db/client.ts:81`, `src/app/s/[store]/[market]/layout.tsx:37`, `src/server/shopper-emails.ts:39`, `src/server/notifications.ts:38`, `docs/rules/storefront.md:70-71`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md:18`
- **Evidence:** register() must finish before an instance takes a request. It imports src/server/ui-text.ts, which holds the reader (lines 29-129) beside the platform admin's translation tools and so imports ./ai and ./auth: 383 source files on my graph. Re-measured: the hook's chunk is 2.33 MB, and it spends 331 to 336 ms loading modules before its first database connection (2 runs), with 25.7 MB of heap; then one awaited query. The verified report read that chunk's source map: a second copy of the schema (599 KB), admin-map (146 KB), four storefront languages (about 271 KB), the Stripe SDK (212 KB), Supabase auth (95 KB). The reader itself needs the database client and src/lib/ui-registry.ts; isBuiltIn() comes from ui-catalog-all.ts, which imports i18n.ts and email-text.ts (44 files); t("en") and emailText("en") are used only inside loadLanguage(), which runs only when the table holds a language. The query is by design: the storefront layout reads the texts without waiting, and the rule says texts are read from memory, never while rendering. It is production's second most-called statement (278,393 calls in 78 days, scratchpad/m/prod-db-stats.md:87).
- **Cost today:** About 0.33 s on every cold start of every function (twice the lightest route's own start), 25 MB of heap and a second connection pool, plus one database round trip at start. The module loading is the waste: it is the same whether or not any store offers an AI-translated language. Paid by: The first request on every new instance of every route and of the proxy; the database a little (one small query per instance at start and per minute).
- **Saving:** Estimate: 0.25 to 0.3 s and about 20 MB off every cold start together with SF-6 (the skeptic's figure); about 0.2 s without it, because the hook then still evaluates the schema (75 to 114 ms). The start query and the minute poll stay.
- **Risk:** Low. The shared state is on globalThis, so a split module sees the same texts. The lazy imports in loadLanguage() run only when the table holds a language; a mistake there would show as English texts for an AI-translated language and is caught by languages.int.test.ts. Not awaiting the hook is not part of this fix: it would be a real risk.

## The fix

1. New src/lib/built-in-languages.ts holding BUILT_IN_LANGUAGES and isBuiltIn() (src/lib/ui-catalog-all.ts:5-7); ui-catalog-all.ts imports and re-exports them, so its six importers do not change.
2. New src/server/ui-text-read.ts (the name SD-7 of this review uses): move lines 29-129 of src/server/ui-text.ts there unchanged (KEY, FRESH_MS, State, state(), loadLanguage(), refresh(), ensureUi(), startUi(), reloadUi(), uiTextsFor()). Its imports are server-only, sql from drizzle-orm, readDb from @/db/client, the three functions of @/lib/ui-registry and isBuiltIn from @/lib/built-in-languages. Inside loadLanguage() load what only it needs: const [{ t }, { emailText }, { overlayMessages }] = await Promise.all([import("@/lib/i18n"), import("@/lib/email-text"), import("@/lib/ui-catalog")]);
3. src/server/ui-text.ts keeps the admin's tools and imports reloadUi from the reader for its own use. Do not re-export the reader from it (a re-export is how the beacon came to load everything, SF-4): change the three importers instead: src/app/s/[store]/[market]/layout.tsx:37 (uiTextsFor), src/server/shopper-emails.ts:39 and src/server/notifications.ts:38 (ensureUi) import from @/server/ui-text-read.
4. src/instrumentation.ts:8 imports @/server/ui-text-read. Keep await startUi(): a cold instance must not draw, or cache, a page in English for a store in an AI-translated language.
5. Add src/instrumentation.ts to src/server/route-load.graph.test.ts with its count in the baseline (expected 52 files: the reader, the client and the 47 src/lib files the schema imports; 5 once SF-6 is in).
6. Build and run the hook's cold-load script (SF-7 step 3). The minute poll is not changed here: DS-2 and CA-12 of this review plan it (a version stamp, a longer wait while no language is translated).

**Done when:** src/server/route-load.graph.test.ts holds src/instrumentation.ts at 60 files or fewer by static value imports (383 today through ui-text.ts), and the built hook loads less than 1 MB of chunks before its first database connection (2.33 MB today, by the cold-load script).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/languages.int.test.ts and src/server/ui-nightly.int.test.ts (they import ./ui-text for the tools and the reader); src/lib/ui-catalog.test.ts, src/lib/ui-translate.test.ts.
- The written design D111 (comment at src/server/ui-text.ts:19-27, docs/rules/storefront.md:70-71): t() is synchronous, pages are drawn from memory, the database is never read while a page is prerendered. The split keeps all three; move the comment's reader half to the new file.
- The state is on globalThis (ui-text.ts:42-45, src/lib/ui-registry.ts:16-19), so the hook's separately bundled copy and the routes' copy keep sharing it after the move.
- e2e: a storefront page in a built-in language still draws its texts (e2e/store-pages.spec.ts).

**Comes after:** SF-6 for the full saving (without it the hook still loads the schema); SF-7 steps 1 and 2

**Notes:** The skeptic dropped the auditor's optional step of not awaiting the hook; it stays dropped. The empty ui_translations table is what one expects before opening and is no argument here: the finding is the unrelated code every instance loads. Same split as SD-7 step 1; this entry adds that the three importers must change and that the English catalogues load inside loadLanguage().
