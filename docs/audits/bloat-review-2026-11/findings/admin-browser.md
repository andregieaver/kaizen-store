# What an owner's browser loads in the admin (AC)

Part of `docs/audits/bloat-review-2026-11.md`, on commit 0bd814c. One reviewer's reading of this area. A tick (✓) marks a finding the lead checked a second time; the others were not checked. "Step" is the step of the plan that closes the finding.

**In short.** The admin's browser load is moderately bloated, not runaway, and most of the worst of it is cheap to fix. A plain admin screen loads 1.15 MB of script (0.35 MB gzip), down from 3.0 MB two weeks ago, but 43% of what every screen still loads (481 KB) is Supabase's whole client, zod and the builder's English text, pulled in by three stray imports. Beyond the shell, 26 screens load an editor they never draw, the page builder is 3.3 MB, one Work screen ships the entire two-language catalogue in a 1.7 MB chunk, and 36 to 81% of each page's HTML data is translated text handed down as whole areas. The script budget covers 7 of 449 admin routes and the import guard that protects shoppers leaves the admin out, which is why none of this was seen.

## Measured

| Measure | Value | How |
|---|---|---|
| First-load script per admin route (449 routes) | median 1.15 MB raw / 0.35 MB gzip; mean 1.40 MB; 337 routes at 1.0-1.3 MB, 33 at 1.3-2 MB, 17 at 2-3 MB, 40 over 3 MB; largest 4.27 MB raw / 1.34 MB gzip | .next/diagnostics/route-bundle-stats.json of the finished build (exit=0), each chunk file sized and gzipped with node zlib |
| What the 22 chunks shared by 90%+ of admin routes hold | 1,123,681 bytes: Next and React 469 KB (42%), removable imports 481 KB (43%: Supabase 237 KB + its Buffer polyfill 23 KB, zod 117 KB, the builder's English 72 KB, builder schemas 33 KB), the shell's own code 174 KB (15%) | Chunk frequency over the 449 routes, then each chunk split into Turbopack modules and identified by its strings; importers traced with a static import graph of src (4,156 files) |
| Store home, as the server sends it | scripts 1,185,364 bytes raw / 356,517 gzip in 23 files; CSS 204,207 raw / 36,378 gzip; HTML 165,942 raw / 37,698 gzip | scratchpad m/html/admin-home.html: every script src and stylesheet resolved to its file in .next/static and gzipped |
| Translated text inside page HTML | 36% to 81% of the flight data: home 57.7 KB of 106 KB, pages list 86.8 KB of 160 KB, product editor 238 KB of 296 KB; 34.0 KB of it is on every store screen | Decoded self.__next_f.push rows of 7 sampled signed-in admin HTML files and measured each "texts" prop by area |
| Page builder first load | 3.30 MB raw / 1.015 MB gzip on 39 routes (26 editors and 13 draft previews); the visitor sandbox /admin/try is 3.09 MB | route-bundle-stats.json; routes that carry chunk 1jj1xvz8qgfpw.js |
| Rich text editor (Tiptap and ProseMirror) reach | one 435,421-byte chunk (136,630 gzip) in the first load of 73 routes; 34 of them are not the builder | Chunk 3lclkawi229rq.js identified by its strings; counted in route-bundle-stats.json |
| Largest single first-load chunk | 1,704,595 bytes raw / 526,391 gzip: every admin catalogue area in English and Norwegian, on the Work invoice screen only | ls -S .next/static/chunks; content sampled at 8 offsets; import path found with the graph |
| Routes that need zod or Supabase beyond the shell | zod: 163 of 449; Supabase: 83 of 449. The other 286 and 366 routes load them only because the shell does | Static import closure of each route's client modules (from its page_client-reference-manifest.js), shell modules excluded |
| Lazy boundaries in the admin | 7 files use import() or next/dynamic among 332 client component files under src/components/admin (CSS editor, backdrop fields, Stripe Connect, AI chat, DNS recipes, text styles, the English fallback) | rg for next/dynamic and import( in src/components/admin; client files counted by their "use client" line |
| Script budget coverage | 7 store routes budgeted of 449 admin routes; the home's budget is 1,340,000 and today's build measures 1,297,958 the same way (about 13 KB more than the figure recorded on 10 November), of which 112,594 is a nomodule polyfill modern browsers never fetch | e2e/signed-in/admin-scripts.spec.ts lines 36-46 read; script tags of the sampled HTML summed with and without the nomodule file |
| AI manager chat chunk | 496,206 bytes raw / 143,978 gzip, fetched when the panel first opens; first load on the 2 assistant routes (2.06 MB) | Chunk 00rxgygh1f--7.js; its client modules read from the manifests; import closure of ai-manager.tsx is 209 files, 2.94 MB of source |
| Client code reachable from admin routes | 1,086 source files, 13.4 MB of source (615 lib files 9.0 MB, 455 components 4.3 MB); 0 files from src/server | Union of static import closures of every admin route's client modules; "use server" files counted as stubs |

## Well made, and should stay

- The CSS editor (CodeMirror, 392 KB chunk), three and model-viewer (1.08 MB), mediabunny (575 KB) and Stripe Connect load only when used: none is in any admin route's first load (0 routes in route-bundle-stats.json).
- Icons are imported by name: lucide-react in 24 files and 26 simple-icons marks in brand-icon.tsx. The build tree-shakes them; the shell's whole icon chunk is 31 KB.
- No chart library is shipped, and no large constant table sits in client code: the product taxonomy is read from disk on the server, and no font, country or preset list over 22 KB is in any admin client closure.
- The per-area English fallback of 10 November (D540) holds: admin-text.tsx statically imports only common and sign-in, and the store home went from 2.46 MB to 1.28 MB as documented.
- The AI manager's chat is fetched when its panel opens (ai-manager-launcher.tsx), not with every screen; the launcher itself is about 15 KB.
- web-vitals is loaded after the page with import() (speed-beacon.tsx:53).
- The notice badge polls once a minute and only while the tab is visible (ai-notices.tsx:41-47).
- No server-only module leaks into a client bundle: the import graph reaches 0 files under src/server from admin client code, apart from server action stubs.
- Sign-in, two-step and forgot-password load 0.50 MB and no Supabase client.
- Page lists were already split from the editor on 4 November; the builder's long lists (templates, link targets, grid previews, fonts to install) are fetched by server actions on demand, not passed as props.

## Findings

### AC-1 ✓ Three stray imports put Supabase, zod and the builder's English on every admin screen

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 0.10.
- **Where:** `src/app/admin/(gated)/layout.tsx:47`, `src/app/admin/(gated)/layout.tsx:51`, `src/components/admin/session.tsx:8`, `src/lib/supabase/client.ts:1`, `src/lib/env.ts:1`, `src/components/admin/push-settings.tsx:6`, `src/components/admin/push-settings.tsx:155`, `src/components/admin/shortcut-sheet.tsx:19`, `src/components/admin/responsive-edit.tsx:20`, `src/components/admin/responsive-edit.tsx:306`
- **Evidence:** Chunks in 420-432 of 449 admin routes, identified by content: 2du16ociar189.js is supabase-js (179,419 raw / 44,575 gzip), 2i4juo9spco86.js is Supabase realtime (57,349 / 16,687), a Buffer polyfill module used only by Supabase storage (22,701), 1-5xy7dnrat0_.js is zod (116,870 / 32,996), 0pmozty218j-z.js is builderEn (71,508 / 23,861), 2-qbqk-gdin9b.js is typography and visibility schemas (33,198 / 11,526). The import graph names the only paths: SessionKeeper imports the full Supabase browser client to call auth.onAuthStateChange, and env.ts validates two strings with zod; the 8-line AdminServiceWorker lives in push-settings.tsx beside the Push settings screen, which imports push.ts and zod; the shortcut sheet imports the 3-line typingIn() from responsive-edit.tsx, which imports builder.en and the responsive schemas. Without the shell, only 163 routes reach zod and 83 reach Supabase.
- **Cost today:** 481 KB raw / 137 KB gzip of script parsed before every admin screen is interactive: 43% of the 1.12 MB shared by all screens. Paid by: An owner's browser, on every admin screen; staff on phones most.
- **Fix:** 1) Move typingIn() to a small file of its own (for example src/lib/typing-in.ts) and import it from there in shortcut-sheet.tsx. 2) Move AdminServiceWorker to its own file. 3) In session.tsx load the Supabase client with import() inside the effect, after the page is idle; give the browser a public-env helper that checks the two values without zod. Add these three targets to an admin import guard (AC-11).
- **Saving:** Estimate from measured chunks: store home 1.19 MB to about 0.70 MB raw, 357 KB to about 220 KB gzip (-38%). zod leaves 286 routes entirely; Supabase still downloads once after the page, off the critical path.
- **Risk:** Low. The token refresh starts a few seconds later than today; docs/rules/admin/platform.md says SessionKeeper refreshes in the browser, which stays true. Run the signed-in suite.
- **Already tracked:** PSI PERF-01 (open) says to cut the shared scripts but names none of these imports. Not tracked as a step.

