# The two hub edits, measured in a copy (11 Nov 2026)

A throwaway copy of commit 0bd814c with exactly two edits, then `next analyze --output` and `scripts/server-graph.mjs`'s reading
of it. Nothing was type-checked or deployed: it measures the saving, it is not the fix.

1. In `src/app/api/visit/route.ts`, `touch/route.ts`, `speed/route.ts` and `speed/own/route.ts`:
   `import { sameSite } from "@/server/chat-route"` became `import { sameSite } from "@/lib/same-site"` (the chat module only
   re-exports it, at line 38).
2. In `src/db/client.ts`: `import * as schema` became `import type * as schema`, and `drizzle({ client: pool, schema })`
   became `drizzle({ client: pool })`.

| Route | Server code loaded with the route, before | After |
|---|---|---|
| /api/visit | 10,475 KB in 1,890 modules | 1,188 KB in 639 modules |
| /api/health | 1,155 KB in 308 modules | 417 KB in 259 modules |
| /api/shop/tiles | 10,478 KB in 1,893 modules | 9,863 KB in 1,887 modules |
| /s/[store]/[market] | 11,944 KB in 2,419 modules | 11,329 KB in 2,413 modules |
| /admin/[store] | 12,316 KB in 2,414 modules | 11,702 KB in 2,408 modules |

`src/db/schema.ts` (597 KB built) left every route. `src/lib/admin-messages` in the visit beacon fell from 2,903 KB to 85 KB;
the other routes still load all of it (step 2.1). What the beacon still loads comes through `recordVisit()` and `getOpenStore()`.
