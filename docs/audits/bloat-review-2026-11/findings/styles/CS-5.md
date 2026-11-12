# CS-5 ✓ Layout-level style sheets are carried three times in each store document

Styles (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P3. **Effort:** S. **Confidence:** medium. **Step:** 2.1.
- **Second check:** corrected.
- **Where:** `src/app/s/[store]/[market]/layout.tsx:104`, `src/app/s/[store]/[market]/layout.tsx:164`, `src/components/store-theme.tsx:25`, `src/components/custom-css.tsx:15`, `src/lib/custom-css.ts:19`, `node_modules/next/dist/server/app-render/create-component-tree.js:551`, `node_modules/next/dist/server/app-render/create-component-tree.js:659`
- **Evidence:** Theme variables, breakpoint classes, text styles, the store's own CSS and the header's and footer's CSS are <style href precedence> elements drawn by the layout (layout.tsx:164-170): inline in every document, once in the HTML and once in the payload. In store documents each is there a third time: the theme sheet's href is 3 times in store-home.html and 2 times in Kaizena Flow's front page. The cause, which the verified report left open, is in Next's source: a root layout with a children slot and one more slot is wrapped in a boundary whose not-found fallback is the layout drawn again (create-component-tree.js:551 and 657-668; its comment says it 'renders the RootLayout twice'). The market layout has the cart drawer's slot (layout.tsx:104). With the real functions: a launch theme's layout-level sheets are 6.6-9.5 KB (theme variables 1.4-1.5 KB, breakpoint sheet 1.8 KB, the theme's own CSS 3.4-6.3 KB), so 20-28 KB per document in three copies.
- **Cost today:** For a store on a launch theme, 6.6-9.5 KB raw per document for the copy nobody needs (estimate from measured parts); about 0.1-0.3 KB Brotli. Paid on full page loads only: client navigations inside a store do not resend the layout. The ceiling is five sheets of 50,000 characters, each three times. Paid by: A shopper's browser on every full page load; the CDN and function, which store and send larger documents.
- **Saving:** From SC-8, not from this finding: 6.6-9.5 KB raw per document for a launch-theme store (estimate), about 0.1-0.3 KB Brotli. The draft's 20-28 KB raw and 1.5-2.5 KB Brotli assumed an external sheet and a warm cache; on a first visit that saving is zero or negative.
- **Risk:** None of its own. The risk of moving the slot is SC-8's.

## The fix

1. Nothing of its own for the third copy: it goes when the storefront-client plan's SC-8 moves the cart drawer's slot off the root layout (the same finding as PL-2 and PM-1). Do not build a second fix here.
2. Keep the layout-level CSS inline. Write the reason into docs/performance.md (the 'Styles' part of CS-3): an external per-store sheet trades about 2 KB of inline Brotli for one more render-blocking request on a first visit and helps only repeat full loads.
3. Watch it with CS-3's inline-style budget, and add one line to docs/performance.md: look again at an external, hashed, immutable sheet (the href's hash already exists) when real stores' layout-level CSS commonly passes about 10 KB.
4. After SC-8, lower the count in CS-3 step 2 and note the theme sheet's count (2) in docs/performance.md.

**Done when:** After SC-8, the theme sheet's href (theme-<store id>-) appears 2 times in /s/demo/no's HTML (3 today).

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/performance.spec.ts: CS-3's inline-style budget is the check.
- e2e/custom-css.spec.ts and src/lib/theme.test.ts hold what the sheets say; nothing changes for them.
- Rule D100 (docs/decisions.md:111): the owner's CSS comes after the theme and wins. Kept: nothing moves.

**Comes after:** SC-8 (storefront-client plan: the cart drawer's slot leaves the root layout); CS-3

**Notes:** P3 because it needs no work of its own now: the duplicate is removed by SC-8 and the growth is watched by CS-3. The planner settled the open cause by reading Next's source, which SC-8's plan had already cited. What grows after opening: owners' own CSS and themes; the budget and the 10 KB line say when to look again.
