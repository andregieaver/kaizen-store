# FT-7 ✓ What a new owner sees: 29 links in Basic, 94 in Advanced, 35 under Settings. A product question, mostly planned already

The product's surface (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P2. **Effort:** M. **Confidence:** high. **Step:** your choice. **The owner's choice.**
- **Second check:** corrected.
- **Where:** `src/lib/store-nav.ts:58`, `src/lib/admin-view.ts:14`, `src/lib/store-nav.test.ts:245`, `src/components/admin/section-hub-cards.tsx:27`, `docs/admin-navigation.md:148`, `docs/audits/admin-usability-2026-11.md:197`, `docs/audits/code-review-2026-11.md:84`, `src/lib/platform-nav.ts:68`
- **Evidence:** Parsed from store-nav.ts (re-run by me): 110 links, 42 marked for Basic. With only the shop on: 29 in Basic, every account's default (admin-view.ts:14), and 94 in Advanced (Marketing 13, Analytics 13, Website 13, Settings 35). The two hub pages follow the view as the sidebar does (section-hub-cards.tsx:27). Settings has 50 page files. The doc still says 104 and 40 (admin-navigation.md:148). The cap test covers Basic only (store-nav.test.ts:245-253); the total has no ceiling. The platform has 52 links, 27 under Settings, and no Basic view. I looked for screens nothing links to and found none: each of the 288 admin screens with a fixed address is named outside its own folder, and 2 of 560 pages only redirect.
- **Cost today:** Reading time for an owner in Advanced, and for the platform's operator, on every visit. No shopper cost. The admin's shell carries the whole menu on each response, which the admin-data dimension measures. Paid by: An owner's admin in Advanced view, and the platform operator's
- **Saving:** Estimate from the planned moves: Advanced for a new shop from 94 to about 85 links, Settings from 35 to about 20. No running-cost saving.
- **Risk:** Moves need redirects and ADMIN_PAGES entries kept, or the AI manager and old links open a 404; admin-map.test.ts walks the routes and would show a missing entry.
- **Already tracked:** docs/audits/admin-usability-2026-11.md phase 2 and code review steps 2.3 (Open), 2.4 (Open), 2.5 (Open), 4.3 (Open), 4.6 (Open). Only the ceiling on the total is new.

## The fix

1. This is the owner's choice of what Homer and Lisa see, not waste. Do the agreed work as tracked: code review step 2.4 (the audit's phase 2 moves: settings into their sections, Campaigns and Coupons as one Discounts page, Workflows and Automation as one, docs/audits/admin-usability-2026-11.md:197-200), step 2.3 (Basic and groups for the platform and the account), step 4.3 (generate docs/admin-navigation.md from src/lib/store-nav.ts).
2. New and small: hold the total per section in the surface budget of FT-2 (the counter reads STORE_SECTIONS), so Advanced cannot grow unseen as Basic cannot.
3. Each move keeps the old address working (a redirect) and its ADMIN_PAGES entry, as the audit says.

**Done when:** After step 2.4, the parser of src/lib/store-nav.ts gives at most 85 links in Advanced and at most 20 under Settings for a store with only the shop on, and the generated docs/admin-navigation.md states the same counts.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/store-nav.test.ts (the Settings group's Basic labels are listed by name at lines 255-267; the Account group's order at line 234), src/lib/admin-map.test.ts (the map and the menu name the same pages), src/lib/platform-nav.test.ts, src/lib/admin-view.test.ts.
- Rules: the Homer and Lisa rule (CLAUDE.md Conventions), D454 (Basic hides links, never pages), docs/admin-navigation.md and docs/admin-style.md.

**Comes after:** FT-2 (the budget that holds the totals); FT-8 (Workflows and Automation as one); Code review steps 2.3, 2.4 and 4.3

**Notes:** A new owner meets 29 links, not 94: Basic is the default. What Basic lists first is the owner's product question (the clarification), so nothing here argues from use.
