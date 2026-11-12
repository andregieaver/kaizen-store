# CR-7 ✓ The theme-shots route rebuilds its whole wanted list every minute

Scheduled and background work (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** 3.1.
- **Second check:** corrected.
- **Where:** `src/app/api/cron/theme-shots/route.ts:21-35`, `src/server/theme-shots.ts:56-64`, `src/server/theme-shots.ts:92-95`, `src/server/theme-shots.ts:112-145`, `src/server/theme-shots.ts:164-187`, `src/server/theme-shots.ts:330-341`, `src/server/theme-shots.ts:419-422`, `src/server/design-presets.ts:825`, `src/server/design-presets.ts:2368`, `src/server/store-starters.ts:326`, `docs/theme-showcase-phase-2.md:66-72`
- **Evidence:** runThemeShots() starts each minute with queueThemeShots(): it reads every published theme with its whole snapshot JSON (35,101 calls, 101 s, 348,763 rows, about ten themes a call), the themes' contents, the showcase stores and every theme_shots row (88,341 sequential scans), then one update, a claim under an advisory lock and a prune read: about 8 statements a minute. What is wanted changes only when a platform admin publishes a theme, a version or a demo store, and those three paths already call askForThemeShots() (design-presets.ts:825 and 2368, store-starters.ts:326).
- **Cost today:** About 11,500 statements a day and every published theme's snapshot read 1,440 times a day. A fixed floor: themes are the platform's, so it does not grow with stores. Paid by: The database and the server, every minute.
- **Saving:** About 8 statements a minute to 0 or 1 while idle (about 11,500 a day); the snapshot read falls from 1,440 to at most 96 a day.
- **Risk:** A publish path that forgets to ask leaves a theme without new photographs for up to 15 minutes, until the sweep. It would be seen on Platform, Themes as pictures that appear late.

## The fix

1. src/server/theme-shots.ts: move the third statement of queueThemeShots() (lines 137-143, the unit whose run stopped at the end of a round) into its own settleStoppedShots(). runThemeShots() (lines 330-341) calls settleStoppedShots(), then claims. It calls queueThemeShots() only when its new option 'sweep' is true, and works out wantedNow() lazily, only once a unit has been claimed (takeThemeShot() needs it).
2. src/app/api/cron/theme-shots/route.ts: pass sweep = the minute is a multiple of 15.
3. Keep the three askForThemeShots() calls. Check the other writers that change what is wanted and add the call where it is missing: a theme archived or unpublished and a theme's contents published (src/server/design-presets.ts), a demo store unpublished or archived (src/server/store-starters.ts, src/server/demo-stores.ts).
4. Reword docs/theme-showcase-phase-2.md:66-72 (the job brings the queue in line on a publish and every 15 minutes, not every run).

**Done when:** In pg_stat_statements the calls of the statement that selects p.snapshot from commerce.design_presets where p.published and p.archived_at is null rise by 100 or fewer a day (1,440 now).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/theme-shots.int.test.ts:79 (its runJob helper expects a run to bring the queue in line: pass sweep true there) and :276-317 (queueThemeShots cases stay). Add: a run that is not a sweep reads no theme and still takes a waiting unit.
- src/lib/theme-shots.test.ts:143 (only the route imports the runner) stays.

**Notes:** With CR-1's gate the route is not called at all while no unit waits; this step still matters in the minutes when units do wait, and it is small. Do it in CR-1's change.
