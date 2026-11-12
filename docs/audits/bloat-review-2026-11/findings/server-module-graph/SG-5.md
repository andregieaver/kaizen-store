# SG-5 ✓ Every instance start loads 856 modules and queries the database before the first request

The server code every route loads (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.7.
- **Second check:** corrected.
- **Where:** `src/instrumentation.ts:6-10`, `src/server/ui-text.ts:5-15`, `src/server/ui-text.ts:47-55`, `src/server/ui-text.ts:106-115`, `src/server/ui-text.ts:127-129`, `src/app/s/[store]/[market]/layout.tsx:37`, `src/server/shopper-emails.ts:39`, `src/server/notifications.ts:38`, `src/lib/ui-catalog-all.ts:1-7`, `.next/server/instrumentation.js.nft.json`
- **Evidence:** register() imports ui-text.ts and awaits startUi() (instrumentation.ts:8-9); Next's route module awaits ensureInstrumentation before each function's first request (route-module.js:428-449, called from the app-route and app-page templates). ui-text.ts is both the reader of AI-translated interface text and the platform admin's tool that makes it, so it imports ai.ts and auth.ts (lines 14-15) and, through ui-catalog-all.ts:1-2, email-text.ts and i18n.ts: 856 modules in one chunk of 2.4 MB that register() loads through its import(), in a layer of its own, so schema.ts and the admin catalogues are evaluated a second time in the same process. It then runs a group-by on commerce.ui_translations and arms a one-minute timer that repeats it (278,393 calls in 78 days, prod-db-stats.md). Two more things I found: the storefront's market layout imports the same file for one getter, uiTextsFor (layout.tsx:37), and shopper-emails.ts:39 and notifications.ts:38 import it for ensureUi; through ui-text.ts -> ai.ts -> settings.ts -> connect.ts that is one of the chains that put ai.ts and the Stripe SDK on storefront pages (traced on the graph after the other cuts).
- **Cost today:** 0.27 to 0.30 s and 43 MB of heap before the first request of every function instance, lean routes included (the skeptic's re-measurement, 3 runs), plus one query per start and one per instance-minute. For a lean route this start hook costs more than the route's own code (0.16 to 0.24 s). Paid by: The server at every cold start of every function; the database once a minute per warm instance, so the query count grows with instances after opening. The load cost is the same whether or not any language has been translated, so it does not follow use.
- **Saving:** Simulated: 856 -> 208 modules with the split alone, whether or not translated languages exist; -> 168 with SG-6; -> 130 while there is no language to load. An estimated 0.2 to 0.25 s and 25 to 35 MB of heap per instance start, on every function. On a storefront page the reader import also drops about 100 KB (simulated 3,625 -> 3,519 KB after the other cuts).
- **Risk:** t() is synchronous and relies on the registry being filled before the first page; the split keeps that order. The lazy i18n import inside loadLanguage must stay awaited before registerMessages. A wrong import path fails the type check.
- **Already tracked:** Not in the repo's plans. In this review the same split is storefront-data SD-7 step 1; the minute poll is caching CA-12, db-queries DQ-12 and db-schema DS-2.

## The fix

1. Move BUILT_IN_LANGUAGES and isBuiltIn from src/lib/ui-catalog-all.ts:5-7 to a leaf with no imports (for example src/lib/built-in-languages.ts); ui-catalog-all.ts re-exports them.
2. New file src/server/ui-text-read.ts (the name storefront-data SD-7 uses): the state, loadLanguage, refresh, ensureUi, startUi, reloadUi and uiTextsFor now at src/server/ui-text.ts:29-129. It imports only the database client, src/lib/ui-registry, overlayMessages from src/lib/ui-catalog and the leaf of step 1. Inside loadLanguage, load t and emailText where they are used: const [{ t }, { emailText }] = await Promise.all([import('@/lib/i18n'), import('@/lib/email-text')]); so an instance with no translated language loads neither.
3. src/server/ui-text.ts keeps the tools (uiCoverage, uiCounts, uiRows, planGeneration, generateChunk, uiConnection, saveUiEdits, markUiReviewed, clearUiTexts) with ai.ts and auth.ts, and imports reloadUi from the reader. It does not re-export the reader's functions, so a reader cannot import the tools by habit.
4. Change the four reader imports to the new path: src/instrumentation.ts:8 (startUi), src/app/s/[store]/[market]/layout.tsx:37 (uiTextsFor), src/server/shopper-emails.ts:39 and src/server/notifications.ts:38 (ensureUi).
5. Add src/instrumentation.ts to the guard of SG-14 with a ceiling of 250 modules and a ban on src/server/ai.ts, src/server/auth.ts and src/lib/admin-text.ts.
6. Leave the wait at start and the one-minute poll as they are in this step (D111's rule: t() is synchronous and never waits on the database). Changing when the texts are read is storefront-data SD-7 step 2, for when the first language is translated in production.

**Done when:** After a build, the .js chunk files named in .next/server/instrumentation.js.nft.json sum to under 700 KB (today 4 files, 2,383 KB, one of them 2,339 KB), and src/server/route-load.graph.test.ts holds src/instrumentation.ts, following its import(), to 250 source files or fewer with no src/server/ai.ts, src/server/auth.ts or src/lib/admin-text.ts.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/ui-nightly.int.test.ts and src/server/languages.int.test.ts import the tools from ./ui-text: unchanged; where they call ensureUi or reloadUi the import path changes.
- src/lib/ui-catalog.test.ts, src/lib/ui-translate.test.ts: pure, unaffected.
- The comment at src/server/ui-text.ts:19-27 (D111) is the written rule: the registry is filled before the first page and never read during prerender. The split keeps the order; move the comment's reader half with the code.
- docs/platform-admin-i18n.md describes when a new language reaches every instance: unchanged by this step.
- No test mocks ./ui-text (rg).

**Notes:** The saving does not rest on the translations table being empty: the tool half (ai.ts, auth.ts, the admin catalogues, the schema) loads at every start for a job that only reads, and the split removes about 650 modules either way.