### AC-2 26 screens load an editor they never draw, because lists, previews and editors share one views file

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 2.5.
- **Where:** `src/app/admin/(gated)/[store]/pages/editor-views.tsx:7`, `src/app/admin/(gated)/[store]/pages/editor-views.tsx:277`, `src/app/admin/(gated)/[store]/pages/[pageId]/preview/page.tsx:3`, `src/app/admin/(gated)/[store]/pages/views.tsx:9`, `src/app/admin/(gated)/[store]/pages/views.tsx:60`, `src/app/admin/(gated)/[store]/pages/views.tsx:229`, `src/components/admin/content-views.tsx:6`, `src/components/admin/content-views.tsx:33`, `e2e/signed-in/admin-scripts.spec.ts:43`
- **Evidence:** route-bundle-stats.json: the 13 draft preview routes (store, platform, sandbox) are 3.22-3.30 MB raw / about 1.0 MB gzip, the same as the editor, because StorePreviewPageView sits in editor-views.tsx beside PageEditor and DualPageEditor; it draws only PageDrawing and a status line. The 9 lists of pages, articles, headers, footers and product layouts are 2.00 MB / 0.62 MB gzip because views.tsx also exports the categories view with TermsManager (Tiptap, dnd-kit, the custom fields form). The 4 content lists are 1.95 MB because content-views.tsx holds the type and entry editors. A plain list such as Products is 1.17 MB. docs/performance.md records that a route loads every client component its server module imports, drawn or not, and that this exact split took 1.13 MB off the lists on 4 November. The pages list budget (2,180,000) blesses the leftover.
- **Cost today:** About 1.9 MB raw / 0.6 MB gzip extra on each preview, and about 0.8 MB raw / 0.25 MB gzip extra on each of 13 list screens. Paid by: An owner's browser: every press of Preview in the builder and every visit to a list of pages, articles, headers, footers or content.
- **Fix:** Move the preview views to their own file (store, platform and sandbox), the categories view out of views.tsx, and the list views out of content-views.tsx. Then lower the pages list budget to the plain-list figure and add a preview route to the budgets.
- **Saving:** Estimate: previews 3.3 MB to about 1.4 MB raw; page and content lists 2.0 MB to about 1.2 MB raw. Measure after the split.
- **Risk:** Low: files move, no behaviour changes. Platform twins must move in the same change.
- **Already tracked:** no (the 4 November split under PSI PERF-01 fixed the lists against the editor only)

