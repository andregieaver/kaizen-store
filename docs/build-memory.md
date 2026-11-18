# The build's memory on Vercel (D378)

Production deploys failed from 27 October 2026 (`72751a02`) to 28 October: the build ran out of memory. The last good deploy was
`d865c02b`. This note records what was measured and what was changed.

## What was measured

The build was run in this repository's sandbox (4 cores, like Vercel's standard build machine), under a cgroup memory cap of
8 GB, the size of that machine, and sampled every second per process. The database was the seeded one (850 prerendered pages).

| Setup | Outcome under 8 GB |
| --- | --- |
| As deployed before 28 October (`next build`, Node's default heap) | The type check died: "JavaScript heap out of memory" (its heap limit was about 2 GB) |
| As deployed on 28 October (`--max-old-space-size=7168`) | Killed (exit 137) when the type check started, the compile's memory still held |
| No type check, default heap | Killed when the page-data workers started |
| No type check, no Turbopack build cache | Killed when the page-data workers started (compile 5.8 GB instead of 7.2 GB) |
| No type check, no build cache, one worker | Passed |
| The same, with Tailwind's scan scoped (below) | Passed, peak about 7.2 GB of process memory |

What held the memory, measured without the cap:

- **Turbopack's compile:** about 7.2 GB in the `next build` process with its build cache, and 5.8 GB without. This is native memory, outside Node's heap, and it is held until the pages start rendering.
- **The type check:** a `tsc` of about 5 GB, and it needs a 7 GB heap limit to finish. It starts before the compile's memory is let go.
- **Page data and rendering:** each worker holds about 1.3 to 1.9 GB, and three of them start by default.
- **Tailwind's PostCSS worker:** 750 MB. Tailwind read every file git tracks, among them the 560 MB of Drizzle snapshots in `supabase/migrations/meta` and the taxonomy's 13 MB of JSON.

## What changed

- `next.config.ts` sets these on Vercel only (`ON_VERCEL`):
  - no type check: CI's `static` job and the quick gate run `pnpm typecheck` on every push. Since 16 November 2026 (bloat review step 0.38) CI's three browser builds skip it too (`SKIP_BUILD_TYPECHECK=1`): one push checked the same commit five times, 183 s each;
  - no Turbopack build cache;
  - one worker;
  - no source maps (D709, 17 November 2026, measured below; `serverSourceMaps` too since step 1.20, 18 November 2026).
- The source-map switches step 1.21 weighed, from the rows of step 1.20 below: `serverSourceMaps: false` is on for Vercel (peak 6.8 GB under the 8 GB cap,
  from 7.6 to 7.8 GB without it); `enablePrerenderSourceMaps: false` gained nothing (7.9 GB) and is not set. `serverSourceMaps` was already in
  `next.config.ts` (step 1.20), so commit 2 of step 1.21 adds no switch to it.

Stage 2 is needed.
Peak with the switches: 6.8 GB; step 1.29 builds in CI and deploys the prebuilt output.

- `pnpm build` is `scripts/next-build.mjs`: `next build` with a 7 GB heap everywhere except Vercel.
- `src/app/globals.css` points Tailwind at the code under `src`: without `src/data`, tests (`*.test.ts`, `*.test.tsx`, `src/test`), the interface texts (`src/lib/messages`, `src/lib/admin-messages`) and `src/db`, and without any SQL.
  - The CSS lost 37 selectors, all of them words in docs, e2e selectors or numbers in the taxonomy's JSON. No class the app uses was lost.
  - Narrowed on 16 November 2026 (bloat review step 0.35). Measured on 12 November 2026: the SQL and the message files added no
    class, and the tests added ten that nothing draws (order-1038, order-1042, col-1, row-1, row-2, m-1, sepia, block-1, md:mr-0,
    lg:ml-auto). D378 put the SQL in on purpose, in case seeded content carried a class: the baseline files hold no class
    attribute, a seeded page's classes are the themes' own names, and content made in production never passes through a build, so
    it could never rely on the scan. Tailwind reads about 3,984 files, not 5,931.

## Watch

- No paid build machine, plan or add-on is used, now or later (the owner, bloat review step 1.21). If the build needs room: the two
  source-map switches below, then the build in CI deployed prebuilt (step 1.29).
- **A type error can now reach production** without failing the deploy, when a push has no migration (those deploy before the checks finish). CI's `static` job still goes red.
- **The margin was about 0.8 GB on 28 October** (about 1 to 1.7 GB since D709, below). If the build grows past it:
  - cut what the compile holds;
  - or build in CI and deploy the built output (bloat review step 1.29, the free way).
- **Vercel environment variables:** a `NODE_OPTIONS` set there overrides none of this, but a large heap set there would let the compile hold more.
- **11 November 2026: the margin was crossed once.** Vercel's build of `f5c1ec8` (D555) was killed for memory while collecting page data
  with one worker; the same commit built when the deploy hook was asked again a few minutes later. On 17 November it happened twice
  (`d066e58d`, `0624ff3c`); the next section is what was done.
- **Every build ends with a line**, `Build: N s, peak memory X GB (source)` (`scripts/next-build.mjs`, step 1.20), on Vercel too: it is the last line of the build log. Read the peak
  there after each deploy (the source is the container's own peak when the kernel keeps one, else the machine's used memory, which counts every process on the machine).
  CI's builds print the same line into the run's summary. `scripts/ci-budgets.json` holds the ceilings on every check's seconds, filled from ten CI runs on `main`
  (`node scripts/ci-budgets-check.mjs --suggest`); the build's peak memory is read by hand from Vercel's log and written under the next heading.
- **Source-map switches, 18 November 2026 (step 1.20, measured below).** The peak with `serverSourceMaps: false` was 6.8 GB under the 8 GB cap against 7.6 to 7.8 GB without it
  (two runs); `enablePrerenderSourceMaps: false` alone gained nothing (7.9 GB). The first stays, on Vercel only; the second is not kept.
  If the peak with a switch is 6.0 GB or less, the build has a quarter of the machine free; nothing is paid for either way, and the free
  way past that is to build in CI and deploy the built output (step 1.29). At 6.8 GB the peak is above 6.0 GB, so that step does not wait.

### What every build reports

A production build ends by writing `build-stats.json` in the repository root (`scripts/next-build.mjs`, step 1.21): the commit, the build's
seconds, its peak memory, the build machine's memory and the peaks of the ten builds before it (numbers and a commit hash only; the file is
git-ignored). The peak is read as in the `Build:` line: the container's own peak where the kernel keeps one, else the machine's memory in
use, sampled each second. The ten earlier peaks are read from production's `/api/health` when a production build starts, so no store is
needed. `next.config.ts` traces the file with the health route, so `/api/health` carries it as `build` (public, numbers only), and the
wait for the deploy (`scripts/await-deploy.mjs`) prints the build's line against its ceiling in the run's summary under
`### Production build`. The ceiling is the median of the last ten production builds plus 10%, never above 75% of the machine
(`scripts/lib/build-stats.mjs`); until a later commit turns it on, a build above it is only printed.

