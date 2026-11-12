# TC-7 ✓ Three cold builds per push; the hosts job builds the whole app for 25 tests

Tests, CI and the build (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** M. **Confidence:** medium. **Step:** 3.11.
- **Second check:** confirmed.
- **Where:** `.github/workflows/ci.yml:116-166`, `.github/workflows/ci.yml:170-210`, `.github/workflows/ci.yml:215-258`, `.github/workflows/ci.yml:338-347`, `playwright.config.ts:9`, `playwright.config.ts:36-48`, `e2e/smoke.spec.ts:146-150`, `src/lib/ci-playwright.scan.test.ts:29-40`
- **Evidence:** e2e, hosts and signed-in each install, seed and run `pnpm build` (ci.yml:149-152, 203-206, 246-249). The hosts job then runs 4 spec files with 25 tests (ci.yml:208). The e2e and signed-in builds differ only in NEXT_PUBLIC_SUPABASE_URL and its key (ci.yml:236-237); E2E_SIGNED_IN is read by playwright.config.ts:9 alone, not by the app. Playwright's config sets no shards and no workers; 573 and 208 tests run in two unsharded jobs. Several unsigned specs test the admin 'without a session' and one accepts a health answer of 200 or 503 because Supabase is not configured in that build (e2e/smoke.spec.ts:148).
- **Cost today:** Each extra build is about 80 s once the type check is out (262 s less 183 s here), plus an install of a 939 MB node_modules, a seed and a runner to wait for. Vercel then builds a fourth time, and that build is the only one never tested. Paid by: CI on every code push
- **Saving:** One build without its type check (about 80 s here), one install and one seed per push: about 3 to 4 runner-minutes (estimate), and one runner fewer to wait for.
- **Risk:** Medium. What could break: unsigned specs that assume Supabase is not configured; they would fail in the trial of step 1, before any CI change. One longer job replaces two shorter ones, so a migration release may wait longer unless it is sharded.
- **Already tracked:** Yes. Code review FH10, step 1.8, Open: share one build, shard Playwright, CI builds the app twice at most. New here: the 25-test count and the check of what differs between the builds.

## The fix

1. After TC-1. Try it locally first: build once with the signed-in job's two variables (NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3912 and its key), then run the unsigned projects against that build (`pnpm test:e2e` with the auth stand-in started). List the specs that fail; expected candidates are e2e/smoke.spec.ts:146-150 (health) and e2e/csp.spec.ts (the policy names Supabase's host).
2. If the list is short, fix those specs to hold in both builds and merge the two jobs: one job with the signed-in job's env, the steps install, seed, build, `playwright install chromium webkit`, then `pnpm exec playwright test` with E2E_SIGNED_IN=1 so every project runs. If the job passes 20 minutes, add a matrix with `--shard=${{ matrix.shard }}/2`; each shard then builds once, which is still two builds.
3. Leave hosts as it is: its three NEXT_PUBLIC host variables change the routing built into the app (next.config.ts:91-103).
4. Update `release` (ci.yml:339-347: needs and if) to the new job names, the comments at ci.yml:40-42 and 212-214, and src/lib/ci-playwright.scan.test.ts:31 and :37, which expect at least four image tags and the browser jobs e2e, hosts, scan and signed-in.
5. Tick what this closes of step 1.8 in the code review's Progress table.

**Done when:** A push to main runs `pnpm build` in two CI jobs at most (the done-when of code review step 1.8), and `release` still needs every browser suite.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/ci-playwright.scan.test.ts:29-40 lists the browser jobs by name and counts image tags: must change with the jobs.
- CLAUDE.md, Commands: the signed-in tests run 'only with E2E_SIGNED_IN=1, in a build whose NEXT_PUBLIC_SUPABASE_URL is the Auth stand-in ... as CI's signed-in job does'. The rule (the stand-in is the only fake) is kept; the sentence names the job.
- Code review step 0.1 (Done): release needs hosts and signed-in. The merged job must be in `needs` and in the `if`.
- docs/ci-migrations.md where it names the jobs release waits for.

**Comes after:** TC-1

**Notes:** After TC-1 the remaining prize is small (about 80 s of build and an install). It is worth doing with step 1.8, whose larger half is the owner's choice between the 16 GB build machine and a prebuilt deploy (question 2 of the code review).