### AC-3 Order, customer and deal screens load the rich text editor and the builder's schema for custom fields no store has filled in

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 2.5.
- **Where:** `src/components/admin/fields-form.tsx:41`, `src/components/admin/fields-form.tsx:451`, `src/components/admin/term-page-fields.tsx:10`, `src/components/admin/entity-fields-card.tsx:5`, `src/lib/custom-fields.ts:5`, `src/lib/custom-fields.ts:1`
- **Evidence:** The order screen is 2.00 MB raw / 611 KB gzip, a customer 1.94 MB, a deal 1.86 MB. Beyond the shell and the order's own 115 KB chunk they carry: Tiptap and ProseMirror 435,421 bytes, the builder's page-content schema 74,836, the fields English 45,222, the fields form 41,652, cookie-consent texts in four languages 37,916, store parts and motion 33,933, the custom-fields schema 24,871: 693,851 raw / 217,493 gzip in all. The path is entity-fields-card to fields-form, which imports RichTextEditor statically for one field kind, and custom-fields.ts, which imports two small helpers from the 197 KB page-content.ts (which pulls page-modal and cookie-consent). entity-fields-card.tsx says it draws nothing when no group applies. Production: field_values is one of the 255 tables that have never held a row (prod-db-stats.md).
- **Cost today:** About 0.69 MB raw / 217 KB gzip on the order, customer and deal screens; 435 KB of it on 21 non-builder, non-list routes in all. Paid by: An owner's browser, on the screens used most in daily work (an order, a customer).
- **Fix:** Load RichTextEditor through a client-side next/dynamic wrapper in fields-form.tsx and term-page-fields.tsx, so it arrives only when a rich text field is drawn. Draw EntityFieldsCard through a lazy wrapper only when a group applies. Move cleanRichText() and richTextPlain() to a small module so custom-fields.ts stops importing page-content.ts.
- **Saving:** Estimate from measured chunks: an order screen 2.00 MB to about 1.3 MB raw (611 KB to about 395 KB gzip) while the store has no fields for orders; 435 KB raw less wherever no rich text field is shown.
- **Risk:** Low to medium: a rich text field appears a moment after its form; keep a placeholder of the same height and hold the value in the form's state so Save never loses it (the lesson docs/performance.md records for 31 October).
- **Already tracked:** no (code review step 3.2 would split page-content into a folder, Open, but does not name this)

