# PF-2 ✓ Every page of a store with several languages, currencies or countries prefetches the home page of each other view, and for languages and currencies the press does not open it

Prefetching: what the router asks for unasked (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.10.
- **Second check:** corrected.
- **Where:** `src/components/view-menu.tsx:50-76`, `src/components/store-layout.tsx:207-221,236,419,531,537`, `src/components/site-parts.tsx:184-208`, `src/server/shop.ts:93-101`
- **Evidence:** The standard footer lists the view choices as <Link>s to each view's front page (LocaleChoice as a list at store-layout.tsx:531, countries at 537; a built header's or footer's Countries part at site-parts.tsx:184-208). Each is prefetched when it comes into view: 3 requests a link, the other view's layout (55 KB decoded), its home page (29 KB) and the drawer slot's default (0.6 KB). Re-measured by the planner on the demo store's home page read to the footer on a phone: 8 links, 24 of 47 requests, 662.0 of 729.3 KB decoded, 135.4 of 204.0 KB on the wire; the built /products page shows the same 24 of 48. For the 6 language and currency links the press handler cancels the link and pushes the current page in the chosen view (view-menu.tsx:62-72), so the prefetched home page is used only on the home page. The 2 country links have no handler and do open what was fetched. Only the template store's views are built ahead (shop.ts:93-101), so on a real store the first prefetch of a view renders its layout and home page (75 to 78 ms cold per the skeptic), and again when stale (s-maxage 900).
- **Cost today:** Per page view that reaches the footer: 24 requests and 662 KB decoded in the browser, 24 proxy runs, and up to 8 server renders of pages nobody opened when the cache is cold or stale. A built header that shows the Countries part as a list pays it at the top of every page. On a store host each link also asks for its route tree: about 32 requests (the skeptic's estimate from the mechanism). Paid by: The shopper's browser and data plan; the proxy and the server per request. Only stores with Several languages, Several currencies or several countries pay, but every page view of theirs does, whether or not a shopper ever switches. It grows with stores times views.
- **Saving:** Measured: 24 of 47 requests, 662 of 729 KB decoded and 135 of 204 KB on the wire on the home page read to the footer; the same on every page whose footer is seen. Up to 8 fewer cold or stale renders per visit to a quiet store.
- **Risk:** Low. Changing language, currency or country waits for one round trip; it is a rare press. A failure would show as a language or country spec that no longer lands on the other view.

## The fix

1. src/components/view-menu.tsx:56: add prefetch={false} to the <Link>. Keep the href (the no-script fallback) and the onClick handler.
2. src/components/store-layout.tsx:236 (MarketChoice), 419 (the phone menu's countries) and 537 (the footer's countries): add prefetch={false}.
3. src/components/site-parts.tsx:190 (a built header's or footer's Countries list): add prefetch={false}.
4. e2e/prefetch.spec.ts (from PF-1): add 'no other view is fetched ahead': a phone (390x844) loads /s/demo/no and scrolls to the footer at a reader's pace; expect no router prefetch request whose path is /s/demo/no-sv, -da, -en, -sek, -dkk, -eur, /s/demo/dk or /s/demo/se (24 today), and at most 23 in all (47 today).

**Done when:** e2e/prefetch.spec.ts 'no other view is fetched ahead' passes: 0 router prefetch requests for another view (24 today) and at most 23 in all on the phone home page read to the footer (47 today).

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/localization.spec.ts, e2e/language-switcher.spec.ts, e2e/marketless.spec.ts, e2e/country-content.spec.ts and e2e/navigation.spec.ts press these links: they must still pass (the press is unchanged; only the fetch ahead goes).
- D109 (language and currency as links that keep the page) and D479 (the language remembered at the door): the href, the handler and the cookie stay.
- No written rule asks for these links to be prefetched.

**Comes after:** PF-1

**Notes:** Once PF-3's wrapper exists the two country links may move from none to intent, since their press opens what was fetched; languages and currencies stay at none because their press goes elsewhere. Depends on PF-1 only for the shared spec file and for counts taken with route guessing off.
