# PF-6 ✓ Each row of an admin list fetches the same shell again

Prefetching: what the router asks for unasked (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** 0.10.
- **Second check:** confirmed.
- **Where:** `src/components/admin/products-bulk.tsx:259`, `src/components/admin/ui/list.tsx:28,51`, `src/components/admin/ui/card.tsx:82`, `src/components/admin/ui/button.tsx:79-85`, `src/components/admin/ui/page-header.tsx:37`, `src/components/admin/ui/focus-frame.tsx:36,47`, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/partialPrefetching.md:38-55`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/prefetch.md:39-45`, `node_modules/next/dist/docs/01-app/02-guides/adopting-partial-prefetching.md:67-79`
- **Evidence:** The skeptic's measure on the product list with four rows: 8 requests, four identical route trees (741 B) and four identical page answers (9,746 B each); the answer has no product in it, only the editor's shell. The rows are <Link>s in products-bulk.tsx:259; most other lists go through the shared primitives ListRow and RowLead (ui/list.tsx:28, 51; 114 uses in 88 files, counted here), the card tile (ui/card.tsx:82) and ButtonLink (ui/button.tsx:81; 107 uses). Next's docs name the case: with Partial Prefetching the App Shell is shared across every link to a given route, regardless of dynamic params (adopting-partial-prefetching.md:79).
- **Cost today:** Two requests and about 10.5 KB decoded per row in view, all copies. A list of 25 rows in view would make 50 requests and about 260 KB (estimate by multiplication). Repeated after every refresh or save (PF-5). Paid by: The owner's browser; the CDN. It grows with real catalogues, order lists and customer lists.
- **Saving:** Measured: 8 requests and 42 KB decoded on a four-row list; in proportion on longer lists.
- **Risk:** Low. A row press may show the pending state for one round trip; the same trade as PF-5.

## The fix

1. src/components/admin/ui/list.tsx:28 (ListRow) and :51 (RowLead), src/components/admin/ui/card.tsx:82, src/components/admin/ui/page-header.tsx:37 and src/components/admin/ui/focus-frame.tsx:36, 47: use AdminLink (PF-5), policy intent.
2. src/components/admin/ui/button.tsx:79-85: ButtonLink renders AdminLink; a caller's prefetch={false} (src/app/admin/(gated)/platform/capacity/page.tsx:55) becomes policy none.
3. src/components/admin/products-bulk.tsx:259: the product row's link through AdminLink. The other lists that draw raw <Link> rows move as PF-10's ratchet makes them.
4. e2e/signed-in/prefetch.spec.ts (PF-5): add 'a list's rows wait to be pointed at': the product list with its seeded rows makes 0 router prefetch requests for a product's editor in the 3 s after load (8 today on four rows).
5. With PF-9's spike: try export const prefetch = 'partial' on the admin's gated store layout, so the rows of a list share one shell even when fetched.

**Done when:** e2e/signed-in/prefetch.spec.ts 'a list's rows wait to be pointed at' passes: 0 router prefetch requests for product editors after the product list loads (8 on a four-row list today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/admin/ui/ui.test.ts renders the primitives: run it; the anchors come out the same.
- D227 (a table that is a list of records is a list in a card, the row opens the thing): the row stays one link.
- The three documentPrintHref links and the capacity CSV keep prefetch off (they are files, not pages).

**Comes after:** PF-5

**Notes:** Four primitives carry most of the admin's 947 links' rows and buttons, so this is a small change with a wide reach. Do it in the same change as PF-5.
