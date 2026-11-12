# DP-9 ✓ The existing plan's dependency item (FH12) points at the wrong Postgres driver, and its note on three is incomplete

Dependencies (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** 0.4.
- **Second check:** corrected.
- **Where:** `docs/audits/code-review-2026-11.md:294-296`, `docs/audits/code-review-2026-11.md:501`, `docs/audits/code-review-2026-11.md:132`, `src/db/client.ts:7`, `src/db/client.ts:56-63`, `src/lib/store-hosts-build.ts:1`, `next.config.ts:12`, `package.json:60`, `package.json:62`, `package.json:72`, `node_modules/@google/model-viewer/package.json`, `e2e/product-media.spec.ts`
- **Evidence:** FH12 says pg is kept beside postgres for one module, and step 4.4 (Open) says to take pg out of production dependencies. That is backwards: pg is the production driver (client.ts:7, reason at :56-63); the driver with one module in src is postgres, imported by the build's host read (store-hosts-build.ts:1, called from next.config.ts:12), five scripts and tests, and found in no server chunk or trace. FH12 also says three is a dependency nothing imports. True of src, but @google/model-viewer 4.4.0 declares it a peer (^0.183.0) and its module build imports it; 0.187.0 is installed, outside that range for a 0.x version, and e2e/product-media.spec.ts covers the 3D viewer.
- **Cost today:** No run-time cost. A plan step that, followed as written, removes the database driver from the list (the build would fail, so it would be caught, at the price of a wasted session). Paid by: Whoever picks up step 4.4; an agent's session reading the plan.
- **Saving:** None in bytes. Removes a wrong instruction from the working plan.
- **Risk:** None for the doc fix.
- **Already tracked:** docs/audits/code-review-2026-11.md step 4.4 (FH12), Open, wrong as written about pg

## The fix

1. docs/audits/code-review-2026-11.md, FH12 (lines 294-296): say pg is the run-time driver and stays; postgres is the build's and the scripts' driver and reaches no function; three is a required peer of @google/model-viewer, installed at 0.187.0 against a stated ^0.183.0, held by e2e/product-media.spec.ts.
2. Same file, step 4.4 (line 501): replace 'pnpm why three, and pg out of production dependencies' with 'postgres may move to devDependencies only if the Vercel build still installs devDependencies (next.config.ts needs it at build time); otherwise leave it and say why'.
3. Add a change-log line, as the file's own rule asks. Make the edit in DP-1's change, which already touches this file.

**Done when:** rg -n 'out of production dependencies' docs/audits/code-review-2026-11.md prints nothing, and FH12's text names postgres, not pg, as the driver with one module.

**Tests and rules that hold today's behaviour, and change with it:**

- CLAUDE.md conventions: a finding the code no longer matches is corrected in the same change that touches the plan
- src/db/client.ts:56-63 (D37) is the written reason for pg: unchanged
- DP-6's src/lib/dependencies.scan.test.ts will hold the allow-list entry for three with this reason

**Comes after:** DP-1 (same file, same change)

**Notes:** No saving, so P2 by the scale; in practice it costs two sentences in a file DP-1 edits anyway, so it lands with the P0 work.
