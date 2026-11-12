# TX-3 ✓ A store in an AI-translated language would send the whole catalogue of 1,673 texts in every document

Interface text (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P1. **Effort:** S. **Confidence:** medium. **Step:** 0.8.
- **Second check:** confirmed.
- **Where:** `src/server/ui-text.ts:47-54`, `src/server/ui-text.ts:127-129`, `src/app/s/[store]/[market]/layout.tsx:131`, `src/app/s/[store]/[market]/layout.tsx:160`, `src/components/ui-texts.tsx:17-25`, `src/lib/browser-text.ts:15-19`, `src/lib/returns-text.ts:15-21`, `src/app/s/[store]/[market]/withdraw/page.tsx`, `src/server/languages.int.test.ts:130`
- **Evidence:** loadLanguage() keeps every ui: key of the language for the browser (ui-text.ts:53), the storefront layout passes it to the client component UiTexts (layout.tsx:131 and 160), and UiTexts lays it over browserText('en'), which has 114 keys, keeping the rest only for the withdrawal page's returnsText(). Re-measured from the catalogue: 1,673 keys are 92,809 bytes as JSON at English lengths; the 114 the browser's components read are 5,854 bytes; the withdrawal page's 144 are 10,409 bytes.
- **Cost today:** Nothing today: no store sells in an AI-translated language before opening. From the first store that sells in German, French, Dutch, Finnish or any language but nb, sv, da and en: about 93 KB raw / 25 KB gzip inline in each document its shoppers load, on pages that are 104 to 166 KB now. It is in the page, so the browser does not cache it. Paid by: A shopper's browser in every AI-translated language; the server serialising it.
- **Saving:** About 87 KB raw / 23 KB gzip per document load in such a language (estimate from English lengths); 77 KB on the withdrawal page, which also needs its own keys. Nothing changes for nb, sv, da and en.
- **Risk:** Low. A text left out reads English in the browser only, and the key tests catch a set that drifts. A client component that reads a ui key outside browserText() would already be wrong in the four hand-written languages, and storefront-bundle.scan.test.ts forbids it.

## The fix

1. src/server/ui-text.ts: compute once the key sets BROWSER_KEYS = keys of catalogOf("ui", enBrowser) (import enBrowser from src/lib/messages/en-browser.ts) and RETURNS_KEYS = keys of catalogOf("ui", { returns: enReturns }). In loadLanguage() (lines 47-54) keep two small maps per language in the state: the browser's keys and the withdrawal page's keys. The server's own registry still gets every key.
2. uiTextsFor(lang) (lines 127-129) returns the browser map. Add returnsTextsFor(lang) for the second map; both return null for a hand-written or untranslated language, as now.
3. src/components/ui-texts.tsx: take a prop part ("browser" by default). Remember the version per language and part. For part "browser" register ui as today and merge texts into what the registry holds (registerMessages(lang, { ui, texts: { ...registeredTexts(lang), ...texts } })); for part "returns" merge texts only and leave ui alone.
4. src/app/s/[store]/[market]/withdraw/page.tsx: draw <UiTexts lang={market.lang} texts={returnsTextsFor(market.lang)} part="returns" /> before the withdrawal flow, so returnsText() (src/lib/returns-text.ts:19) still finds its words in the browser.
5. Tests: a unit test beside src/lib/ui-catalog.test.ts that every key of BROWSER_KEYS and RETURNS_KEYS exists in fullCatalog(). In src/server/languages.int.test.ts, lines 123-131 and 176: the key it looks up in uiTextsFor("de") must be one the browser reads (take it from catalogOf("ui", enBrowser)), and add that a server-only key is not in the prop and that returnsTextsFor("de") holds a returns key.
6. docs/performance.md:52-60 (D212) and docs/rules/storefront.md:40-71: add that a language translated by AI sends the same few texts as a hand-written one, and the withdrawal page its own.

**Done when:** The new assertion in src/server/languages.int.test.ts passes: for a language with every key translated, uiTextsFor(lang) holds exactly the 114 browser keys and its JSON is under 9,000 bytes (92,809 for the English stand-in today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/languages.int.test.ts:123-131 and 176 assert on uiTextsFor("de"); they change with step 5.
- src/lib/ui-catalog.test.ts holds the catalogue's rules (HAND_WRITTEN_ONLY, CHOOSING); a hand-written-only key is never in either set because catalogOf() leaves it out.
- Rule kept: D212 (a visitor's browser gets only the texts its client components read) and D111. The sentence in docs/performance.md:60, 'UiTexts, which also keeps them for returnsText()', changes to name the withdrawal page.
- By hand in a browser, in a translated language on a test database: a gallery label, the cart's quantity words and the withdrawal page read the translation.

**Notes:** The same change as SC-13 (storefront-client) and PL-9 (page-payload); do it once. It is not an argument about the feature and does not rest on the empty table: it is what each of the feature's users would pay per page. Do it before the first store opens in such a language; it shares its file with TX-6 and TX-12.
