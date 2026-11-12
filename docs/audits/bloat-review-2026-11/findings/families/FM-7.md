# FM-7 ✓ 1,266 server actions, 50 on the shared wrapper; the count of the rest is not held

Families and twins (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** L. **Confidence:** medium. **Step:** 1.9.
- **Second check:** corrected.
- **Where:** `src/server/store-action.ts:35`, `src/app/admin/(gated)/[store]/orders/actions.ts:1`, `src/app/admin/(gated)/[store]/returns/actions.ts:88`, `src/app/admin/(gated)/[store]/customer-groups/actions.ts:28`, `scripts/lib/ratchet-count.mjs:72`, `src/server/ratchet.baseline.json:1`, `docs/rules/admin/platform.md:89`, `docs/audits/code-review-2026-11.md:61`
- **Evidence:** 235 'use server' files in the admin hold 1,266 exported actions. storeAction() or platformAction() is called 50 times in 3 files (orders, returns, the books settings); 232 files guard by hand. The verified report counted about 180 small local helpers in those files (wordsOf in 48, noAccess in 35, text in 25, said in 16, failed in 12, asOwner in 11, done in 10) and showed that a wrapped action is no shorter than a guarded one: what the wrapper adds is one logged failure and one refusal in the person's language (store-action.ts:35-50). The rule moves a file when it is touched; nothing counts what is left.
- **Cost today:** About 300 lines of repeated local helpers (estimate), and failures that are answered and logged differently per file. No run-time cost. Paid by: The owner's admin (an action that throws shows Next's error page instead of a plain line), and an agent's session.
- **Saving:** About 300 lines over time (estimate), and one failure behaviour. The wrapper itself saves no lines per action.
- **Risk:** Low per file. A conversion changes what a refused person sees (a plain line, not a 404), which the wrapper's rule already asks for. Step 1 alone is S and changes no behaviour.
- **Already tracked:** code review step 1.4: Done for the wrapper on 11 November; the other files move 'when touched' (docs/rules/admin/platform.md:89), with no count

## The fix

1. Count it. In scripts/lib/ratchet-count.mjs add unwrappedActionFiles: files under src/app/admin and src/components/admin whose first statement is 'use server' and that call neither storeAction( nor platformAction( (232 today). Return it from ratchetCounts() (line 72), refuse a rise in scripts/ratchet.mjs beside the other counts, assert it in src/server/ratchet.scan.test.ts, and write it with node scripts/ratchet.mjs --first only if the baseline's shape needs it.
2. Put the helpers the action files repeat into src/server/store-action.ts (or a file beside it): the no-access answer, the reader of a member's words, and the form-text reader. Export them; do not sweep the callers.
3. Convert by area when an area is opened for other work, as docs/rules/admin/platform.md:89 says: wrap each action, delete the file's local helpers, lower the baseline in the same change.

**Done when:** src/server/ratchet.baseline.json has unwrappedActionFiles (232 on the day it is added) and src/server/ratchet.scan.test.ts fails when a new 'use server' file in the admin calls neither wrapper.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/ratchet.scan.test.ts and src/server/ratchet.baseline.json: gain the count (step 1).
- docs/rules/admin/platform.md:89 (server actions run through storeAction() or platformAction(); other files move when touched): add that the ratchet holds the number.
- docs/audits/code-review-2026-11.md step 1.4 is Done for the wrapper: add a change-log line that the remaining files are now counted; the step's status does not change.
- A converted action answers a refusal with a plain line where some files answer notFound() today: the signed-in e2e specs of that area show a difference.

**Notes:** Only step 1 is worth doing now (small, and it stops the number growing with every new screen). The conversion is the existing rule and follows other work. The same gap is reported by the copied-code area (CP-7).
