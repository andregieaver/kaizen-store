# css: Styles

Styles are one of the leaner areas, and no finding here rests on a feature being unused. Every page of every surface loads one stylesheet of 183 KB (25.8 KB Brotli); compiling the proposed split with the project's own Tailwind gives shoppers a sheet of 130 KB (19.8 KB Brotli: 28% less raw, 22% less on the wire), leaves the admin's as it is, needs no more scan memory than today (204-212 MB against 221-223 MB), and stops admin-only and test-only edits from renaming the shoppers' file. The rest is copies: a launch theme's home page carries an estimated 45 to 71 KB of style text, of which 10.6 to 17.6 KB is one fixed breakpoint sheet repeated per row and 6.6 to 9.5 KB a second copy of the layout's sheets. The completeness check added one thing the report missed and the split depends on: the admin's form, print and editing parts are drawn on public pages with colour roles that have no value there, so the main button on Kaizena Flow's status and illegal-content report pages has no fill (seen in the built HTML); before opening is the cheap time to fix both, with no shopper's cache to disturb and a missed class found by the team.

## Measures
- Global stylesheet (every page of every surface): 183,124 B raw / 31,864 B gzip -9 / 25,832 B Brotli; 34,014 B as the local server sent it
- Admin-only stylesheet (two colour schemes and admin.css): 21,083 B raw / 4,199 B gzip / 3,496 B Brotli; the scheme not in use costs 0.44 KB Brotli
- What the global sheet is made of: utilities layer 117,832 B (64%); hand-written unlayered 26,622 B plus 3,884 B of @media, @supports, @keyframes; components layer (motion.css) 18,742 B / 4,309 gzip / 3,815 Brotli; @property and properties 7,156 B; theme 4,910 B; base 3,977 B
- The proposed site stylesheet, compiled: 129,745 B raw / 23,800 B gzip / 19,762 B Brotli, 1,042 classes. Today's globals.css through the same pipeline: 181,586 / 31,403 / 25,360, 1,750 classes (the build: 183,124 B, 1,749 classes). Difference: 51,841 B raw (28.5%), 7,603 gzip, 5,598 Brotli
- The proposed admin stylesheet, compiled: 181,142 B raw / 31,312 B gzip / 25,333 B Brotli: today's sheet less 10 classes that only tests name (436 B)
- Classes the site would keep from admin files it draws: 45 classes, 2,984 B raw, from 11 files under src/components/admin that pages outside the admin import
- Tailwind's scan, today and after: today 5,931 files, 71,891 candidates, 0.58 s. Site entry 2,451 files, 38,251 candidates, 0.26 s; admin entry 3,984 files, 45,347 candidates, 0.35 s
- Memory of the Tailwind step: today's one entry 221-223 MB resident; the same entry without tests, messages, src/db and the SQL 160-169 MB; both proposed entries in one process 204-212 MB
- Re-including after an @source not: a single file named after a folder's `not` line is read (1 of 1); a folder named after it is not (0 of 1,702 files)
- Admin colour roles named by files a page outside the admin can draw: 13 roles. 125 uses in the 11 shared admin files (line 41, card 17, brand 14, sunken 13, ink 8, danger-text 8, brand-ink 8, inverse 4, inverse-ink 4, ink-2 3, warning-text 2, edge 2, canvas 1); 20 uses on 14 lines of 7 non-admin files. The global sheet defines…
- Public pages whose main button has no fill: status.html and report.html of the build: <button type="submit" class="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink ...">, no data-admin on <html>, one stylesheet linked (the global one)
- Copies of the fixed sheets per document: breakpoint sheet (1,760 B, href kz-bp-j5um1l1cw): 4 in store-home (one row), 3 on store pages without rows, 2 on Kaizena Flow's front page; theme sheet: 3 in store documents, 2 in the site's
- Style text of the six launch themes' home pages: theme variables 1.4-1.5 KB; the theme's own CSS 3.4-6.3 KB; row sheets 6.3-12.4 KB for 6-10 rows (as one sheet 4.2-6.7 KB); breakpoint sheet 1,760 B per row. Estimated per document: 45-71 KB of style text (HTML plus payload), of which per-row breakpoint copie…
- Inline style in the sampled documents: store documents: <style> elements 3.7-4.6 KB, style attributes 23-696 B; admin documents: no <style> but the builder's (4.4 KB), style attributes 69-1,931 B, under 1.5% of the document
- Style work per edit on the builder's canvas: partCss for all 10 rows of Meridian's home page 2.7 ms, themedRows 2.8 ms
- The dark variant written twice: 23 dark utilities each once by attribute and once by media query: 3.4 KB raw, 0.17 KB Brotli
- Admin assets fetched by Kaizena Flow's own pages after load: 12.2 KB on site-home, site-blog-post and site-themes: admin CSS 6,015 B and two /admin?_rsc answers of 2,099 and 4,044 B. None on site-docs or any store page
- Commits that changed the stylesheet: 13 of 115 (11%) added a utility class the parent tree did not name; 6 of the 13 only in admin folders or tests