### AC-4 Pages hand whole text areas to the browser where their parts read a few branches; one area on every screen is read by nothing

- **Kind:** oversize. **Effort:** M. **Confidence:** high. **Step:** 2.1.
- **Where:** `src/app/admin/(gated)/layout.tsx:45`, `src/app/admin/(gated)/[store]/layout.tsx:114`, `src/lib/admin-text.ts:308`, `src/app/admin/(gated)/[store]/products/[productId]/page.tsx:45`, `src/app/admin/(gated)/[store]/pages/views.tsx:81`, `src/app/admin/(gated)/[store]/page.tsx:117`, `src/app/admin/(gated)/[store]/pages/editor-views.tsx:30`, `src/components/admin/rich-text-editor.tsx:155`, `src/components/admin/product-editor.tsx:872`
- **Evidence:** Measured in the sampled HTML: every store screen carries common 6,498 + setup 6,895 + shell 6,905 + assistant 13,683 = 34.0 KB of text. No file in src calls useAdminText("setup"). The shell's parts read 3,878 of shell's 6,905 characters. Before the chat opens the launcher and notices need about 1.3 KB of assistant; 6,422 of it is the autopilot's words. Home hands the home area (23,695) and its client parts read home.drafts (1,219, 5%). The pages list hands website (47,127) and reads 5,107 (11%); schedules (5,668) is read by none of that route's client modules. The product editor hands 237,889 characters, 81% of its flight data: its own modules read 2,847 of builder's 74,732 (richText, textStyles) and 1,616 of website's 47,127. Readers were found by scanning every client module in each route's import closure for useAdminText(area).branch. The builder hands 11 areas, about 265 KB by source size (estimate). This text is in the HTML and in every navigation's response, so the browser never caches it; the script budget does not count it.
- **Cost today:** About 22 KB of unread text on every store screen; at least 77 KB and likely about 160 KB on the product editor (426 KB of HTML); about 58 KB on the pages list. Paid by: An owner's browser on every full load and every navigation; the server, which serialises it per request.
- **Fix:** Stop handing setup. Split the largest areas so a page can hand what its parts read: builder (rich text and text styles apart), website (media, picker, picture maker apart), assistant (launcher and notices apart from chat and autopilot, the rest fetched with the chat), home.drafts, products' term words. Splitting areas keeps D540's rule and its test (an area not handed is a noted fallback). Add an HTML size check for the budgeted screens.
- **Saving:** Estimate from the measured slices: home HTML 166 KB to about 134 KB; pages list 279 KB to about 220 KB; product editor 426 KB to about 270-350 KB; every store screen 22 KB less.
- **Risk:** Medium: a part that reads a branch not handed falls back or draws nothing. The existing admin-text-fallbacks spec covers whole areas; split by area, not by partial object, so it keeps working.
- **Already tracked:** no. D540 and PSI PERF-01 moved the English out of the scripts; the size of what is handed down is not measured or budgeted anywhere.

