# SG-3 ✓ The visit beacon and 52 other routes import the chat agent to get a ten-line function

The server code every route loads (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.4.
- **Second check:** confirmed.
- **Where:** `src/app/api/visit/route.ts:3`, `src/app/api/shop/tiles/route.ts:4`, `src/app/api/recommendations/events/route.ts:4-5`, `src/server/chat-route.ts:8`, `src/server/chat-route.ts:34-38`, `src/lib/same-site.ts:6`, `src/server/replicate-route.ts:8`, `src/server/assistant-route.ts:12`, `src/server/chat-agent.ts:185`
- **Evidence:** sameSite() lives in src/lib/same-site.ts and imports nothing. chat-route.ts re-exports it (line 38) and also imports chat-agent.ts, private-mode.ts, shop.ts and support.ts (lines 7-12). I counted the importers again: 61 non-test files import chat-route; 37 take only sameSite and 16 take fail and sameSite (53 route files), replicate-route.ts and assistant-route.ts take sameSite, and only the two chat routes and four support modules use anything else. On /api/visit this import is the only edge into the cycle of SG-1: route.ts -> chat-route.ts -> chat-agent.ts -> recommend.ts -> customers.ts -> privacy-erasure.ts -> retention.ts -> order-rules.ts -> follow-ups.ts -> owner-tools.ts (chain traced on the build's graph). Removing that one edge in the build's graph takes the route from 2,015 module paths and 10,420 KB to 708 and 1,898 KB (re-run here, same numbers as the skeptic). /api/recommendations/events has a second such import: visitorKey from chat-agent.ts, which only re-exports it from chat-turns.ts (chat-agent.ts:185).
- **Cost today:** About 8.5 MB and 1,300 modules on each of the four visit beacons, and about 0.65 to 0.75 s of their 0.9 to 1.3 s cold load on this machine (estimate by calibration: a measured route of 685 modules and 1.75 MB loads in 0.24 s). The built entry names 117 chunks, 11,130 KB (sum of the files its R.c() calls name). Paid by: The server on each cold instance of /api/visit, /api/visit/touch, /api/visit/speed and /api/visit/speed/own. The beacon is called once per page view of every store that counts visits, so it becomes the most-called function once shoppers arrive, and every push to main makes all its instances cold again.
- **Saving:** /api/visit: 2,015 -> 708 module paths, 10.4 -> 1.9 MB (simulated on the build's graph, one edge; reproduced). With SG-6: 663 and 1.17 MB. With SG-9: 465 and 0.96 MB. Ten handlers leave the over-1,500 group on this change alone: the four visit beacons, five admin export routes and /api/docs/feedback. Cold load of the beacon from 0.9 to 1.3 s toward about 0.25 s here (estimate by calibration, not a Vercel figure). /api/shop/tiles does not move with this alone: it also needs SG-1.
- **Risk:** Very low: the function is the same one, only its import path changes. A missed importer fails the type check at once (the re-export is deleted).
- **Already tracked:** Not in the code review, PSI follow-ups or docs/performance.md. Planned twice in this review from other sides: deps DP-10 and families FM-2 and FM-14 (same change; do it once).

## The fix

1. New file src/lib/route-fail.ts, no imports, holding the two-line fail() helper now at src/server/chat-route.ts:34-35 (the name the deps and families plans, DP-10 and FM-14, also use).
2. In the 39 files whose only import from chat-route is sameSite (rg -l 'import \{ sameSite \} from "(@/server|\.)/chat-route"' src): change the path to '@/lib/same-site'. That is the four routes under src/app/api/visit, 32 export, import and tick routes under src/app/admin/(gated), src/app/s/[store]/[market]/account/privacy/export/route.ts, and src/server/replicate-route.ts:8 and src/server/assistant-route.ts:12.
3. In the 16 routes that take fail and sameSite (rg -l 'import \{ fail, sameSite \}' src): sameSite from '@/lib/same-site', fail from '@/lib/route-fail'.
4. src/app/api/chat/route.ts:4 and src/app/api/chat/voice/route.ts:8: take sameSite and fail from the two lib files; keep chatContext, chatPlace and takeTurn from chat-route. src/server/support-route.ts:11: fail from '@/lib/route-fail'.
5. src/server/chat-route.ts: delete the re-export and its comment at lines 37-38 and the local fail at 34-35; import fail from '@/lib/route-fail' for its own use. After this no file can take sameSite from the chat module, so the edge cannot come back by habit.
6. src/app/api/recommendations/events/route.ts:4: import visitorKey from '@/server/chat-turns' (where it is defined, chat-turns.ts:22), not from chat-agent.ts.
7. src/app/admin/(gated)/[store]/customers/[customerId]/export/route.test.ts:8-9: delete the vi.mock of '@/server/chat-route'; the route now imports the real function.
8. Add the four visit routes to the guard of SG-14 (no reach of chat-route.ts, auth.ts, admin-text.ts, schema.ts, the stripe package or sharp).
9. Build. Sum the chunks the entry names (node -e over the R.c("...") list in .next/server/app/api/visit/route.js) and run next analyze export for /api/visit; write both numbers under a new heading 'What a server route loads' in docs/performance.md.

**Done when:** A new next analyze export shows /api/visit at or under about 710 modules and 1.9 MB of server code loaded with the route (today 1,890 modules and 10,475 KB); equally, the chunks named by R.c() in .next/server/app/api/visit/route.js sum to under 2.5 MB (today 11,130 KB); and rg -n sameSite src/server/chat-route.ts prints nothing.

**Tests and rules that hold today's behaviour, and change with it:**

- src/app/admin/(gated)/[store]/customers/[customerId]/export/route.test.ts:9 mocks @/server/chat-route only to hand over sameSite: the mock goes, the test must still pass.
- src/server/support.int.test.ts:228, 561, 570 and src/server/support-tools.int.test.ts:30 import chatContext and takeTurn from ./chat-route: unaffected.
- src/server/analytics-visits.int.test.ts and the speed beacons' tests hold the beacon's behaviour: unchanged, must pass.
- docs/security.md:77 already names src/lib/same-site.ts as the home of sameSite(): no edit. No rule in docs/rules or CLAUDE.md names the import path (rg sameSite).
- New: the visit routes in src/server/route-load.graph.test.ts (SG-14).

**Notes:** Do this first: it is the largest saving per line changed in the whole dimension. The beacon still loads 85 KB of analytics admin text afterwards (src/lib/analytics-words.ts imports admin-messages/analytics.en.ts and analytics.nb.ts through src/lib/analytics-traffic.ts); that is small and left alone.
