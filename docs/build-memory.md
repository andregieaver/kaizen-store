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

- `next.config.ts` sets three things on Vercel only (`ON_VERCEL`):
  - no type check: CI's `static` job runs `pnpm typecheck` on every push, and CI's builds still check;
  - no Turbopack build cache;
  - one worker.
- `pnpm build` is `scripts/next-build.mjs`: `next build` with a 7 GB heap everywhere except Vercel.
- `src/app/globals.css` points Tailwind at `src` (without `src/data`) and the migrations' SQL.
  - The CSS lost 37 selectors, all of them words in docs, e2e selectors or numbers in the taxonomy's JSON. No class the app uses was lost.

## Watch

- **A type error can now reach production** without failing the deploy, when a push has no migration (those deploy before the checks finish). CI's `static` job still goes red.
- **The margin is about 0.8 GB.** If the build grows past it:
  - switch the project to Vercel's Enhanced build machine (16 GB, a paid setting the owner changes under Project Settings → Build and Deployment);
  - or cut what the compile holds.
- **Vercel environment variables:** a `NODE_OPTIONS` set there overrides none of this, but a large heap set there would let the compile hold more.
