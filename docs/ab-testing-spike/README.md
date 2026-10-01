# A/B testing: the phase 0 spike

Throwaway code that proved the serving design in [`../ab-testing.md`](../ab-testing.md). Not part of the app: the files
end in `.example` so the build ignores them.

To run it (on a branch, never on `main`):

1. Seed a scratch database (`node scripts/db-setup.mjs --seed`) and add a published copy of the demo store's `om-oss`
   page as `om-oss-b` with a changed heading.
2. Copy `proxy.ts.example` to `src/proxy.ts`, `variant-page.tsx.example` to
   `src/app/s/[store]/[market]/[slug]/ab/[variant]/page.tsx`, and (for the flicker comparison) `hole-page.tsx.example`
   to `src/app/s/[store]/[market]/hole/[slug]/page.tsx`.
3. `pnpm build && pnpm start`, then
   `node scripts/ab-ttfb.mjs http://localhost:3000 /s/demo/no/om-oss "kaizen_ab=exp1.b" 300` and the same without the
   cookie (arguments: base URL, path, cookie header, requests).

On a Vercel preview, use the preview's URL instead and read the `x-vercel-id` header to see which regions the request
touched.

The variant page is the original page's code reading the page `{slug}-{variant}`; a real variant is the experiment's
own page. The proxy's list of running experiments is a hard-coded map standing in for a cached database read.
