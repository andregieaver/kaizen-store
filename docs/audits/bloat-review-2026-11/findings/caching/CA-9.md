# CA-9 ✓ The same one-line store lookup is written 27 times, and three tiny facts are asked of the database about 11,000 times a day by scheduled work

Caching and rendering (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** 0.16.
- **Second check:** corrected.
- **Where:** `src/server/menus.ts:284`, `src/server/content-grid.ts:133`, `src/server/content-grid.ts:152`, `src/server/content-site.ts:46`, `src/server/custom-fields.ts:817`, `src/server/ai.ts:206`, `src/server/ai-pause.ts:19`, `src/server/redirect-live.ts:187`, `src/server/limits.ts:26`, `evidence/prod-db-stats.md`
- **Evidence:** The verified report counted 27 copies of 'select slug from commerce.stores where id = $1' in src/server and 12 callers of the cached helper storeSlugOf() (menus.ts:284, cacheLife days, no tag); the statement is production's most-called: 560,090 calls in 78 days. Opened in this pass: aiFor() (ai.ts:206-210) reads ai_providers with select * on every call, 237,563 calls; aiAutonomyPaused() (ai-pause.ts:19-22) reads one flag, 69,075 calls. The platform is not open, so these calls come from the five-minute dispatcher, the every-minute routes and cold renders. A per-instance memo helper already exists twice: remembered() (redirect-live.ts:187-200) and the limits memo with forgetLimits() (limits.ts:20-45).
- **Cost today:** About 11,100 statements a day (866,728 over 78 days), each a round trip from a function to the database. None is among the costliest statements (smallest listed: 17.5 s in 78 days). The count grows with stores and scheduled runs. Paid by: The database; the server per scheduled run and per cold render.
- **Saving:** Estimate: over 90% of those calls, worth little database time today. The clearer gain is one helper instead of 27 copies.
- **Risk:** A changed pause reaches other instances within the memo's minute; the instance that changes it forgets at once. Low. Noticed by the pause's tests.

## The fix

1. This is DQ-9 of the database dimension; follow its steps so the work is done once: move storeSlugOf() to src/server/stores.ts (menus.ts re-exports it), replace the exact copies (rg -n 'select slug from commerce.stores where id' src), and carry the slug in GridPlace where a page already holds the store.
2. The AI provider row: read the enabled providers once per job run and hand them down (enabledProviders() beside aiFor(), an optional providers argument), and once per request with perRequest(). Do not keep the row in instance memory: it holds the encrypted key.
3. The pause flag: skipWhilePaused() callers in one dispatcher run share one read; pass the answer down from the dispatcher, or wrap aiAutonomyPaused() in remembered('ai|paused', …, 60_000) from src/server/redirect-live.ts and forget it in setAiAutonomyPaused() (ai-pause.ts:30), as forgetLimits() does.
4. Do not add a fifth memo helper: reuse remembered().

**Done when:** rg -c 'select slug from commerce.stores where id' over src without tests gives at most 3 lines (27 today); on production a week after the deploy that statement grows by fewer than 500 calls a day (about 7,180 a day today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/*.int.test.ts that seed stores and read grids and menus (content-grid, menus, custom-fields) must pass unchanged.
- ratchet.scan.test.ts: unchecked reads may only fall; lower src/server/ratchet.baseline.json with node scripts/ratchet.mjs.
- agent-eval and the AI pause's tests (rg -l aiAutonomyPaused src --glob '*.test.ts'): a pause must still stop the next run on the instance that set it at once.
- docs/capacity.md:32 describes the limits memo; add the pause flag's minute there.

**Notes:** Same change as DQ-9, which ranks it P0 for the call count; from the caching side the time saved is small, so it is P2 here. Whichever dimension's order is followed, do it once.
