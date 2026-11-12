# PL-9 ✓ A store in an AI-translated language will carry the whole interface catalogue in every document

What a page sends: document, payload and requests (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P1. **Effort:** S. **Confidence:** medium. **Step:** 0.7.
- **Second check:** corrected.
- **Where:** `src/server/ui-text.ts:47`, `src/server/ui-text.ts:53`, `src/server/ui-text.ts:127`, `src/app/s/[store]/[market]/layout.tsx:131`, `src/app/s/[store]/[market]/layout.tsx:160`, `src/components/ui-texts.tsx:17`, `src/lib/ui-catalog-all.ts:6`, `src/lib/returns-text.ts:15`, `src/lib/messages/en-browser.ts:6`
- **Evidence:** Only nb, sv, da and en are written by hand (ui-catalog-all.ts:6). For any other language loadLanguage() keeps every stored text that is not an email (ui-text.ts:47-54), uiTextsFor() returns that whole map (line 127), and the layout hands it to the UiTexts client component as a prop (layout.tsx:131, 160). The browser lays it over only its own subset (browserText, ui-texts.tsx:21) and keeps the rest for one reader, the withdrawal function (returns-text.ts:15-20). Sizes read in this pass: the English source is 95,362 bytes (src/lib/messages/en.ts); the browser's own files are 8,659 (en-browser.ts) and 9,480 bytes (en-returns.ts). Not measured in a document: the demo is Norwegian (the prop is null in both layout copies) and no translated language exists yet. That is not the argument: selling EU-wide in German, French or Finnish is what the product is for, and each such store will pay this on every page. The prop will be in the payload once, not twice: both layout copies are handed the same object.
- **Cost today:** Estimate: about 100 KB raw (roughly 30 KB gzipped) in every document of every store in a language without hand-written text. Nothing until such a store exists; then it is as large as the rest of the document. Paid by: A shopper's browser on every page of such a store; the server per render.
- **Saving:** Estimate: about 85% of the prop, some 80 KB raw (about 25 KB gzipped) per document of a store in a translated language. Nothing changes for nb, sv, da and en.
- **Risk:** Low: a client component that reads a key outside the browser set shows English; the same would already be wrong for the hand-written languages, whose browser files are that set.

## The fix

1. src/server/ui-text.ts: compute once the key set the browser reads: the keys of catalogOf('ui', enBrowser) (src/lib/ui-catalog.ts:201, src/lib/messages/en-browser.ts) and, apart, of catalogOf('ui', { returns: enReturns }). In loadLanguage() (lines 47-54) keep, beside the whole map the server's registry uses, a browser map with only the first set's keys and a returns map with only the second's. uiTextsFor(lang) returns the browser map; add returnsTextsFor(lang).
2. src/components/ui-texts.tsx: let registrations add to one another. Take a prop part ('browser' by default), remember the version per language and part, merge the texts into what the registry already holds for the language, and build the ui overlay only for the browser part.
3. src/app/s/[store]/[market]/withdraw/page.tsx: draw a second UiTexts with returnsTextsFor(market.lang) and part 'returns' before the withdrawal flow, so returnsText() (returns-text.ts:15-20) still finds the function's words in a translated language.
4. Tests: a unit test (new src/server/ui-text.test.ts or in src/lib/ui-catalog.test.ts) that for a language with every key translated uiTextsFor() holds exactly the browser keys and no other (for instance not 'ui:storeSummary'). An integration case beside src/server/languages.int.test.ts: after a language is generated the prop holds no server-only key. Extend src/lib/storefront-bundle.scan.test.ts's idea to the prop: a test fails if uiTextsFor() returns more keys than the browser set.
5. By hand in a browser, in a translated language on a local store: a client component's words (the gallery's labels, the quantity words) and the withdrawal page read that language.
6. docs/performance.md:52-60 (D212): add that a language translated by AI sends the same few texts, and the withdrawal page its own.

**Done when:** The new unit test passes: for a language with every key translated, JSON.stringify(uiTextsFor(lang)) is under 12,000 bytes and holds only keys of the browser set (today it holds every text that is not an email: about 95 KB by the English source's size).

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/ui-catalog.test.ts, src/server/languages.int.test.ts, src/server/ui-nightly.int.test.ts.
- src/lib/storefront-bundle.scan.test.ts:107-111 (browser-text and returns-text stay clear of whole languages).
- e2e/gallery.spec.ts (the reason texts are there with the first scripts, D212).
- src/lib/withdraw-no-storage.test.ts and the withdraw actions' integration test (the withdrawal page stores nothing in the browser: UiTexts keeps its texts in memory only).
- Rules D111 (the catalogue) and D212 (docs/performance.md:52-60: the browser has only the texts its components read). The fix makes the translated path follow D212.

**Notes:** Same finding and fix as SC-13 (storefront-client); one change. Costs nothing today, which is why no measurement could see it. Do it before the first store opens in such a language: afterwards every one of its page views carries the catalogue.
