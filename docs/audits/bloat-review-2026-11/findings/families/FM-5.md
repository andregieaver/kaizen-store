# FM-5 ✓ The parity rule names platform_* tables as the way and does not say when the store's module with a scope is expected

Families and twins (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P1. **Effort:** S. **Confidence:** medium. **Step:** 3.10. **The owner's choice.**
- **Second check:** corrected.
- **Where:** `CLAUDE.md:403`, `docs/platform-parity-plan.md:32`, `docs/platform-parity-plan.md:73`, `docs/decisions.md:805`, `docs/decisions.md:855`, `docs/decisions.md:856`, `src/db/schema.ts:1446`, `scripts/ratchet.mjs:9`
- **Evidence:** CLAUDE.md:403 asks for every store feature on the platform in the same change and names 'store_id is null or platform_* tables' as where its rows live. The plan of 6 November counted 9 platform_* tables (line 32) and said 'build it for stores' (line 73), but also set a console track for what no store can give (section 6). That track was built on 9 November on the owner's instruction (D515, D516, D518 and others): the schema has 19 platform_* tables today, and src has 24 platform-*.ts server modules (4,761 lines) and 20 lib ones (1,664). The code is copied only in part: the events modules are 26 to 55% the stores' lines (FM-4), plan reminders 41% and the platform's speed recorder 70% (FM-11); the money, team and analytics modules are the platform's own subject. Nothing in the rule or in a test tells a copy from a new subject.
- **Cost today:** A copied module adds lines to keep in step for good: today about 370 server lines in the events family (FM-4) and about 180 in plan reminders and the speed recorder. The cost is upkeep, not run time. Paid by: An agent's session (the rule is read in every one) and CI.
- **Saving:** No lines today. It keeps the next console step from being built as a copy.
- **Risk:** Low. It changes the wording of a rule the owner set on 6 November without changing what the platform gets. What could go wrong: the sentence read as 'no platform tables', which the plan's console track contradicts; the wording above speaks of modules, not tables.
- **Already tracked:** partly: docs/platform-parity-plan.md section 3 says 'build it for stores'; the rule in CLAUDE.md does not say how

## The fix

1. With the owner's agreement, add one sentence to the rule at CLAUDE.md:403: 'Where the platform's version does the same job on its own rows, it uses the store's module with a scope (the table and the owner filter passed in), not a copy; a decision that adds a copied platform-*.ts module says why a scope would not do.'
2. Put the same sentence in docs/platform-parity-plan.md section 3, under 'Where Kaizena Flow needs something a store lacks, build it for stores' (line 73), and point to src/server/webhook-endpoints.ts as the example once FM-4 is done.
3. Do not put the number of platform_* tables or platform-*.ts modules in the only-falls ratchet: the console track adds them on purpose and scripts/ratchet.mjs refuses a rise. The twin-pair budget of FM-13 is what catches a copied module.

**Done when:** rg -c 'with a scope' CLAUDE.md docs/platform-parity-plan.md prints 1 for each file, and src/lib/copies.baseline.json exists with the twin-pair count.

**Tests and rules that hold today's behaviour, and change with it:**

- CLAUDE.md Conventions (the rule of 6 November 2026) and docs/platform-parity-plan.md section 3: reworded, not reversed. The platform still gets every feature.
- docs/platform-parity.md: no row changes.
- src/lib/copies.scan.test.ts (FM-13) is the check that stands behind the sentence.

**Comes after:** The owner's agreement to the wording; FM-13 steps 2 and 3 (the twin-pair budget) for the rule to have a check

**Notes:** A wording choice for the owner, not waste. The ten tables added on 9 November were the plan's own console track and are not a finding. Empty tables are no argument here: nothing is open yet.
