# DC-9 ✓ The saved parity-wave workflow asks for specs with no size limit and tells every agent to read them whole; it is dormant

The written rules and the agents' context (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P3. **Effort:** S. **Confidence:** medium. **Step:** tolerated.
- **Second check:** corrected.
- **Where:** `.claude/workflows/parity-wave.js:29`, `.claude/workflows/parity-wave.js:74`, `.claude/workflows/parity-wave.js:188`, `docs/consolidation.md:3`
- **Evidence:** Line 188 asks for a spec of nine sections with no size limit; line 74 tells every later agent to 'read it completely before anything else'. The 14 wave specs written in that shape total 1,694,387 bytes (88 to 184 KB each). The workflow accepts only waves 0 to 9 (line 29), and docs/consolidation.md:3 says feature waves were paused on 29 October. No run falls inside the clone's history.
- **Cost today:** Nothing today. If run again as written: about 12 agents reading a spec of about 120 KB each (about 30,000 tokens each, estimate). Paid by: An agent's session, only when the workflow is run
- **Saving:** None until the workflow is run again; then about 270,000 tokens per run (skeptic's estimate).
- **Risk:** A thinner spec may miss an edge case the long ones caught; the review lenses and the gates stay.

## The fix

1. Before the next run, not before: in .claude/workflows/parity-wave.js:188 cap the spec ('at most 30,000 characters') and ask for the lead's hand-over and the drafts of the decision and the rule in the final report, not in the spec.
2. Line 74: replace 'read it completely before anything else' with 'read sections 1 to 5 and the part for your area'.
3. When DC-1 has landed, drop the draft of the CLAUDE.md bullet from line 188: there is no per-rule line any more.

**Done when:** rg -c 'read it completely' .claude/workflows/parity-wave.js prints nothing (today 1) and line 188 names a size limit.

**Tests and rules that hold today's behaviour, and change with it:**

- docs/parity/WAVES.md describes the workflow's steps and must say the same.
- No test reads the workflow file.

**Notes:** P3 because it has no running cost: the workflow is not in use. Change it on the day a wave is next run.
