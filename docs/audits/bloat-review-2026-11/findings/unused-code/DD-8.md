# DD-8 ✓ Three files only tests reach, and a rule that still describes one of them

Code nothing uses (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** dead. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 0.36.
- **Second check:** confirmed.
- **Where:** `src/components/inline-edit/heading-editor.tsx:12`, `src/components/inline-edit/inline-edit.test.ts:5`, `src/components/admin/page-builder.tsx:3281`, `src/components/inline-edit/site-editor.tsx:190`, `docs/rules/admin/website.md:302`, `src/components/admin/work/coming-soon.tsx:10`, `src/components/admin/work/work-pages.test.ts:251`, `src/lib/admin-messages/work.en.ts:44`, `src/lib/admin-messages/work.nb.ts:40`, `src/lib/store-modules.ts:7`, `src/db/commerce.test.ts:3820`, `docs/work.md:1365`
- **Evidence:** InlineHeadingEditor (143 lines) is rendered only by inline-edit.test.ts (41 lines, three cases, all about it); the builder and the live-site editor both use InlineMarkupEditor (page-builder.tsx:3281, site-editor.tsx:190). The rule at docs/rules/admin/website.md:302 still names InlineHeadingEditor, twice, as the heading's editor. WorkComingSoon (17 lines) stands in for Work pages 'built in a later step'; no page uses it, one test case does (work-pages.test.ts:251); its words off.comingSoon and off.backToWork are read only by it (work-off.tsx reads isOff, switchOn, kept and titles; the settings page reads another backToWork). store-modules.ts (11 lines): MODULES is read by one test (commerce.test.ts:3820), isModule and StoreModule by nothing; docs/work.md:1365 names the file.
- **Cost today:** 171 lines of source, a 41-line test and two test cases, and one rule that sends a reader or an agent to an editor nobody uses. Paid by: Agents and people who follow the rule before touching in-place editing.
- **Saving:** About 230 lines (171 of source, 41 of test, about 20 of test cases and words; measured).
- **Risk:** Low. A page that still imported one of the three would fail the type check. The rule edit is the part that matters: after it, an agent reading the rule opens the editor the product uses.

## The fix

1. Delete src/components/inline-edit/heading-editor.tsx and src/components/inline-edit/inline-edit.test.ts. cleanHeadingText() in src/lib/inline-edit.ts stays: markup-editor.tsx and /api/platform/editor/text use it.
2. docs/rules/admin/website.md:302: replace both mentions of InlineHeadingEditor (src/components/inline-edit/heading-editor.tsx) with InlineMarkupEditor (src/components/inline-edit/markup-editor.tsx), and restate from that file's header what holds for a heading today (one line, a paste is plain text held by cleanHeadingText(), Escape puts back what it was).
3. Delete src/components/admin/work/coming-soon.tsx, its import and case in src/components/admin/work/work-pages.test.ts (lines 8 and 251 on), and the keys off.comingSoon and off.backToWork in src/lib/admin-messages/work.en.ts (lines 44-45) and work.nb.ts (lines 40-41). First confirm with rg -n "off\.backToWork|words\.backToWork" src that coming-soon.tsx is the only reader.
4. Delete src/lib/store-modules.ts. In src/db/commerce.test.ts drop the import (line 9) and write the three names in the loop at line 3820 as a literal. Correct docs/work.md:1365.
5. pnpm lint, typecheck and test; node scripts/unused.mjs if DD-4 is in (the three files leave testOnlyFiles).

**Done when:** rg -n -w "InlineHeadingEditor|WorkComingSoon|store-modules" src docs --glob '!docs/audits/**' prints nothing, and pnpm typecheck and pnpm test pass.

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/inline-edit/inline-edit.test.ts: deleted whole. e2e/inline-edit-hosts.spec.ts and e2e/signed-in/text-styles.spec.ts drive the real editors and are not touched.
- src/components/admin/work/work-pages.test.ts:251 and the catalogue parity tests (English and Norwegian must hold the same keys: delete in both).
- src/db/commerce.test.ts:3817-3824 (the stores_modules check stays tested by its rejects line).
- Rules: docs/rules/admin/website.md:302 (corrected); docs/work.md:1365.