## Well made
- Hand-written CSS has almost no dead weight: 93 of 96 class names, 112 of 113 attributes and all 39 keyframes in globals.css, motion.css, admin.css and the two schemes are used by non-test code (the verified report's sample). The exceptions are four alternativ…
- Every block of feature CSS (motion, brands, gallery, lightbox, menu hover, table, modal, header stages) has code that emits its attributes or classes. None is a candidate to retire; that the demo store draws none of them says nothing about use.
- Tailwind's scan is cheap since D378: 0.6 s and about 220 MB for 5,931 files. Scanning all of src is not a build cost worth chasing on its own.
- The page builder does not style with inline attributes: a store page carries 23-696 bytes of style="". Settings become hashed classes in a part sheet (src/lib/part-css.ts), which keeps owners' CSS able to win (D100). The sheet itself is compact: Meridian's 10…
- Style generation is not paid per request: store pages are prerendered shells revalidated every 15-60 minutes, and the reads behind them are cached ('use cache' in src/server/text-styles.ts:50 and src/server/fonts.ts:159). The builder's canvas recomputes the p…
- Fonts are done well: one stylesheet per family from a cached route, kept for a year, cut to the EU's scripts and the builder's weights (src/app/api/fonts/css/[slug]/route.ts, docs/performance.md:61-62).
- The admin's own CSS is already a separate file that only admin pages load (21 KB, 3.5 KB Brotli). Loading both colour schemes costs 0.44 KB Brotli: not worth a second file.
- The motion script is loaded only where a page needs it (src/components/motion-support.tsx:10-20).
- The dark variant's double writing (by attribute and by the device) is 0.17 KB Brotli, and it is what lets a page be dark without scripts (D99). Leave it.
- Theme variables are small and bounded (1.4-1.8 KB per store) and owners' CSS is checked and capped at 50,000 characters a sheet (src/lib/custom-css.ts:19).
- Class names kept in stored pages are the themes' own (meridian-hero and the like in src/lib/signature/*.ts), styled by the theme's CSS, not Tailwind utilities; the four migration files hold no class attribute. So no stored content depends on Tailwind's scan, …
- Inline layout-level CSS is the right default at today's sizes: it is paid once per full page load, and an external file would add a render-blocking request to every first visit.

## Findings (9)

### CS-7 [P0 S process confirmed] Shop pages use admin-only colour roles that have no value outside the admin
- evidence: globals.css:62-66 says the roles (bg-card, border-line and the rest) are set only inside the admin. In the built files the global sheet has .border-line{border-color:var(--line)} and .bg-card{background-color:var(--card)} and no definition of --line or --card; the admin's file defines them only under html[data-admin] or [data-scheme-preview]. Counted again by the planner with the role names of globals.css:67-104: 20…
- cost: No bytes. A wrong border on swatches in every store, one checkout field, the supplier's page and the passport; an error line that does not look like one; a pressed tool that looks unpressed. It also shows what one share… (Shoppers and suppliers, in what they see; the team, when CS-1 is done and these…)
- fix: 6 steps; first: 1. Replace the role names with the site's own in the seven files: border-line -> border-border in src/components/product-card.tsx:109-110, src/components/content-grid.tsx:206 (twice), src/components/product-parts.tsx:1347-1348, src/app/passport/[id]/page.tsx:…
- done when: rg -c --pcre2 with the role pattern over src/components and src/app, without the admin folders, tests and CSS, counts 0 uses (20 today), and the new rule in stylesheet-sources.scan.test.ts passes.
- saving: No bytes. Removes a visual fault on shop pages and one of the two blockers of CS-1.
- after: nothing
- notes: Not bloat by itself: a visual defect and a missing check that CS-1 needs settled. P0 because it is half an hour of work, it is visible to shoppers, and CS-1 waits for it. The planner's recount adds one line to the skeptic's list (the editor's toolbar was name…

### CS-9 [P0 S process added] The admin's form, print and editing parts are drawn on public pages without the colours they read: the main button on Kaizena Flow's status and report pages has no fill
- evidence: Eleven files under src/components/admin are drawn by pages outside the admin (the planner's import walk from the 644 non-admin files of src/app and src/components, not through src/server: 13 admin files reached, 2 of them word lists): action-form.tsx, admin-text-context.tsx, admin-text.tsx, colour-field.tsx, colour-library.tsx, css-code-editor.tsx, design-cards.tsx, modal.tsx, rich-text-editor.tsx, text-styles.tsx a…
- cost: No bytes. A main button that does not look like a button on two public pages of Kaizena Flow (one of them a legal notice form), on the confirm and get-domain pages, and on every hosted invoice; errors that are not red; … (Visitors of kaizenaflow.com, a store's invoice customers and staff editing on t…)
- fix: 8 steps; first: 1. In the site's CSS (src/app/globals.css today, right after the dark blocks that end at line 169; src/app/_styles/base.css once CS-1 has moved the body) add one block under the selector html:not([data-admin]) that gives each role a page outside the admin can…
- done when: On the built app the submit button of /report and of /status has a computed background-color other than rgba(0, 0, 0, 0) (transparent today by the built CSS and HTML; not yet looked at in a browser), held by the new line in e2e/content-reports.spec.ts, and the second rule of stylesheet-sources.scan.test.ts passes.
- saving: No bytes (the block adds about 0.4 KB raw to the site's sheet). Removes a visible fault on public pages and the second blocker of CS-1.
- after: nothing
- notes: Added by the planner's completeness check: the brief asked for admin-only CSS on public pages 'and the reverse', and the report covered only shop files that name a role (CS-7). The choice of one mapping block over renaming is deliberate: the on-site editor em…

### CS-8 [P0 S eager confirmed] Kaizena Flow's own pages fetch the admin's stylesheet and two admin answers after load
- evidence: Read again from m/routes.json: site-home, site-blog-post and site-themes each fetch, after load, the admin's stylesheet 3jc9lkep25kye.css (6,015 B transferred) and two /admin?_rsc answers (2,099 and 4,044 B). site-docs, which has no link to /admin, fetches none; store-home and store-page fetch none. Five <Link href="/admin"> sit in the site's header part, its standard header, phone menu and bottom bar and on the fro…
- cost: About 12.2 KB transferred after load per view of a site page (local build, gzip), 6 KB of it CSS, and two requests. It does not delay first paint. The page-payload review (PL-4) measured the same links pulling six admin… (A visitor's browser on kaizenaflow.com; the CDN or a function, which answers tw…)
- fix: 5 steps; first: 1. Add prefetch={false} to the six links: src/components/site-parts.tsx:261, src/components/platform-routes/home.tsx:55, src/components/platform-layout.tsx:133, 176 and 273, src/components/platform-routes/sign-up.tsx:164.
- done when: After loading / on the built app and waiting 2 s, 0 requests go to /admin and no admin stylesheet is fetched (today: 2 requests and 1 stylesheet, 12.2 KB), held by the new test in e2e/performance.spec.ts.
- saving: Measured: 6.0 KB of CSS and 6.1 KB of payload per view of a site page, and two requests. With PL-4's scripts the same change saves about 135 KB more.
- after: nothing
- notes: A prefetch matter more than a style matter, kept here because it must land before CS-1: with two Tailwind entries a prefetch of /admin would otherwise pull the admin's whole sheet into every site visit. Same fix as PL-4 (page-payload) and BN-2 (client-bundles…

### CS-3 [P0 S process corrected] Nothing holds the stylesheet's size, its sources or the style text in a document
- evidence: e2e/performance.spec.ts has budgets for first scripts (lines 11 and 40-50) and for page weight (line 126). Page weight includes the stylesheet, but the budget is 450,000 bytes for pages measured at 311 and 331 KB, so the sheet could double unnoticed. No budget names CSS; none of the scan tests looks at classes or at globals.css's @source lines (rg for globals.css in tests finds five readers, none of the source lines…
- cost: Each deploy that adds or drops a class renames the one sheet (assumed from hashed chunk names), and every returning shopper fetches 25.8 KB Brotli again: about one commit in nine in the sample, half of them for admin-on… (A shopper's browser after deploys; the team, which cannot see the sheet growing.)
- fix: 6 steps; first: 1. e2e/performance.spec.ts: add STYLESHEET_BUDGETS, raw bytes of the build's stylesheets a page's HTML links (link[rel=stylesheet] whose href starts with /_next/static/, each fetched with page.request and its body measured; the fonts' route is not counted): '…
- done when: e2e/performance.spec.ts holds a stylesheet budget for 3 routes, each within 4% of its E2E_MEASURE=1 figure, and an inline-style budget for the store's front page, and the spec passes in CI.
- saving: No bytes by itself. It keeps what CS-1, CS-4 and CS-6 save, and makes the sheet's growth a failing number instead of a surprise.
- after: nothing
- tracked: Partly: PSI PERF-11 (per-route budgets, ticked done in docs/audits/psi-followups.md:135) covers first scripts only; nothing covers styles.
- notes: Do steps 1 and 2 first of everything in this dimension, at today's figures, so each later fix shows as a number that falls. The refetch after a deploy is 25.8 KB Brotli, not 32 KB, and 11% of commits, not 26% (the skeptic's corrections). Same family as SC-6, …

### CS-1 [P1 M eager confirmed] Shoppers download the admin's classes: one stylesheet serves every surface
- evidence: The build makes two CSS files: 3-w0shgm-eqtf.css (183,124 B raw, 31,864 gzip, 25,832 Brotli), linked by all 32 sampled pages, and 3jc9lkep25kye.css (21,083 B), linked only by the 16 admin pages. Sixteen files import globals.css (15 root layouts and error pages outside the admin, and src/app/admin/layout.tsx:13), and Tailwind reads all of src for it (globals.css:6-9). The verified report found 728 of 1,749 utility cl…
- cost: 183 KB raw / 25.8 KB Brotli, render-blocking, on the first visit to every store (stores are served on their own hosts, so the cache is per store), to kaizenaflow.com and to the docs. 51.8 KB raw / 7.6 KB gzip / 5.6 KB B… (A shopper's browser (and visitors of kaizenaflow.com and the docs) on the first…)
- fix: 12 steps; first: 1. First land CS-7 and CS-9 (roles outside the admin), CS-8 (no prefetch of /admin from the site: with two entries a prefetch would pull the admin's whole sheet) and CS-3 steps 1 and 2 (the budgets, at today's figures).
- done when: The stylesheet that /s/demo/no links is at most 135,000 bytes raw (183,124 today; 129,745 when the proposed entry is compiled outside the build), with stylesheet-sources.scan.test.ts and the e2e suite passing and the build's peak under the 8 GB cap written into docs/build-memory.md.
- saving: Measured by compiling the proposed entry: 51.8 KB raw, 7.6 KB gzip, 5.6 KB Brotli off every first visit to a store, the site and the docs (28% raw, 22% Brotli). The skeptic's cautious figure, from removing admin-only rules by hand, is about 44 KB raw / 6 KB g…
- after: CS-7; CS-9; CS-8; CS-3 (steps 1 and 2: budgets at today's figures); A build under the 8 GB cap measured before and after (docs/build-memory.md)
- notes: The same finding as SC-5 (storefront-client plan, P2 there because its saving was an estimate and the memory unmeasured) and BN-12; this is the detailed plan, merge them. Before opening is the cheap time: no shopper's cache is disturbed and a missed class is …

### CS-4 [P1 S duplicate confirmed] The fixed breakpoint sheet is drawn again with every row
- evidence: RowView draws <PartStyles rows={[row]}> for each row of a page, header and footer (page-article.tsx:223, reached from site-parts.tsx:345 too), and PartStyles draws BreakpointSheet beside the row's own sheet (part-styles.tsx:41-49 and 57-66). The sheet is 1,760 B and the same text for every store on the default screen sizes. The layout already draws it once through StoreThemeStyles (store-theme.tsx:31); a store's row…
- cost: 1,760 B of text per row in every document and in every payload answer for a page: navigations and each prefetch of a page (the page-payload review counted 11 to 50 prefetches after a storefront load). On the wire it is … (A shopper's browser, per page view and per prefetched page; the server, which w…)
- fix: 7 steps; first: 1. src/components/part-styles.tsx: take <BreakpointSheet> out of StoreSheet (line 45) and out of PartStyles' branch for Kaizena Flow's pages (line 62); PartStyles then draws only the rows' or blocks' own sheet. Export a small async server component PreviewBre…
- done when: A three-row test page's HTML holds the breakpoint sheet's href at most 3 times (6 today), held in e2e/performance.spec.ts; 2 once SC-8 has removed the second layout copy.
- saving: Step 1 to 5: 10.6-17.6 KB raw per launch-theme home document and per payload answer for it (rows times 1,760 B), about 0.1-0.3 KB Brotli. Step 6: a further 1.2-5.7 KB raw, in the HTML and again in the payload (computed with the real functions on the six launc…
- after: nothing
- notes: A true duplicate: small on the wire, cheap and safe to remove, and it multiplies with rows, pages and prefetches. Same finding as PM-7 (page-model); merge them. An equal, simpler-looking way (a per-request memo that lets only the first BreakpointSheet draw) w…

### CS-6 [P2 S dead confirmed] Tailwind reads tests, SQL and message files: 37% of its candidates, 10 junk classes
- evidence: globals.css:6-9 points Tailwind at all of src except src/data, and at supabase/migrations/*.sql. The planner compiled the sheet with and without the noise, with the project's own Tailwind: leaving out **/*.test.ts, **/*.test.tsx, src/test, src/lib/messages, src/lib/admin-messages, src/db and the SQL takes the scan from 5,931 files and 71,891 candidates to 3,984 files and 45,347, and the sheet from 1,750 classes to 1…
- cost: 436 B of CSS, about 0.2 s of scan and about 55 MB of the Tailwind step's memory (221-223 MB against 160-169 MB, fresh process each). The real cost is coupling: a word in a test can add a class and rename the production … (The build, slightly; a shopper's browser when a test-only change renames the sh…)
- fix: 5 steps; first: 1. Do it inside CS-1 (its steps 4 and 5 carry these lines). If CS-1 waits, do it alone: in src/app/globals.css delete line 9 (@source "../../supabase/migrations/*.sql") and add after line 8: @source not "../**/*.test.ts"; @source not "../**/*.test.tsx"; @sour…
- done when: The built stylesheet holds none of the ten test-only classes (rg -o 'order-1038|order-1042|\.sepia\{' .next/static/chunks/*.css | wc -l gives 0; 3 today) and every other class it has today (1,739 of 1,749, compared with the planner's diffcls.mjs).
- saving: 436 B of CSS, about 0.2 s and about 55 MB in the build's Tailwind step (measured); tests and texts can no longer rename the production stylesheet.
- after: nothing
- tracked: Partly: D378 and docs/build-memory.md scoped the scan (done); this remainder is not tracked.
- notes: Too small to stand alone, but it pays for CS-1: with these lines the two entries together read 6,435 files against 5,931 today and need no more memory than today's one. Same finding as AS-7 (assets); merge them. P2 only because its own bytes are trivial; it r…

### CS-5 [P3 S duplicate corrected] Layout-level style sheets are carried three times in each store document
- evidence: Theme variables, breakpoint classes, text styles, the store's own CSS and the header's and footer's CSS are <style href precedence> elements drawn by the layout (layout.tsx:164-170): inline in every document, once in the HTML and once in the payload. In store documents each is there a third time: the theme sheet's href is 3 times in store-home.html and 2 times in Kaizena Flow's front page. The cause, which the verif…
- cost: For a store on a launch theme, 6.6-9.5 KB raw per document for the copy nobody needs (estimate from measured parts); about 0.1-0.3 KB Brotli. Paid on full page loads only: client navigations inside a store do not resend… (A shopper's browser on every full page load; the CDN and function, which store …)
- fix: 4 steps; first: 1. Nothing of its own for the third copy: it goes when the storefront-client plan's SC-8 moves the cart drawer's slot off the root layout (the same finding as PL-2 and PM-1). Do not build a second fix here.
- done when: After SC-8, the theme sheet's href (theme-<store id>-) appears 2 times in /s/demo/no's HTML (3 today).
- saving: From SC-8, not from this finding: 6.6-9.5 KB raw per document for a launch-theme store (estimate), about 0.1-0.3 KB Brotli. The draft's 20-28 KB raw and 1.5-2.5 KB Brotli assumed an external sheet and a warm cache; on a first visit that saving is zero or nega…
- after: SC-8 (storefront-client plan: the cart drawer's slot leaves the root layout); CS-3
- notes: P3 because it needs no work of its own now: the duplicate is removed by SC-8 and the growth is watched by CS-3. The planner settled the open cause by reading Next's source, which SC-8's plan had already cited. What grows after opening: owners' own CSS and the…

### CS-2 [P3 M eager corrected] A store with no builder motion still downloads motion.css
- evidence: In the built sheet the components layer (motion.css) is 18,742 B raw / 4,309 B gzip / 3,815 B Brotli (the planner's own parse). After CS-1 it would be 14% of the site's sheet raw and 19% of its Brotli. The motion script is already loaded only where needed (motion-support.tsx:10-20, motionNeeds()); the CSS is not. Nothing in it is dead. The six launch themes do their motion in their own theme CSS: rg for motion, back…
- cost: 3.8 KB Brotli (4.3 KB gzip), render-blocking, on the first visit to every store and on every admin screen. A store that uses no builder motion pays the same as one that uses all of it. (A shopper's browser.)
- fix: 4 steps; first: 1. Do not build this now. After opening, measure with a read-only script over published pages, headers and footers: the share whose rows need the sheet (motionNeeds(rows).any, or any gradient background, or any background layers). Write the share into docs/pe…
- done when: The share of published pages that need motion.css is written in docs/performance.md with the decision; if built, a store page without builder motion links no motion stylesheet and the site's sheet is 18.7 KB raw smaller.
- saving: If built and if most pages have no builder motion: 3.8 KB Brotli / 4.3 KB gzip / 18.7 KB raw per first visit. Nothing on pages with motion, which make one more render-blocking request instead.
- after: CS-1; A measured share of real pages that need motion.css, after opening
- notes: P3: true, but not worth doing now. It needs a build step and a hand-made stylesheet link for 3.8 KB, and its sign depends on use nobody can know before opening. This is not an argument from disuse: the idle cost is real and small, and the plan is to measure b…

## Refuted (not findings)
- CS-2 (part) Serving the optional component CSS (menu hover, brands, gallery, header stages, table, modal) as separate files, the dr…: All six launch themes set a hover on their header menu, so menu hover is used on every page of a launch-theme store. The rest is about 2.6 KB gzip over five components and would need a file and a gate each.
- CS-5 (part) Moving a store's layout-level CSS to an external per-store stylesheet: On a first visit it trades about 2 KB of inline Brotli for one more render-blocking request, and inside a session the layout is not resent. Kept as a watch item for when real stores' layout CSS commonly passes about 10 …
- CS-3 (part) The draft's figure that 26% of commits change every shopper's stylesheet: 30 of 115 commits touched a className line, but only 13 (11%) added a class the tree did not already name.
