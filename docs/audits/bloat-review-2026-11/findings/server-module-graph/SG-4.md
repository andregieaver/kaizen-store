# SG-4 ✓ The admin's whole interface text, both languages, loads wherever one word is needed

The server code every route loads (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 2.13.
- **Second check:** corrected.
- **Where:** `src/lib/admin-text.ts:2-135`, `src/lib/admin-text.ts:232-303`, `src/lib/two-step.ts:13`, `src/lib/two-step.ts:59`, `src/server/customer-tiers.ts:21`, `src/server/plan-reminders.ts:270`, `src/server/shopper-emails.ts:1294`, `src/server/company-locations.ts:27`, `src/server/staff-alerts.ts:84`, `src/server/endpoint-emails.ts:36`, `src/server/price-lists.ts:27`
- **Evidence:** admin-text.ts statically imports 134 catalogues (67 areas in English and Norwegian) into one table; adminText(lang, area) reads one entry (lines 300-303). In the server chunks that is 2,903 KB in 133 modules. 242 of 268 handlers, 560 of 562 pages, the proxy and instrumentation reach it. 723 non-test files import the module. I counted who brings it to shoppers once the cycle is cut: 13 files across the 59 storefront pages, of which eight cover 57 pages: two-step.ts (area signIn, reached through auth.ts on every page), customer-tiers.ts and company-locations.ts and price-lists.ts (customers), plan-reminders.ts, shopper-emails.ts, staff-alerts.ts and endpoint-emails.ts (staffEmails; staff-alerts.ts:672 also reads order). The storefront home page needs only the first three. 66 src/lib modules already import their own area's files directly, so the pattern exists. Turbopack writes the catalogue chunk 10 times (10 copies of 2.7 MiB).
- **Cost today:** 2.2 to 2.9 MB of server code per route and about 64 ms of evaluation per cold start (admin-text.ts 51 ms plus catalogues 13 ms in the profile; attribution approximate); about 27 MB of repeated chunks in the build. Paid by: The server per cold instance on every storefront, API and admin route; the build.
- **Saving:** Step a, simulated after SG-1's three edits: storefront home 7.7 -> 5.0 MB with the three importers it has (about 2.7 MB less; the areas it keeps are about 0.15 MB), and with SG-6 4.35 MB; the proxy 5.2 -> 2.4 MB with the eight importers; handlers that reach the registry 238 -> 49. Step b: at most 2.2 MB off an admin page (simulated with every catalogue removed; real pages keep their areas) and roughly 50 ms of its cold start.
- **Risk:** Step a is twelve small files. A wrong area name fails the type check. Step b is wide but mechanical (605 files) and is worth doing only if the admin's cold start matters enough: effort M for about 2 MB on owners' pages; the two scan tests and the signed-in fallback spec hold the catalogue's shape meanwhile.
- **Already tracked:** The browser's half is done (D540, docs/performance.md:167-185). The server registry is not tracked in the repo. In this review the same change is families FM-1 (full design), storefront-data SD-1 step 4 and i18n TX-1.

## The fix

1. Step a1 (for shoppers, small): add src/lib/admin-area.ts with no catalogue import: the type AreaWords<A> = { area: A; words: Record<AdminLang, AdminAreaMessages[A]> } (types from admin-text.ts by import type) and areaText(lang, a) returning a.words[lang] (the design of families FM-1 step 1).
2. Step a2: add one small module per area needed now in a new folder src/lib/admin-words/: sign-in.ts, customers.ts, staff-emails.ts and order.ts, each importing its area's .en and .nb files from src/lib/admin-messages and exporting signInWords, customersWords, staffEmailsWords, orderWords.
3. Step a3: in the eight files named in the evidence replace adminText(lang, 'x') with areaText(lang, xWords) and drop the import of @/lib/admin-text: src/lib/two-step.ts:13, 59, 92; src/server/customer-tiers.ts:9, 21; src/server/plan-reminders.ts:19, 270; src/server/shopper-emails.ts:17, 1294; src/server/company-locations.ts:9, 27; src/server/staff-alerts.ts:11, 84, 672; src/server/endpoint-emails.ts:8, 36; src/server/price-lists.ts:9, 27.
4. Step a4: the other importers outside the admin folders (35 files today by FM-1's count; kaizen-life-emails.ts, work-text.ts, report-labels.ts, report-schedules.ts and stock-alerts.ts are the ones still on shopper routes) move the same way, each with its area's module. Rebuild CATALOGUES in admin-text.ts from the area modules as they appear, so an area's two files are still named in one place (D312's rule).
5. Step a5: add the rule to the guard of SG-14: no file outside src/app/admin and src/components/admin value-imports @/lib/admin-text (a list that may only shrink, empty after a4), and the proxy, the visit routes and the storefront layout may not reach it.
6. Step b (for the admin, wide, later): one area module for each of the 67 areas and a codemod over the 605 calling files, one folder of src/app/admin/(gated)/[store] at a time: adminText(lang, 'x') -> areaText(lang, xWords), adminTexts(lang, ['a','b']) -> areaTexts(lang, [aWords, bWords]). When no run-time importer is left, delete CATALOGUES, adminText() and adminTexts() and keep the types. Follow families FM-1 steps 6 to 8 for the test helper and the docs.

**Done when:** A new next analyze export shows no src/lib/admin-text.ts in /api/visit, /s/[store]/[market] or the proxy, and /s/[store]/[market] at or under about 1,650 modules and 4.7 MB with SG-1 and SG-6 also in (today 2,419 and 11,944 KB). For step b: /admin/[store]/orders lists only the areas it draws.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/admin-strings.scan.test.ts counts English written into admin markup, not call shapes: passes unchanged; its header comment names adminText(lang, area) and is reworded in step b.
- src/components/admin/admin-catalogues.scan.test.ts keeps catalogues out of client parts: widen its pattern so a 'use client' module may not value-import src/lib/admin-words/* either (an area module holds both languages).
- src/lib/admin-lang.test.ts walks every area for equal keys in both languages: it must keep covering all 67 (a test-only list in step b).
- src/test/admin-english.ts (the unit tests' setup) and e2e/signed-in/admin-text-fallbacks.spec.ts: must stay green after each batch.
- docs/platform-admin-i18n.md section 3.3 (how server code reads an area) and D312 (an area is its two files and one entry): the entry becomes the area's module; say so there. docs/performance.md:167-185 (D540) covers the browser's half and stays.
- No test mocks @/lib/admin-text (rg).

**Comes after:** SG-1

**Notes:** P0 and S are for step a. Step b is P2, M. The skeptic's count of three importers is right for the home page; over all storefront pages it is eight, so step a3 lists eight.
