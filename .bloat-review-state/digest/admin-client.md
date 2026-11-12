# admin-client: What an owner's browser loads in the admin

The admin's browser load is moderately bloated, and the worst of it is cheap to fix before opening: a plain screen loads 1.15 MB of script (median of 449 routes), of which 481 KB is Supabase's client, zod and the builder's English, brought in by three stray imports. 26 screens load an editor they never draw, an order screen carries 0.69 MB for custom fields the store may not have, one Work screen ships a 1.7 MB chunk of text, and the builder loads 3.3 MB at once. Four small fixes (AC-1, AC-2, AC-3, AC-7) and two checks (AC-10, AC-11) take a plain screen to about 0.72 MB and keep the leaks from coming back; the builder, the text handed down in each page (36 to 85% of its data) and link prefetching (23 to 46 background requests a screen) need more care. Two things the report missed are added: the notice badge costs four database statements per open tab per minute whatever the store uses (AC-13), and the Products list sends every product to the browser at about 0.9 KB each (AC-14, already code review step 1.13, open); no finding judges a feature by its use, and every cost is per screen view, so it starts the day owners arrive.

## Measures
- First-load script per admin route (449 routes): median 1,152,953 bytes raw, mean 1,396,112; the store home 1,194,862 raw / 360,861 gzip; the largest 4,274,839 raw / 1,335,794 gzip (the Work invoice screen). 40 routes are over 3 MB.
- What three imports put on every signed-in screen: 481,045 bytes raw: supabase-js 179,419 (44,575 gzip, on 432 of 449 routes), realtime 57,349 (432), a Buffer polyfill module 22,701, zod 116,870 (432), the builder's English 71,508 (423), schemas 33,198 (420). With the five whole chunks taken off, the store ho…
- Screens that load an editor they do not draw: 13 draft previews at 3,220,818 to 3,303,372 bytes; 13 page lists and category screens at 2,002,798 or 2,007,577; 12 content screens at 1,953,143 or 1,961,129 (4 of them lists). A plain list (Products) is 1,167,291. Client closure of a page list: 192 files, 13…
- Order, customer and deal screens: 1,998,644 / 1,936,135 / 1,858,910 bytes. With the fields card out of the route's client modules the order screen's closure falls from 207 files (2.00 MB of source) to 141 (0.96 MB) and no longer reaches Tiptap or page-content.ts. The seven chunks the card bri…
- Page builder first load: 3,303,372 raw / 1,014,731 gzip on a store's editor routes; 39 routes carry the builder's own chunk (460,704). Tiptap is one chunk of 435,421 (136,630 gzip) on 73 routes; the storefront's four languages are one chunk of 318,693 (103,098 gzip) on 40 routes. Cut…
- Largest single first-load chunk: 1,704,595 bytes raw / 526,391 gzip on one route (the Work invoice screen). Exactly two "use client" files in src have a static path to lib/admin-text.ts, both through lib/work-text.ts.
- AI manager chat chunk: 496,206 bytes raw / 143,978 gzip, fetched when the panel opens. The chat's closure is 209 files, 2,943,188 bytes of source; without its imports of manager-tools, admin-map and pages.nb it is 39 files, 302,869 bytes. TOOL_WORDS itself is about 13,900 bytes of …
- Translated text handed down in page HTML: Every store screen carries common 6,498 + setup 6,895 + shell 6,905 + assistant 13,683 = 34.0 KB of words; setup has no client reader. The home hands home (23,695) for a reader of home.drafts (1,219). The product editor hands builder (74,940) and website (47,…
- English catalogue files compiled into client code: 38 import sites reach an area's English (or Norwegian) file from client code besides common and sign-in: builder.en through responsive-edit.tsx on 422 routes, fields.en through lib/field-group-editor.ts on 73, blocks.en and builder.en in the builder (39 each)…
- Script budget coverage: 9 of 449 admin routes have a budget (7 signed-in store screens, sign-in and forgot-password). The spec counts every script tag, the 112,594-byte nomodule polyfill included, and no HTML.
- Requests after an admin screen has loaded: Prefetches: 23 to 46 per screen (home 28 for 13 targets, 98 KB on the wire, 171 KB decoded; pages list 46; settings 44). One GET of /admin/account/notices/feed per screen: 1,731 bytes on the wire for a 12-byte answer, repeated every 60 seconds while the tab i…
- Products list, bytes per product: 217 characters of flight data per product (the rows prop: 2,171 for 10 products) and 606 to 744 characters of HTML between consecutive rows: about 0.9 KB of document per product, with no limit in the read.
- Lazy boundaries in the admin: 6 files load on demand among 332 client component files under src/components/admin (verified report); page-builder.tsx (6,658 lines) and block-fields.tsx (3,644) have none.

## Well made
- The CSS editor (CodeMirror), three, model-viewer, mediabunny and Stripe Connect load only when used: I searched the 324 chunks that are in some admin route's first load for their markers and found no CodeMirror, three or Stripe Connect code; model-viewer and …
- The heavy editors are client modules of their own routes only: product-editor.tsx on 2 routes, media-library.tsx on 2, menu-editor.tsx on 2, campaign-editor.tsx on 2, theme-editor.tsx on 5. What leaks is listed in AC-2 (page-editor.tsx on 13 previews, terms.t…
- No data table reaches admin client code: no file of src/data, no font list, country list or taxonomy file over 20 KB is in any admin route's client closure (fonts.ts is 5 KB, product-taxonomy.ts 17 KB). The exception is the AI chat's closure (AC-8).
- Icons are imported by name (lucide-react, simple-icons); no namespace import.
- The admin loads no web font: its root layout (src/app/admin/layout.tsx) sets font-sans and imports only CSS. Its two stylesheets are 204,207 bytes raw / about 36 KB gzip, cached for a year; one of them (183,124 bytes) is the same file the storefront loads, so…
- The admin's service worker is small and keeps only the offline page and one icon (src/lib/admin-sw.ts lines 13-37); it caches no page, script or data.
- The per-area English fallback of 10 November (D540) holds: admin-text.tsx statically imports only common and sign-in.
- The AI manager's chat is fetched when its panel opens (ai-manager-launcher.tsx line 32), and web-vitals after the page (speed-beacon.tsx line 53).
- Polls other than the notice badge run only while their work runs: the store draft every 10 seconds while a page is being built (store-drafts.tsx lines 39-45), the replicate panel, live analytics, the Work timer on Work screens. The notice badge is AC-13.
- The owner's avatar goes through /api/gravatar with a one-hour browser cache and a one-day shared cache; the media library draws thumbnails (media-library.tsx line 507).
- No server-only module leaks into a client bundle: the import graph reaches no file under src/server from admin client code apart from server action stubs.
- Sign-in, two-step and forgot-password load about 0.50 MB and no Supabase client.
- No test or written rule pins the three shell imports of AC-1: docs/rules/admin/platform.md line 51 only requires that SessionKeeper refreshes tokens in the browser.
- Non-text flight data is not oversized on the sampled lists: the orders list's rows after the words are element trees of the page itself (largest 14 KB, the top bar).

## Findings (14)

### AC-1 [P0 S eager confirmed] Three stray imports put Supabase, zod and the builder's English on every admin screen
- evidence: Chunks in the first load of 420 to 432 of 449 admin routes, each opened: supabase-js 179,419 bytes (44,575 gzip), Supabase realtime 57,349, a Buffer polyfill module 22,701, zod 116,870 (32,996 gzip), the builder's English 71,508, schemas built on zod 33,198. The only paths from the signed-in layout, by my import graph: session.tsx to lib/supabase/client.ts to env.ts (zod); push-settings.tsx, which holds the 9-line A…
- cost: 481 KB raw / about 137 KB gzip in the first load of every signed-in admin screen, 43% of the 1.12 MB all screens share. Downloaded once per browser until a deploy changes a chunk (the builder's English changes whenever … (An owner's browser on every full load of any admin screen, phones most. The tea…)
- fix: 5 steps; first: typingIn: create src/lib/typing-in.ts with typingIn() moved as it is from src/components/admin/responsive-edit.tsx lines 305-309. In responsive-edit.tsx replace the function with `export { typingIn } from "@/lib/typing-in";` so page-builder.tsx line 79 and re…
- done when: After pnpm build, in .next/diagnostics/route-bundle-stats.json the route /admin/[store] has firstLoadUncompressedJsBytes at or under 760,000 (1,194,862 today) and none of its firstLoadChunkPaths holds zod or supabase-js; the same holds for /admin/[store]/orders, /admin/[store]/products, /admin/[store]/settings and /ad…
- saving: Measured by subtraction: the store home from 1.19 MB to about 0.72 MB raw (361 to about 225 KB gzip). 222 KB raw (zod, the builder's English, the schemas) leaves about 290 routes outright; the 260 KB of Supabase still downloads on every screen, after the page…
- after: nothing
- tracked: PSI PERF-01 (docs/audits/psi-followups.md line 482, open) says to cut the shared scripts but names none of these imports. Not a step anywhere.
- notes: What stays after this: 260 KB of Supabase client fetched after the page on every plain screen, only to refresh a token. Removing it entirely would mean refreshing on the server from a small route, which changes the rule in docs/rules/admin/platform.md line 51…

### AC-2 [P0 S eager corrected] 26 screens load an editor they never draw, because lists, previews and editors share one views file
- evidence: route-bundle-stats.json: the 13 draft previews (7 of a store, 5 of the platform, 1 of the sandbox) are 3,220,818 to 3,303,372 bytes, the same as the editor. A store's and the platform's preview view sit in editor-views.tsx beside PageEditor and DualPageEditor; the sandbox's preview imports two small helpers (isPageId, sandboxAndKind) from editor.tsx, which imports both editors. The 13 lists and category screens of p…
- cost: About 1.7 to 2.1 MB raw too much on each draft preview, and about 0.8 MB raw (about 0.25 MB gzip) on each of 17 list screens. (An owner's browser: every press of Preview in the builder and every visit to a …)
- fix: 7 steps; first: Store previews: create src/app/admin/(gated)/[store]/pages/preview-views.tsx and move StorePreviewPageView there (editor-views.tsx lines 276-329) with only the imports it uses (Link, notFound, z, requireFeature, PAGE_TYPE_COPY, adminLangOf, adminText, require…
- done when: route-bundle-stats.json after a build: /admin/[store]/pages/[pageId]/preview at or under 1,700,000 bytes (3,303,372 today), /admin/[store]/pages at or under 1,300,000 (2,002,798), /admin/[store]/content at or under 1,250,000 (1,953,143), and the platform's and the sandbox's twins the same; no preview route's page_clie…
- saving: Estimate from closures and a like route: previews from 3.3 MB to about 1.2 to 1.6 MB raw; content lists from 1.95 to about 1.15 MB; page lists from 2.0 MB to about 1.35 MB, or about 1.17 MB (the Products list's size) with the pages-table import fixed. Before …
- after: nothing
- tracked: No. The split of 4 November under PSI PERF-01 (docs/performance.md lines 162-164) kept the lists apart from the editor only.
- notes: The skeptic's count of 26 is 13 previews, 9 page lists and 4 content lists; the 4 category screens and the 8 content editor screens ride along and gain from the same split.

### AC-3 [P0 S eager corrected] Order, customer and deal screens load the rich text editor and the builder's schema for custom fields, whether or not the store has any
- evidence: The order screen is 1,998,644 bytes raw / 611,343 gzip, a customer 1,936,135, a deal 1,858,910. One path brings the excess on all three: StaffFieldsSection imports EntityFieldsCard, which imports entity-fields, fields-form and RichTextEditor (Tiptap), and custom-fields.ts imports two helpers from page-content.ts; fields-form.tsx imports EMPTY_DOC from page-content.ts itself. StaffFieldsSection returns null when the …
- cost: About 0.69 MB raw / 217 KB gzip on every order, customer and deal screen of a store with no custom fields for them; 435 KB of it wherever no rich text field is shown. (An owner's browser, on the screens used most in daily work. A store that never …)
- fix: 6 steps; first: Create src/components/admin/lazy/fields.tsx ("use client") after the pattern of src/components/lazy/blocks.tsx: `export const EntityFieldsCard = lazyView(dynamic(() => import("../entity-fields-card").then((m) => m.EntityFieldsCard)));` with the import() writt…
- done when: route-bundle-stats.json after a build: /admin/[store]/orders/[orderId] at or under 1,350,000 bytes (1,998,644 today) with no Tiptap chunk in its firstLoadChunkPaths, and the same for customers/[customerId] and deals/[dealId].
- saving: From measured chunks: an order screen from 2.00 MB to about 1.3 MB raw (611 to about 395 KB gzip) while the store has no fields for orders; 435 KB raw less wherever no rich text field is shown.
- after: nothing
- tracked: No. Code review step 3.2 would split page-content into a folder (Open) but does not name this.
- notes: Steps 1 to 3 alone give the whole saving where no group applies and are the part to do first; steps 4 and 5 serve stores that use custom fields without rich text.

### AC-4 [P1 M oversize corrected] Pages hand whole text areas to the browser where their parts read a few branches; one area on every screen is read by nothing
- evidence: Sized by importing the catalogue files: every store screen is handed common 6,498 + setup 6,895 + shell 6,905 + assistant 13,683 = 34.0 KB of words. rg finds no useAdminText("setup") or useHandedText("setup") in src. The launcher and the notices read launcher (272) and notices (1,025) of assistant; 6,422 of it is the autopilot's words and the rest is the chat's, which loads only when the panel opens. The home hands …
- cost: About 22 KB raw (about 8 KB compressed) of unread text in every store screen's document; at least 77 KB and likely about 160 KB raw on the product editor; about 58 KB on the pages list. The layout's part is sent on a fu… (An owner's browser on every full load, every refresh after a save and every nav…)
- fix: 6 steps; first: src/app/admin/(gated)/layout.tsx line 45: hand ["common", "shell"]; drop "setup" (no client part reads it; the setup screens pass their words as props).
- done when: The signed-in suite passes with admin-text-fallbacks.spec.ts; the store home's document is at or under 140,000 characters (165,942 today) and the product editor's at or under 350,000 (about 426,000 today), measured by the new document budget; no admin document carries a "setup" object in its flight data.
- saving: Estimate from the measured slices: every store screen 22 KB raw less (about 8 KB compressed); the home's HTML from 166 KB to about 134 KB; the pages list from 279 KB to about 220 KB; the product editor from 426 KB to about 270 to 350 KB. On the wire about a t…
- after: AC-2 for the page lists' part (until then the category editor on those routes reads website.picker and pictureMaker); AC-9 for the home's part (demo-content-car
- tracked: No. D540 and PSI PERF-01 moved the English out of the scripts; the size of what is handed down is not measured or budgeted anywhere.
- notes: Step 1 is a one-line change worth doing at once (6.9 KB off every signed-in document). Derived areas are chosen over handing partial objects because a missing branch is then a type error, not a crash, and D540's test keeps its meaning. The shell area's unread…

### AC-5 [P1 M eager corrected] The page builder loads everything at once: 3.3 MB of script before the first paint
- evidence: route-bundle-stats.json: 3,303,372 bytes raw / 1,014,731 gzip on a store's editor routes; 39 routes carry the builder's own chunk of 460,704 bytes (26 editors and the 13 previews of AC-2). Against a plain list the builder adds, by the verified report, 2,164,685 bytes: its own chunk, Tiptap 435,421, the storefront's text in four languages 318,693 plus 49,242 (AC-6), components' fields 136,082 and 114,972, the page-co…
- cost: 3.30 MB raw / 1.0 MB gzip on the first open of the builder, and the changed chunks again after a deploy. PSI PERF-01 and code review FB8 name the editors for the admin's 3.93 s largest paint at p75, measured on the team… (An owner's browser on every page, article, header, footer and layout edit; a pr…)
- fix: 5 steps; first: Tiptap off the first load: create src/components/admin/lazy/editors.tsx ("use client") with next/dynamic stand-ins for RichTextEditor and MarkupInput (a fallback box of the field's height) and for InlineMarkupEditor and InlineRichEditor (ssr: false; they moun…
- done when: route-bundle-stats.json after a build: /admin/[store]/pages/[pageId] at or under 2,450,000 bytes (3,303,372 today) with no Tiptap chunk in its firstLoadChunkPaths, and the signed-in builder specs pass.
- saving: Estimate: the first load from 3.3 MB to about 2.3 to 2.4 MB raw from the three named cuts (the storefront's text about 350 KB, Tiptap 435 KB put off, English copies about 150 KB), lower once the dialogs load on demand. AC-1 saves nothing here: the builder nee…
- after: AC-6; AC-9; code review step 3.1 and 3.2 for step 4
- tracked: docs/audits/code-review-2026-11.md step 3.4 (FB8), Open, after step 3.1 (split the builder, Open). FB8's finding names the rich text editor; its fix lists only…
- notes: Steps 1 to 3 do not wait for the builder's split (3.1): they change import lines, not the builder's structure. Tiptap is put off, not removed: with the idle warm-up its bytes still arrive on each open, after the first paint.

### AC-6 [P1 M oversize corrected] The builder and the draft order editor load the storefront's text in all four languages
- evidence: Chunk 1u2592k6jkhim.js (318,693 bytes raw / 103,098 gzip) holds messages/da, nb, sv and en and is in the first load of 40 admin routes: the 39 builder routes and the draft order editor. Any import of lib/i18n brings all four (i18n.ts lines 9-12). In the builder's client closure four modules import it as a value: block-fields.tsx (the form's usual words, one of them a function), modal-preview.tsx (two strings), page-…
- cost: About 350 KB raw / about 113 KB gzip on 40 routes (the chunk and a 49,242-byte chunk of returns texts on 39). (An owner's browser in the builder and on a draft order.)
- fix: 7 steps; first: Create src/components/admin/site-words.ts: siteWordsLater(lang) with one import() per hand-written language module (@/lib/messages/nb, sv, da, en; English for any other language), kept in a Map per language as admin-text-later.ts keeps its areas, and a hook u…
- done when: route-bundle-stats.json after a build: no admin route has a first-load chunk holding the four language modules (40 routes carry 1u2592k6jkhim.js today), and /admin/[store]/orders/drafts/[draftId] is at or under 1,300,000 bytes (1,607,368 today).
- saving: Estimate: about 350 KB raw / 113 KB gzip off the first load of the 39 builder routes and about 319 KB off the draft order editor; about 80 to 90 KB of it comes back after load in the builder when a preview first needs the store's language.
- after: nothing
- tracked: No.
- notes: The messages hold functions, so the whole object cannot cross from the server as a prop; that is why the admin loads one language module itself. The split also takes lib/i18n out of the chunk the storefront's recommended grid loads on demand (not measured her…

### AC-7 [P0 S oversize confirmed] The Work invoice screen ships the whole admin catalogue, both languages, in one 1.7 MB chunk
- evidence: /admin/account/work/s/[store]/invoices/[invoiceId] is the largest admin route: 4,274,839 bytes raw / 1,335,794 gzip. Its chunk 3fqt1dd2f0p1k.js is 1,704,595 bytes (526,391 gzip) and is on that one route. The client editor imports invoice-readiness.tsx and invoice-totals.tsx, written for the server (no "use client"), which import lib/work-text.ts, which imports lib/admin-text.ts: every area in both languages. I searc…
- cost: About 1.66 MB raw / about 520 KB gzip of text on each first open of a Work invoice, and again after every deploy that changes any admin word (the chunk holds them all). (An owner's browser, on the Work invoice screen only. The cost already follows u…)
- fix: 5 steps; first: src/components/admin/work/invoice-readiness.tsx: remove the lib/work-text import (line 8). Add a prop words: { ready, toFix, fix, check, open, problems } where problems is the record of templates by code, or null for English; write the problem's text from it …
- done when: route-bundle-stats.json after a build: /admin/account/work/s/[store]/invoices/[invoiceId] at or under 2,700,000 bytes (4,274,839 today), and no admin route has a first-load chunk over 600,000 bytes (one of 1,704,595 today).
- saving: Measured chunk: about 1.66 MB raw / about 520 KB gzip; the route falls from 4.27 MB to about 2.6 MB raw.
- after: nothing
- tracked: No.
- notes: The language point is read from the code (cache() on the server only), not seen in a browser. 137 source files and 2.8 MB of source are in admin client code only through this one screen's leak (verified report).

### AC-8 [P1 S oversize confirmed] The AI manager's chat downloads every tool definition, the admin map and the Norwegian page names to label a tool call
- evidence: Chunk 00rxgygh1f--7.js is 496,206 bytes raw / 143,978 gzip. ai-manager.tsx imports one table, TOOL_WORDS (about 13,900 bytes of source, manager-tools.ts lines 318-621), from manager-tools.ts (36 KB), which imports owner-tools.ts (208 KB) and through it the product, site and setup tools; it imports matchPath from admin-map.ts (172 KB) and PAGES_NB (61 KB) to name the current page in one suggested question (lines 392-…
- cost: 496 KB raw / 144 KB gzip the first time the panel opens, again after each deploy that changes a tool's description or a page's name, and in the first load of the two assistant screens (2,056,681 and 2,064,667 bytes). (An owner's browser, when the AI manager is opened. The cost follows use; the ch…)
- fix: 4 steps; first: Create src/lib/tool-words.ts with TOOL_WORDS moved as it is (manager-tools.ts lines 317-621; it imports nothing). manager-tools.ts adds `export { TOOL_WORDS } from "./tool-words";` so the 30 test files that import it from ./manager-tools keep working. src/com…
- done when: The script the panel fetches on opening is at or under 130,000 bytes (496,206 today), read in e2e/signed-in/ai-manager-panel.spec.ts from the requests made on the press; and /admin/[store]/assistant is at or under 1,720,000 bytes in route-bundle-stats.json (2,056,681 today).
- saving: Estimate from source sizes: about 400 KB raw / 115 KB gzip of the 496 KB chunk, and the same off the two assistant screens.
- after: nothing
- tracked: docs/performance.md lines 154-160 records the 0.48 MB chunk and made it load on opening (4 November); its size is not a step anywhere.
- notes: If AC-4 is done, the chat's words also arrive with the start call; the page's name can ride on the same pattern (one action bound in the layout).

### AC-9 [P2 M duplicate corrected] English text for 23 areas is still compiled into client scripts and then handed down again in the HTML
- evidence: Walking every admin route's client closure (the Work invoice route of AC-7 left out) I find 38 import sites that bring an area's English or Norwegian file into client code besides common and sign-in: builder.en through responsive-edit.tsx on 422 routes (AC-1 takes it down to the builder's 39), fields.en through lib/field-group-editor.ts on 73 (eleven functions there default their words to fieldsEn), blocks.en throug…
- cost: 24 to 150 KB raw of English per affected screen that the page also hands down in the account's language; a Norwegian account downloads English it never shows. (An owner's browser on the affected screens (the builder most: about 150 KB).)
- fix: 5 steps; first: Lib modules that default to English: make the words a required parameter and let callers pass them (a client part passes useAdminText()'s result; a server caller passes adminText(lang, area)). In order of reach: src/lib/field-group-editor.ts lines 54-517 (ele…
- done when: The walking scan test of AC-11 finds no path from an admin client module to a file of src/lib/admin-messages other than common.en and sign-in.en (38 import sites today), and ALREADY holds only admin-text.tsx and admin-text-context.tsx.
- saving: Estimate: about 150 KB raw on the builder, 65 KB on the Work screens, 24 to 45 KB on 73 field screens, 22 KB on the home.
- after: AC-1; AC-11
- tracked: Partly: admin-catalogues.scan.test.ts holds a list of 14 direct importers that may only shrink (PSI PERF-01). The indirect ones are not seen.
- notes: Do the builder's four sites with AC-5 and the fields module with AC-3; the long tail of sites on 1 to 7 routes is worth doing when each area is next touched, which is why this is P2 as a whole.

### AC-10 [P0 S process corrected] The script budget covers 9 of 449 admin routes and none of the HTML
- evidence: BUDGETS holds 7 signed-in store routes; e2e/performance.spec.ts adds sign-in and forgot-password. No platform, account, Work, preview, order or customer route has one. The four worst things found here sit outside them: the 4.27 MB Work invoice, 13 previews at 3.2 to 3.3 MB, the order screen at 2.0 MB, the sandbox's builder at 3.09 MB. firstScripts() sums every script tag, the 112,594-byte nomodule polyfill included,…
- cost: Growth outside 9 screens is unseen; about 13 KB was added to every plain screen and 58 KB to the builder in a day without a signal. (CI now; every owner's browser later.)
- fix: 4 steps; first: Write scripts/bundle-budget.mjs: read .next/diagnostics/route-bundle-stats.json and fail loudly if it is missing or is not an array of { route, firstLoadUncompressedJsBytes, firstLoadChunkPaths }. For every route under /admin compare with a committed baseline…
- done when: node scripts/bundle-budget.mjs passes on main with a baseline of 449 admin routes (9 have a budget today) and fails on a branch that imports zod into src/components/admin/admin-main.tsx; CI's signed-in job runs it.
- saving: No bytes by itself; it keeps the 0.5 to 2 MB found here from coming back and covers 440 more routes for a few seconds of CI.
- after: nothing
- tracked: Partly: code review 3.4's done-when adds the page editor to the budgets (it is already there); PSI PERF-11 (done) budgets visitor routes. A budget for all admi…
- notes: Land it first with today's numbers as the baseline, then let AC-1, AC-2, AC-3 and AC-7 lower it: each of their done_when lines is a number this script prints. The same script can hold the other 111 routes of the build; that is the storefront review's call.

### AC-11 [P0 S process confirmed] The import guard that keeps zod and whole catalogues out of shoppers' scripts leaves the admin out
- evidence: storefront-bundle.scan.test.ts walks every visitor component's static imports and fails on zod, lib/page-content, lib/i18n and whole language modules; its header (line 14) says the admin is left out. The admin's only bundle guard matches a direct .en import in a "use client" file. Every large finding here is one small import of a helper from a large module, which a walk catches: typingIn from responsive-edit (AC-1),…
- cost: Nothing at run time; each miss costs 20 KB to 1.7 MB per screen until someone measures by hand. (CI (a unit test of under a second); an owner's browser pays for each miss.)
- fix: 4 steps; first: Lift the walk of src/lib/storefront-bundle.scan.test.ts (resolve, typesOnly, the import pattern) into a shared helper, src/test/import-walk.ts, and keep that test's behaviour as it is.
- done when: pnpm test runs admin-bundle.scan.test.ts green on main, and it fails when `import { z } from "zod"` is added to src/components/admin/admin-rail.tsx; the lists of zones (a) and (b) are empty once AC-1, AC-6 and AC-7 are in.
- saving: Prevents the return of AC-1, AC-3, AC-6, AC-7 and AC-8 (about 0.5 MB on every screen and up to 1.7 MB on one); the three helpers named in step 3 are worth about 38 KB on 83 routes, 18 KB on 71 and 22 KB on the product editor.
- after: nothing
- tracked: No.
- notes: The three extra leaks are small one by one and are listed here, not as findings of their own. cookie-consent.ts reaches admin client code on 96 routes by my graph and its chunk is in 83 routes' first load.

### AC-12 [P1 S eager corrected] Every navigation link in view is prefetched one by one: 23 to 46 background requests per admin screen
- evidence: The rail, tabs and sidebars use plain Link; 4 places in the admin set prefetch={false} and none in src sets prefetch or prefetch={true}. Next's guide: with Partial Prefetching a Link prefetches the route's shell, built once per route and reused, "rather than prefetching each link separately as it did before"; and when cacheComponents is on without a partialPrefetching value Next logs a warning, which the production …
- cost: Measured locally: 23 to 46 requests and 78 to 160 KB on the wire per admin screen view, on top of the page. In production each is a request to Vercel; whether it also runs a function is unknown. (An owner's browser (network) and the hosting bill per request. The team's own c…)
- fix: 5 steps; first: next.config.ts line 42: add partialPrefetching: true beside cacheComponents (docs/plan.md line 120 named both for the stack). There is no <Link prefetch> or prefetch={true} in src, so the guide's audit of full prefetches has nothing to migrate.
- done when: pnpm start prints no partialPrefetching warning, the e2e and signed-in suites pass, and the repeated measurement shows the store home's after-load prefetches at or under today's 28 requests and 98 KB on the wire, with the figures written into docs/performance.md.
- saving: Not known until tried: fewer and smaller prefetches per screen is what the guide describes. The View store link alone is 4 requests and about 62 KB decoded per screen on a deployment where stores share the admin's host.
- after: The storefront review's prefetch finding, if it has one: it is one flag for the whole app, to be set once
- tracked: No. docs/plan.md line 120 names partialPrefetching as part of the stack; the config never set it, and no decision says why.
- notes: Before opening is the cheapest time to change a router setting: nobody's working session depends on it yet.

### AC-13 [P2 S eager added] The notice badge asks the server every minute from every open admin tab: four database statements a time, one of them thrown away
- evidence: useNoticeCount() asks /admin/account/notices/feed?place=...&count=1 when the admin opens, every NOTICE_POLL_MS (60,000) while the tab is visible, and when the tab is shown again. It runs in the AI manager's launcher, which is in the store's and the platform's layout, so every screen of a signed-in owner has it. The browser run shows it on all 13 store screens sampled: one GET after load, 1,731 bytes on the wire for …
- cost: Per visible admin tab: 60 requests and 240 statements an hour, whether or not the AI manager has ever left that person a notice. Arithmetic, not a measurement: 1,000 owners with the admin visible are 1,000 function call… (The server per request and the database, and Supabase Auth for sessions without…)
- fix: 4 steps; first: src/app/admin/(gated)/(owner)/account/notices/feed/route.ts line 32: in count mode call unreadNotices(account.id, place) and answer { unread }; keep listNotices() for the list. Four statements become three.
- done when: With the store home left open and visible for ten minutes and the AI manager untouched, the browser makes at most 2 requests to /admin/account/notices/feed (10 today), checked in a signed-in spec with a clock; and a count request runs at most 2 statements after the account read (asserted in assistant-notices.int.test.…
- saving: Estimate: about 85 to 90% fewer poll requests from an idle open tab (6 an hour, not 60) and half the statements in each.
- after: nothing
- tracked: No. The verified report listed the poll under clean because it follows open tabs; it does not follow use of notices, and its cost per answer was not counted.
- notes: Steps 1 and 2 are pure savings and can go at once. The cadence of step 3 is a small product trade (how late a badge may be); ten minutes is a proposal. The Auth round trip per request for sessions without a second step is the server review's subject, not this…

### AC-14 [P1 M oversize added] The Products list sends every product of the store to the browser: no paging, about 0.9 KB a product
- evidence: listAdminProducts() has no limit: its statement ends at the order by (products.ts line 347) and runs several correlated subqueries per product (first picture, variants, digital variants, stock, prices). The page maps every row into the rows prop of the client component ProductsTable (page.tsx line 168), which draws a table row for each (products-bulk.tsx line 251). In the sampled list of 10 products the rows prop is…
- cost: Grows in a straight line with the catalogue. Estimate from 10 rows: about 0.45 MB of document for 500 products and 4.5 MB for 5,000, on every visit to Products and every refresh after a bulk action. Nothing today: the t… (An owner's browser (document, DOM, hydration), the server and the database, who…)
- fix: 3 steps; first: Before opening, a cap: listAdminProducts(store, { archived, limit = 100, page }) returns { rows, total }; src/app/admin/(gated)/[store]/products/page.tsx shows "100 of N" and a Show more link (?page=2), the way the storefront's listings do since code review s…
- done when: With a store seeded with 500 products, the Products page's document is under 300,000 characters and says "100 of 500" (code review 1.13's own done-when: a list says when it was cut).
- saving: Estimate: at 5,000 products about 4.4 MB less document and 4,900 fewer table rows per visit; nothing at today's 10.
- after: code review step 1.12 and 1.13 for the shared pager; step 1 here can go first
- tracked: Yes: docs/audits/code-review-2026-11.md step 1.13 (One way to search and page a list, FS2), Open, after step 1.12 (Open); docs/audits/admin-usability-2026-11.m…
- notes: No store has a large catalogue yet only because none is open; this is the cost that arrives with the first real catalogue, so the cap belongs before opening and the shared pager can follow. listPages() reading whole page contents for a list is the database re…