## Measured again, 17 November 2026 (D709)

The same way as above: the seeded database (`node scripts/db-setup.mjs --seed`, 1,471 pages generated, 850 on 28 October), `VERCEL=1`
so `next.config.ts` takes Vercel's settings, a cgroup v1 memory cap in the sandbox (4 cores), each process's resident memory sampled
every second. "Peak" is the build's whole resident memory.

| Setup (commit `2a4a6650`) | Compile (`next build` process) | Peak | Under an 8 GB cap |
| --- | --- | --- | --- |
| As deployed (no type check, no build cache, one worker) | 7.5 GB, 113 to 126 s | 8.35 GB uncapped | **Killed** (two OOM kills) as page data started, right after "Compiled successfully": Vercel's failure |
| The same, without source maps (`turbopackSourceMaps`, `turbopackInputSourceMaps` off) | 6.2 to 6.3 GB, 102 s | 6.3 to 7.0 GB | Passed |

**What grew.** The compile's memory follows the code it compiles. Since this note was written (28 October, `57369a11`) the source
outside tests went from 28.4 MB to 38.9 MB (+37%), pages from 480 to 588, routes from 189 to 280, and new packages came in
(CodeMirror, rrweb, signpdf, pdf-lib, node-forge, subset-font). The compile went from 5.8 to 7.5 GB with it. Nothing else had
grown: `outputFileTracingIncludes` is traced after the compile, prerendered pages are rendered by the one worker after the compile has
let go (it peaks at about 1.5 to 1.7 GB, at a time the compile holds about 1.1 GB), Tailwind's `@source` lines were narrowed on
16 November (D667) and its worker stays under 200 MB.

