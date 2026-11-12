# BN-4 ✓ zod is in every signed-in admin screen's first scripts through three small imports

The built client bundles, by page (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.8.
- **Second check:** corrected.
- **Where:** `src/lib/env.ts:1`, `src/lib/supabase/client.ts:3`, `src/lib/push.ts:1`, `src/lib/push.ts:29`, `src/components/admin/push-settings.tsx:6`, `src/components/admin/push-settings.tsx:155`, `src/app/admin/(gated)/layout.tsx:11`, `src/server/push.ts:11`, `src/lib/storefront-bundle.scan.test.ts:16`
- **Evidence:** Chunk 1-5xy7dnrat0_.js is zod (116,870 bytes, 32,660 gzip), in the first-load list of 432 routes and of no route outside /admin (marker 'ZodError'). Three chains bring it to a plain screen: the Supabase client reads publicEnv() from env.ts, which imports zod (BN-1); the gated layout takes AdminServiceWorker from push-settings.tsx (line 11), whose only import from src/lib/push.ts is deviceName, a function of two regular expressions, while push.ts also holds the subscription's zod schema (lines 1 and 29); and the shortcut sheet's chain (BN-3) reaches typography, visibility and colour. The storefront has a written rule and a scan for this (schemas in *-schema.ts beside the plain module; storefront-bundle.scan.test.ts line 16 forbids zod); the admin's frame has neither. Simulated with all three chains cut (the skeptic's run, repeated here): zod leaves the first scripts of 275 routes and stays on 157 whose own code imports it (the page model, custom fields, the builder).
- **Cost today:** 114 KB raw, 33 KB gzip, in the first scripts of 432 routes; the verified report measured 27% of it run on the admin home (schemas built at import). Paid by: An owner's browser on each admin screen.
- **Saving:** Simulated on the real chunks: with BN-1 and BN-3, 495 KB off the list screens (admin home 1,164,140 to 656,940 model bytes, 44%); across the 432 routes about 500 KB off 266, about 400 off 69, about 350 off 57 and about 250 off the builder's 39; the median falls from 1,098 to 604 KB. zod itself leaves 275 routes.
- **Risk:** Low. The server still validates the push subscription with the same schema. A missed importer of the schema fails the type check.
- **Already tracked:** The rule exists for visitors only (docs/performance.md, No zod in a visitor's scripts); PERF-01 is open in general. Same change as AC-1 step 2 and AC-11 zone (a).

## The fix

1. New file src/lib/push-schema.ts: move base64url, pushSubscriptionInput and the type PushSubscriptionInput there from src/lib/push.ts lines 26 to 34 (it imports z and isPushEndpoint from './push'). Remove the zod import from push.ts. src/server/push.ts line 11 and src/lib/push.test.ts line 5 import the schema from '@/lib/push-schema'.
2. New file src/components/admin/admin-service-worker.tsx ('use client') with AdminServiceWorker moved from push-settings.tsx lines 153 to 163 (it needs only serviceWorkerOf from @/lib/browser-access). src/app/admin/(gated)/layout.tsx line 11 imports it from there, so the push settings' form loads only on Your account.
3. The public variables without zod: BN-1 step 1.
4. New test src/components/admin/admin-frame-bundle.scan.test.ts, on the walk of src/lib/storefront-bundle.scan.test.ts (lift resolve(), typesOnly() and the import pattern into src/test/import-walk.ts and use it from both). Start at the layouts of the signed-in admin (src/app/admin/(gated)/layout.tsx, [store]/layout.tsx, platform/layout.tsx, (owner)/layout.tsx and the files they import outside src/server), collect every 'use client' file reached, walk each, and fail when one reaches zod, @supabase/*, lib/i18n, lib/messages/{lang}, lib/admin-text, lib/page-content, @tiptap/*, or a value import of lib/admin-messages/*.en other than common and sign-in. Print the chain, as the storefront's test does.
5. docs/performance.md: one rule under The admin as people use it: the frame's client parts import no schema, no SDK and no catalogue; a helper they need lives in a file without them. One sentence in CLAUDE.md, Conventions, beside the storefront's.

**Done when:** After pnpm build, zod (marker 'ZodError') is in the first-load chunks of at most 160 routes (432 today) and of none of /admin/[store], /admin/[store]/orders, /admin/[store]/products, /admin/[store]/settings and /admin/platform; /admin/[store] is at or under 700,000 bytes in route-bundle-stats.json (1,194,862 today); admin-frame-bundle.scan.test.ts passes and fails when import { z } from 'zod' is added to src/components/admin/admin-rail.tsx.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/push.test.ts lines 5 and 23 to 31 (the schema's import moves; deviceName stays in push.ts).
- e2e/signed-in/notifications.spec.ts (push settings on Your account) and the offline page of the installable admin (D361): the service worker still registers from the layout.
- src/lib/storefront-bundle.scan.test.ts: its walker moves to a shared file; its lists and result must not change.
- Rule docs/performance.md lines 34 to 37 (schemas in *-schema.ts, the browser imports the plain module): this applies it to the admin's frame.
- The 46 scan tests run in pnpm test; the new one must stay under a second or two.

**Comes after:** BN-1; BN-3

**Notes:** The skeptic's correction is used: zod does not leave all 432 routes; it stays where a screen's own code needs it. Once zod is out of the frame, the AI manager's chat script would fetch it on opening unless BN-15 is done; do BN-15 soon after.
