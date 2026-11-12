# SF-4 ✓ The visit beacons load the whole application because of one re-exported helper

Server functions: size, cold start, per-request overhead (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.3.
- **Second check:** confirmed.
- **Where:** `src/app/api/visit/route.ts:3`, `src/server/chat-route.ts:7-12`, `src/server/chat-route.ts:34-38`, `src/lib/same-site.ts:6-14`, `src/app/admin/(gated)/[store]/customers/[customerId]/export/route.test.ts:9`
- **Evidence:** The beacon needs analytics-visits.ts (144 files on my graph). It also imports sameSite from src/server/chat-route.ts, which only re-exports it from src/lib/same-site.ts (a pure function of nine lines) and itself imports the chat agent, the AI client, the shop and support, and through them the cycle. 60 non-test files import chat-route.ts: 39 take only sameSite, 16 only fail and sameSite (counted from the import clauses). Re-measured: /api/visit loads 118 chunks (10.91 MB) and starts in 933 to 945 ms with 77.6 MB of heap and sharp's native binary; its trace is 449 files and 47.3 MB. Ten handlers enter the cycle through this one import: /api/visit, /api/visit/touch, /api/visit/speed, /api/visit/speed/own, /api/docs/feedback and five admin export routes.
- **Cost today:** About 0.7 s and 55 MB more than needed on each cold beacon instance. Paid by: The server per cold start; the shopper's browser holds the beacon request open for it. The beacon is sent once per page view by every store that counts visits, so it will be among the most-called functions after opening.
- **Saving:** Estimate: the beacon reaches 145 files instead of 1,306 and starts in about 0.25 s with 22 to 25 MB, by /api/ab/assign's measured 240 ms and 22.2 MB at 113 files. With SF-6 and SF-9 step 3 it reaches 99 files.
- **Risk:** Low: the function is unchanged, only its import path. A missed importer fails the type check, since the export is gone.

## The fix

1. The names are those of DP-10 of this review, which plans the same change: make it once.
2. New src/lib/route-fail.ts with the two-line fail() helper now at src/server/chat-route.ts:34-35 (no imports).
3. In the 39 files that take only sameSite from chat-route (rg -l 'import \{ sameSite \} from "(@/server|\.)/chat-route"' src lists them: the four /api/visit routes, 32 export, import, csv and tick routes under src/app/admin, src/app/s/[store]/[market]/account/privacy/export/route.ts, src/server/assistant-route.ts and src/server/replicate-route.ts) change the path to @/lib/same-site.
4. In the 16 files that take fail and sameSite, import sameSite from @/lib/same-site and fail from @/lib/route-fail. src/app/api/chat/route.ts and chat/voice/route.ts do the same and keep chatContext, chatPlace and takeTurn from chat-route; src/server/support-route.ts:11 takes fail from @/lib/route-fail and keeps chatPlace.
5. src/server/chat-route.ts: delete the re-export at line 38 and the local fail at lines 34-35; import fail from @/lib/route-fail for its own use. After this nobody can take sameSite from the chat's module by habit.
6. src/app/admin/(gated)/[store]/customers/[customerId]/export/route.test.ts: delete the vi.mock of @/server/chat-route at line 9; the route now imports the real function.
7. Add the four /api/visit routes to src/server/route-load.graph.test.ts (SF-7): fewer than 160 files each, none reaching src/server/chat-route.ts or a file that imports sharp.

**Done when:** src/server/route-load.graph.test.ts passes with each of the four /api/visit routes under 160 files by static value imports (1,306 today), and rg -n 'sameSite' src/server/chat-route.ts prints nothing.

**Tests and rules that hold today's behaviour, and change with it:**

- src/app/admin/(gated)/[store]/customers/[customerId]/export/route.test.ts (its mock of chat-route goes).
- src/server/support.int.test.ts and support-tools.int.test.ts import chatContext and takeTurn from ./chat-route: unchanged.
- src/lib/security-routes.scan.test.ts and src/lib/api-routes.scan.test.ts do not name chat-route or sameSite (searched), so no scan pins the old path; run them all the same, since they read every route.
- No written rule names where sameSite lives.

**Comes after:** SF-7 steps 1 and 2 (to hold it)

**Notes:** The cheapest large saving in this dimension: an afternoon, no behaviour change, and it frees the function every page view calls.
