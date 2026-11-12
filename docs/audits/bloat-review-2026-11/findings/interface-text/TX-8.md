# TX-8 ✓ A shopper's scripts carry the admin's shared words, and three browser languages they do not read

Interface text (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 0.16.
- **Second check:** confirmed.
- **Where:** `src/lib/browser-text.ts:1-15`, `src/components/buyer.tsx:6`, `src/lib/b2b.ts:13`, `src/lib/store-features.ts:14`, `src/lib/store-features.ts:240-249`, `src/lib/store-features.ts:466`, `src/lib/owner-tool-features.ts:149`, `src/server/bookings.ts:184`, `src/server/products.ts:834`, `src/server/setup-tools.ts:153`, `src/components/admin/page-builder.tsx:5619`, `src/lib/storefront-bundle.scan.test.ts:16`, `docs/performance.md:52-60`, `docs/performance.md:112-117`
- **Evidence:** store-features.ts imports the admin's common.en by value (line 14) only as the default argument of three label functions: requirementLabel (240), featureOffText (246) and needWords (466). b2b.ts imports store-features.ts (line 13) and buyer.tsx imports b2b.ts, so common.en (6.2 KB minified, 2.4 KB gzip) reaches every storefront page. My client graph: 10 visitor client entries reach common.en through b2b.ts and store-features.ts; with the import gone, the only visitor client code that reaches an admin catalogue is the platform's sign-up wizard, through admin-text-context.tsx, which the docs describe. In the build common.en's sentence 'is switched off under Settings' is in the first-load chunks of 97 of the 111 routes outside the admin, 57 of the 58 storefront routes among them. Eight callers lean on the English default: owner-tool-features.ts:149, bookings.ts:184, products.ts:834, setup-tools.ts:153 and 206, page-builder.tsx:5619, hosts/actions.ts:14 and deliveries/actions.ts:16. browser-text.ts imports nb, sv, da and en together: 25.9 KB minified / 7.1 KB gzip where one language is 6.1 to 6.9 KB.
- **Cost today:** 6 KB minified (2.4 KB gzip) of admin words per shopper today. The three other browser languages are about 19.5 KB minified / 4.6 KB gzip, and each further hand-written language adds about 6.4 KB. Paid by: A shopper's browser on first load.
- **Saving:** About 6 KB minified / 2.4 KB gzip per shopper's first load. The language step, if ever done, about 19.5 KB minified / 4.6 KB gzip.
- **Risk:** Low. The move changes import paths only; a missed importer does not compile. The language step has a known risk the docs record (loading the page's language separately once lost a press, e2e/gallery.spec.ts) and is not proposed now.

## The fix

1. New src/lib/feature-labels.ts holding requirementLabel(), featureOffText() and needWords() as they are, with their import of commonEn and countWords. Remove them and the import at line 14 from src/lib/store-features.ts (keep requirementMet and the rest).
2. Change the importers: src/lib/owner-tool-features.ts, src/lib/feature-words.ts:205, src/server/bookings.ts, src/server/products.ts, src/server/setup-tools.ts, src/server/store-features.ts:250, src/components/admin/feature-off-text.tsx, src/components/admin/page-builder.tsx:5619, and the admin actions hosts/actions.ts, deliveries/actions.ts, deals/actions.ts, deals/activity-actions.ts and settings/localization/actions.ts; src/lib/store-features.test.ts:79 imports requirementLabel from the new file.
3. src/lib/storefront-bundle.scan.test.ts: forbid every file of lib/admin-messages for a visitor's client entry unless the chain passes components/admin/admin-text-context (the sign-up wizard, docs/performance.md:112-117); add a would-notice case that lib/b2b.ts reaches no admin catalogue.
4. Leave the four browser languages together. That is a written, tested decision (D212, docs/performance.md:52-60). Revisit only when a fifth hand-written language is added, and then send one language's file as its own script placed before the page's scripts.

**Done when:** After a build, no storefront route (/s/...) in .next/diagnostics/route-bundle-stats.json has a first-load chunk holding common.en's sentence 'is switched off under Settings' (57 of 58 today), and the extended storefront-bundle.scan.test.ts passes. Kaizena Flow's sign-up and status pages keep the admin's shared words by design.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/store-features.test.ts:79 (requirementLabel).
- src/lib/storefront-bundle.scan.test.ts gains the rule of step 3.
- e2e/performance.spec.ts: lower the visitor's script budget by what the build then measures.
- Rule kept: D212 for the browser languages; docs/performance.md:112-117 for the sign-up wizard's common words. Add one sentence to docs/performance.md, The rules: admin words are not a visitor's scripts.

**Notes:** Small alone; do it in the same push as TX-5 and SC-3. SC-3 step 2 cuts the same chain from the other end (b2b.ts stops importing store-features.ts, which also takes the features table out of shoppers' scripts). Do both: SC-3's cut removes more bytes, and this one stops any later import of store-features.ts from bringing admin words with it.
