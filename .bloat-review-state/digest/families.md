# families: Families and twins: the same thing built several times

Copy-paste is not this codebase's problem: 1.5% of code lines sit in 8-line clones and 41 twin pairs were found in 3,974 files, and carriers, payment providers, emails, CSV, PDF and the AI tools each have one core. What matters is two loading faults that every store pays at each cold start whatever it uses: both languages of the admin's words (2.8 MB built) load with 802 of 830 server entries, and three small helpers imported through the chat modules make 11 routes, the four visit beacons and the recommendations beacon among them, load about 11.4 MB of server code each where a beacon needs about 2 MB; both fixes are small and safe and come first, with a server-side import check to hold them. The true duplicates are kaizenaflow.com kept twice (parity plan step 7, up to 4,400 lines, cheapest before opening), the platform's events pipeline written beside the stores', five CSV import flows and Fiken's engine copied from Tripletex's: beyond step 7 they come to a few thousand lines of 768,000 (2,600 to 6,700 by the estimates, the top being upper bounds), so each is folded when its area is next opened. Nothing in this plan rests on a feature being unused.

## Measures
- Size measured: 768,202 lines of non-test TypeScript in src in 4,139 files; 325,579 lines of tests
- Verbatim clones: 8,041 lines (1.5% of 554,385 code lines) sit in an 8-line window repeated in another file. Exact copies only, so near-copies are not counted
- Twin file pairs: 41 pairs among 58 files of 3,974 (1,742 shared long lines)
- Platform family: 24 server modules (4,761 lines), 20 lib modules (1,664), 19 platform_* tables in the schema
- Share of a platform module's lines found unchanged in its store module: endpoints 55% (92 of 167), workflows 54% (132 of 243), API tokens 30%, integrations 28%, ad conversions 26%, with import lines left out. The five events modules share 368 lines by the loose measure, 209 in runs of three or more
- Admin words on disk: 3.56 MB in 136 catalogue files; the registry imports 134 of them (67 areas, 3.46 MB). 596 files import the registry at run time: 561 in the admin folders, 35 outside, which use 18 areas (1.11 MB). Every call names its area as a string literal (0 exceptions in…
- Admin words in the build: 13 server chunks carry the catalogues: 37.3 MB of 205.0 MB of server chunk JS (18%). Ten are the same 2.81 MB chunk under ten names. 802 of 830 page.js and route.js entries load one; 255 of the 282 entries outside the admin
- What an entry would load with one module per area: Outside the admin: 8 areas, 0.55 MB of source, where the registry is 3.46 MB (84% less); 254 of 278 non-admin entries reach the registry today, none after. Admin pages: a median of 15 areas and 0.75 MB, at most 28 areas and 1.66 MB
- Server JS an entry loads: /api/visit 11.40 MB in 117 chunks (202 to 249 ms to require here); /api/recommendations/events the same 117 chunks (209 to 221 ms); /api/health 1.16 MB in 16 chunks (29 to 42 ms); /api/ab/assign 1.59 MB in 30 chunks (40 to 43 ms); the storefront front page 12…
- Import reach: The four visit beacons and /api/recommendations/events reach 1,308 or 1,309 of 4,136 modules (20.4 MB of source); with their helper imports pointed at the helpers' own files they reach 143 to 150 (2.6 to 2.7 MB). /api/health reaches 54, /api/ab/assign 113. 17…
- Re-exports that drag a heavy module in: Two matter: sameSite through chat-route.ts (39 files take only that) and visitorKey through chat-agent.ts (4 files). Pointing every such import at its source frees 9 entries; no other re-export in src changes an entry's reach by more than 100 modules
- What a third language would cost: Admin: about 33,800 hand-written lines in 69 files, and about 1.4 MB more in every function while the registry is one module (estimate: half of today's chunk). Storefront: about 2,250 lines, or none through ui_translations. Platform site: 30 wrapper route fil…
- Server actions: 1,266 exported actions in 235 'use server' files of the admin; 50 wrapper calls in 3 files (orders, returns, books); 232 files use no wrapper
- Hand-made admin interface today: 154 tables in 116 files; 436 native selects in 198 files; Europe/Oslo in 67 TSX files; slice(0, 10) in 46; confirm( in 42; 31 files with a hand-made GET filter form; no shared pager (0 uses); the kit's List in 89 files. 99 admin route handlers, 2,116 lines
- Repeated helpers: 446 names are defined at top level in 3 or more files (2,944 definitions), route and page names such as GET, POST and Page included. addDays is exported by 7 lib modules and written locally in 3 more; isUuid is defined in 23 files; isUniqueViolation in 9
- Families by size: Carriers: 10 adapters behind one interface and one index. Payment providers: Stripe and Mollie behind one 50-line interface. AI tools: 44 server and 25 lib *-tools.ts files behind one registry, which the MCP catalogue also reads. CSV import engines 2,401 line…

## Well made
- Carriers: one interface (ShippingCarrierAdapter) and ten adapters behind src/server/carriers/index.ts. Checkout reads a store's connected carriers in one statement (delivery-options.ts:154) and builds only that carrier's adapter.
- Payment providers: Stripe and Mollie behind one interface (src/server/payment-providers/types.ts).
- AI tools: one registry. The 44 server and 25 lib *-tools.ts files repeat names (refusal, prepare, problemText) but not bodies; the MCP's catalogue is built from the same registry (src/lib/mcp-catalogue.ts), so there is no second list of tools.
- CSV: one reader and writer (src/lib/csv.ts) under every export and import. PDFs: one maker (src/server/browser.ts).
- Inbound email: support, the timeline's filed email and the books inbox share src/lib/inbound-email.ts; the three server files are 4 to 7% alike.
- Accounting documents: Tripletex's and Fiken's mappings share src/lib/accounting-docs.ts; the two map files are 29% alike by the loose measure, 15 lines in runs. Only the sync engine is a copy (FM-9).
- Verbatim copying is rare: 1.5% of code lines in 8-line clones and 41 twin pairs in 3,974 files.
- The platform console's own modules are not copies of the stores' (sales, team, payouts, discounts, experiments, the API: 2 to 11% alike in the verified report). They were built as the parity plan's console track on the owner's instruction. Empty before openin…
- The pure lib and server split costs nothing at run time and is what lets unit tests run without a database.
- Per-language route groups are thin: Norwegian is 30 wrapper files that hand a lang to shared views in src/components/platform-routes. Private mode is not a second route tree (3 files).
- Imports already share a core: the job store, runJob(), tickJob(), tickResponse() and the 14-line tick routes. What is copied is the per-kind orchestration around it (FM-6).
- The idle cost of the every-minute deliveries is fixed, not per store: one set-based claim each for stores and for the platform.
- A browser-side import check exists and is the model for a server-side one: src/lib/storefront-bundle.scan.test.ts walks every visitor component's static imports.
- Work at the owner's level (D123) is a deliberate combined view over each store's own data: no second table and no second engine. Only its list components repeat the stores' (FM-10).
- Looked for and not found: a second dropdown, dialog or icon family worth folding (3 listbox parts, 21 files with a dialog, 102 inline SVGs in 56 files); a re-export other than sameSite and visitorKey that pulls a heavy module into a light route.

## Findings (14)

### FM-2 [P0 S eager confirmed] One import of sameSite through the chat module makes the four visit beacons, and five admin export routes, load the whole server core
- evidence: sameSite is one pure function of nine lines in src/lib/same-site.ts. chat-route.ts:38 re-exports it; its own comment says it is 'kept here for the routes that import it from here'. 57 files take it from chat-route.ts, 39 of them take nothing else, 17 already import the pure file. chat-route.ts imports ai.ts, chat-agent.ts and support.ts, and 1,307 modules follow. By static import reach (the planner's own graph): eac…
- cost: 11.4 MB of server JS and about 0.2 s of loading at each cold start of a beacon function, where 1.2 to 1.6 MB and 30 to 45 ms is what a route of that size takes here. Every counted page view sends a beacon, also for a pa… (The server at each cold start of the beacon routes, so the database write of a …)
- fix: 6 steps; first: 1. In the 39 files whose only import from chat-route.ts is sameSite (rg -l 'import \{ sameSite \} from "(@/server|\.)/chat-route"' src), change the import to '@/lib/same-site'. The four that carry the saving are the routes under src/app/api/visit; the five ad…
- done when: node /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/fmp/reach.mjs (or the new scan test) reports at most 200 modules for each of the four routes under src/app/api/visit (1,308 today); rg -c sameSite src/server/chat-route.ts prints nothing; after a build the entry .next/serve…
- saving: Nine entries leave the core. The four beacons go from 1,308 reachable modules to 146 to 150 and from 20.4 MB of source to 2.7 MB (measured by import reach). Built size per beacon from 11.4 MB to about 2 MB (estimate: /api/ab/assign reaches 113 modules and is …
- after: nothing
- notes: Do with FM-14 (two more public routes with the same fault) and FM-13 (the check) in one change. The same fault is reported in other areas of this review (server graph SG-3, functions FN-4, dependencies DP-10): one fix serves all. The larger tangle, 179 of 265…

### FM-14 [P0 S eager added] Two more public routes load the whole server core for three small helpers: the recommendations beacon and the docs' feedback
- evidence: The verified report counted four beacons. /api/recommendations/events is a fifth: a shopper's tab posts to it what recommendations it showed and which were pressed (recommended-grid.tsx:26). Its route imports visitorKey from chat-agent.ts (line 4) and fail and sameSite from chat-route.ts (line 5). visitorKey is three lines in chat-turns.ts, which chat-agent.ts:185 only re-exports; chat-turns.ts says it was split out…
- cost: 11.4 MB of server JS and about 0.2 s of loading at each cold start of each of the two functions. The recommendations beacon is sent from every page that draws a recommended grid; the docs' feedback is rare. (The server at each cold start of the two routes. The recommendations beacon gro…)
- fix: 4 steps; first: 1. src/app/api/recommendations/events/route.ts: import visitorKey from '@/server/chat-turns' and sameSite from '@/lib/same-site'. Replace the one use of fail (line 29) with Response.json({ error: 'No such store.' }, { status: 404, headers: { 'Cache-Control': …
- done when: The import walk reports at most 200 modules for src/app/api/recommendations/events/route.ts (1,308 today) and at most 450 for src/app/api/docs/feedback/route.ts (1,324 today); after a build the entry .next/server/app/api/recommendations/events/route.js lists under 3 MB of chunks (11.40 MB today).
- saving: Two more entries leave the core: 1,308 modules to 143 for the recommendations beacon (measured by import reach), 1,324 to 425 for the docs' feedback. Built size from 11.4 MB to about 2 MB for the beacon (estimate, as in FM-2).
- after: FM-2 (same change; it deletes the sameSite re-export these routes also use)
- notes: Added by the planner. It is the same fault as FM-2 through a second and third helper, so it belongs in the same change; it is listed apart because the verified report's count of four beacons missed it.

### FM-1 [P0 M eager confirmed] Both languages of the admin's words (2.8 MB built) load with 802 of 830 server entries, the storefront's included
- evidence: admin-text.ts imports 134 catalogue files (67 areas, English and Norwegian, 3.46 MB of source) into one object, CATALOGUES (line 232), and adminText(lang, area) reads from it (line 303). 596 files import it at run time: 561 in src/app/admin and src/components/admin, 35 outside. A storefront page reaches it through 14 of those 35, none of them the admin's own: lib/two-step.ts (by way of server/auth.ts:18), shopper-em…
- cost: 2.8 MB of server JS read and compiled at each cold start of almost every function: about 45 ms to load here and roughly 60 ms to run (the run part is the verifier's rough figure). 37.3 MB of build output, 18% of all ser… (The server at every cold start, so the first shopper or owner on a new instance…)
- fix: 8 steps; first: 1. Add src/lib/admin-area.ts with no catalogue import: the type AreaWords<A extends AdminArea> = { readonly area: A; readonly words: Record<AdminLang, AdminAreaMessages[A]> } (types from admin-text.ts by 'import type'), areaText(lang, a) returning a.words[lan…
- done when: The scan test's list of files outside the admin folders that import @/lib/admin-text at run time is empty (35 today), and by the walk no page or route entry outside src/app/admin reaches src/lib/admin-text.ts (254 of 278 today). After a build, node work/fmp/words-in-entries.mjs with a sentence of builder.nb.ts reports…
- saving: After step 3: a storefront, API or cron function reaches 0.55 MB of words source in 8 areas where it reaches 3.46 MB (84% less; from source sizes and import reach). After step 6: an admin page reaches a median of 15 areas and 0.75 MB, at most 28 areas and 1.6…
- after: FM-13 step 1 (the import walk the new rule lives in); it can land in the same change
- tracked: no (PSI PERF-01 and docs/performance.md cover the browser's side only)
- notes: Steps 1 to 5 are the P0 part: about 40 files, and they give every function outside the admin its saving. Steps 6 and 7 are a mechanical codemod over 561 files and can follow as P1. The storefront still reaches 8 areas of staff words afterwards (reports, work,…

### FM-13 [P0 S process confirmed] No check holds server import reach or copies, so heavy imports and twins arrive unseen
- evidence: package.json, eslint.config.mjs and .github name no duplication, unused-code or import-graph tool (rg for jscpd, knip, madge, dependency-cruiser, depcheck and ts-prune finds none). 46 scan tests exist. One, storefront-bundle.scan.test.ts, already walks static imports, but only for what a visitor's browser loads; nothing does the same for what a server route loads. The ratchet counts casts, unchecked reads and unscop…
- cost: FM-1, FM-2 and FM-14 each came in by one import line with nothing to flag them, and each costs every cold start. A copied module (FM-4, FM-6, FM-9) is seen only by a reader who knows the other file. (Later: the server at each cold start, the build, and an agent's session.)
- fix: 4 steps; first: 1. Move the walk of src/lib/storefront-bundle.scan.test.ts (its IMPORT pattern, typesOnly(), resolve(), files() and reach()) into src/lib/import-walk.test-helper.ts and use it from both tests. Add src/lib/server-reach.scan.test.ts with three rules. (a) Light …
- done when: pnpm test runs src/lib/server-reach.scan.test.ts and src/lib/copies.scan.test.ts; a trial edit that imports '@/server/chat-route' into src/app/api/visit/route.ts fails the first, and a trial copy of a 30-line function into a second file fails the second. src/lib/copies.baseline.json holds 8,041 or fewer cloned lines a…
- saving: None by itself. It keeps FM-1, FM-2, FM-14, FM-6 and FM-11 from coming back, for about 2.7 s of test time.
- after: FM-2 and FM-14 (rule (a) is red until they land; land them together)
- tracked: no (code review step 1.2 built the ratchet for other counts)
- notes: Step 1 is the part that protects running cost and should ship with FM-2. Steps 2 and 3 can follow. Other areas of this review ask for the same kind of gate (copied code CP-14, server graph SG-14, dependencies DP-6): one walk and one budget file can serve all …

### FM-3 [P1 M duplicate confirmed OWNER-CHOICE] kaizenaflow.com exists twice: the old no-store site is still built and kept beside the store that now serves it
- evidence: Since D484 the proxy serves the front page, every page, blog, category, tag and cookies of kaizenaflow.com from the store 'kaizenaflow' (house-routing.ts:13, proxy.ts:71-75); docs/platform-parity.md:21 says the switch is on in production. The old site is still whole. Counted by the planner: 20 route files for those addresses in (platform) and (platform-nb) (313 lines); their views in src/components/platform-routes (…
- cost: Up to about 4,400 lines of code and about 560 of tests, 3 twin tables (platform_theme_installs, platform_theme_install_updates, platform_page_roles), the old pages' build and prerender on every build in two languages, a… (The build and CI on every push, the team's admin (two places that look like the…)
- fix: 8 steps; first: 0. Before any of it: the owner says the switch is final, and the media library's rows are moved to the store (docs/platform-parity-plan.md:162 lists it as still to do). Run node scripts/site-compare.mjs https://kaizenaflow.com > before.json.
- done when: find 'src/app/(platform)' 'src/app/(platform-nb)' -name page.tsx lists no front page and nothing under [slug], blog, category, tag or cookies (20 files today); src/server/platform-theme-installs.ts, src/server/platform-roles.ts and src/components/platform-page.tsx do not exist; rg -c 'platform_theme_installs|platform_…
- saving: Up to about 4,400 lines and about 560 test lines (an upper bound from the files listed: the theme store's pages and sign-up still use part of the platform page machinery), 3 tables, about 20 fewer routes to build and prerender, one set of chrome.
- after: The owner's word that the switch of 7 November is final; The media library's rows moved to the store (parity plan, still to do)
- tracked: docs/platform-parity-plan.md step 7 'One copy': open (steps 1 to 5 built; 6 and 7 not). The plan says the null rows go 'weeks after the switch'.
- notes: The owner's choice is only when: the plan already decided that it happens. Step 6 of the same plan (one support desk) would also remove the platform's support, chat and assistant screens that repeat the stores' (about 225 identical lines of 546 in 15 files, m…

### FM-5 [P1 S process corrected OWNER-CHOICE] The parity rule names platform_* tables as the way and does not say when the store's module with a scope is expected
- evidence: CLAUDE.md:403 asks for every store feature on the platform in the same change and names 'store_id is null or platform_* tables' as where its rows live. The plan of 6 November counted 9 platform_* tables (line 32) and said 'build it for stores' (line 73), but also set a console track for what no store can give (section 6). That track was built on 9 November on the owner's instruction (D515, D516, D518 and others): th…
- cost: A copied module adds lines to keep in step for good: today about 370 server lines in the events family (FM-4) and about 180 in plan reminders and the speed recorder. The cost is upkeep, not run time. (An agent's session (the rule is read in every one) and CI.)
- fix: 3 steps; first: 1. With the owner's agreement, add one sentence to the rule at CLAUDE.md:403: 'Where the platform's version does the same job on its own rows, it uses the store's module with a scope (the table and the owner filter passed in), not a copy; a decision that adds…
- done when: rg -c 'with a scope' CLAUDE.md docs/platform-parity-plan.md prints 1 for each file, and src/lib/copies.baseline.json exists with the twin-pair count.
- saving: No lines today. It keeps the next console step from being built as a copy.
- after: The owner's agreement to the wording; FM-13 steps 2 and 3 (the twin-pair budget) for the rule to have a check
- tracked: partly: docs/platform-parity-plan.md section 3 says 'build it for stores'; the rule in CLAUDE.md does not say how
- notes: A wording choice for the owner, not waste. The ten tables added on 9 November were the plan's own console track and are not a finding. Empty tables are no argument here: nothing is open yet.

### FM-4 [P2 M duplicate corrected] The platform's events pipeline is written a second time beside the stores': 26 to 55% of its lines are the stores' own
- evidence: Share of a platform file's significant lines found unchanged in its store file, imports left out: endpoints 55% (92 of 167), workflows 54% (132 of 243), API tokens 30% (14 of 46), integrations 28% (105 of 371), ad conversions 26% (25 of 97). The five server modules share 368 lines by that measure, 209 of them in runs of three or more. Read side by side, addPlatformEndpoint() and addEndpoint() differ in the table nam…
- cost: About 370 identical server lines and about 200 screen lines kept in step by hand: a fix to retry, signing or endpoint health on one side must be remembered on the other. At run time the every-minute job makes one more c… (CI and an agent's session, and whoever changes one runner and forgets its twin.…)
- fix: 6 steps; first: 1. Keep the separate tables and screens' addresses (D465, D515 and D516 stand). Start with endpoints, the most alike. In src/server/webhook-endpoints.ts add an EndpointScope: the Drizzle table object (webhookEndpoints or platformWebhookEndpoints from src/db/s…
- done when: node /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/fmv/sim2.mjs on the five pairs reports under 60 lines in runs of three or more (209 today), and the six integration test files named pass without an edit.
- saving: About 300 to 550 lines (estimate from the 209 to 368 identical server lines and about 200 identical screen lines measured). Tests stay.
- after: nothing
- tracked: no. D465, D515 and D516 give the reason for separate tables; the fix keeps them.
- notes: Worth doing when either runner is next opened for a real change, not as a project of its own: the saving is a few hundred lines and the run-time cost is two statements a minute. The same pair is reported by the copied-code area (CP-4) and the features area (F…

### FM-6 [P2 M duplicate corrected] Five CSV imports repeat the same orchestration, pages and client flow around one shared job core
- evidence: A shared core exists: the job store, runJob() and tickJob() in data-jobs.ts (653 lines), tickResponse() in data-routes.ts, the findings table and the job tracker. Around it, products, customers, redirects, stock and order history each write their own start-upload, register, check, apply and problems-CSV functions of the same shape (customer-import.ts:92, 112, 146, 173, 419), and data-jobs.ts picks between them with …
- cost: One job done five ways, with about 1,000 lines measured as identical across engines, flows and pages. A change to how an import checks, resumes or reports must be made five times. (The build, CI and an agent's session. Not the browser: each import page loads o…)
- fix: 6 steps; first: 1. Add src/server/import-kinds.ts: one description per kind (its JobKind, its permission from JOB_KEY, how to read the file into rows, how to judge a row, how to write a row, its problems-CSV columns, its storage folder). Start with customers and order histor…
- done when: node /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/fmv/sim2.mjs for the four engines against customer-import.ts reports under 80 lines in runs of three or more (321 today); rg --files src/components/admin | rg 'import-flow' lists one file (four today); the seven integration…
- saving: About 900 to 1,300 lines (estimate from identical lines measured: engines 320 to 470, flows 155 to 220, pages about 300 to 400, plus part of the views).
- after: nothing
- notes: Imports are how a new owner moves in, so the weeks before opening are a good time: nothing is in flight. It is still upkeep, not running cost, so it ranks below the P0 and P1 items. The same family is reported by the copied-code area (CP-1).

### FM-7 [P2 L duplicate corrected] 1,266 server actions, 50 on the shared wrapper; the count of the rest is not held
- evidence: 235 'use server' files in the admin hold 1,266 exported actions. storeAction() or platformAction() is called 50 times in 3 files (orders, returns, the books settings); 232 files guard by hand. The verified report counted about 180 small local helpers in those files (wordsOf in 48, noAccess in 35, text in 25, said in 16, failed in 12, asOwner in 11, done in 10) and showed that a wrapped action is no shorter than a gu…
- cost: About 300 lines of repeated local helpers (estimate), and failures that are answered and logged differently per file. No run-time cost. (The owner's admin (an action that throws shows Next's error page instead of a p…)
- fix: 3 steps; first: 1. Count it. In scripts/lib/ratchet-count.mjs add unwrappedActionFiles: files under src/app/admin and src/components/admin whose first statement is 'use server' and that call neither storeAction( nor platformAction( (232 today). Return it from ratchetCounts()…
- done when: src/server/ratchet.baseline.json has unwrappedActionFiles (232 on the day it is added) and src/server/ratchet.scan.test.ts fails when a new 'use server' file in the admin calls neither wrapper.
- saving: About 300 lines over time (estimate), and one failure behaviour. The wrapper itself saves no lines per action.
- after: nothing
- tracked: code review step 1.4: Done for the wrapper on 11 November; the other files move 'when touched' (docs/rules/admin/platform.md:89), with no count
- notes: Only step 1 is worth doing now (small, and it stops the number growing with every new screen). The conversion is the existing rule and follows other work. The same gap is reported by the copied-code area (CP-7).

### FM-8 [P2 L duplicate confirmed] Lists, tables, dates and selects are still hand-made per screen, and the counts are not held while the kit waits
- evidence: Counted by the planner over src/app/admin and src/components/admin (1,155 TSX files): 154 tables in 116 files; 436 native selects in 198 files; Europe/Oslo in 67 files and slice(0, 10) in 46; confirm( in 42 files; 31 files with a hand-made GET filter form; no shared pager (0 uses of one). The kit (src/components/admin/ui: bars, button, card, chip, focus-frame, insight, list, page-header) has no table, select, date o…
- cost: Up to about 2,000 lines of table markup a column-list part would not need (estimate: the header lines), and dates on the wrong day for a store outside Norway (FS5 in the code review), which matters once stores in other … (The owner's admin and an agent's session.)
- fix: 2 steps; first: 1. Hold today's numbers before building anything. In scripts/lib/ratchet-count.mjs add six counts over the two admin folders' TSX files: '<table' (154), '<select' (436), files with 'Europe/Oslo' (67), files with 'slice(0, 10)' (46), files with a call of confi…
- done when: src/server/ratchet.baseline.json holds the six counts at the numbers above and src/server/ratchet.scan.test.ts fails when a new admin screen adds a table, a native select, an Oslo date or a confirm( call.
- saving: Up to about 2,000 lines of markup once the kit is used (estimate). The larger gain is one behaviour everywhere.
- after: FM-7 step 1 shares the same three files; do both in one change
- tracked: code review steps 1.12, 1.13, 1.14 and 1.15: all Open. Their findings (FS4, FS5) already plan scan tests once built; holding the counts before that is the only…
- notes: The kit itself is the code review's plan and is not restated. Only step 1 is new. The same ground is reported by the copied-code area (CP-3).

### FM-10 [P2 M duplicate corrected] Work's combined lists and the account's Domains pages repeat the store's, 29 to 77% the same
- evidence: D123 gave Work a combined, read-only view across an owner's stores, with the data and the editing left per store. Its list components repeat the store's. Share of the account-level file's significant lines found unchanged in the store-level file: owner-invoices 63% (80 of 128), owner-clients 52% (37 of 71), owner-time 44% (60 of 137, against time-filters.tsx), owner-overview 35% (67 of 192), owner-report 29% (37 of …
- cost: About 280 identical component lines and three Domains files with about 110 identical lines (the verifier's count), kept in step by hand. (The build, CI and an agent's session. Not the browser.)
- fix: 2 steps; first: 1. Let src/components/admin/work/invoices-list.tsx, clients-list.tsx, time-filters.tsx and report-filters.tsx take rows from one store or from several: an optional store column and a link builder passed as props. Draw the account pages with them and delete ow…
- done when: node /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/fm/sim.mjs over the five Work pairs reports under 80 identical lines in all (281 today), and the two move-domain page.tsx files are under 30 lines each (101 each today).
- saving: About 350 to 450 lines (estimate from the identical lines measured).
- after: nothing
- notes: Do when Work's lists are next opened; FM-8's table part would make it smaller still, so it can wait for that. The same pairs are reported by the copied-code area (CP-5).

### FM-11 [P2 M duplicate corrected] Ten small pairs of near-copies, about 840 identical lines
- evidence: Identical significant lines, second file against first, re-measured by the planner: the shopper's order page in two places 115 of 208 (55%); own-speed.ts against analytics-speed.ts 57 of 82 (70%); plan-reminders.ts against cart-reminders.ts 123 of 298 (41%); the affiliate and bonus settings forms 157 of 253 (62%); the campaign and discount editors 149 of 438 (34%); the docs-guide and chat-agent forms 58 of 86 (67%);…
- cost: Up to about 840 identical lines in ten pairs (the verified total), kept in step by hand. No run-time cost. (The build, CI and an agent's session.)
- fix: 3 steps; first: 1. When either file of a pair is next opened, fold the pair: an OrderView part for the two shopper order pages; a ProgramSettingsForm for bonus and affiliates; one versions dialog that takes what it lists; one agent-settings form for the chat agent and the do…
- done when: node /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/fm/twinscan2.mjs no longer lists these four pairs it lists today: the affiliate and bonus forms, the two shopper order pages, the campaign and discount editors, the chat-agent and docs-guide forms.
- saving: About 500 to 700 lines (estimate; the identical-line count is an upper bound).
- after: FM-13 steps 2 and 3, for the budget that records each fold
- notes: Two of the pairs (the speed recorders, the reminders) are the platform's twin of a store feature and are the cases FM-5's sentence speaks to. Not a project: fold a pair when it is touched. Reported also by the copied-code area (CP-11, CP-12).

### FM-9 [P3 M duplicate corrected] Fiken's sync engine is a copy of Tripletex's: about 250 to 400 identical lines, and no third system is planned
- evidence: fiken-sync.ts says of itself that it is 'the same engine as Tripletex's' (line 28). Imports left out, 208 of its 386 significant lines (54%) are in tripletex-sync.ts unchanged, 143 in runs of three or more: sweep, claim, release, block, fail, the retry ladder, attaching PDFs. The connection modules are 25% alike (84 lines, 40 in runs). The two settings pages share 73 long lines (44%) and their actions 23. What a doc…
- cost: About 250 to 400 duplicate lines today. A fix to the queue, the retry ladder or the alerts must be made twice. No run-time cost beyond one small query every five minutes; the job works per connected store, so a store wi… (CI and an agent's session.)
- fix: 3 steps; first: 1. Do nothing now. Leave both connectors as they are.
- done when: Not planned. If step 2 is done: node /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/fmv/sim2.mjs src/server/tripletex-sync.ts src/server/fiken-sync.ts reports under 40 lines in runs of three or more (143 today) and the named integration tests pass without an edit.
- saving: About 250 to 400 lines (estimate from the 143 to 208 identical sync lines, 40 to 84 in the connection modules and about 75 to 126 in the pages; an interface costs some back). No saving from later connectors: none is planned.
- after: nothing
- tracked: no. docs/own-books-and-sales.md decision 6 says no further accounting connector is started.
- notes: P3 because it is a true but small duplicate in code that books money, both connectors are a bridge to the own ledger, and no third is coming. Folding it now would spend risk to save a few hundred lines that are due to shrink anyway. Reported also by the copie…

### FM-12 [P3 M duplicate corrected] Small helpers are rewritten per file: addDays in 10 files, isUuid in 23, isUniqueViolation in 9
- evidence: 446 names are defined at top level in three or more files of src (route and page names such as GET and Page among them). Opened by the planner: addDays is exported by seven lib modules (lines in the list above) and written locally in three more; isUuid is defined in 23 files and exported by two; isUniqueViolation is in nine server files, exported by one. The verified report counted 248 function bodies that are byte-…
- cost: Up to about 1,000 lines of exact repeats (0.13% of the code) and three ways to check an id. No run-time cost. (An agent's session and reviewers.)
- fix: 3 steps; first: 1. Do not sweep. Name one home for each of three helpers: addDays in src/lib/analytics-period.ts (or a new src/lib/days.ts that the seven re-use), isUuid in src/lib/admin-api.ts:116 moved to a small src/lib/ids.ts, isUniqueViolation in a new src/server/pg-err…
- done when: pnpm lint fails on a trial 'const isUuid = ...' in a new file; rg -c for definitions gives addDays 10, isUuid 23 and isUniqueViolation 9 or fewer, falling to 1 each over time.
- saving: Up to about 1,000 lines over time (measured as exact repeats, loading files apart). The lint rule itself saves nothing; it stops the three most-copied helpers from spreading.
- after: nothing
- notes: P3: hygiene with no running cost, and a sweep costs more review than it saves. Steps 1 and 2 are small and can ride with any change to eslint.config.mjs. Reported also by the copied-code area (CP-8).
