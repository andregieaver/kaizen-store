# DP-4 ✓ supabase-js, its realtime client and zod are 39% of the first scripts of every admin page

Dependencies (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.9.
- **Second check:** corrected.
- **Where:** `src/app/admin/(gated)/layout.tsx:10-11`, `src/app/admin/(gated)/layout.tsx:47`, `src/app/admin/(gated)/layout.tsx:51`, `src/components/admin/session.tsx:8`, `src/components/admin/session.tsx:22`, `src/components/admin/session.tsx:46`, `src/lib/supabase/client.ts:1-3`, `src/lib/env.ts:1-6`, `src/components/admin/push-settings.tsx:6`, `src/components/admin/push-settings.tsx:155-163`, `src/components/admin/shortcut-sheet.tsx:19`, `src/components/admin/responsive-edit.tsx:306-309`, `src/lib/storefront-bundle.scan.test.ts:12-16`, `e2e/signed-in/admin-scripts.spec.ts:17-22`, `e2e/signed-in/admin-scripts.spec.ts:36-46`, `docs/performance.md:34`, `docs/audits/psi-followups.md:482`
- **Evidence:** The prerendered admin shell (.next/server/app/admin.html) asks for 15 scripts. One, Next's 112,594-byte polyfill, has the noModule attribute and a modern browser skips it; the other 14 are 898,697 bytes raw, 261,302 gzip. Three are libraries: supabase-js (179,419 raw, 44,575 gzip), Supabase's realtime client (57,349, 16,687) and zod (116,870, 32,996): 353,638 raw, 94,258 gzip. The three are named by 432 admin route manifests and no storefront one. Re-walked with the client-graph script on six admin layouts and two pages: supabase-js comes only through session.tsx:8 (SessionKeeper keeps the token fresh); zod comes by three chains only: session.tsx to supabase/client.ts to env.ts (two strings checked), push-settings.tsx to lib/push.ts (the layout draws the 8-line AdminServiceWorker from that file), and shortcut-sheet.tsx to responsive-edit.tsx to responsive.ts to typography.ts (for the 3-line typingIn()). The store home and orders pages add no other path.
- **Cost today:** 354 KB raw / 94 KB gzip of script downloaded, parsed and run before the admin is usable, on every admin page: 39% of what a modern browser loads first (36% gzip). Paid by: An owner's browser on every full admin page load (the download once per deploy that changes the chunks, the parse and run each time). Staff on phones most. Grows with the number of owners.
- **Saving:** 117 KB raw / 33 KB gzip gone from the first scripts of admin pages whose own forms do not use zod; 237 KB raw / 61 KB gzip of Supabase moved to after first paint (still fetched once). Measured chunk sizes; the effect on paint time is not measured.
- **Risk:** Low. The session keeper starts a moment later; a token that expires in that moment is handled as today by SessionRecovery. Screens with zod-based forms (builder, product editor, media) still load zod with their own scripts. A break would show as a sign-in loop in the signed-in e2e project.
- **Already tracked:** Partly: docs/audits/psi-followups.md PERF-01 (open) sets the goal of cutting the admin's shared scripts and names none of these. The admin-client review's AC-1 is this same finding (it adds a Buffer polyfill and the builder's English): do it once.

## The fix

1. src/components/admin/session.tsx: remove the static import at line 8. In SessionKeeper's effect load the client after mount: keep the cookiesReadable check first, then import('@/lib/supabase/client').then(({ createClient }) => { if (gone) return; const { data } = createClient().auth.onAuthStateChange(() => {}); stop = () => data.subscription.unsubscribe(); }).catch(() => {}); and return a cleanup that sets gone and calls stop. In SessionRecovery, inside the async function's try block: const { createClient } = await import('@/lib/supabase/client'); client = createClient();
2. Move typingIn() (src/components/admin/responsive-edit.tsx:306-309) to a new file src/lib/typing-in.ts with no imports. Import it from there in shortcut-sheet.tsx:19, responsive-edit.tsx and page-builder.tsx.
3. Move AdminServiceWorker (push-settings.tsx:155-163) to a new file src/components/admin/admin-service-worker.tsx ('use client'; imports only serviceWorkerOf from @/lib/browser-access). src/app/admin/(gated)/layout.tsx:11 imports it from there.
4. Give the browser a zod-free reading of the two public values: a new src/lib/public-env.ts that checks NEXT_PUBLIC_SUPABASE_URL with new URL() and the key for being non-empty, and throws the same 'Invalid or missing environment: ...' message. src/lib/supabase/client.ts uses it; env.ts's publicEnv() calls it too, so there is one rule. Without this zod would arrive with the deferred Supabase chunk on every screen.
5. Extend src/lib/storefront-bundle.scan.test.ts with a second entry set (or a sibling file that shares its walker): the client components drawn by src/app/admin/layout.tsx, (gated)/layout.tsx, (gated)/[store]/layout.tsx, (gated)/platform/layout.tsx, (gated)/(owner)/layout.tsx and (gated)/hosting/layout.tsx may not reach zod or @supabase/* by static import. Change the header's 'Left out: the admin' sentence.
6. Run the signed-in suite with E2E_MEASURE=1 and lower BUDGETS in e2e/signed-in/admin-scripts.spec.ts to the new figures plus 4%. In firstScripts() skip script tags that carry noModule, so the budget counts what a modern browser loads.
7. docs/performance.md, 'The admin as people use it': the new figures and one line extending the no-zod rule to the admin's shell. docs/audits/psi-followups.md PERF-01: note what was cut.

**Done when:** No script tag of .next/server/app/admin.html names a chunk containing zod or Supabase (today 3 chunks, 353,638 bytes), and the admin home measured by e2e/signed-in/admin-scripts.spec.ts with E2E_MEASURE=1 falls by at least 330,000 bytes from 1,284,745.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/signed-in/admin-scripts.spec.ts BUDGETS (home 1,284,745 measured, budget 1,340,000): lowered
- src/lib/storefront-bundle.scan.test.ts: gains the admin shell's entries; its header changes
- src/lib/env.test.ts (publicEnv): must pass; add cases for src/lib/public-env.ts
- e2e/signed-in/auth.setup.ts and the whole signed-in project: the session must keep working with the deferred client
- docs/rules/admin/platform.md:50-51 ('SessionKeeper refreshes tokens in the browser, and SessionRecovery ...'): stays true, no edit
- docs/performance.md:34 (the *-schema.ts convention for visitors) and :119-139; docs/audits/psi-followups.md:482 (PERF-01, open)
- The sandboxed preview frame rule (D127): the cookiesReadable check stays the effect's first line

**Notes:** Corrected again by the planner: the share is 39% raw and 36% gzip, not 35% and 31%, because one of the 15 scripts is a noModule polyfill no modern browser fetches. The fix moves typingIn() and AdminServiceWorker (two tiny moves) where the skeptic moved the schemas of push.ts and typography.ts; either works, this one touches less. PERF-01's 3.93 s p75 came from the team's own use before the 10 November cut: measure again, do not treat it as a baseline.
