# Families and twins (FM)

Part of `docs/audits/bloat-review-2026-11.md`, on commit 0bd814c. One reviewer's reading of this area. A tick (✓) marks a finding the lead checked a second time; the others were not checked. "Step" is the step of the plan that closes the finding.

**In short.** Copy-paste is not this codebase's problem: 1.5% of code lines sit in 8-line clones, and a scan of 3,974 files finds only 41 twin pairs. Carriers, payment providers, emails and the AI tools each have one core. The bloat in this area is structural: the same capability is stood up again with its own tables, runner and screens for the platform (19 platform_* tables, 12 never used), for a second copy of kaizenaflow.com that production no longer serves, and for five CSV importers. The cost that reaches shoppers is a loading one: both languages of the admin's words (2.8 MB) load with 802 of 830 server entries, and one helper import makes the visit beacons load 11.4 MB of server code.

## Measured

| Measure | Value | How |
|---|---|---|
| Size measured | 768,077 lines of non-test TypeScript in src, 325,551 lines of tests (lib 266,505; server 214,775; components 169,053; app 96,917) | find + wc -l over src, test and spec files apart. The brief's 473,000 counts differently. |
| Verbatim clones | 8,041 lines (1.5% of 554,290 code lines) sit in an 8-line window repeated in another file; 3.0% with 5-line windows; tests 2.4% | scripts/fm/clones.mjs (hashes windows of normalised lines; comments, imports and lone brackets left out). No jscpd-summary.txt existed. |
| Twin file pairs | 41 pairs among 58 files of 3,974 (1,742 shared lines); 14 pairs at the stricter threshold | scripts/fm/twinscan.mjs: identical lines of 30+ characters shared by a pair, at least 20 lines and 30% of the smaller file (strict: 30 lines and 40%). Message catalogues left out. |
| Platform family | 24 server modules (4,761 lines), 20 lib modules (1,664), 3,834 lines of tests, 205 platform admin files (16,325 lines); 82 platform screens share a path with a store screen (3,486 lines, 36% of their significant lines identical) | wc -l on src/server/platform-*.ts and src/lib/platform-*.ts; twins.mjs compares same-path files under admin/(gated)/platform and admin/(gated)/[store]. |
| Share of a platform module's lines found unchanged in its store module | endpoints 56%, workflows 56%, theme installs 41%, plan vs cart reminders 41%, API tokens 37%, integrations 29%, ad conversions 27%, discounts 11%, payouts 10%, experiments 10%, API 10%, sales 4%, team 3%, briefing 2% | scripts/fm/sim.mjs: trimmed lines of 12+ characters, comments out, counted as a multiset. |
| platform_* tables | 19 in the schema (9 on 6 November by the parity plan's count); 12 have never held a row in production | rg over src/db/schema.ts for table names; docs/platform-parity-plan.md line 32; the never-held-a-row list in prod-db-stats.md. |
| Admin words on disk | 136 catalogue files, 3.48 MB: English 67 files, 31,667 lines, 1.69 MB; Norwegian 69 files, 33,773 lines, 1.87 MB. One module imports them all; 602 files import that module, 35 of them outside the admin, using 18 areas (1.08 MB) | wc -lc on src/lib/admin-messages; import graph built by graph.mjs in the same scratch folder; areas read from each adminText() call. |
| Admin words in the build | 13 server chunks carry the catalogues: 37.3 MB of 205 MB of server chunk JS (18%). 802 of 830 page.js and route.js entries load one (storefront 74 of 76, API 99 of 113, cron 12 of 13, admin 547 of 548) | grep of .next/server for a sentence from books.nb.ts; each entry's R.c(...) chunk list read by routechunks.mjs. build-summary.txt said exit=0. |
| Server JS an entry loads | /api/visit 11.4 MB in 117 chunks (218 to 269 ms to require here); storefront pages 12.7 MB in about 201 chunks; /api/health 1.2 MB in 16 chunks; the admin-words chunk alone 48 to 62 ms | Summed file sizes of each entry's R.c list; node require() of every chunk, 3 runs, machine under load (load average about 1.5). Read and parse only; module factories not run. |
| Import reach | /api/visit reaches 1,308 of 4,139 non-test modules; 145 when sameSite is imported from its pure file. catalog.ts, checkout.ts, shopper-emails.ts and chat-route.ts each reach the same 1,307 modules; auth.ts reaches 311 | reach.mjs, reach1.mjs and reach2.mjs in the scratch folder: static imports followed, type-only imports left out. Regex-based, so approximate. |
| What a third language would cost | Admin: about 33,800 hand-written lines (1.87 MB) in 69 files, and about 1.4 MB more in each server chunk copy while the registry is one module (estimate). Storefront: 6 files, about 2,250 lines, 125 KB (or none, through ui_translations). Platform site: 632 lines of words, 30 wrapper route files (404 lines) and 3 root layouts | wc on the nb files; the (platform-nb), (docs-nb) and (theme-preview-nb) groups counted with find + wc. |
| Server actions | 1,266 exported actions in 235 'use server' files (21,693 lines); 50 run through storeAction() or platformAction(); 759 guard calls in 183 files; 516 'if (!member) return' lines; 179 local helper definitions | actions.mjs in the scratch folder and rg counts over src/app/admin. |
| Hand-made admin interface today | 154 tables in 116 files (6,100 lines inside them, 2,000 in headers); 435 native selects in 198 files; 265 date-format calls in 190 files; Europe/Oslo in 70 files; slice(0, 10) in 53; confirm( in 42 files; 86 raw form actions in 53 files | rg and a node count over src/app/admin and src/components/admin (1,155 TSX files, 181,671 lines). |
| Repeated helpers | 437 names defined at top level in 3 or more files (framework names such as GET, Page, Loading apart): 2,416 definitions, 1,805 of them 8 lines or fewer (4,743 lines). 248 function bodies are byte-identical across files: 770 copies, 1,094 lines beyond the first | fnames.mjs and fstats.mjs in the scratch folder; the top 25 names were opened and read. |
| Families by size | Carriers: 10 adapters 1,732 lines, 10 lib files 3,760, shared interface 674. Payment providers 508. AI tools: server 12,820, lib 7,676, with 105 direct SQL statements. Accounting connectors 6,727. Shop and CRM movers about 12,960. CSV imports about 5,830 | wc -l per family; rg -c for db().execute, typedRows and typedRow in src/server/*-tools.ts. |
| Pure lib files used by one server file | 22 lib modules (1,952 lines) are imported only by the server file of the same name; 60 more (6,759 lines) by one other server file; 4 (512 lines) by tests only | pairs.mjs over the import graph; the 4 test-only files checked again with rg over src, scripts, e2e and next.config.ts. |
| Hand-written queue claims | 'skip locked' in 30 server files (37 uses); the schema has 28 claim columns | rg -ci over src/server (tests out) and src/db/schema.ts. |

## Well made, and should stay

- Carriers: one interface (ShippingCarrierAdapter) and ten adapters of 68 to 224 lines. The only repeated piece is a 10 to 14 line call() in each. No carrier code reaches the shopper's browser (marker strings searched in .next/static: none).
- Payment providers: two adapters behind a 50-line type file, 508 lines in all.
- AI tools: one registry (254 tool entries in owner-tools.ts) and 12,820 lines of handlers with only 105 direct SQL statements, so tools call the same server functions as the screens. Tools are chosen per turn and the rest wait behind load_tools (owner-assistant.ts:716-750).
- Emails: 20 email modules send through one layout and one sender (98 renderEmail and 99 sendEmail calls in 48 files).
- Verbatim copying is rare: 1.5% of code lines in 8-line clones, 2.4% in tests, 14 strict twin pairs in 3,974 files.
- The pure lib and server split costs little: only 22 lib modules (1,952 lines) serve nothing but their server twin, and it costs nothing at run time. It is what lets 1,186 unit test files run without a database.
- Per-language route groups are thin: Norwegian is 30 wrapper files and 404 lines that hand a lang to shared views in components/platform-routes.
- Most platform Website pages are 6-line wrappers over the store's views and call the shared server core with a null store (savePage(admin, null, ...)).
- Movers: Shopify and WooCommerce share product-csv.ts and old-shop.ts and are 4 to 11% alike. No Wix, Squarespace, BigCommerce or Shopware importer exists in code, only words.
- The admin's words in the browser: client files import types only, and words are fetched per area (PSI PERF-01, done 10 November 2026).
- Storefront words: four hand-written languages at about 125 KB each; a further language can come through ui_translations without code.
- Affiliates reuse the bonus ledger and creators reuse the referral link and cookie: related programs share their core rather than copying it.

## Findings

### FM-1 Both languages of the admin's words (2.8 MB) load with 802 of 830 server entries, the storefront's included

- **Kind:** eager. **Effort:** M. **Confidence:** high. **Step:** 2.1.
- **Where:** `src/lib/admin-text.ts:2`, `src/lib/admin-text.ts:232`, `src/lib/admin-text.ts:303`, `src/lib/two-step.ts:13`, `src/server/auth.ts:18`, `src/server/shopper-emails.ts:17`, `src/server/cart-reminders.ts:28`, `src/app/s/[store]/[market]/checkout/checkout-section.tsx:42`, `.next/server/chunks/src_lib_0upnmb_oo7q5h._.js`, `docs/performance.md:167`
- **Evidence:** admin-text.ts imports all 136 catalogue files (68 areas, English and Norwegian, 3.48 MB of source) into one object. 602 files import it. 35 of them are outside the admin (two-step.ts, shopper-emails.ts, staff-alerts.ts, push.ts, store-action.ts and others) and need 18 areas, 1.08 MB. The checkout page reaches it through cart-reminders.ts and shopper-emails.ts; every route that touches auth.ts reaches it through two-step.ts. In the finished build 13 server chunks carry the catalogues (found by a sentence from books.nb.ts; one 2.79 MB chunk holds at least 122 of the 136 files): 37.3 MB of the 205 MB of server chunk JS. 802 of 830 page.js and route.js entries load one: 74 of 76 storefront entries, 99 of 113 API routes, 12 of 13 cron routes. Requiring the 2.81 MB chunk took 48 to 62 ms here (3 runs, read and parse only).
- **Cost today:** 2.8 MB of server JS read and parsed at each cold start of almost every function (48 to 62 ms measured locally; more once the module runs and builds the objects). 37.3 MB of build output, 18% of all server chunk JS. A third language would add about 1.4 MB to each copy (estimate: half of today's chunk). Paid by: The server at every cold start, so the first shopper or owner on a new instance waits for it; and the build.
- **Fix:** 1. Give each area its own small module that exports its words by language (for example ordersText(lang)), importing only that area's two files. 2. Move the 35 non-admin importers to those modules, and add a scan test that fails when a file outside src/app/admin and src/components/admin imports @/lib/admin-text. 3. Move the admin's 567 importers by codemod, area by area; keep adminTexts() only where a layout hands slices to client parts. Re-run the chunk measurement after step 2.
- **Saving:** Base measured: 2.8 MB and 48 to 62 ms per cold start, 37.3 MB of build output. Step 2 takes about 2.4 MB of words (69% of the source) off every non-admin function (estimate from source sizes). Step 3 leaves an admin page with its own areas, tens of KB each. Up to about 30 MB less server JS emitted (estimate).
- **Risk:** Low. The words are plain data and the type check catches a wrong area. Chunking is the bundler's choice, so confirm with the same script. admin-strings.scan.test.ts and the admin-text fallback e2e must stay green.
- **Already tracked:** no (PSI PERF-01 and docs/performance.md cover the browser's side only, done 10 November 2026)

### FM-2 ✓ One import of sameSite through the chat module makes the four visit beacons load the whole server core

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 0.1.
- **Where:** `src/app/api/visit/route.ts:3`, `src/app/api/visit/touch/route.ts:4`, `src/app/api/visit/speed/route.ts:3`, `src/app/api/visit/speed/own/route.ts:3`, `src/server/chat-route.ts:7`, `src/server/chat-route.ts:38`, `src/server/ai.ts:25`, `.next/server/app/api/visit/route.js`
- **Evidence:** sameSite lives in src/lib/same-site.ts, one pure module. chat-route.ts:38 re-exports it and 37 files import it from there; 17 import the pure file. chat-route.ts imports ai.ts, which imports auth.ts, and about 1,300 modules follow. By static import reach (type-only imports left out): /api/visit reaches 1,308 of 4,139 modules; with the import pointed at the pure file it reaches 145 (touch 145, speed 149, own speed 149). Five admin export routes fall from about 1,308 to about 330. In the build /api/visit's entry requires 117 chunks, 11.4 MB, which took 218 to 269 ms here (3 runs); /api/health, with 54 modules, requires 16 chunks, 1.2 MB.
- **Cost today:** 11.4 MB of server JS and about a quarter of a second of loading at each cold start of the beacon functions, which every counted page view calls. Paid by: The server per cold start; the beacons are sent from every shopper's page view.
- **Fix:** Import sameSite from @/lib/same-site in the 37 files and delete the re-export at chat-route.ts:38. Add a scan test that fails when a route under src/app/api/visit reaches more than about 200 modules.
- **Saving:** Beacon entries go from 1,308 reachable modules to about 147 (measured by reach). Server JS per beacon entry from 11.4 MB to about 2 MB (estimate, by analogy with /api/health).
- **Risk:** Low: it is the same function. The bundler may still place some modules in shared chunks, so check the entry's chunk list after the change.

### FM-3 kaizenaflow.com exists twice: the old no-store site is still built, edited and read beside the store that now serves it

- **Kind:** duplicate. **Effort:** M. **Confidence:** high. **Step:** 3.2. **The owner's decision.**
- **Where:** `docs/platform-parity-plan.md:118`, `docs/platform-parity-plan.md:165`, `docs/platform-parity.md:21`, `src/lib/house-routing.ts:9`, `src/proxy.ts:71`, `src/components/platform-root.tsx:59`, `src/server/platform-navigation.ts:80`, `src/app/admin/(gated)/platform/pages/actions.ts:60`, `src/app/(platform)/[slug]/page.tsx:1`, `evidence/build.log:1065`
- **Evidence:** Since D484 the proxy serves the front page, every page, blog, category, tag and cookies of kaizenaflow.com from the store 'kaizenaflow' (house-routing.ts:9, proxy.ts:71); the parity list says the switch is on in production. The old site stays whole: 13 route files for those addresses in (platform) and (platform-nb) (313 lines), their views in components/platform-routes (365), platform-page.tsx and platform-layout.tsx (384), platform-theme-installs.ts, platform-roles.ts (server and lib) and platform-navigation.ts (762), and twelve Website folders of the platform admin (2,672): about 4,500 lines, plus about 640 lines of tests. The build still compiles and prerenders the old routes in both languages (build.log:44-48 and 1065-1120). The routes the platform keeps (sign-up, themes, docs, status) draw header, footer, theme, fonts and CSS from the old rows (platform-root.tsx:59, platform-navigation.ts:80-81), so one site has two sets of chrome. 'store_id is null' is handled in 220 statements of 86 server files.
- **Cost today:** About 4,500 lines of code and 640 of tests, 3 twin tables (platform_theme_installs, platform_theme_install_updates, platform_page_roles), the old pages' prerender on every build, and two headers, footers and menu sets to keep alike by hand (D489 was such a drift). Paid by: The build and CI, the owner's admin (two places to edit one site), and an agent's session (every site change is weighed twice).
- **Fix:** Do step 7 of the parity plan when the owner calls the switch final: draw the kept platform routes with the store's header, footer and theme; delete the old page, blog, category, tag and cookies routes and their views; make Platform, Website one link; retire the three twin tables and the null rows; then narrow null-store handling where a null served only the site.
- **Saving:** About 4,500 lines and 640 test lines (estimate from the files listed), 3 tables, fewer routes to build and prerender, one set of chrome.
- **Risk:** Medium. The way back to the old pages ends when they go, so only after the owner calls the switch final. The theme store's pages and sign-up still use the platform's page machinery and must draw the store's chrome first.
- **Already tracked:** docs/platform-parity-plan.md step 7 'One copy': open (steps 1 to 5 built; 6 and 7 not). The plan says the null rows go 'weeks after the switch'.

### FM-4 The platform's events have a second pipeline: 5 modules, 7 tables and 2 per-minute runners that copy the stores', and neither side has been used

- **Kind:** duplicate. **Effort:** M. **Confidence:** medium. **Step:** 3.3. **The owner's decision.**
- **Where:** `src/server/platform-endpoints.ts:19`, `src/server/platform-integrations.ts:22`, `src/server/platform-integrations.ts:394`, `src/server/platform-integrations.ts:449`, `src/server/integrations.ts:899`, `src/server/integrations.ts:1031`, `src/server/platform-workflows.ts:26`, `src/app/api/cron/integrations/route.ts:30`, `src/db/schema.ts:7677`, `docs/decisions.md:805`, `evidence/prod-db-stats.md:172`
- **Evidence:** Share of a platform file's significant lines found unchanged in its store file: endpoints 56% (101 of 181), workflows 56% (150 of 266), API tokens 37%, integrations 29% (114 of 393), ad conversions 27%. They share the sender (postSigned, postToService) and the pure rules; the list, save, claim, attempt, retry and prune code is written twice against twin tables. Sizes: 2,090 lines of modules, 1,216 of tests, 815 of screens. Production: the 7 platform tables and the 7 store tables beside them (store_integrations, integration_deliveries, webhook_endpoints, workflows, workflow_runs, api_tokens, ad_conversions) have never held a row. The every-minute cron runs both sets (route.ts:30-36); the store side's claim and prune each ran 66,533 times on an empty table. D465 chose separate tables because a store's are keyed by the store. That was written the day Kaizena Flow's own store was chosen (D466); that store now exists with Integrations, Workflows and an API of its own.
- **Cost today:** About 4,100 lines (modules, tests, screens), 7 tables with their indexes and triggers, and four or more idle statements every minute. Kaizena Flow connects Slack or Zapier in two places. Paid by: The server and database every minute, CI, and the owner's admin.
- **Fix:** Preferred: make the platform's events topics of Kaizena Flow's own store (offered only where stores.house), so that store's Integrations, Endpoints, Workflows and API serve them; delete the platform twins, then their tables in a later migration. Smaller: keep the tables and give the store modules a scope argument (table names, owner filter, payload builder) so the list, save, claim, attempt and prune code exists once.
- **Saving:** Preferred: about 4,000 lines, 7 tables and the second runner (estimate). Smaller: about 700 to 900 lines (estimate from the shared-line counts).
- **Risk:** Preferred: medium. It moves four console screens into the store and changes D465, D515, D516 and D518; there is no data to move, as the tables are empty. Smaller: low, held by the two sets of integration tests.
- **Already tracked:** no (D465 gives the reason for separate tables; docs/platform-parity.md lists them as built for both)

### FM-5 The parity rule makes a twin by default and nothing counts them: 9 platform tables on 6 November, 19 today

- **Kind:** no check. **Effort:** S. **Confidence:** high. **Step:** 3.3. **The owner's decision.**
- **Where:** `CLAUDE.md:403`, `docs/platform-parity-plan.md:32`, `docs/platform-parity-plan.md:66`, `docs/platform-parity-plan.md:73`, `src/db/schema.ts:7702`, `src/db/schema.ts:7733`, `src/db/schema.ts:7794`, `src/db/schema.ts:7820`, `evidence/prod-db-stats.md:172`
- **Evidence:** The rule asks for every store feature on the platform in the same change. The plan of 6 November counted 9 platform_* tables, called that way 'Code: grows: platform-* twins' (line 66), chose Kaizena Flow's own store instead and added 'build it for stores' (line 73). The console track then added ten more twin tables in five days: endpoints, workflows and their runs, API tokens, marketing spend, ad conversions, payouts and their lines, sales, targets. The schema has 19 today; 12 have never held a row. src/server has 24 platform-*.ts modules (4,761 lines) and src/lib has 20 (1,664).
- **Cost today:** Each twin adds tables, a module, a screen, tests and often a cron step. This week's rate: 10 twin tables and about 2,000 lines of twin modules in five days. Paid by: An agent's session (the rule is read in every one), the build, CI and the database.
- **Fix:** Reword the rule: the platform gets a feature through Kaizena Flow's own store, or through the same module with a scope; a new platform_* table or platform-*.ts module needs a line in its decision saying why neither works. Add both counts (19 tables, 24 server modules) to ratchet.scan.test.ts so they only fall without a deliberate baseline change.
- **Saving:** No lines today. It stops the family growing at this week's rate.
- **Risk:** Low. It changes a rule the owner set on 6 November; the house store already delivers most of what the rule wanted.
- **Already tracked:** partly: docs/platform-parity-plan.md section 3 says it, but the rule in CLAUDE.md and the console track do not follow it, and no check exists

### FM-6 Five CSV imports are five copies of one engine, screen and tick route

- **Kind:** duplicate. **Effort:** M. **Confidence:** medium. **Step:** 4.2.
- **Where:** `src/server/customer-import.ts:92`, `src/server/customer-import.ts:104`, `src/server/customer-import.ts:325`, `src/server/inventory-jobs.ts:227`, `src/server/inventory-jobs.ts:523`, `src/server/product-import.ts:103`, `src/server/redirect-import.ts:77`, `src/server/order-history-import.ts:83`, `src/app/admin/(gated)/[store]/customers/import/[jobId]/tick/route.ts:8`, `src/components/admin/data/import-flow.tsx:1`, `src/components/admin/inventory/stock-import-flow.tsx:1`
- **Evidence:** Products, customers, redirects, stock and order history each have start-upload, register, check, apply and problems-CSV functions of the same shape. By identical long lines, customer-import.ts and inventory-jobs.ts share 115 (58% of the smaller), and the five engines pair up at 34 to 58%. isUniqueViolation is defined in all five and applyCursor in four, byte for byte. The ten pages are 47 to 74% identical to a sibling; the five tick routes differ in three words; the client flows are 59 to 70% identical to data/import-flow.tsx. Sizes: engines 2,401 lines, routes 1,872, components 1,557.
- **Cost today:** About 5,830 lines for one job done five ways, and four client flow components where one would do. Paid by: The owner's admin (four flow scripts), the build, CI and an agent's session.
- **Fix:** One description per kind (read the file, judge a row, write a row, the permission, the words) and one engine; one [kind]/import page pair, one tick and one problems route, one flow component. Keep each kind's parsing and writing as it is.
- **Saving:** About 2,200 lines (estimate: engines 700, routes 1,000, components 500).
- **Risk:** Low to medium. Imports write customers, stock and products; each kind has integration tests to hold it.

### FM-7 1,266 server actions, 50 on the shared wrapper; the rest repeat guard, language and failure handling

- **Kind:** duplicate. **Effort:** L. **Confidence:** medium. **Step:** 4.2.
- **Where:** `src/server/store-action.ts:31`, `src/app/admin/(gated)/[store]/customer-groups/actions.ts:17`, `src/app/admin/(gated)/[store]/customer-groups/actions.ts:28`, `docs/rules/admin/platform.md:89`, `docs/audits/code-review-2026-11.md:61`
- **Evidence:** 235 'use server' files in the admin hold 1,266 exported actions in 21,693 lines. 50 calls go through storeAction() or platformAction() (orders, returns, books). The others make 759 guard calls in 183 files and 516 'if (!member) return' lines, and define 179 small local helpers: 'text' in 93 files, 'wordsOf' in 61, 'fail' in 56, 'noAccess' in 35, 'isUuid' in 23, 'refuse' in 19. The rule moves a file when it is touched; nothing counts what is left.
- **Cost today:** About 2,400 lines of repeated guard and helper code (estimate: 2 lines for each of about 1,000 actions, plus the helpers), and failures answered differently per file. Paid by: The owner's admin (uneven errors), an agent's session and CI.
- **Fix:** Add the count of unwrapped guard calls (759) to the ratchet so it only falls. Convert by area, largest first. Put 'text', the id check and the no-access answer in the wrapper's module.
- **Saving:** About 2,400 lines (estimate) and one failure behaviour.
- **Risk:** Low per file. A conversion changes what a refused person sees (a plain line, not a 404), which the wrapper's rule already asks for. The ratchet alone is S.
- **Already tracked:** code review step 1.4: Done for the wrapper; the other files move 'when touched' (docs/rules/admin/platform.md), with no count

### FM-8 Lists, tables, dates and selects are still hand-made per screen, and the counts are not held while the kit waits

- **Kind:** duplicate. **Effort:** L. **Confidence:** medium. **Step:** 4.2.
- **Where:** `src/components/admin/ui/list.tsx:14`, `docs/audits/code-review-2026-11.md:69`, `docs/audits/code-review-2026-11.md:72`, `docs/audits/code-review-2026-11.md:250`
- **Evidence:** Today, over src/app/admin and src/components/admin: 154 tables in 116 files with 6,100 lines inside them, 2,000 of those in headers; 435 native selects in 198 files; 265 date-format calls in 190 files; Europe/Oslo in 70 files and slice(0, 10) in 53; confirm( in 42 files; 86 raw form actions in 53 files; 25 hand-written search forms. The kit's List is used in 88 files, PageHeader in 313, Card in 242. The review of 9 November counted 429 selects and 83 raw forms; the same searches give 435 and 86 two days later (its scope is not stated, so the rise is likely, not certain).
- **Cost today:** About 2,000 lines of table markup a column-list component would not need (estimate: a third of the lines inside tables), and dates on the wrong day for stores outside Norway (FS5). Paid by: The owner's admin and an agent's session.
- **Fix:** Before building the kit, add today's counts to the ratchet (tables, native selects, Europe/Oslo, slice(0, 10), confirm(, raw form actions) so a new screen cannot add to them. Then the kit's Table, Select, date formatter and ConfirmButton, list pages first, as steps 1.12 to 1.15 say.
- **Saving:** About 2,000 lines of markup (estimate). The larger gain is one behaviour everywhere.
- **Risk:** Low. The ratchet step alone is S and changes no screen.
- **Already tracked:** code review steps 1.12, 1.13, 1.14 and 1.15: all Open. Holding the counts first is not in the plan.

### FM-9 Fiken's sync engine is a copy of Tripletex's; a third accounting system would be a third copy

- **Kind:** duplicate. **Effort:** M. **Confidence:** medium. **Step:** 3.5.
- **Where:** `src/server/fiken-sync.ts:27`, `src/server/fiken-sync.ts:108`, `src/server/fiken-sync.ts:119`, `src/server/tripletex-sync.ts:120`, `src/server/tripletex-sync.ts:131`, `src/app/admin/(gated)/[store]/integrations/fiken/page.tsx:1`, `src/app/admin/(gated)/[store]/integrations/tripletex/page.tsx:1`, `evidence/prod-db-stats.md:164`
- **Evidence:** fiken-sync.ts says it is 'the same engine as Tripletex's' (line 27). 220 of its 407 significant lines (54%) are in tripletex-sync.ts unchanged: sweep, claim, release, block, fail, the retry ladder, attaching PDFs, retry and check. The connection modules are 27% alike; the error, settings, setup and mapping files 28 to 29%; the two admin pages share 73 long lines. Sizes: Tripletex 3,276 lines of server and lib and 857 of screens; Fiken 1,980 and 614. Production: fiken_connections and fiken_sync have never held a row, and the Fiken job still runs every five minutes (66 ms last time).
- **Cost today:** About 500 to 600 duplicate lines today, and about 2,600 lines for each further system without a core (Fiken's size). Paid by: CI and an agent's session; the server every five minutes for the unused job.
- **Fix:** An accounting-sync engine with a connector interface (find an existing booking, ensure the customer, send, classify a failure, attach the PDF), as carriers have ShippingCarrierAdapter. Tripletex and Fiken become two connectors. Do it before a third system, not for its own sake.
- **Saving:** About 500 to 600 lines now and about 1,500 for each later connector (estimate).
- **Risk:** Medium. This code books invoices in an owner's accounts and Tripletex is in use. The existing integration tests must pass unchanged.

### FM-10 Work and Domains have a second set of screens at account level, 29 to 77% the same as the store's

- **Kind:** duplicate. **Effort:** M. **Confidence:** medium. **Step:** 4.2.
- **Where:** `src/components/admin/work/owner-time.tsx:1`, `src/components/admin/work/owner-invoices.tsx:1`, `src/components/admin/work/owner-clients.tsx:1`, `src/components/admin/work/owner-report.tsx:1`, `src/components/admin/work/owner-overview.tsx:1`, `src/server/work-owner.ts:1`, `src/app/admin/(gated)/(owner)/account/domains/move/[domain]/page.tsx:1`
- **Evidence:** Share of the account-level file's significant lines found unchanged in the store-level file: owner-invoices 63% (80 of 128), owner-clients 52%, owner-time 44% (60 of 137), owner-overview 35%, owner-report 29%: 281 of 655 lines. work-owner.ts (828 lines) shares 41 and 33 long lines with work-attention.ts and work-overview.ts. Domains: the move page is 77% the same (49 of 64), the list page 33%, the buy actions 39%.
- **Cost today:** 1,127 lines of owner-* components, 828 of server and three Domains files for a second view of the same data. Paid by: The owner's admin (two sets of client components), the build and CI.
- **Fix:** Let the store components take a list of stores (one, or all of the account's) and draw the account pages with them. One move-domain page that takes its owner (store or account) as a prop.
- **Saving:** About 450 lines (estimate).
- **Risk:** Low.

### FM-11 Ten small pairs of near-copies, about 840 identical lines

- **Kind:** duplicate. **Effort:** M. **Confidence:** medium. **Step:** 4.2.
- **Where:** `src/app/s/[store]/[market]/order/[orderId]/order-section.tsx:1`, `src/app/s/[store]/[market]/account/orders/[orderId]/page.tsx:1`, `src/server/analytics-speed.ts:1`, `src/server/own-speed.ts:1`, `src/server/cart-reminders.ts:1`, `src/server/plan-reminders.ts:1`, `src/components/admin/bonus-settings-form.tsx:470`, `src/components/admin/affiliate-settings-form.tsx:408`, `src/components/admin/discount-editor.tsx:1`, `src/components/admin/campaign-editor.tsx:1`, `src/server/draft-pay.ts:131`, `src/server/exchange-pay.ts:176`, `src/server/order-edit-pay.ts:98`
- **Evidence:** Identical significant lines, second file against first: the shopper's order page in two places 115 of 208 (55%); own-speed.ts against analytics-speed.ts 57 of 82 (70%) and their two routes 17 of 20; plan-reminders.ts against cart-reminders.ts 123 of 298 (41%) and their pages 46 of 93; the affiliate and bonus settings forms 157 of 253 (62%); the campaign and discount editors 149 of 438; the docs-guide and chat-agent forms 58 of 86 (67%); the page and look versions dialogs 57 of 94 (61%); order-edit-pay.ts against draft-pay.ts 57 of 143, with takeBucket byte-identical in three pay files.
- **Cost today:** About 840 identical lines in ten pairs. Four of the pairs are client components, so the owner's browser loads both. Paid by: The owner's admin, the build and CI.
- **Fix:** One shared part for each pair: an OrderView for the two order pages, a ProgramSettingsForm, a versions dialog, a reminder runner with a subject (cart or plan), one speed recorder with a target. Leave the three pay steps until one is next touched.
- **Saving:** About 700 lines (estimate).
- **Risk:** Low, except the pay steps, which move money and are left out.

### FM-12 Small helpers are rewritten per file: 437 names appear in three or more files

- **Kind:** duplicate. **Effort:** M. **Confidence:** high. **Step:** 4.2.
- **Where:** `src/lib/analytics-period.ts:103`, `src/lib/booking-slots.ts:73`, `src/lib/gift-card-line.ts:33`, `src/lib/order-list.ts:467`, `src/lib/payment-terms.ts:22`, `src/server/demo-stores.ts:34`, `src/lib/admin-api.ts:116`, `src/app/admin/(gated)/[store]/settings/shipping/actions.ts:39`, `src/server/autopilot-goals.ts:59`, `src/server/analytics-tools.ts:28`
- **Evidence:** 248 top-level function bodies are byte-identical in two or more files: 770 copies, 1,094 lines beyond the first. 1,805 short helpers (4,743 lines) carry a name that three or more files define. Examples read: addDays is exported by five lib modules; isUuid is in 23 files in three forms (a regex, zod, a shared constant); a 3-line 'fail' is identical in 42 files; adminLink in 13; isUniqueViolation in 6; sha256 in 7; ten carrier files each hold their own timed call().
- **Cost today:** About 1,100 lines of exact repeats and up to about 3,000 with near-repeats (estimate), and three ways to check an id. Paid by: An agent's session and reviewers; no run-time cost.
- **Fix:** Do not sweep. Name one home for dates (addDays, iso, day), ids (isUuid) and Postgres errors (isUniqueViolation); add a lint rule that refuses a new local definition of those names; fold the copies when a file is touched.
- **Saving:** About 1,100 lines certain, up to about 3,000 (estimate).
- **Risk:** Low, but it touches hundreds of files, so it is worth doing only as files are opened for other work.

### FM-13 No check holds duplication or import reach, so twins and heavy imports arrive unseen

- **Kind:** no check. **Effort:** S. **Confidence:** high. **Step:** 1.2.
- **Where:** `package.json:1`, `src/server/ratchet.baseline.json:1`, `docs/audits/code-review-2026-11.md:59`
- **Evidence:** package.json, the CI workflows and the ESLint config name no duplication, unused-code or import-graph tool (grep for jscpd, knip, madge, dependency-cruiser, depcheck: none). 42 scan tests exist and the ratchet pattern is in place, but it counts casts, unchecked reads and unscoped writes only. The scripts written for this review run in about 2 seconds each.
- **Cost today:** FM-1 and FM-2 came in by one import line each with nothing to flag them; ten twin tables arrived in five days. Paid by: Everyone later: the server, the build and an agent's session.
- **Fix:** Add to the ratchet: cloned lines in 8-line windows (8,041 today), twin pairs (41), modules reachable from the beacon and health routes, and files outside the admin that import admin-text.ts (35, to reach 0).
- **Saving:** None by itself. It keeps FM-1, FM-2, FM-6 and FM-11 from coming back.
- **Risk:** Low. A ratchet that is too tight annoys; set each at today's number.
- **Already tracked:** no (code review step 1.2 built the ratchet for other counts)
