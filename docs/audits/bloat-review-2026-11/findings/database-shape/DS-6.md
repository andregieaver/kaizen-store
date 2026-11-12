# DS-6 ✓ Kaizena Flow's own site and tools are kept more than one way: null-store rows, platform_* twin tables, and a copy in its own store

The database's shape (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P1. **Effort:** L. **Confidence:** medium. **Step:** 3.9. **The owner's choice.**
- **Second check:** corrected.
- **Where:** `docs/platform-parity-plan.md:32-35`, `docs/platform-parity-plan.md:112-118`, `docs/platform-parity-plan.md:153-166`, `docs/decisions.md:824`, `src/app/api/cron/integrations/route.ts:28-36`, `src/app/api/cron/cart-reminders/route.ts:266-269`, `src/server/pages.ts:71`
- **Evidence:** 63 tables allow a null store_id for Kaizena Flow's own rows and 19 platform_* tables exist (catalog of the migrated test database); the parity plan counted 9 twins on 6 November and says why the gap opens: each store feature is built once for stores and again for the platform (docs/platform-parity-plan.md:32-35). The twins double jobs: the every-minute route runs runWorkflows and runPlatformWorkflows, deliverDue and deliverPlatformDue (integrations/route.ts:28-36); the dispatcher runs theme-updates and platform-theme-updates (cart-reminders/route.ts:266-269). The site exists twice: as null-store rows, which serve kaizenaflow.com today, and as a copy in the house store. The switch to serve from the house store is built and left off (D484, docs/decisions.md:824; plan lines 153-166), and step 7 'One copy' is not done. The owner's own rule asks for every store feature on the platform too.
- **Cost today:** A true duplicate: two engines for one job (workflows, deliveries, theme installs), twin jobs every minute and every five minutes, and the null-safe comparisons of DS-7 in 40 files. The running cost is small; the main cost is that each such feature is built and tested twice. Paid by: Every future feature, built twice; the database and server per tick, slightly
- **Saving:** Estimate: the site's null-store paths, a handful of twin tables and their jobs after step 7, and one build instead of two for each later site feature.
- **Risk:** Medium. The plan keeps the null rows until weeks after the switch, compares every address before and after, and the switch has its undo (one setting).
- **Already tracked:** docs/platform-parity-plan.md: step 5 built and off (D484), step 6 and step 7 'One copy' not done. The twins of the console track (D516, D518, D523) are the plan's own, not drift.

## The fix

1. The owner decides whether to make the switch before opening, when the site has the least to lose and nobody to disturb, or to keep both copies for now.
2. If yes, follow docs/platform-parity-plan.md step 5 as written (lines 153-166): copy the site again, look at the copy in the store, run node scripts/site-compare.mjs https://kaizenaflow.com > before.json, turn on platform_settings.site_from_store from Platform, Website (SiteSwitchCard), and run the compare again with --against before.json. The media library's rows move to the store at the switch.
3. Decide step 6 (one desk for support and chat), then, weeks after the switch, do step 7 'One copy': remove the site's null-store paths (platform-theme-installs.ts, platform-roles.ts, the (platform) page and blog routes, platform-layout.tsx) and retire the site's twin tables in a later migration (add, never drop in the same change as the code that stops using them).
4. Until then, and after: a new platform_* twin is added only where no store form can carry it (the console track, plan section 6), and its decision in docs/decisions.md says so in one sentence.
5. Tick the rows in docs/platform-parity.md and the steps in docs/platform-parity-plan.md as they land.

**Done when:** docs/platform-parity-plan.md step 7 is marked done and ls src/server/platform-theme-installs.ts src/server/platform-roles.ts finds neither file.

**Tests and rules that hold today's behaviour, and change with it:**

- src/db/house-switch.test.ts and src/proxy.test.ts hold the switch; src/db/house-site.test.ts and src/db/house-store.test.ts hold the copy; scripts/site-compare.mjs and e2e-live/ hold every address of the sitemap before and after.
- Rules: CLAUDE.md Conventions (whatever is built for stores is built for the platform too), docs/platform-parity-plan.md steps 5 to 7, docs/platform-parity.md.
- Step 7 changes the null branch of DS-7's owned() helper only where a null served the site alone; the platform's console tables keep it.

**Comes after:** The owner's decision on the switch (docs/platform-parity-plan.md step 5)

**Notes:** Not waste: a choice the owner already framed. Before opening is the cheapest time to make it, because the site has no real visitors to lose and the store has no real data to migrate.
