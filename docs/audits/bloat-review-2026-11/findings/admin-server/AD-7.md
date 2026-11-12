# AD-7 ✓ The products list reads the whole editor context and a per-product check it does not need

What the server does for an admin navigation (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.15.
- **Second check:** corrected.
- **Where:** `src/app/admin/(gated)/[store]/products/page.tsx:90-96`, `src/app/admin/(gated)/[store]/products/page.tsx:105-106`, `src/app/admin/(gated)/[store]/products/page.tsx:115`, `src/server/products.ts:126-157`, `src/server/products.ts:198-200`, `src/server/vat-categories.ts:44-52`, `src/server/unit-price-gaps.ts:61-91`
- **Evidence:** For a member who may edit, the list calls getEditorContext(): 10 statements in one batch (economic operators, two location reads, terms, the VAT matrix, booking staff, places, hosts, layouts, VAT categories), then 3 more one after another while the object is built (the store's AI provider, shipping profiles, market price rules; lines 198-200). The page uses terms and three fields of markets that are already in the cached store (lines 105-106). ratesNow() calls commerce.vat_rate() for every country and category and the result is dropped. productsNeedingMeasure() returns titles, categories (a recursive query) and SKUs for every active product that passes commerce.unit_price_required(), a function call per product, while the default view uses only the count (line 115).
- **Cost today:** 12 or more unused statements per products-list view for editors, 3 of them sequential after the batch, one a function call per country and category; one function call per active product per view for a notice's number. The list streams in only when the slowest chain is done. Paid by: The database and the server per view; the owner waits for the context's four rounds before the list appears.
- **Saving:** Estimate: 16 or more statements down to 4 per view for an editor (products, the notice's count, terms, import jobs), and three sequential waits gone.
- **Risk:** Low. The bulk panel needs only terms and markets. What could break: the notice's number disagreeing with its list (the int test compares them), or the early return hiding a product marked by itself (the exists covers both the product's own mark and a category's).
- **Already tracked:** no (the list's missing paging is code review step 1.13, see AD-10)

## The fix

1. src/app/admin/(gated)/[store]/products/page.tsx:94: replace getEditorContext(store) with listTerms({ storeId: store.id, contentType: "product" }) (the same call products.ts:141 makes) and build the bulk panel's markets from store.markets (code, name, currency: lines 105-106 need nothing else).
2. src/server/unit-price-gaps.ts: add countProductsNeedingMeasure(storeId): return 0 at once when the store has no product marked sold_by_measure and no category marked requires_unit_price (one cheap exists), else count the products the present query would return, without titles, categories or SKUs. Read it through typedRows().
3. src/app/admin/(gated)/[store]/products/page.tsx:92 and 115: use the count for the notice and the tab; call productsNeedingMeasure() only when ?needs=unit-price is asked (line 151 needs the rows).
4. Leave getEditorContext() itself alone: the product editor needs all of it. Its three sequential awaits (products.ts:198-200) can join the Promise.all when the editor is next touched.

**Done when:** rg -c getEditorContext 'src/app/admin/(gated)/[store]/products/page.tsx' prints nothing (1 today), and AD-12's counter shows the products list at 5 statements or fewer for an editor on the default view (16 or more today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/unit-price.int.test.ts (productsNeedingMeasure): add the count and that it equals the list's length for the seeded cases, including a category marked after products were assigned.
- e2e/signed-in/products-bulk.spec.ts (the bulk panel's categories, tags and markets still offered), e2e/signed-in/products-grid.spec.ts.
- src/server/products.int.test.ts and store-features-selling.int.test.ts (listAdminProducts, unchanged).
- src/server/ratchet.scan.test.ts (the new count is a checked read).
- Rule kept: docs/wave-1d-unit-price.md and D160 (the notice and its filter stay; only what is read for the number changes).

**Comes after:** AD-12 step 1 (the statement counter, for the check only)

**Notes:** The skeptic raised the counts (the auditor missed the three awaits inside the returned object). Small, safe, and on one of the most opened pages of a selling store.
