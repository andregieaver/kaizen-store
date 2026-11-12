# AC-8 ✓ The AI manager's chat downloads every tool definition, the admin map and the Norwegian page names to label a tool call

What an owner's browser loads in the admin (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 0.9.
- **Second check:** confirmed.
- **Where:** `src/components/admin/ai-manager.tsx:9`, `src/components/admin/ai-manager.tsx:11`, `src/components/admin/ai-manager.tsx:13`, `src/components/admin/ai-manager.tsx:328`, `src/components/admin/ai-manager.tsx:392`, `src/lib/manager-tools.ts:3`, `src/lib/manager-tools.ts:318`, `src/components/admin/ai-manager-launcher.tsx:32`, `src/components/admin/ai-skills.tsx:7`, `src/lib/saved-skills.ts:6`, `src/app/admin/(gated)/[store]/assistant/actions.ts:28`
- **Evidence:** Chunk 00rxgygh1f--7.js is 496,206 bytes raw / 143,978 gzip. ai-manager.tsx imports one table, TOOL_WORDS (about 13,900 bytes of source, manager-tools.ts lines 318-621), from manager-tools.ts (36 KB), which imports owner-tools.ts (208 KB) and through it the product, site and setup tools; it imports matchPath from admin-map.ts (172 KB) and PAGES_NB (61 KB) to name the current page in one suggested question (lines 392-394). My closure of the chat: 209 files, 2,943,188 bytes of source; without those three imports 39 files, 302,869 bytes. What is left is led by assistant-skills.ts (62,620 bytes), reached because ai-skills.tsx takes three length limits from saved-skills.ts, which imports the built-in skills.
- **Cost today:** 496 KB raw / 144 KB gzip the first time the panel opens, again after each deploy that changes a tool's description or a page's name, and in the first load of the two assistant screens (2,056,681 and 2,064,667 bytes). Paid by: An owner's browser, when the AI manager is opened. The cost follows use; the chunk is about five times larger than the chat needs.
- **Saving:** Estimate from source sizes: about 400 KB raw / 115 KB gzip of the 496 KB chunk, and the same off the two assistant screens.
- **Risk:** Low. The first suggestion now waits for one small call per page while the panel shows its suggestions; it must still follow a navigation made with the panel open. It would show in the ai-manager-panel spec.
- **Already tracked:** docs/performance.md lines 154-160 records the 0.48 MB chunk and made it load on opening (4 November); its size is not a step anywhere.

## The fix

1. Create src/lib/tool-words.ts with TOOL_WORDS moved as it is (manager-tools.ts lines 317-621; it imports nothing). manager-tools.ts adds `export { TOOL_WORDS } from "./tool-words";` so the 30 test files that import it from ./manager-tools keep working. src/components/admin/ai-manager.tsx line 11 imports it from "@/lib/tool-words".
2. The page's name from the server: add pageHere(pathname): Promise<string | null> to AiManagerActions (ai-manager.tsx lines 27-35). Write pageHereAction in src/app/admin/(gated)/[store]/assistant/actions.ts and platform/assistant/actions.ts with the guard their start action uses: matchPath(pathname), the rule now at ai-manager.tsx lines 392-393 (not the assistant's own page; the page's area is the place's or "account"), and the title from PAGES_NB for a Norwegian account, else the page's own. Bind it where the other actions are bound: [store]/layout.tsx lines 119-127, platform/layout.tsx, and the two assistant pages.
3. ai-manager.tsx: remove the imports at lines 9 and 13. Keep the name in state; ask for it in an effect on the path, only while the suggested questions are shown (an empty conversation), and build the first suggestion from it. Until the answer arrives the usual suggestions show without it.
4. Move SKILL_TITLE_MAX, SKILL_WHEN_MAX and SKILL_STEPS_MAX to a small module of their own (re-exported from saved-skills.ts) and import them from there in ai-skills.tsx line 7, so the skills form stops pulling assistant-skills.ts.

**Done when:** The script the panel fetches on opening is at or under 130,000 bytes (496,206 today), read in e2e/signed-in/ai-manager-panel.spec.ts from the requests made on the press; and /admin/[store]/assistant is at or under 1,720,000 bytes in route-bundle-stats.json (2,056,681 today).

**Tests and rules that hold today's behaviour, and change with it:**

- About 30 src/lib/*-tools.test.ts files import TOOL_WORDS from ./manager-tools and check every tool has words: the re-export keeps them.
- src/lib/agent-eval.test.ts (every tool a case names exists) and src/lib/admin-messages/assistant.en.ts line 314 (a name missing from the catalogue is read from TOOL_WORDS).
- e2e/signed-in/ai-manager-panel.spec.ts: the screen asks for the chat's scripts only on opening and the panel draws the chat; extend it to see the page's name in the first suggestion after a navigation with the panel open.
- e2e/signed-in/recent-pages.spec.ts (the launcher's list of recent pages).
- src/lib/permissions.scan.test.ts: the new action in [store]/assistant/actions.ts must run through the same guard as its neighbours.
- docs/performance.md lines 154-160 records the 0.48 MB chunk; write the new size there. docs/rules/admin/ai.md (the AI manager).

**Notes:** If AC-4 is done, the chat's words also arrive with the start call; the page's name can ride on the same pattern (one action bound in the layout).
