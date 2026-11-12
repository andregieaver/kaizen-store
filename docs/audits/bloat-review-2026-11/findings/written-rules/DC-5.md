# DC-5 ✓ CLAUDE.md sends agents to a 73 KB plan written before the platform was multi-tenant

The written rules and the agents' context (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 0.28.
- **Second check:** confirmed.
- **Where:** `CLAUDE.md:5-6`, `README.md:15`, `docs/plan.md:3`, `docs/decisions.md:3-6`, `docs/decisions.md:422`, `docs/platform.md:1-14`
- **Evidence:** CLAUDE.md:5-6 says the research and phased build plan are in docs/plan.md and to read it before architectural work; README.md:15 says to skim it. plan.md is 72,617 bytes. Its own banner (line 3, updated 23 September) notes that the region and the single app differ from the plan. decisions.md:422 dates multi-tenancy to 24 September, and decisions.md:3-6 says the plan loses where they differ. docs/platform.md (16,193 bytes) is the note on how the platform is built. 12 other docs cite plan.md by path for its research (skeptic's count).
- **Cost today:** About 18,000 tokens (estimate) for an agent that follows the instruction, much of it a stack that was not built. How often sessions follow it was not measured. Paid by: An agent's session
- **Saving:** About 14,000 tokens per session that follows the instruction (72.6 KB less 16.2 KB; estimate).
- **Risk:** Low. The plan keeps its place and its links.

## The fix

1. CLAUDE.md:5-6: replace 'The research and phased build plan are in docs/plan.md; read it before architectural work.' with 'How the platform is built is in docs/platform.md: read it before architectural work. docs/plan.md is the research behind the first build (conversion, law, measurement), written before the platform was multi-tenant: open the section a doc cites, not the whole.'
2. README.md:15: name docs/platform.md first as what to read, and docs/plan.md as research to open by section.
3. Leave docs/plan.md where it is: 12 docs link to it by path.

**Done when:** rg -c 'plan\.md`; read it before architectural work' CLAUDE.md and rg -c 'Skim \[`docs/plan.md`\]' README.md both print nothing (today 1 each), and CLAUDE.md's opening names docs/platform.md.

**Tests and rules that hold today's behaviour, and change with it:**

- No test reads these lines (rules-index.test.ts reads only the Storefront and Admin sections).
- docs/decisions.md:3-6 already says the plan loses to the decisions; docs/plan.md:3 already lists two differences.

**Notes:** Two sentences. Do it in the same commit as DC-1; it is not P0 only because how often the instruction is followed is unknown.
