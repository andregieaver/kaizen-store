# server-graph: The server code every route loads

One import cycle of 229 files in src/server makes 181 of 268 route handlers, 559 of 562 pages and the proxy each load about 10 MB of server code (the AI manager's tools, the admin's whole text in two languages, the schema, Stripe, sharp): a fat route takes 0.9 to 1.3 s and 97 MB of heap to load cold on this machine against 0.16 to 0.24 s and 26 MB for /api/health, and every instance first pays 0.27 to 0.30 s for a start hook and about 0.09 s to read a 10.4 MB list of server references. None of it depends on what a store uses, so it grows with stores, traffic and the deploy on every push once the platform opens. The cure is a few dozen small import changes, not removed features: one import path takes the visit beacon from 10.4 to 1.9 MB (0.96 MB with the schema and Stripe cuts), the rest take a storefront page from 11.3 to about 3.5 MB, the proxy from 9.2 to 2.4 MB (0.8 MB with its readers split) and 2.2 MB off 384 admin pages (all simulated on the build's own module graph). A scan test and a byte budget must land with them or the next convenient import undoes the work; before opening is the cheapest time, with no live traffic and every cut checkable on the next build.

## Measures
- Modules and bytes /api/visit loads that /api/health does not: 1,586 modules, 9,298 KB: src/lib/admin-messages 2,903 KB (133 modules), src/server 2,427 KB (482), src/lib 2,274 KB (570), src/lib/messages 413 KB (26), opentype.js 226 KB, stripe 212 KB (189), signature themes 127 KB, legal starters 95 KB, @supabase/auth-js …
- Eager chunks named by each built entry: /api/visit 117 chunks, 11,130 KB; /api/health 16 chunks, 1,129 KB; /s/[store]/[market] 181 chunks, 12,169 KB; /admin/[store]/orders 173 chunks, 11,936 KB; the proxy 18 chunks, 9,729 KB; /api/shop/tiles 117 chunks, 11,133 KB; /api/cron/page-jobs 118 chunks, 11…
- next analyze figures (the baseline for each done-when): /api/visit 1,890 modules, 10,475 KB; /api/health 308 and 1,155 KB; /s/[store]/[market] 2,419 and 11,944 KB; /admin/[store]/orders 2,349 and 12,068 KB; 4.0 to 5.3 MB more per page behind import(); 34.7 MB traced beside each function
- The import cycle: 229 modules, all in src/server, 712 edges; with what it reaches 1,934 modules and 10.3 MB on a route handler; compiled once per layer (route handlers, pages, proxy)
- Routes that load the cycle: 181 of 268 handlers (median 2,015 module paths; 24 under 500), 559 of 562 pages, the proxy 1,969
- Every route after this plan's cuts (simulated): Median handler 2,015 -> 725 module paths; median storefront page 2,500 -> 1,637; median admin page 2,443 -> 1,998; handlers over 1,500: 181 -> 29; handlers that reach the AI tools 181 -> 28; that reach admin-text.ts 238 -> 49; that reach the Stripe SDK 244 ->…
- Staged results for the key routes (simulated): /api/visit: 2,015 paths, 10.4 MB -> 708, 1.9 MB (SG-3) -> 663, 1.17 MB (SG-6) -> 465, 0.96 MB (SG-9). Storefront home: 2,498, 11.3 MB -> 1,843, 7.7 MB (SG-1's three edits) -> 1,661, 4.35 MB (SG-4 step a, SG-6) -> 1,594, 3.9 MB (SG-17) -> 1,389, 3.6 MB (SG-18)…
- Cold load, measured by the skeptic in fresh processes: /api/visit 0.89 to 1.3 s (heap 97 MB, RSS 222 MB); /api/health 0.16 to 0.24 s (26 MB, 106 MB); storefront home 1.06 to 1.13 s; admin orders 0.91 s; the proxy 0.87 to 1.04 s (87 to 96 MB); instrumentation 0.27 to 0.30 s (43 MB). Calibration: a route of 685 mod…
- The server-reference manifest at each cold start: 10,397,955 bytes; 80 to 91 ms and 20 to 24 MB of heap (39 MB RSS) to load: read 20 ms, parse 40 to 43 ms, deep freeze 30 ms. 1,454 references, 81,027 route entries; 85 cached functions hold 55,974 of them (74 are listed for more than 700 of 807 routes); 1,369…
- Where evaluation time goes on /api/visit: 1,332 factories, 771 ms: src/lib 337 ms, src/server 215 ms, src/db/schema.ts 68 ms, admin-text.ts 51 ms plus catalogues 13 ms, mcp-catalogue.ts 42 ms, lib/owner-tools.ts 18 ms, all four storefront languages 12.8 ms, opentype 11 ms, stripe 6 ms. /api/health: 1…
- Who brings the admin text registry to shoppers: 723 non-test files import src/lib/admin-text.ts. With the cycle cut, 13 files bring it to the 59 storefront pages and eight of them cover 57 pages: two-step.ts, customer-tiers.ts, plan-reminders.ts, shopper-emails.ts, company-locations.ts, staff-alerts.ts, en…
- The key reader that brings Stripe: 18 server files import settings.ts for encryptionKey() alone. With those edges removed after the other cuts: storefront pages that reach the Stripe SDK 59 -> 33, handlers 155 -> 95, 205 modules and 260 KB off the storefront home page
- The theme store section in the page renderer: One static import (page-article.tsx:35) puts 67 modules and 464 KB on 96 routes, 58 storefront pages among them, and is their last path to sharp
- sharp: import takes 44 to 54 ms and 26 to 29 MB of RSS; 12 server modules import it at the top, none lazily; 181 handlers and 559 pages reach it; 18.9 MiB in each such function's trace
- Traced files: /api/visit: 449 files, 47.5 MiB: chunks 14.0 MiB, sharp 18.9 MiB, taxonomy 12.7 MiB, no source map. /api/health: 216 files, 15.6 MiB, of which taxonomy 12.7 MiB. Code behind import() is still traced. The manifests are not in the nft.json; the host adds them
- Server chunks written more than once: 5,174 chunk files, 195.5 MiB of JS, 72.0 MiB unique; 512 files (123.6 MiB) repeat another's bytes; their maps 431 MiB of 672 MiB. A second route with other copies cost 116 to 142 ms and 15 MB in the same process
- Build: 263 s: compile 36.5 s, type check 3.0 min, 1,426 static pages; peak machine memory 7.6 GB (baseline 0.8 GB); .next/server 1.4 GB by du
- Tests that hold today's import paths: One test mocks @/server/chat-route for sameSite; src/proxy.test.ts mocks five proxy modules by path; 113 test files mention platformModes, nearly all in a mock of ./stripe; none mocks privacy-erasure, customer-admin, store-closure, owner-tools, ui-text, setti…

## Well made
- A lean route is possible today: /api/health loads 16 chunks and 1.1 MB, and 24 handlers reach under 500 modules (/admin/sw.js 93, /api/ucp/catalogue.json 103, /api/gravatar/[hash] 139). The fat graph is a tangle of imports, not a property of the stack.
- Turbopack runs a module's body only when it is first imported: a chunk's factories are registered on load and the route's own code is loaded on the first request. /api/visit's chunks hold 1,879 source modules; 1,332 factories run.
- A lazy server import is safe in a prerendered page: the server runtime loads an async chunk with a synchronous require and returns an already resolved promise (.next/server/chunks/[turbopack]_runtime.js:945-970), so import() adds no I/O task. What it does not…
- Modules are instantiated once per process, so a second fat route in a warm instance costs almost nothing when it names the same chunk files (/api/shop/tiles after /api/visit: 1 ms). The exception is SG-11's copies.
- Heavy third-party parsers are already behind import(): unpdf, mammoth, playwright-core, @sparticuz/chromium (58 await import() in 30 server files). They cost package size, not cold-start time.
- sameSite() already lives in a leaf with no imports (src/lib/same-site.ts), OwnerToolError in its own leaf (src/server/owner-tool-error.ts), visitorKey in chat-turns.ts, and 66 src/lib modules already import their own area's admin catalogue directly: several o…
- The taxonomy (12.7 MiB of JSON) is read from disk on first use and kept per instance (src/server/product-taxonomy.ts:27-43); catalog.ts reads it only for a product with a standard category.
- Chromium, the PDF files, the docs' Markdown and HarfBuzz are traced only into the routes that use them (next.config.ts:50-78); only the taxonomy uses '/**'.
- The database pool is made on first use (src/db/client.ts:94-97); importing the client opens nothing.
- Source maps are not traced into any function checked, and the edge runtime carries nothing heavy (.next/server/edge is 116 KB).
- The browser's copy of the admin catalogue is already split per area (D540, docs/performance.md:167-185); what is whole is the server's registry (SG-4).
- After the planned cuts no second hub hides behind the first on an admin page: removing any one file of src/server or src/app from /admin/[store]/orders takes off at most 238 modules and 0.64 MB. An admin page's floor of about 2,000 modules is what it uses (au…
- The three-minute type check is not paid on Vercel (next.config.ts:45, D378) and CI runs it in its own job: it is no cost of the server graph.
- Test coupling to the present import paths is small for the P0 and P1 cuts: one mock of the chat module, one proxy test with five mocks, nothing for the cycle's edges, the key reader or the theme store section. Only SG-9 meets many tests (113 files).
- No finding in this dimension asks to retire, hide or merge a feature, and none argues from a feature being unused. Each is a running cost that every store pays whatever it uses, so the owner's clarification changes wording (SG-5), not substance.

## Findings (18)

### SG-3 [P0 S eager confirmed] The visit beacon and 52 other routes import the chat agent to get a ten-line function
- evidence: sameSite() lives in src/lib/same-site.ts and imports nothing. chat-route.ts re-exports it (line 38) and also imports chat-agent.ts, private-mode.ts, shop.ts and support.ts (lines 7-12). I counted the importers again: 61 non-test files import chat-route; 37 take only sameSite and 16 take fail and sameSite (53 route files), replicate-route.ts and assistant-route.ts take sameSite, and only the two chat routes and four …
- cost: About 8.5 MB and 1,300 modules on each of the four visit beacons, and about 0.65 to 0.75 s of their 0.9 to 1.3 s cold load on this machine (estimate by calibration: a measured route of 685 modules and 1.75 MB loads in 0… (The server on each cold instance of /api/visit, /api/visit/touch, /api/visit/sp…)
- fix: 9 steps; first: New file src/lib/route-fail.ts, no imports, holding the two-line fail() helper now at src/server/chat-route.ts:34-35 (the name the deps and families plans, DP-10 and FM-14, also use).
- done when: A new next analyze export shows /api/visit at or under about 710 modules and 1.9 MB of server code loaded with the route (today 1,890 modules and 10,475 KB); equally, the chunks named by R.c() in .next/server/app/api/visit/route.js sum to under 2.5 MB (today 11,130 KB); and rg -n sameSite src/server/chat-route.ts prin…
- saving: /api/visit: 2,015 -> 708 module paths, 10.4 -> 1.9 MB (simulated on the build's graph, one edge; reproduced). With SG-6: 663 and 1.17 MB. With SG-9: 465 and 0.96 MB. Ten handlers leave the over-1,500 group on this change alone: the four visit beacons, five ad…
- after: nothing
- tracked: Not in the code review, PSI follow-ups or docs/performance.md. Planned twice in this review from other sides: deps DP-10 and families FM-2 and FM-14 (same chan…
- notes: Do this first: it is the largest saving per line changed in the whole dimension. The beacon still loads 85 KB of analytics admin text afterwards (src/lib/analytics-words.ts imports admin-messages/analytics.en.ts and analytics.nb.ts through src/lib/analytics-t…

### SG-1 [P0 S eager corrected] One import cycle of 229 server files makes almost every route load everything
- evidence: 229 files of src/server form one import cycle (712 edges; Tarjan on the build's own module graph, reproduced by the skeptic and matched by the tests-ci plan's source-level count). The build compiles it once per layer (route handlers, pages, proxy). It reaches 1,934 modules and 10.3 MB. 181 of 268 handlers and 559 of 562 pages reach it. I traced the entry chains again on the graph: a storefront page enters through pa…
- cost: 0.9 to 1.3 s and 97 MB of heap (222 MB RSS) to load a fat route cold on this machine, against 0.16 to 0.24 s and 26 MB for /api/health (the skeptic's re-measurement, fresh process per run). About 0.3 s of it is running … (The server per cold instance: the first shopper or owner after each deploy (eve…)
- fix: 11 steps; first: Edit 1, src/server/customers.ts: delete line 17 (import { eraseSubject } from './privacy-erasure'). In deleteCustomer (lines 499-502) load it where it is used: const { eraseSubject } = await import('./privacy-erasure'); The function is already async and is th…
- done when: A new next analyze export shows /s/[store]/[market] at or under about 1,800 modules and 8.2 MB of server code loaded with the route after the first three edits (today 2,419 modules and 11,944 KB), and no storefront route nor /api/shop/tiles lists src/server/owner-tools.ts.
- saving: Simulated on the build's graph (whole edges removed; an estimate). Storefront home: 2,498 module paths and 11.3 MB -> 1,843 and 7.7 MB with the three edits. /api/shop/tiles: 2,018 and 10.4 MB -> 1,168 and 6.3 MB with edits 1 to 7, and -> 733 paths and 2.3 MB …
- after: nothing
- tracked: Partly. Code review step 3.13 Domain folders (FV4, FH6) and step 4.1 Lint rules (FH7, FH8), both Open, say nothing stops one feature importing another's intern…
- notes: Effort S is for edits 1 to 3, which pay for shoppers; edits 4 to 7 and TC-2's list are M together. Admin pages do not move with this finding: see SG-15. The proxy gets most of its gain from this finding with SG-4 and SG-6 (9.2 -> 2.4 MB simulated) before its …

### SG-6 [P0 S dead confirmed] schema.ts (19,614 lines) is evaluated in every function and used by none at run time
- evidence: client.ts imports * as schema (line 11) and passes it to drizzle() (line 78). Nothing reads through it: I searched src for db().query, db().select, .from(schema. and found none outside tests that call pg's own tx.query(); the server writes SQL through execute(). client.ts is the only non-test importer of the schema (one scan test imports it too); drizzle-kit reads the file from drizzle.config.ts:7, not from the clie…
- cost: 56 ms of /api/health's 101 ms of module evaluation and 68 ms on /api/visit (per-factory profile, re-run by the skeptic); 598 KB parsed per layer per instance. (The server per cold instance of every function that touches the database (256 o…)
- fix: 5 steps; first: src/db/client.ts: delete line 11. Line 31 becomes type Database = NodePgDatabase; (no schema type, so db().query.<table> stops type-checking, which is right: nothing fills it any more). Line 78 becomes withRows(drizzle({ client: pool })).
- done when: A new next analyze export shows /api/health under about 280 modules and 0.45 MB of server code (today 308 and 1,155 KB) and no route lists src/db/schema.ts; pnpm db:check exits 0.
- saving: About 0.7 MB and 55 to 70 ms per layer per cold start on every database route (simulated: /api/health 1,125 -> 395 KB; /api/visit after SG-3 1,898 -> 1,173 KB; the proxy and a storefront page lose 0.6 to 0.7 MB each).
- after: nothing
- tracked: Yes: code review FD5, step 3.14 'Split schema.ts', Open; its fix text already says to drop the schema argument first. New here: the measured cost per cold star…
- notes: Do it now and leave the split of the file for step 3.14.

### SG-5 [P0 S eager corrected] Every instance start loads 856 modules and queries the database before the first request
- evidence: register() imports ui-text.ts and awaits startUi() (instrumentation.ts:8-9); Next's route module awaits ensureInstrumentation before each function's first request (route-module.js:428-449, called from the app-route and app-page templates). ui-text.ts is both the reader of AI-translated interface text and the platform admin's tool that makes it, so it imports ai.ts and auth.ts (lines 14-15) and, through ui-catalog-al…
- cost: 0.27 to 0.30 s and 43 MB of heap before the first request of every function instance, lean routes included (the skeptic's re-measurement, 3 runs), plus one query per start and one per instance-minute. For a lean route t… (The server at every cold start of every function; the database once a minute pe…)
- fix: 6 steps; first: Move BUILT_IN_LANGUAGES and isBuiltIn from src/lib/ui-catalog-all.ts:5-7 to a leaf with no imports (for example src/lib/built-in-languages.ts); ui-catalog-all.ts re-exports them.
- done when: After a build, the .js chunk files named in .next/server/instrumentation.js.nft.json sum to under 700 KB (today 4 files, 2,383 KB, one of them 2,339 KB), and src/server/route-load.graph.test.ts holds src/instrumentation.ts, following its import(), to 250 source files or fewer with no src/server/ai.ts, src/server/auth.…
- saving: Simulated: 856 -> 208 modules with the split alone, whether or not translated languages exist; -> 168 with SG-6; -> 130 while there is no language to load. An estimated 0.2 to 0.25 s and 25 to 35 MB of heap per instance start, on every function. On a storefro…
- after: nothing
- tracked: Not in the repo's plans. In this review the same split is storefront-data SD-7 step 1; the minute poll is caching CA-12, db-queries DQ-12 and db-schema DS-2.
- notes: The saving does not rest on the translations table being empty: the tool half (ai.ts, auth.ts, the admin catalogues, the schema) loads at every start for a job that only reads, and the split removes about 650 modules either way.

### SG-4 [P0 S oversize corrected] The admin's whole interface text, both languages, loads wherever one word is needed
- evidence: admin-text.ts statically imports 134 catalogues (67 areas in English and Norwegian) into one table; adminText(lang, area) reads one entry (lines 300-303). In the server chunks that is 2,903 KB in 133 modules. 242 of 268 handlers, 560 of 562 pages, the proxy and instrumentation reach it. 723 non-test files import the module. I counted who brings it to shoppers once the cycle is cut: 13 files across the 59 storefront …
- cost: 2.2 to 2.9 MB of server code per route and about 64 ms of evaluation per cold start (admin-text.ts 51 ms plus catalogues 13 ms in the profile; attribution approximate); about 27 MB of repeated chunks in the build. (The server per cold instance on every storefront, API and admin route; the buil…)
- fix: 6 steps; first: Step a1 (for shoppers, small): add src/lib/admin-area.ts with no catalogue import: the type AreaWords<A> = { area: A; words: Record<AdminLang, AdminAreaMessages[A]> } (types from admin-text.ts by import type) and areaText(lang, a) returning a.words[lang] (the…
- done when: A new next analyze export shows no src/lib/admin-text.ts in /api/visit, /s/[store]/[market] or the proxy, and /s/[store]/[market] at or under about 1,650 modules and 4.7 MB with SG-1 and SG-6 also in (today 2,419 and 11,944 KB). For step b: /admin/[store]/orders lists only the areas it draws.
- saving: Step a, simulated after SG-1's three edits: storefront home 7.7 -> 5.0 MB with the three importers it has (about 2.7 MB less; the areas it keeps are about 0.15 MB), and with SG-6 4.35 MB; the proxy 5.2 -> 2.4 MB with the eight importers; handlers that reach t…
- after: SG-1
- tracked: The browser's half is done (D540, docs/performance.md:167-185). The server registry is not tracked in the repo. In this review the same change is families FM-1…
- notes: P0 and S are for step a. Step b is P2, M. The skeptic's count of three importers is right for the home page; over all storefront pages it is eight, so step a3 lists eight.

### SG-14 [P0 S process confirmed] Nothing measures or limits the server graph, so it only grows
- evidence: There are 46 scan tests and one graph test (counted with find), and budgets for a visitor's and the admin's first scripts, but none for what a route loads on the server: eslint.config.mjs has no import or cycle rule (rg finds no no-restricted-imports and no import plugin), the workflows hold no step that reads .next/server (rg over .github/workflows and scripts), and the code review says circular imports were only s…
- cost: Every finding of this dimension arrived unnoticed. With about 3,800 imports between server files and agents adding more each day, a cut made today is undone by the next convenient import. (Everyone later: shoppers in cold starts, the build in memory, engineers and age…)
- fix: 6 steps; first: One test file, src/server/route-load.graph.test.ts (the name deps DP-6 uses; families FM-13's server-reach.scan.test.ts, storefront-data SD-1's proxy.graph.test.ts and assets AS-3's proxy ratchet are the same guard: build one). Move the import walk of src/lib…
- done when: pnpm test runs src/server/route-load.graph.test.ts green; a trial edit that adds import '@/server/chat-route' to src/app/api/visit/route.ts makes it fail; and CI's e2e job prints the budget table for a push and fails on a local build made with that trial edit.
- saving: None by itself. It keeps the gains of SG-1 to SG-9, SG-15, SG-17 and SG-18: about 8.5 MB and 0.7 s on the beacon, about 7.5 MB on a storefront page, about 8 MB on the proxy.
- after: SG-3
- tracked: Partly: code review step 4.1 'Lint rules for the boundaries' (FH7, FH8), Open, covers src/lib imports, not server reach or budgets. In this review the same gua…
- notes: Land the first version with SG-3 (the visit routes' rule is green the moment that change is in) and add each entry's rule with the cut that makes it true.

### SG-15 [P1 S eager confirmed] The admin shell loads the AI manager's whole engine on every admin page
- evidence: The store layout binds the assistant's actions and hands them to AiManagerLauncher on every page of a store's admin (layout.tsx:113-128); the platform layout does the same. The actions file imports owner-assistant.ts at the top (actions.ts:8-17), which imports owner-tools.ts and through it the rest of the cycle. So after every cut of SG-1, 384 of 449 admin pages still reach the AI tools, and /admin/[store]/orders st…
- cost: About 2.2 MB and 400 modules on every admin page of a store, loaded whether or not the owner opens the assistant; the admin orders page takes about 0.9 s to load cold on this machine (measured by the skeptic). (An owner's admin: the server per cold instance of any admin page. It grows with…)
- fix: 5 steps; first: src/app/admin/(gated)/[store]/assistant/actions.ts: turn the value import of @/server/owner-assistant (lines 8-17) into a type-only import (import type { Approval, Conversation }) and add an unexported loader: const assistant = () => import('@/server/owner-as…
- done when: A new next analyze export shows /admin/[store]/orders without src/server/owner-tools.ts among its sync modules, at or under about 2,050 modules and at least 2.0 MB under today's 12,068 KB of server code loaded with the route (today 2,349 modules).
- saving: Simulated: /admin/[store]/orders 2,425 -> 2,030 module paths, 11.0 -> 8.8 MB; with SG-6 8.2 MB; admin pages that reach the AI tools 384 -> 55 to 65; median admin page 2,443 -> about 2,000. An estimated 0.15 to 0.2 s of an admin page's cold load.
- after: SG-1
- tracked: Not in the repo's plans. In this review the same edit is deps DP-11.
- notes: This is not an argument from the assistant being unused: the launcher stays on every page, only the engine waits for the first use. After this, an admin page's floor is about 2,000 modules and 8 MB, and the only further cut is the text registry (SG-4 step b).

### SG-18 [P1 S eager added] Eighteen modules import the payment settings file for a three-line key reader, and the Stripe SDK comes with it
- evidence: encryptionKey() is three lines in settings.ts (22-25): parseKey(process.env.SETTINGS_ENCRYPTION_KEY), with parseKey from src/lib/secret-box.ts:15. Eighteen server files import settings.ts for that function alone (rg: ai.ts, mollie.ts, google-reviews.ts, instagram.ts, integrations.ts, webhook-endpoints.ts, shipping-carriers.ts, fiken.ts, tripletex.ts, slack.ts, sms.ts, custom-apps.ts, developer-apps.ts, page-looks.ts…
- cost: About 205 modules and 260 KB of server code (settings.ts, connect.ts and the Stripe SDK's 189 modules and 212 KB) on every route that reads a secret or asks for an AI connection but takes no payment: 26 storefront pages… (The server per cold instance of those routes. It is the same for every store, w…)
- fix: 5 steps; first: New file src/server/encryption-key.ts: import 'server-only'; import { parseKey } from '@/lib/secret-box'; and the function and comment now at src/server/settings.ts:22-25.
- done when: rg -n 'export function encryptionKey' src/server/settings.ts prints nothing, and a new next analyze export shows /s/[store]/[market] with no ~/stripe module among its sync modules (today 189 modules, 212 KB) once SG-1 and SG-5 are also in.
- saving: Simulated on the build's graph after the other cuts: 205 modules and 260 KB off the storefront home page and /api/shop/tiles; the Stripe SDK off 26 of 59 storefront pages and 60 of 155 handlers. In time a small share: Stripe's own factory ran in 6 ms in the p…
- after: SG-1
- notes: The report's SG-9 said storefront pages reach Stripe 'through checkout code'; the graph shows the home page reaches it through this key reader instead. This is the cheap half of SG-9 and should come before it. Found by asking, after the planned cuts, which si…

### SG-17 [P1 S eager added] The page renderer imports the theme store's server code for every page of every store
- evidence: page-article.tsx draws every page of every store and of Kaizena Flow's own site. It statically imports each block's server component, among them ThemeStoreSection (line 35), which draws only on Kaizena Flow's pages and its own store's: the component's first line returns null for any other owner (theme-store-section.tsx:24, D285 and D469). That component imports theme-store.ts (line 9), which imports theme-shots.ts (…
- cost: 67 modules and 464 KB of server code on every storefront page and on about 40 other public pages, and the only reason those pages load sharp (44 to 54 ms and 26 to 29 MB of RSS per cold instance until SG-7) and carry it… (The server per cold instance of every store's pages; a store pays for a compone…)
- fix: 5 steps; first: src/components/page-article.tsx: delete the static import at line 35 and add a small async wrapper beside the other helpers: async function ThemeStorePart(props: { block: ThemeStoreBlock; place: GridPlace }) { const { ThemeStoreSection } = await import('./the…
- done when: A new next analyze export shows /s/[store]/[market] with no src/server/theme-store.ts and no [externals]/sharp among its sync modules, and at or under about 1,600 modules and 4.2 MB of server code with SG-1, SG-4 and SG-6 also in (today 2,419 modules and 11,944 KB).
- saving: Simulated on the build's graph after the other cuts: 67 modules and 464 KB off each storefront page and about 40 other public pages (96 routes); sharp no longer loaded at cold start by 56 of 58 storefront pages even before SG-7. The package keeps sharp until …
- after: SG-1
- notes: This is the registry pattern the brief asked to test: one renderer imports every block's server reader, and one of them belongs to the platform's own site. Found by asking, after the planned cuts, which import still tied the storefront home page to sharp.

### SG-2 [P1 M eager confirmed] The proxy that runs before every store page loads the whole graph
- evidence: The proxy runs on Node.js and its second matcher lets through every page address (proxy.ts:53-60). Its built entry names 18 chunks, 9,729 KB (summed here). It reaches 1,969 module paths: owner-tools.ts through house-switch.ts -> pages.ts -> visibility.ts -> customers.ts, the admin catalogues through holding.ts -> auth.ts -> two-step.ts -> admin-text.ts, sharp through house-switch.ts -> seo.ts -> theme-store.ts, the …
- cost: 0.87 to 1.04 s and 87 to 96 MB of heap per cold proxy instance (the skeptic's re-measurement, 3 runs). A cold visitor can pay this and then the page function's own cold start. (Every shopper's page request that lands on a cold proxy instance, prerendered p…)
- fix: 6 steps; first: Step 1, the tag leaf: new file src/lib/cache-tags.ts with no imports, holding the tag names and builders now spread over feature files: STORES_TAG (seo.ts:67), storeTag (stores.ts:178), CATALOG_TAG and catalogTag (catalog.ts:35-36), PAGES_TAG and pagesTag (pa…
- done when: After a build, the chunks named by R.c() in .next/server/middleware.js sum to under 2 MB (today 18 chunks, 9,729 KB), and a new next analyze export of the proxy lists no src/server/auth.ts, pages.ts, seo.ts or stripe.ts.
- saving: Simulated on the proxy's own analyzer data: 1,969 module paths and 9.2 MB -> 915 and 2.4 MB from SG-1, SG-6 and SG-4 step a with no change here; -> about 450 and 0.8 MB with the tag leaf and the readers split (the skeptic's sequence: 959 and 5.1 MB with the t…
- after: SG-1; SG-4; SG-6; SG-14
- tracked: Not in the repo's plans. In this review the readers' split is storefront-data SD-1 step 1 (same files) and functions FN-2.
- notes: Take the free part first: the P0 items already bring the proxy from 9.2 to about 2.4 MB. The split here is for the rest, and so that a new import in a feature file cannot make the proxy fat again.

### SG-7 [P1 S eager corrected] The sharp image library is loaded at cold start by routes that never touch a picture
- evidence: 12 server modules write import sharp from "sharp" at the top (counted again: ai-vision, content-packs, page-looks, picture-editor, ai-picture-marks, theme-highlights, product-import, replicate-images, replicate, ai-pictures, theme-shot-files, brand-marks); none loads it lazily. All are admin, AI or cron picture work. 181 handlers and 559 pages reach it, and its files (libvips 17.8 MiB, the addon and wrapper 1.0 MiB)…
- cost: 44 to 54 ms and 26 to 29 MB of RSS per cold instance (the skeptic's re-measurement: import('sharp') in a fresh process, 3 runs, warm disk); 18.9 MiB in the function package. (The server per cold instance of nearly every route; function package size at de…)
- fix: 4 steps; first: New file src/server/sharp-load.ts (the name deps DP-2 uses; assets AS-1 calls it sharp.ts: make one): import 'server-only'; import type sharp from 'sharp'; let loaded: Promise<typeof sharp> | undefined; export const loadSharp = () => (loaded ??= import('sharp…
- done when: pnpm lint fails on a new static value import of sharp outside src/server/sharp-load.ts (0 such imports under src outside tests; today 12), and a new next analyze export shows no [externals]/sharp among the sync modules of /s/[store]/[market] or the proxy.
- saving: About 50 ms and about 28 MB of RSS per cold instance of every route that reaches it today. The package does not shrink from this: a module behind import() is still traced (unpdf's lazy chunks are in /api/visit's nft.json), so the 18.9 MiB leaves only the rout…
- after: nothing
- tracked: Not in the repo's plans. In this review the same change is deps DP-2 and assets AS-1.
- notes: Needed whatever the cycle cuts do: admin pages keep their chain to sharp, and the storefront keeps one until SG-17.

### SG-16 [P2 S oversize added] Every cold function reads a 10.4 MB list of server references before its first request
- evidence: Next's route module loads server/server-reference-manifest.json for every app route, pages and route handlers alike, in prepare() before the first request (route-module.js:206-212 and 463-465; the app-route template calls it at line 132). loadManifest reads the file, parses it and deep-freezes it, once per process (load-manifest.external.js:40-66). The file is 10,397,955 bytes. Timed with Next's own loadManifest in …
- cost: 80 to 91 ms and 20 to 24 MB of heap per cold instance of every function, the lean ones included: about a third on top of /api/health's 0.16 to 0.24 s. Measured here with Next's own loader; whether Vercel's packaging cha… (The server per cold instance of every function, whatever the route. It grows wi…)
- fix: 5 steps; first: Measure it where it matters first: Next traces this step as the span 'load route manifests' (route-module.js:463-465). Read that span for one cold request in production (or log the time around the first request once) to confirm the function pays what this mac…
- done when: scripts/route-budget.mjs prints the manifest's bytes and entry count on every CI build and fails when either rises, and after SG-1, SG-3 and SG-15 the file is at least 10% smaller: under 9.4 MB and 73,000 entries (today 10.4 MB and 81,027).
- saving: About 10 to 12 ms and 3 MB of heap per cold start from the cuts already planned (14% of entries, by the model). The rest, about 70 ms and 20 MB, stays until the admin's pages stop bundling every cached reader or Next reads the manifest per route. The certain …
- after: SG-1; SG-14; SG-15
- notes: The functions dimension lists the manifest's size as a metric and says what a Vercel function loads 'was not visible'; the load in route-module.js (used by the route templates themselves) and the deep freeze were not seen there. With the start hook of SG-5 th…

### SG-10 [P2 S eager corrected] The AI manager's tool catalogue is converted to JSON Schema at import, on routes with no AI
- evidence: OWNER_TOOLS builds about 250 zod schemas when the module loads; MCP_TOOLS is a module-level array ending in ...OWNER_TOOLS.map(withStore) (mcp-catalogue.ts:121-159), and withStore calls toolDefinition, which runs z.toJSONSchema() per tool (owner-tools.ts:2076-2077). Its readers are three: store-mcp.ts (lines 136, 161, 165), docs-reference.ts:81 and mcpCatalogue() at mcp-catalogue.ts:168; eight test files name MCP_TO…
- cost: About 60 ms of the roughly 770 ms of evaluation at each cold start of any route in the cycle (attribution approximate), and 176 KB plus 71 KB for the two owner-tools files. (The server per cold instance, storefront and beacon included, until SG-1 lands;…)
- fix: 4 steps; first: src/lib/mcp-catalogue.ts:121: replace the module-level array with a memoised function: let tools: McpToolInfo[] | undefined; export const mcpTools = (): McpToolInfo[] => (tools ??= [the three own tools, ...OWNER_TOOLS.map(withStore)]); The definitions are bui…
- done when: rg -n 'MCP_TOOLS' src prints nothing, and the per-factory profile (the review's work/prof.js) of a route that reaches mcp-catalogue.ts without listing tools shows no mcp-catalogue entry above 1 ms (today 42 ms on /api/visit).
- saving: About 42 ms per cold start of a route that loads the catalogue without using it (estimate from the profile). The 18 ms of building the zod schemas stays; SG-1 and SG-15 remove both from routes with no AI.
- after: SG-1; SG-15
- tracked: Related only: code review FA6, step 3.21 (a tool's facts in one place), Open.
- notes: P2: once SG-1 and SG-15 are in, few routes load the catalogue without using it. Do it when mcp-catalogue.ts is next touched (step 3.21).

### SG-11 [P2 S duplicate confirmed] The build writes the same server chunks many times: 124 MiB of 196 MiB is repeats
- evidence: Hashing every server chunk without its last line (the skeptic's script): 512 of 5,174 files repeat another's bytes; one 4.0 MiB blob exists 18 times, the 2.7 MiB admin catalogue chunk 10 times, a 3.9 MiB SSR chunk 5 times. Each copy has its own source map: 431 of 672 MiB. Routes name different copies: /api/visit and /api/cron/page-jobs share 105 chunk files by name but 113 by content, and loading both in one process…
- cost: About 550 MiB of the 1.4 GB under .next/server; build time and memory writing it; and at run time roughly 0.1 to 0.25 s and 15 to 19 MB of heap each time a warm instance first serves a route whose chunk list names other… (The build and CI; the server when one instance serves routes from different cop…)
- fix: 4 steps; first: Do nothing to the bundler first: the copies shrink with the blob. SG-1, SG-4 and SG-6 take most of the 4 MiB and 2.7 MiB chunks apart.
- done when: The duplicate-chunk count in scripts/route-budget.mjs reports under 40 MiB of repeated bytes (today 123.6 MiB), and docs/build-memory.md holds the measured peak with and without server source maps.
- saving: Estimate, not measured: 80 to 100 MiB of chunk JS and about 300 MiB of maps off the build output once the blob is cut. The build-memory gain is unknown until tried.
- after: SG-1; SG-4; SG-6; SG-14
- tracked: Partly: code review FH10, step 1.8 'Give the build room', Open; docs/build-memory.md Watch. The duplicate chunks are new. In this review: tests-ci TC-8 step 5 …
- notes: The three-minute type check is paid locally and in CI's builds only: on Vercel the build skips it (next.config.ts:45, D378) and CI's static job runs pnpm typecheck. It is not a cost of the server graph and is left to the tests-ci dimension.

### SG-8 [P2 L process corrected] Reader and writer share a file, so a new import between features re-joins reads to writes
- evidence: A feature is one file under src/server holding its cached storefront read, its admin save and its audit entry. 30 of the 49 server files with a 'use cache' read also import audit from auth.ts (the skeptic's recount), and 193 server modules import auth.ts within the storefront home page's graph. This is why the cycle of SG-1 formed and why the proxy of SG-2 is fat. One clear case I opened: theme-shots.ts holds the re…
- cost: Little that is not already counted in SG-1, SG-2 and SG-17. What is left on a storefront page after the other cuts is about 3.5 MB: Next's own runtime about 0.5 MB, the four storefront languages 0.4 MB, the rest src/lib… (Engineers and agents, who cannot add an import between two feature files withou…)
- fix: 4 steps; first: Write the rule in docs/performance.md ('What a server route loads') and one line under Conventions in CLAUDE.md: a feature's cached reads and tag names live in x-read.ts (database client, typed-rows, pure src/lib); x.ts keeps the writes and imports the reader…
- done when: docs/performance.md names the reader and writer rule, and src/server/route-load.graph.test.ts asserts that src/proxy.ts reaches no src/server/auth.ts.
- saving: Not megabytes. The first draft's 'toward 2 to 3 MB and under 1,000 modules' could not be reproduced: Next's runtime alone is 544 modules on a page. The value is that SG-1's and SG-2's gains stay.
- after: SG-2; SG-14
- tracked: Related: code review step 3.13 Domain folders (FV4, FH6), Open. The reader and writer rule is new.
- notes: Effort L is for doing it everywhere; the rule and the three splits named are S and belong to SG-2, SG-5, SG-14 and SG-17.

### SG-13 [P3 S oversize corrected] The 13 MB taxonomy is traced into every function, including those that cannot read it
- evidence: outputFileTracingIncludes '/**' copies src/data/product-taxonomy/* beside every function (next.config.ts:69): 12.7 MiB of /api/health's 15.6 MiB of traced files. Only code that imports src/server/product-taxonomy.ts can read it; eight files import it (catalog.ts, listing.ts, products.ts, product-data.ts, product-tools.ts, owner-tools.ts and category-suggest.ts in src/server, and the admin's products actions). 181 of…
- cost: 12.7 MiB of package for about 90 functions today. Package size, not run time: the files are read on first use. (Deploy size and upload; cold-start download where the platform fetches the pack…)
- fix: 4 steps; first: Not before SG-1, SG-2 and SG-3 are in: until then nearly every route reaches the reader and the list of globs would be the whole app.
- done when: .next/server/app/api/visit/route.js.nft.json and .next/server/app/api/health/route.js.nft.json name no product-taxonomy file (today 12.7 MiB in each), and the new scan test passes.
- saving: 12.7 MiB each for about 90 functions now, and for each further route that loses every path to the reader (SG-3's ten, the proxy after SG-2). Lazy imports do not add to that count: they keep the route's need for the file. Nothing at run time.
- after: SG-1; SG-2; SG-3; SG-14
- tracked: Not in the repo's plans. In this review: assets AS-2 (P3) and functions FN-8.
- notes: P3 because it changes no request's speed and its route list is only stable after the cycle is cut. Do it when the trace report of SG-14 exists and shows the count.

### SG-9 [P3 S eager corrected] getStore() imports the Stripe SDK to learn which payment modes have keys
- evidence: stores.ts:182 imports platformModes from stripe.ts to decide paymentsOn (line 300); orders.ts:23 does the same (line 555); stripe.ts imports the Stripe package at the top (line 3). The SDK is 189 modules and 212 KB in the server chunks. platformModes() is not a pure read of the environment today: it calls platformStripe(mode), which builds a Stripe client when a key is set (stripe.ts:33-46); its answer depends only …
- cost: 212 KB and about 190 modules per cold start of every route that reads a store and has no other path to Stripe (6 ms measured for Stripe's own factory; the rest is parsing). (The server per cold instance.)
- fix: 5 steps; first: Not now. Do SG-18 first: it removes the commoner path to the SDK (ai.ts and mollie.ts -> settings.ts -> connect.ts) with no test to change.
- done when: A new next analyze export shows /api/visit with no ~/stripe module (today 189 modules, 212 KB), at or under about 500 modules and 1.0 MB, and pnpm test:int passes.
- saving: /api/visit 663 -> 465 module paths, 1,173 -> 956 KB (simulated, after SG-3 and SG-6). Handlers that reach the SDK: 244 -> 201 today, -> 155 once the cycle is cut, -> 95 with SG-18 as well. Storefront pages do not move with this cut; they lose the SDK through …
- after: SG-3; SG-6; SG-18
- tracked: Not in the repo's plans. In this review: deps DP-3 (P3, same reasoning).
- notes: P3: 212 KB and a few milliseconds on routes that read a store but take no payment, against a change to how 113 test files get their payment modes. The skeptic's note that storefront pages reach Stripe 'through checkout code' is corrected in SG-18: the home pa…

### SG-12 [P3 M eager corrected] Four storefront languages are imported for every server route; a request needs one
- evidence: i18n.ts statically imports da, en, nb and sv (about 95 KB of source each, plus their returns, quotes, reviews and exchange parts): 413 KB in 26 modules on /api/visit. Turbopack merges all four into one factory, which took 12.8 ms in the skeptic's profile. The file's own comment and D212 state the rule: the server and the admin read all four here; only the browser gets one. In my simulation of a storefront page after…
- cost: About 290 KB parsed and roughly 10 ms of evaluation more than a one-language request needs, per cold instance. (The server per cold instance.)
- fix: 3 steps; first: Leave it until SG-1 to SG-6 are in, then measure the per-factory profile again.
- done when: If done: a new next analyze export shows /s/[store]/[market] listing only src/lib/messages/en*.ts as sync modules. If not done: the profile after SG-1 to SG-6 is in docs/performance.md with the decision to leave it.
- saving: About 290 KB and about 10 ms per cold start (measured share of one merged factory); it grows by about 100 KB per language added by hand.
- after: SG-1; SG-4; SG-6
- notes: P3: true, but the lowest saving of the set and the only one that could show a shopper the wrong language. Revisit when a fifth hand-written language is added.
