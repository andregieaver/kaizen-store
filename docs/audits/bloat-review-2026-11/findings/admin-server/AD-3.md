# AD-3 ✓ Every admin request from a session without two-step calls Supabase Auth

What the server does for an admin navigation (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 2.33.
- **Second check:** confirmed.
- **Where:** `src/server/auth.ts:132`, `src/server/auth.ts:144-153`, `src/server/auth.ts:158-175`, `src/server/two-step.ts:190`, `src/server/two-step.ts:264`, `src/server/two-step.ts:341`, `src/server/two-step.ts:362`, `src/lib/two-step.ts:8`, `node_modules/.pnpm/@supabase+auth-js@2.118.0/node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:5537-5544`, `e2e/fixtures/auth-stub.mjs:3`
- **Evidence:** readSession() verifies the token, reads the account row, then for an aal1 session calls supabase.auth.getUser() over HTTP to list factors, on every request (React's cache spans one render only). Every page render, server action, notice poll and admin route handler goes through it. A save pays it twice: once in the action's guard and once in the redraw that follows, which is a new render with a new cache. The writes that follow run only on a mismatch or while the break-glass switch is on. One more thing found in this pass and not checked against production: getClaims() itself verifies locally only when the project signs tokens with an asymmetric key; for an HS256 token it falls back to getUser() (GoTrueClient.js:5537-5544), which is one more HTTP call per request for every session, with or without two-step. The test stand-in signs with HS256 and says so (auth-stub.mjs:3). Which kind production's project uses is not in the repo.
- **Cost today:** One extra HTTP round trip per admin request for every account without a second factor, two per save, one per 60-second notice poll. Not timed here; the code review rates it severity 2. If production still signs with the shared secret, every admin request of every session makes one more. It grows with every owner who signs in without two-step once stores open. Paid by: The server per request and the owner on every navigation and save.
- **Saving:** One HTTP call per admin request for sessions without two-step, two per save (estimate: tens of milliseconds each; not measured). If production signs with HS256, one more per request for every session.
- **Risk:** Security-sensitive. What could break: an account with a verified factor let in on an old aal1 session because its mirror is null. The mirror is written in the same flow that verifies or removes a factor, and the sign-in reconcile covers a factor added elsewhere; the integration tests above must cover enrol, remove, reset by an owner and re-enrol. The platform's team is unaffected: with no factor they are held at enrolment already.
- **Already tracked:** code review step 3.8 (finding FV8): Open. The signing-key check is not written there.

## The fix

1. First look, by a person with access: in the Supabase dashboard of project ybsozesfuxuitoacntfo, Authentication, JWT signing keys. If tokens are still signed with the legacy shared secret (HS256), move to an asymmetric signing key (Supabase's own migration; no code change: getClaims() then verifies with the cached key set, fetched once per instance per 10 minutes). Record which it was in docs/decisions.md.
2. src/server/auth.ts:144-153: take the fast path the review names. two_step_since is already read in the same statement (line 138) and is written when a factor is verified (two-step.ts:190) and cleared on every removal and reset (two-step.ts:264, 341, 362). For an aal1 session whose row has two_step_since null and no re-enrolment pending, skip getUser(): the account has no verified factor. Keep getUser() when the mirror is set (the person must be held at the challenge) and whenever the row says re-enrol.
3. Close the gap the fast path opens: a factor added outside the app's own flow would not be in the mirror. At sign-in (the sign-in action and the two-step pages, which already call the Auth server) reconcile the mirror once from getUser(), so each session starts from the Auth server's answer.
4. src/server/auth.ts:158-175: move the mirror's write and the break-glass note into after(), as the review says, so they never hold a page.
5. Change the written rule with the code: src/lib/two-step.ts:8 and the comment at src/server/two-step.ts:32 say the mirror 'decides nothing'. Say instead that it decides only when to skip the Auth call for an account that has never verified a factor, and that it is reconciled at sign-in.
6. In the same change set step 3.8 of docs/audits/code-review-2026-11.md to Done with the date and commit, and add its change-log line.

**Done when:** With trust-fixtures, an aal1 account with no factor makes 0 getUser calls across two readSession() runs (1 each today), an aal1 account with a factor is still held, and step 3.8 in the code review's Progress table reads Done.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/admin-trust.int.test.ts and src/server/two-step.int.test.ts with src/server/trust-fixtures.ts (it records each getClaims and getUser call: assert no getUser for an aal1 account whose mirror is null, and one when it is set).
- e2e/signed-in/auth.setup.ts and the two-step specs in e2e/signed-in (a platform admin is still held at the second step; a member with a verified factor and an aal1 session is still sent to the challenge).
- Rule changed: src/lib/two-step.ts:8 and src/server/two-step.ts:32; docs/wave-1-trust.md 2.8 describes the gate.
- Code review step 3.8 (finding FV8): its own done-when is 'a second admin request within five minutes makes no call to Auth'.

**Notes:** Listed so the plan does not count it twice; do it as the review's step. The column fast path is preferred over a five-minute in-memory answer because the column is the same for every instance, while a memory kept per serverless instance is rarely hit and cannot be cleared on the others. The signing-key question is a five-minute look that may be worth more than the rest of this finding.