### AC-5 The page builder loads everything at once: 3.3 MB of script before the first paint

- **Kind:** eager. **Effort:** M. **Confidence:** high. **Step:** 2.5.
- **Where:** `src/components/admin/page-builder.tsx:1`, `src/components/admin/page-builder.tsx:96`, `src/components/admin/block-fields.tsx:33`, `src/components/admin/block-fields.tsx:214`, `src/components/admin/modal-fields.tsx:38`, `src/lib/field-group-editor.ts:31`, `docs/audits/code-review-2026-11.md:281`
- **Evidence:** route-bundle-stats.json: 3.30 MB raw / 1.015 MB gzip in 48 chunks on each of 26 editor routes; the visitor sandbox at /admin/try is 3.09 MB. By chunk: shell 1.15 MB; Tiptap 435 KB; the storefront's text in four languages about 375 KB (AC-6); English copies of builder, blocks and fields about 150 KB while the same areas are also handed down in the HTML; dnd-kit 43 KB; the builder's own code and schemas about 1.15 MB. page-builder.tsx (6,615 lines) and block-fields.tsx (3,644 lines) contain no import() or next/dynamic; every block type's fields are imported up front through BLOCK_EDITORS. The page's import closure is 319 files, 3.9 MB of source.
- **Cost today:** 3.30 MB raw / 1.0 MB gzip per open of the builder, re-downloaded in part after most deploys (27 and 74 commits on the last two days, each push deploys). docs/performance.md names the editors for the admin's 3.9 s largest paint. Paid by: An owner's browser on every page, article, header, footer and layout edit; a prospect's browser in the sandbox.
- **Fix:** Do step 3.4 as written (dialogs, templates, translation, theme panel, dual frame on demand), and add three things it does not name: load Tiptap on the first text edit or at idle; make each BLOCK_EDITORS entry a lazy import so a block's fields load when its dialog opens; drop the static English copies once the areas are handed (AC-9). Add /admin/try to the budgets.
- **Saving:** Estimate: first load from 3.3 MB to about 2.0 MB raw with AC-1 and AC-6 included; the rest moves to first use.
- **Risk:** Medium: the seven signed-in builder specs must pass; a dialog opened before its chunk arrives needs a pending state.
- **Already tracked:** docs/audits/code-review-2026-11.md step 3.4 (FB8), Open, after step 3.1 (split the builder, Open). The Tiptap, block-registry and sandbox points are not in it.

### AC-6 The builder and the draft order editor load the storefront's text in all four languages to read two branches

- **Kind:** oversize. **Effort:** S. **Confidence:** high. **Step:** 2.1.
- **Where:** `src/components/admin/block-fields.tsx:21`, `src/components/admin/block-fields.tsx:2684`, `src/components/admin/modal-preview.tsx:34`, `src/components/admin/drafts/draft-summary.tsx:3`, `src/lib/i18n.ts:9`, `src/lib/storefront-bundle.scan.test.ts:14`
- **Evidence:** Chunk 1u2592k6jkhim.js (318,693 raw / 103,098 gzip) is messages/da, nb, sv and en with their returns, exchange, review and quote texts; two more modules carry the returns texts (31.8 KB) and browser texts (24.8 KB) of the four languages. It is in the first load of 40 routes: the 39 builder routes and the draft order editor. block-fields.tsx reads t(nb or en).form, modal-preview.tsx reads t(lang).modal, and any import of lib/i18n brings all four language modules (i18n.ts lines 9-12). The storefront's scan test forbids lib/i18n in a visitor's scripts and says in its header that the admin is left out.
- **Cost today:** About 375 KB raw / 120 KB gzip on 40 routes. Paid by: An owner's browser in the builder and on a draft order.
- **Fix:** Have the server pass the two branches (form, modal) in the page's language as props, or import only the language modules needed with import(). Add lib/i18n to the admin import guard (AC-11).
- **Saving:** Estimate: 280-375 KB raw / 90-120 KB gzip per builder open.
- **Risk:** Low. Canvas components that call t() on the client need the same props; check the builder specs in a Norwegian store.

