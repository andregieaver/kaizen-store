# BN-3 ✓ The keyboard shortcut sheet brings the page builder's English and field code to every admin screen

The built client bundles, by page (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.8.
- **Second check:** corrected.
- **Where:** `src/components/admin/shortcut-sheet.tsx:19`, `src/components/admin/shortcut-sheet.tsx:45`, `src/components/admin/responsive-edit.tsx:20`, `src/components/admin/responsive-edit.tsx:24`, `src/components/admin/responsive-edit.tsx:100`, `src/components/admin/responsive-edit.tsx:306`, `src/components/admin/page-builder.tsx:79`, `src/components/admin/admin-catalogues.scan.test.ts:31`
- **Evidence:** shortcut-sheet.tsx, a client root of every admin screen, imports one four-line function, typingIn, from responsive-edit.tsx (line 19; the function is at 305 to 309 and reads only the DOM). That module imports the builder's whole English by value for a default argument (line 20, used at 100), DisplayFields (line 24) and lib/responsive. Chunk 0pmozty218j-z.js (71,508 bytes, 23,840 gzip) is the catalogue; its marker text 'Set for {size}' is in the first-load chunks of 423 routes. Ranked by what leaves if one root is dropped, the shortcut sheet is the second heaviest root of the admin home (133,588 bytes; session.tsx is first). The skeptic's simulation of the cut on every route: 129 KB off 335 routes, 96 to 111 KB off 48 more, none off the builder's routes, which need these modules.
- **Cost today:** 129 KB raw (about 43 KB gzip for the three chunks) in the first scripts of 335 routes, 96 to 111 KB on 48 more. Paid by: An owner's browser on every admin screen that is not the builder.
- **Saving:** Simulated on the real chunks (the skeptic's run, cut re-read here): 129 KB raw off 335 routes' first scripts, 96 to 111 KB off 48, 58 KB off one, none off the builder's routes.
- **Risk:** None seen: a function moves and nothing it does changes. A wrong import path fails the type check.
- **Already tracked:** Partly: responsive-edit.tsx is on the list in admin-catalogues.scan.test.ts that may only shrink; that the admin's frame imports it is noted nowhere. PERF-01 (open) covers the shared scripts in general. Same change as AC-1 step 1 and TX-4.

## The fix

1. New file src/lib/typing-in.ts with typingIn() moved as it is from src/components/admin/responsive-edit.tsx lines 305 to 309 (no imports).
2. src/components/admin/responsive-edit.tsx: replace the function with export { typingIn } from '@/lib/typing-in', so page-builder.tsx line 79 and responsive-edit.test.ts line 19 keep working.
3. src/components/admin/shortcut-sheet.tsx line 19: import { typingIn } from '@/lib/typing-in'.
4. Leave responsive-edit.tsx's own catalogue import to BN-8; it stays on the list in admin-catalogues.scan.test.ts until then.

**Done when:** After pnpm build, the builder's English (marker 'Set for {size}') is in the first-load chunks of at most 45 routes (423 today), and none of /admin/[store], /admin/[store]/orders, /admin/[store]/settings and /admin/platform.

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/admin/responsive-edit.test.ts lines 19 and 186 to 188 (typingIn through the re-export).
- src/lib/shortcut-sheet.test.ts and e2e/signed-in/shortcut-sheet.spec.ts: the sheet opens on ? and not while typing.
- src/components/admin/admin-catalogues.scan.test.ts: unchanged by this cut (responsive-edit.tsx still imports the catalogue).
- e2e/signed-in/admin-scripts.spec.ts lines 36 to 46: the budgets fall; lower them with BN-1 and BN-4.

**Notes:** The skeptic cut the scope from 423 routes to 335 in full and 48 in part; that figure is used. BN-4's frame scan keeps it from coming back.
