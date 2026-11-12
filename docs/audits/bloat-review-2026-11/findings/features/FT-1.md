# FT-1 ✓ Most features have no switch; adding more is a product choice, because a switch saves almost no running cost

The product's surface (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P3. **Effort:** S. **Confidence:** high. **Step:** tolerated. **The owner's choice.**
- **Second check:** corrected.
- **Where:** `src/lib/store-features.ts:16`, `src/lib/store-features.ts:8`, `src/lib/store-nav.ts:388`, `src/lib/owner-tool-features.ts:13`, `src/lib/admin-view.ts:14`, `src/server/owner-assistant.ts:733`, `src/server/bonus.ts:550`
- **Evidence:** The registry has 14 ids, 13 optional. Of 110 store links, 16 stand behind an optional switch, 1 behind shop-or-Deals, 40 behind 'shop' and 53 behind none (my re-run of the parser). Of 254 AI tools, 20 stand behind an optional switch, 101 behind 'shop' and 133 behind none. What an unswitched feature costs a store that does not use it: in the navigation its links are in Advanced unless marked basic, and Basic is the default (29 links for a shop-only store); in an AI round nothing more, because a round is cut to 124 definitions either way (FT-4); in scheduled work one or a few statements per job for the whole platform (FT-3); in the build and CI no switch changes anything. The one per-request cost I found is not cured by a switch either: Bonus and Referrals have switches and the cart still asks about them (FT-15).
- **Cost today:** For an owner in Advanced: 94 links in a shop-only store. In run time: close to nothing per store. Paid by: An owner's admin in Advanced view
- **Saving:** None in running cost. The earlier 'up to 100,406 lines, 41,575 test lines and 146 tables' is withdrawn: it argued from features being unused before opening.
- **Risk:** More switches make the Features page longer and add one more thing to keep in step for every feature (navigation, map, tools, SQL). None from writing the paragraph.

## The fix

1. Do not add a second tier of switches to remove bloat: it would not lower a running cost. Write that down in docs/store-features.md in one paragraph: switches are for what an owner sees and what shoppers can do, not for cost; where a feature costs a store that does not use it, the fix is at the read (as FT-15), and the surface budget (FT-2) asks each new feature for its idle cost.
2. When the owner wants one more feature switchable, follow the checklist already written at src/lib/store-features.ts:8-10: the registry entry with its needs, the stores_features check and commerce.feature_needs() in a migration, blockers and warnings in feature-words.ts with a count in FeatureFacts, `feature` on its navigation items and ADMIN_PAGES entries, TOOL_FEATURES for its tools, and the switch in the SQL of its scheduled job.
3. Never set a new switch from 'the store has a row': before opening that says nothing. A new switch starts off for new stores (NEW_STORE_FEATURES) and on for the team's stores that use the feature.

**Done when:** docs/store-features.md carries the paragraph; no code changes.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/store-features.test.ts (needs are complete), src/db/store-features.test.ts (the database repeats the needs), src/lib/store-nav.test.ts and src/lib/admin-map.test.ts (navigation and map carry the same feature), src/server/store-features*.int.test.ts (six files), src/lib/owner-tool-permissions.test.ts.
- Rule: D178 and docs/store-features.md; switching off deletes nothing.

**Notes:** P3 because it is true but not bloat: a switch is a product decision. Not worth doing now for cost; worth a line in the doc so the next review does not propose it again.
