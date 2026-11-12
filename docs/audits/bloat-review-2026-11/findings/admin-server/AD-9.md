# AD-9 ✓ Progress polls redraw the whole admin, and a notice poll runs in every visible owner tab

What the server does for an admin navigation (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.17.
- **Second check:** corrected.
- **Where:** `src/components/admin/refresh-while.tsx:7-13`, `src/components/admin/analytics/live-refresh.tsx:10-26`, `src/components/admin/cookie-scan.tsx:137`, `src/components/admin/domains-panel.tsx:175`, `src/components/admin/page-jobs-panel.tsx:53`, `src/components/admin/legal-pages-panel.tsx:145`, `src/app/admin/(gated)/[store]/dream-factory/page.tsx:116`, `src/app/admin/(gated)/[store]/dream-factory/rework.tsx:39`, `src/app/admin/(gated)/[store]/dream-factory/rework.tsx:135`, `src/app/admin/(gated)/platform/ai/dream/[runId]/page.tsx:55`, `src/components/admin/pack-pictures.tsx:126-133`, `src/components/admin/ai-notices.tsx:29-53`, `src/app/admin/(gated)/(owner)/account/notices/feed/route.ts:17-35`, `src/server/assistant-notices.ts:146-173`, `src/components/admin/store-drafts.tsx:39-45`
- **Evidence:** RefreshWhile calls router.refresh() every 5 s (cookie scan), 6 s (Dream Factory, four places), 10 s (page jobs, legal writing), 15 s (pack pictures, its own copy) or 20 s (domains), and does not stop when the tab is hidden; LiveRefresh, 20 lines away, does. A refresh re-fetches dynamic data in shared layouts too, so each tick pays the whole shell of AD-1, AD-4 and AD-5 plus the page. The Dream Factory run is where a new store's owner lands first ([store]/page.tsx:43-46), so this is the first screen most new owners will watch. Separately, the AI manager's button asks the notices feed every 60 s in every owner's tab while it is shown: the route reads the account, looks up the store by slug, runs the list query with limit 1 and throws it away, then counts.
- **Cost today:** During a Dream Factory run: 10 full shell-and-page renders a minute per watching tab, hidden or not, each with the 100 to 125 ms menu build until AD-1. Always: 60 requests an hour per visible owner tab, 4 statements each, one thrown away, plus an Auth call for a session without two-step (AD-3). Estimate at 1,000 owners with a tab in view: 1,000 requests and 4,000 statements a minute for a badge. Paid by: The server per request and the database; the owner's browser re-parsing the shell each tick.
- **Saving:** Estimate: a hidden tab stops costing anything; a progress tick drops from the whole route to 2 or 3 statements once it asks the job; the notice poll from 4 statements to 2.
- **Risk:** Low. A progress view must still redraw once when the job ends, and once when a hidden tab is shown again (LiveRefresh's 'back' handler does this). Noticed by a run's page not reaching its finished state without a reload: there is no spec for it today, so add the case named under tests.

## The fix

1. src/components/admin/refresh-while.tsx: draw LiveRefresh with every = seconds * 1000 (or copy its check): refresh only while document.visibilityState is 'visible', and once when the tab comes back. src/components/admin/pack-pictures.tsx:126-133: the same in PackPicturesWatch.
2. src/app/admin/(gated)/(owner)/account/notices/feed/route.ts:27-35: when count=1, answer with unreadNotices(account.id, place) alone (assistant-notices.ts:173) and skip listNotices().
3. Take the store's id from what the layout knows: [store]/layout.tsx passes store.id to AiManagerLauncher, useNoticeCount() sends it as place, and placeOf() accepts a uuid without the lookup by slug (the notices are filtered by the account's own id, so another store's id returns nothing of anyone else's). The poll is then the account read and one count.
4. For job progress, ask the job, not the route: give the Dream Factory views, the page jobs panel, the legal pages panel and the cookie scan a small server action that returns the job's state and does not call refresh() (an action without it sends no page back), poll that as store-drafts.tsx:39-45 does, and call router.refresh() once when the state changes to done or failed. Start with the Dream Factory (the onboarding screen).
5. Lengthen the notice poll when the last answer was 0 (for example 60 s, then 120 s, then 300 s, back to 60 s on a press or when the tab is shown again) in src/components/admin/ai-notices.tsx.

**Done when:** rg -n 'setInterval' src/components/admin/refresh-while.tsx src/components/admin/pack-pictures.tsx shows each tick guarded by visibilityState, and AD-12's counter (or a count in assistant-notices.int.test.ts) shows the count=1 feed at 2 statements (4 today).

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/signed-in/live.spec.ts (LiveRefresh), e2e/signed-in/ai-manager-panel.spec.ts (the badge and the notices list), src/server/assistant-notices.int.test.ts (listNotices and the count).
- No e2e spec opens the Dream Factory (rg dream-factory e2e: nothing). Add one signed-in case that a run's page shows the finished state without a reload, or check it by hand with a screenshot for the owner.
- src/app/s/[store]/[market]/order/[orderId]/order-section.test.ts tests the storefront's own RefreshWhile (src/components/refresh-while.tsx), a different file: do not confuse the two.
- Rule kept: ai-notices.tsx:25-28 says polling only, as the support inbox's safety net; D347 decision 2 (polling, never a socket). The fix keeps polling and makes each poll smaller.

**Notes:** Steps 1 and 2 are a few lines and are the P0 part; steps 3 to 5 are P1. The skeptic fixed two details: the poll's constant lives in src/lib/assistant-notices.ts:13, and the notice poll already stops in a hidden tab.