**What was cut.** Turbopack wrote 8,129 server source maps (366 MB on disk) and held them in memory while compiling. Production
never reads them: Vercel's functions run Node without `--enable-source-maps` (no `NODE_OPTIONS` is set on the project), Next turns
server maps on only for its debug prerender, and browser maps were never made (`productionBrowserSourceMaps` is off). Stacks in the
logs (`log.ts`'s `errorStack`) were, and stay, positions in the built chunks. Off on Vercel only; a local or CI build still writes them.

**The margin is about 1.0 to 1.7 GB** against 8 GB (peaks of 6.3 to 7.0 GB). At the rate the code grew over these three weeks the
compile gains about 0.5 GB a week, so this buys **two to three weeks, not a lasting answer.** There is no other large, safe cut left
in the configuration: what remains is the compile of the code itself. The owner has ruled out a paid build machine, so the lasting
answer is bloat review step 1.29's free way: build in CI and deploy the built output. After it, the one-worker and no-source-map
settings can stay or go, and this note should say which.

## Measured again, 18 November 2026 (bloat review step 1.20)

The two source-map switches the first measurement did not try, one build each under a cgroup v1 memory cap of 8 GB with swap off, `VERCEL=1`, the seeded
database (1,524 pages), a build directory cleared before each run, one build at a time (the machine's other builds ran beside it). "Peak" is the cgroup's own
highest use (`memory.max_usage_in_bytes`, GB of 1,024 MB), which counts the files the build reads and writes as well as its processes, so it reads higher than
the resident figures above; the rows compare with each other. The `Build:` line's own peak (the machine's used memory) was 7.8 to 14.0 GB because other builds ran
at the same time, and is not the figure. No build was killed.

| Setting (the tree after commit 1 of step 1.20, `next.config.ts` as noted) | Peak under the 8 GB cap | Seconds | Date |
| --- | --- | --- | --- |
| (a) As the code is (`turbopackSourceMaps` and `turbopackInputSourceMaps` off), first run | 7.83 GB | 235 | 18 Nov 2026 |
| (a) The same, second run (how much two runs differ) | 7.63 GB | 222 | 18 Nov 2026 |
| (b) With top-level `enablePrerenderSourceMaps: false` on Vercel | 7.85 GB | 188 | 18 Nov 2026 |
| (c) With (b) and `experimental.serverSourceMaps: false` | 7.21 GB | 171 | 18 Nov 2026 |
| (d) With `serverSourceMaps: false` alone | 6.84 GB | 198 | 18 Nov 2026 |

`enablePrerenderSourceMaps` gained nothing (0.0 to 0.2 GB above (a): inside the 0.2 GB between the two runs of (a)), so it is not in `next.config.ts`. `serverSourceMaps: false`
gained 0.8 to 1.0 GB over (a) alone and 0.4 to 0.6 GB with the other switch, more than 0.3 GB each time, so it stays in `next.config.ts` for Vercel only; CI's and local builds
keep their source maps. The name `turbopackSourceMaps` (already off since D709) is the Turbopack one in this Next version's config type, `serverSourceMaps` is the
generic one beside it.
