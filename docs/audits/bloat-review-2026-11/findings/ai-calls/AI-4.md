# AI-4 ✓ The owner's browser downloads the model's whole tool catalogue and admin map

What every AI call carries (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.11.
- **Second check:** confirmed.
- **Where:** `src/components/admin/ai-manager.tsx:9`, `src/components/admin/ai-manager.tsx:11`, `src/components/admin/ai-manager.tsx:13`, `src/components/admin/ai-manager.tsx:328`, `src/components/admin/ai-manager.tsx:392-394`, `src/lib/manager-tools.ts:3`, `src/lib/manager-tools.ts:318`, `src/lib/admin-map.ts:1461-1490`, `src/lib/admin-messages/pages.nb.ts:2`, `e2e/signed-in/ai-manager-panel.spec.ts:12`, `docs/performance.md:153-160`
- **Evidence:** The chat (a client component) imports TOOL_WORDS from src/lib/manager-tools.ts, whose first import is ./owner-tools, matchPath from src/lib/admin-map.ts and PAGES_NB from the Norwegian page list. In the finished build .next/static/chunks/00rxgygh1f--7.js is 496,206 bytes (144,326 gzip; both measured here). The skeptic found every one of the 319 tool descriptions and 392 of 416 page descriptions in it by substring. The bundle analyzer's module list for the admin route says the same from the other side: among the client code loaded later, owner-tools.ts is 158,819 bytes, admin-map.ts 150,622, pages.nb.ts 52,925, manager-tools.ts 30,614, and twelve more tool and autopilot files 44,773: 437,753 bytes, against ai-manager.tsx itself at 18,071. The browser uses the 13,226 characters of TOOL_WORDS (ai-manager.tsx:328) and one matchPath() call that reads a page's id, area and title, with the Norwegian title (ai-manager.tsx:392-394). The only other importer of matchPath in components is a server file (src/components/docs/docs-routes.tsx).
- **Cost today:** About 370 KB of 496 KB that nothing in the browser reads, downloaded and parsed when the panel is first opened (and on the assistant's own page). Paid once per owner per session; it grows with every tool and admin page added. Paid by: An owner's browser, on the first opening of the AI manager in a session.
- **Saving:** About 370 KB raw of 496 KB (estimate from the analyzer's module sizes: 437,753 bytes of tool tables, admin map and Norwegian page list leave, 66,690 come back as slim lists), roughly 100 KB of the 144 KB gzip (estimate). The skeptic's floor, counted as text found in the chunk, is 259 KB.
- **Risk:** Low: labels and page names are data. A generated list can go stale; the unit test catches it. If another client component later imports manager-tools or admin-map the weight comes back; the panel's budget catches that.
- **Already tracked:** Partly: docs/performance.md:153-160 records the chunk (0.48 MB) and made it load on first opening (D444, done). What is inside it is not tracked.

## The fix

1. New file src/lib/tool-words.ts with no imports: move the TOOL_WORDS record there as it is (it starts at src/lib/manager-tools.ts:318). In manager-tools.ts leave `export { TOOL_WORDS } from "./tool-words";` so the 23 test files that import it from ./manager-tools keep working.
2. src/components/admin/ai-manager.tsx:11: import TOOL_WORDS from "@/lib/tool-words".
3. New file src/lib/admin-page-names.ts with no imports: `ADMIN_PAGE_NAMES`, one `{ id, area, path, title }` per admin page (416 entries, 36,929 characters as JSON by my measure), and `matchPageName(pathname)`: the matching code of matchPath() (src/lib/admin-map.ts:1461-1490) moved here. matchPath() in admin-map.ts calls it and looks the full page up in ADMIN_PAGES_BY_ID, so there is one matcher. The list is written from ADMIN_PAGES by a new scripts/admin-page-names.mjs.
4. New file src/lib/admin-messages/page-titles.nb.ts: the Norwegian titles only (16,535 characters against 54,585), written by the same script from PAGES_NB.
5. src/components/admin/ai-manager.tsx lines 9, 13 and 392-394: use matchPageName() and the titles file. Nothing else in the chat reads the map.
6. src/lib/admin-map.test.ts: a case that fails when ADMIN_PAGE_NAMES or the Norwegian titles differ from what ADMIN_PAGES and PAGES_NB give, with the script's name in the message.
7. e2e/signed-in/ai-manager-panel.spec.ts: after the press that opens the panel, add up the bytes of the scripts requested since the press and hold them under a budget set from the first measure with about 10% of room (expected about 125,000 bytes raw: today's 496,206 minus 437,753, plus 66,690 for the three slim lists).
8. docs/performance.md after line 160: the chunk's new size and that its budget lives in the panel's spec.

**Done when:** In e2e/signed-in/ai-manager-panel.spec.ts the scripts fetched on first opening the AI manager are under 140,000 bytes raw (496,206 today).

**Tests and rules that hold today's behaviour, and change with it:**

- 23 unit test files import TOOL_WORDS from ./manager-tools (for example src/lib/field-tools.test.ts:18, src/lib/tool-budget.test.ts:3): kept working by the re-export.
- src/lib/admin-map.test.ts (every page is in the map; add the generated lists' check).
- e2e/signed-in/ai-manager-panel.spec.ts (the screen asks for the chat's scripts only on opening): gains the budget. e2e/signed-in/admin-scripts.spec.ts is not affected (first scripts only).
- src/lib/brand.scan.test.ts reads every string: the new files hold only strings that exist today.
- docs/performance.md:153-160; docs/rules/admin/ai.md (a new tool has 'a line in TOOL_WORDS': say the file's new name).

**Notes:** On the server the same tables are part of every admin page's code: the store admin's layout imports the AI manager's actions (src/app/admin/(gated)/[store]/layout.tsx:32-40), and the analyzer lists owner-tools.ts, admin-map.ts, server/owner-tools.ts and assistant-skills.ts among the modules loaded with the /admin/[store] route (about 730 KB of its 12.6 MB). What that costs a cold start belongs to the admin-server dimension; it is noted here so the two fixes are planned together.
