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
  - no source maps (D709, 17 November 2026, measured below).
- `pnpm build` is `scripts/next-build.mjs`: `next build` with a 7 GB heap everywhere except Vercel.
- `src/app/globals.css` points Tailwind at the code under `src`: without `src/data`, tests (`*.test.ts`, `*.test.tsx`, `src/test`), the interface texts (`src/lib/messages`, `src/lib/admin-messages`) and `src/db`, and without any SQL.
  - The CSS lost 37 selectors, all of them words in docs, e2e selectors or numbers in the taxonomy's JSON. No class the app uses was lost.
  - Narrowed on 16 November 2026 (bloat review step 0.35). Measured on 12 November 2026: the SQL and the message files added no
    class, and the tests added ten that nothing draws (order-1038, order-1042, col-1, row-1, row-2, m-1, sepia, block-1, md:mr-0,
    lg:ml-auto). D378 put the SQL in on purpose, in case seeded content carried a class: the baseline files hold no class
    attribute, a seeded page's classes are the themes' own names, and content made in production never passes through a build, so
    it could never rely on the scan. Tailwind reads about 3,984 files, not 5,931.

## Watch

- **A type error can now reach production** without failing the deploy, when a push has no migration (those deploy before the checks finish). CI's `static` job still goes red.
- **The margin was about 0.8 GB on 28 October** (about 1 to 1.7 GB since D709, below). If the build grows past it:
  - switch the project to Vercel's Enhanced build machine (16 GB, a paid setting the owner changes under Project Settings → Build and Deployment);
  - or cut what the compile holds.
- **Vercel environment variables:** a `NODE_OPTIONS` set there overrides none of this, but a large heap set there would let the compile hold more.
- **11 November 2026: the margin was crossed once.** Vercel's build of `f5c1ec8` (D555) was killed for memory while collecting page data
  with one worker; the same commit built when the deploy hook was asked again a few minutes later. On 17 November it happened twice
  (`d066e58d`, `0624ff3c`); the next section is what was done.

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
in the configuration: what remains is the compile of the code itself. The lasting answer is Vercel's Enhanced build machine (16 GB,
Project Settings → Build and Deployment, a paid setting the owner changes); after it, the one-worker and no-source-map settings can
stay or go, and this note should say which.