### AC-7 The Work invoice screen ships the whole admin catalogue, both languages, in one 1.7 MB chunk

- **Kind:** oversize. **Effort:** S. **Confidence:** high. **Step:** 2.1.
- **Where:** `src/components/admin/work/invoice-draft-editor.tsx:43`, `src/components/admin/work/invoice-draft-editor.tsx:44`, `src/components/admin/work/invoice-issue-dialog.tsx:12`, `src/components/admin/work/invoice-readiness.tsx:8`, `src/components/admin/work/invoice-totals.tsx:5`, `src/lib/work-text.ts:4`, `src/lib/admin-text.ts:2`, `src/components/admin/admin-catalogues.scan.test.ts:44`
- **Evidence:** /admin/account/work/s/[store]/invoices/[invoiceId] is the largest admin route: 4.27 MB raw / 1.34 MB gzip. Its chunk 3fqt1dd2f0p1k.js is 1,704,595 bytes (526,391 gzip); sampled at 8 offsets it is Fiken, Tripletex, platform, analytics, payouts, navigation and draft order words in Norwegian and English. The client editor imports invoice-readiness.tsx and invoice-totals.tsx, written for the server, which import work-text.ts, which imports admin-text.ts: every area in both languages (3.7 MB of source in 147 files). The graph finds exactly two client modules with a path to admin-text.ts. The scan test meant to stop this looks only for direct imports of a .en file in a "use client" file.
- **Cost today:** 1.66 MB raw / about 520 KB gzip of text on each open of a Work invoice. Paid by: An owner's browser, for stores with Work switched on.
- **Fix:** Give ReadinessList and InvoiceTotalsView their words as props or through useAdminText("work"), and stop importing work-text.ts from anything a client module imports. Add a guard: no module reachable from a client component may import lib/admin-text or lib/work-text as a value (AC-11).
- **Saving:** Measured chunk: 1.66 MB raw / about 520 KB gzip; the route falls from 4.27 MB to about 2.6 MB raw.
- **Risk:** Low. Side effect to check: in the browser work-text.ts has no request language, so these two parts likely show English to a Norwegian account today; the fix corrects that.

### AC-8 The AI manager's chat downloads every tool definition, the admin map and the Norwegian page names to label a tool call

- **Kind:** oversize. **Effort:** S. **Confidence:** high. **Step:** 2.5.
- **Where:** `src/components/admin/ai-manager.tsx:9`, `src/components/admin/ai-manager.tsx:11`, `src/components/admin/ai-manager.tsx:13`, `src/components/admin/ai-manager.tsx:328`, `src/components/admin/ai-manager.tsx:392`, `src/lib/manager-tools.ts:318`, `src/lib/admin-map.ts:1461`
- **Evidence:** Chunk 00rxgygh1f--7.js is 496,206 bytes raw / 143,978 gzip; one merged module is 491 KB and holds tool descriptions written for the model. ai-manager.tsx imports one map, TOOL_WORDS (about 14 KB of the 36 KB manager-tools.ts), which drags owner-tools.ts (208 KB), assistant-skills.ts (63 KB), product, site and setup tools; it imports matchPath from admin-map.ts (172 KB) and PAGES_NB (61 KB) to name the current page in one suggestion. The chat's own three files are 48 KB of source; its import closure is 209 files, 2.94 MB. The prompt-safety rule text is in the browser chunk too.
- **Cost today:** 496 KB raw / 144 KB gzip the first time the panel opens after each deploy that changes it, and in the first load of the two assistant screens (2.06 MB). Paid by: An owner's browser, each time the AI manager is opened in a new deploy.
- **Fix:** Move TOOL_WORDS to a file of its own with no other import. Resolve the page's name on the server (the launcher's start action already runs there) and pass it down, so admin-map.ts and pages.nb.ts leave the browser.
- **Saving:** Estimate from source sizes: about 400 KB raw / 115 KB gzip of the 496 KB chunk.
- **Risk:** Low. agent-eval.test.ts and the ai-manager-panel spec cover the tool names and the panel.
- **Already tracked:** docs/performance.md records the 0.48 MB chunk and made it load on opening (4 November); its size is not a step anywhere.

