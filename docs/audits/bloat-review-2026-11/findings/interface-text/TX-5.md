# TX-5 ✓ Every visitor loads the purposes of all known cookies in four languages

Interface text (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.13.
- **Second check:** corrected.
- **Where:** `src/lib/cookie-consent.ts:100`, `src/lib/cookie-consent.ts:156-756`, `src/lib/cookie-consent.ts:756-800`, `src/components/consent/consent-manager.tsx:10`, `src/components/consent/consent-manager.tsx:230`, `src/components/touch-keeper.tsx:5`, `src/components/ab/ab-assign.tsx:5`, `src/lib/cookie-scan.ts:4`, `src/server/site-cookies.ts:9`, `src/lib/storefront-bundle.scan.test.ts:16`, `docs/rules/storefront.md:617-620`
- **Evidence:** cookie-consent.ts (800 lines) holds the small helpers the browser needs and KNOWN_COOKIES: 38 cookies, each with a purpose in en, nb, sv and da. Nine modules in client graphs import the file for its helpers and the table comes with them. Bundled alone the module is 26,573 bytes minified / 7,376 gzip; the purposes are 18,394 / 5,309 of that as JSON. The browser does read the table: consent-manager.tsx:230 matches each cookie's name against the patterns to delete a withdrawn category's cookies. It needs pattern and category, never a purpose: all 38 patterns with their category are 2,171 bytes / 484 gzip. In the build, a Swedish and a Danish cookie purpose are in the first-load chunks of 97 of the 111 routes outside the admin (57 of the 58 storefront routes) and of 96 admin routes; on the store's home 6% of that chunk ran (verified report).
- **Cost today:** About 19 to 21 KB minified / 5.5 KB gzip in the first scripts of every storefront and site page, read only by the cookie page and the admin's cookie scan, both on the server. It grows with every cookie described and every language added. Paid by: A shopper's browser on first load.
- **Saving:** About 19 to 21 KB minified / 5.5 KB gzip per visitor's first load (measured parts: purposes 18.4 KB / 5.3 KB, plus provider, days and flags; the patterns' 2.2 KB stay).
- **Risk:** Low. The one thing that must keep working is removing cookies when consent is withdrawn; cookieCategory() does that from the same patterns, synchronously. A cookie added to one file only fails the type check. Tests that read the old file's text fail loudly until pointed at the new one.

## The fix

1. New src/lib/cookie-patterns.ts, importing only the ConsentCategory type: export const COOKIE_PATTERNS = [{ name: "color_mode_…", pattern: /^color_mode_[0-9a-f-]{36}$/, category: "necessary" }, …] as const, the 38 entries of today's table in today's order with these three fields; export type KnownCookieName = (typeof COOKIE_PATTERNS)[number]["name"]; export const cookieCategory = (name: string) => COOKIE_PATTERNS.find((c) => c.pattern.test(name))?.category ?? null. The 38 names are distinct (checked).
2. New src/lib/known-cookies.ts for the server: const DETAILS: Record<KnownCookieName, Omit<KnownCookie, "name" | "pattern" | "category">> holding provider, days, purpose, on and the flags, moved from cookie-consent.ts lines 156-753; export const KNOWN_COOKIES: KnownCookie[] = COOKIE_PATTERNS.map((c) => ({ ...c, ...DETAILS[c.name] })); move the Texts and KnownCookie types, knownCookie(), cookiePurpose() and declaredCookies() here (lines 100-153 and 756-800). The Record type makes a cookie with a pattern and no purpose, or the reverse, a compile error.
3. src/lib/cookie-consent.ts keeps lines 1-95 (categories, tools, the consent cookie's helpers) and does not re-export the table.
4. Importers: src/components/consent/consent-manager.tsx lines 10 and 230 use cookieCategory(name) from cookie-patterns; src/lib/cookie-scan.ts:4 and src/server/site-cookies.ts:9 import from known-cookies; the tests that name the table (cookie-consent.test.ts, cookie-consent-affiliate.test.ts, cookie-consent-modals.test.ts, referrals.test.ts, redirects.test.ts, withdraw-no-storage.test.ts, components/documents/shopper-documents.test.ts, exchange-shopper.scan.test.ts) import from, or read the text of, the new file.
5. src/lib/storefront-bundle.scan.test.ts: add "lib/known-cookies" to FORBIDDEN (line 16) and a would-notice case that lib/cookie-consent.ts no longer reaches it.
6. docs/rules/storefront.md:617-620 (and the matching line of CLAUDE.md's Storefront list only if its wording names the file for the table): every cookie is listed in COOKIE_PATTERNS with its category and in known-cookies.ts with its purpose.

**Done when:** After a build, none of the 111 routes outside the admin in .next/diagnostics/route-bundle-stats.json has a first-load chunk holding a Swedish cookie purpose (search 'Kommer ihåg om du valde ljusa'; 97 routes today), and storefront-bundle.scan.test.ts passes with lib/known-cookies forbidden.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/cookie-consent.test.ts and the seven other tests in step 4: some import KNOWN_COOKIES, some read the source text of cookie-consent.ts to check that a new storage key is declared (withdraw-no-storage.test.ts, exchange-shopper.scan.test.ts): point them at the new files.
- src/server/cookie-scans.int.test.ts: the scan's knownCookie() path; run pnpm test:int.
- e2e consent specs: withdrawing a category still deletes its cookies.
- Rule kept: D58 (docs/rules/storefront.md:617): every cookie the site sets is listed with category and purpose. The list is now two files held together by the type.

**Notes:** SC-3 (storefront-client) plans the same cut another way: move the whole table to lib/known-cookies.ts and let the consent manager fetch it with import() when a visitor withdraws. That removes about 2 KB more, but deleting cookies then waits on a second download that can fail. The split here keeps deletion in the first scripts for 0.5 KB gzip. Choose one of the two; the file name known-cookies.ts is the same in both so the other steps of SC-3 fit.