### AC-9 English text for 23 areas is still compiled into client scripts and then handed down again in the HTML

- **Kind:** duplicate. **Effort:** M. **Confidence:** high. **Step:** 2.1.
- **Where:** `src/lib/field-group-editor.ts:31`, `src/lib/field-group-editor.ts:54`, `src/lib/work-ui.ts:22`, `src/lib/work-ui.ts:370`, `src/components/admin/templates-helpers.ts:1`, `src/components/admin/modal-fields.tsx:38`, `src/components/admin/responsive-edit.tsx:100`, `src/components/admin/admin-catalogues.scan.test.ts:19`
- **Evidence:** Walking each admin route's client import closure finds 23 areas' .en files reachable on two or more routes besides common and sign-in: builder.en on 423 routes (AC-1), fields.en on 74 (a 23.8 KB module), blocks.en on 40 (54.4 KB), work.en on 15 (65.6 KB of source, through the Work timer's work-ui.ts), analytics in English and Norwegian on 6, home.en on the store home (22.6 KB) while the home area is also in that page's HTML (23.7 KB). Most arrive through lib modules that take the English as a default argument (w = fieldsEn), which the scan test cannot see: it lists 14 direct importers and checks only "use client" files.
- **Cost today:** 24 to 150 KB raw of English per affected screen that the page also hands down; a Norwegian account downloads English it never shows. Paid by: An owner's browser on the affected screens (the builder most: about 150 KB).
- **Fix:** In modules a client part imports, make the words a required argument and pass useAdminText()'s result; keep the English default only in a server-side wrapper. Shrink the scan test's list as each goes, and make the test walk imports (AC-11).
- **Saving:** Estimate: 150 KB raw on the builder, 65 KB on the 15 Work screens, 24 KB on 74 field screens, 22 KB on the home.
- **Risk:** Low: types make a missing argument a compile error.
- **Already tracked:** Partly: admin-catalogues.scan.test.ts holds a list of 14 direct importers that may only shrink (PSI PERF-01). The indirect ones are not seen.

### AC-10 The script budget covers 7 of 449 admin routes and none of the HTML

- **Kind:** no check. **Effort:** S. **Confidence:** high. **Step:** 1.3.
- **Where:** `e2e/signed-in/admin-scripts.spec.ts:18`, `e2e/signed-in/admin-scripts.spec.ts:36`, `e2e/performance.spec.ts:40`, `docs/performance.md:139`
- **Evidence:** BUDGETS holds 7 store routes; no platform, account, Work, preview, order or customer route. The four worst things found here sit outside it: the 4.27 MB Work invoice, 13 previews at 3.3 MB, the order screen at 2.0 MB, the sandbox at 3.09 MB. The pages list budget (2.18 MB) was set from a measurement that already held the category editor. firstScripts() sums every script tag, including the 112,594-byte nomodule polyfill no modern browser fetches (9% of the home's figure), and counts no HTML, so text moved from scripts to props looks like a pure saving. Measured the same way, today's home is 1,297,958 against 1,284,745 recorded on 10 November; 42 KB of room is left. The build already writes .next/diagnostics/route-bundle-stats.json with every route's first-load bytes and chunk list.
- **Cost today:** Growth outside 7 screens is unseen; about 13 KB was added to every screen in a day without a signal. Paid by: CI and, later, every owner's browser.
- **Fix:** After the build in CI, read route-bundle-stats.json: fail when the shared shell set grows past its budget, when any admin route passes a ceiling for its kind (plain screen, editor, builder), or when a route grows more than a set amount against a committed baseline that only falls (as ratchet.baseline.json works). Leave the nomodule file out. Add an HTML byte budget to the 7 screens the signed-in spec already opens.
- **Saving:** No bytes by itself; it keeps the 0.5 to 2 MB found here from coming back and covers 442 more routes for a few seconds of CI.
- **Risk:** Low. The file is a Next diagnostic, so pin its shape in the check and fail loudly if it is missing.
- **Already tracked:** Partly: code review 3.4's done-when adds the page editor to the budgets (it is already there); PSI PERF-11 budgets visitor routes. A budget for all admin routes or for HTML is not planned.

### AC-11 The import guard that keeps zod and whole catalogues out of shoppers' scripts leaves the admin out

- **Kind:** no check. **Effort:** S. **Confidence:** high. **Step:** 1.3.
- **Where:** `src/lib/storefront-bundle.scan.test.ts:14`, `src/lib/storefront-bundle.scan.test.ts:16`, `src/components/admin/admin-catalogues.scan.test.ts:44`, `src/components/admin/pages-table.tsx:5`, `src/lib/page-roles.ts:1`, `src/lib/custom-fields.ts:5`
- **Evidence:** storefront-bundle.scan.test.ts walks every visitor component's static imports and fails on zod, lib/page-content, lib/i18n and whole language modules; its header says the admin is left out. The admin's only guard matches a direct .en import in a "use client" file. Every large finding here is one small import of a helper from a large module, which a walk catches: typingIn from responsive-edit (AC-1), ROLE_COPY from page-roles, which pulls the 197 KB page-content.ts into 14 list routes (a 75 KB chunk), two helpers from page-content in custom-fields.ts (AC-3), TOOL_WORDS (AC-8), work-text (AC-7), t() (AC-6). A 60-line graph script written for this review found each in under a second.
- **Cost today:** Nothing at run time; each miss costs 70 KB to 1.7 MB per screen until someone measures by hand. Paid by: CI (a unit test of under a second); an owner's browser pays for each miss.
- **Fix:** Reuse the storefront walker for the admin with zones: the shell's client modules may not reach zod, @supabase, lib/page-content or any catalogue but common and sign-in; no client-reachable module may import lib/admin-text, lib/work-text or lib/i18n as a value; lib/page-content and @tiptap only from a named list of editor modules that may only shrink.
- **Saving:** Prevents regressions of AC-1, AC-3, AC-6, AC-7 and AC-8 (about 0.5 MB on every screen and up to 1.7 MB on one).
- **Risk:** Low. Start with today's offenders in an allow-list that may only shrink, as the catalogue test does.

### AC-12 Every navigation link in view is prefetched with Next's defaults, and what that costs is unmeasured

- **Kind:** eager. **Effort:** S. **Confidence:** low. **Step:** 0.9.
- **Where:** `src/components/admin/store-admin-nav.tsx:94`, `src/components/admin/store-admin-nav.tsx:131`, `src/components/admin/store-admin-nav.tsx:195`, `next.config.ts:44`, `node_modules/next/dist/docs/01-app/02-guides/prefetching.md:34`
- **Evidence:** The rail, tabs and sidebars use plain Link; only 4 places in the admin set prefetch={false}. Next's own guide says each Link that enters the viewport is prefetched in production. The sampled home HTML holds 17 distinct admin links and the orders screen 23. The production server's start log warns that cacheComponents is on without partialPrefetching, the setting under which links share one shell per route. Not measured: how many requests fire per screen and their bytes; that needs a browser trace.
- **Cost today:** Unmeasured. Up to about 17-23 background requests per admin screen view, each answered by a function in Dublin. Paid by: An owner's browser (network) and the server per request.
- **Fix:** Trace one admin session in a browser and count prefetch requests and bytes. Then decide between partialPrefetching: true, prefetch on hover for the sidebars, or leaving it. Record the figure in docs/performance.md.
- **Saving:** Unknown until measured; this is a measurement step first.
- **Risk:** Turning prefetch off makes navigation feel slower; partial prefetching is a framework setting to test across the signed-in suite.
