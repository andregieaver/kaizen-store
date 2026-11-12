# AD-5 ✓ Every save and poll re-sends 51 to 66 KB of unchanged shell words and menu

What the server does for an admin navigation (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 2.28.
- **Second check:** confirmed.
- **Where:** `src/app/admin/(gated)/layout.tsx:45`, `src/app/admin/(gated)/[store]/layout.tsx:114`, `src/app/admin/(gated)/platform/layout.tsx:83`, `src/app/admin/(gated)/[store]/page.tsx:117`, `src/app/admin/(gated)/[store]/products/page.tsx:114`, `src/components/admin/admin-text.tsx:33-49`, `src/components/admin/ai-manager-launcher.tsx:74`, `src/components/admin/ai-manager-launcher.tsx:107-127`, `src/lib/admin-text.ts:302-309`, `src/lib/store-nav.ts:432-462`, `e2e/signed-in/admin-text-fallbacks.spec.ts:7-14`
- **Evidence:** Layouts hand whole catalogue areas to client components as props. Measured as JSON by the skeptic: common+setup+shell 20.4 KB (7.0 KB gzip); the assistant area 13.7 KB in English and 24.9 KB in Norwegian, sent for every owner though the panel is closed until pressed; the menu's tabs and areas 16.9 to 19.5 KB, each page address present three times. No client component reads the setup area (my rg: 0 matches for useAdminText("setup") and for useHandedText("setup")), so its 6.9 KB is dead in every payload. The Home hands the whole home area (23.7 KB) to serve one streamed card, and the products list the whole products area (26.8 KB). In the measured Home document every long string of setup, assistant and home is present, and the handed words and menu are about 75 KB of the 106 KB of page data. A redraw after refresh() serialises all layouts again. The pattern is general: adminTexts() is called at 208 sites in 189 files of src/app and src/components.
- **Cost today:** 51 to 54 KB (English) or 63 to 66 KB (Norwegian) of JSON per shell redraw for a store owner, about 14.5 to 18 KB gzipped; 24 to 27 KB more per view on Home and Products. Server time to serialise and browser time to parse and reconcile it, on every save and poll tick. Paid by: The owner's browser and the server per shell render.
- **Saving:** Estimate from the measured parts: 6.9 KB (setup) plus 12 to 23 KB (assistant) plus about 7.5 KB (menu addresses) less JSON per shell redraw, roughly half; about 8 to 11 KB gzipped. About 20 KB less JSON on each Home view.
- **Risk:** Low to medium. D540 makes a missing area a fault, so the split must be done in the catalogue's types first and the chat's words must arrive before the chat draws. A missed reader shows as an English string in a Norwegian account and as a failure of admin-text-fallbacks.spec.ts. Step 1 alone is safe today.
- **Already tracked:** Partly: PSI PERF-01 (open) cut the admin's shared scripts (D540, 10-11 November); the words re-sent as props on each redraw are not in it.

## The fix

1. src/app/admin/(gated)/layout.tsx:45: hand down ["common", "shell"] only. Nothing on the client reads setup.
2. Split the assistant area in the catalogue (src/lib/admin-messages/assistant.en.ts and assistant.nb.ts, the types in src/lib/admin-text.ts): a small area for what shows while the panel is closed (the button, the badge and the notices list: what ai-manager-launcher.tsx and ai-notices.tsx read) and the rest (chat, voice, approval, skills, memory). [store]/layout.tsx:114 and platform/layout.tsx:83 hand down the small one.
3. Send the rest with the opening the panel already makes: startAssistantAction (and the platform's) returns the chat's words in the account's language beside what it returns today, and ai-manager-launcher.tsx wraps the loaded chat in an AdminTextScope with them (it already waits for start() and for the chat's script before drawing, lines 107-127). The AI manager's own page keeps handing the whole area down.
4. src/app/admin/(gated)/[store]/page.tsx:117: give the drafts card its words as a prop (words.drafts), as the demo card beside it gets words.demo, instead of a scope with the whole home area. Do the products list (products/page.tsx:114) when it is next touched: its table and bulk panels read many parts of the area.
5. src/lib/store-nav.ts:432-462 and src/components/admin/store-admin-nav.tsx: send each menu address once. Drop also from the tabs and let the client work it out from the area with the same index (its prefixes), or send the sections once and build tabs and sidebars from them in the client.
6. Hold it: add the store shell's handed JSON size to AD-12's checks (JSON.stringify of adminTexts() for the gate and of storeNav() for a store with every feature on, against a number that only falls).

**Done when:** docs/audits/bloat-review-2026-11/scripts/sources/skeptic-ad/words.mjs.txt, run again with the layouts' new arguments, prints under 30 KB of JSON for the store shell in English (51 to 54 KB today), and e2e/signed-in/admin-text-fallbacks.spec.ts and ai-manager-panel.spec.ts pass.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/signed-in/admin-text-fallbacks.spec.ts: fails when a part reads an area nothing handed down (D540). It must pass with the panel opened and a message typed, in English and Norwegian; add that case if it is not there.
- src/components/admin/admin-catalogues.scan.test.ts (no client module imports a whole catalogue) and src/lib/admin-strings.scan.test.ts (which areas client parts read).
- e2e/signed-in/ai-manager-panel.spec.ts (the panel opens, lists notices, sends), e2e/signed-in/admin-view.spec.ts and admin-phone.spec.ts (the menu, the sidebar, the active tab).
- src/lib/store-nav.test.ts and src/lib/admin-layouts.test.ts (the shape of tabs and areas).
- e2e/signed-in/admin-scripts.spec.ts budgets count scripts, not the data in the document: this change does not move them.
- Rule kept: docs/performance.md:170-182 and D540 (hand the area down where the part is drawn; never put the English back into every screen). The chat's words arrive in a scope with the chat, in the account's language.

**Comes after:** AD-1 (storeNav() gives one place to change the menu's shape)

**Notes:** Step 1 is a one-line change and can ship with the P0 work. The 208 call sites of adminTexts() are not each a fault: a page that hands an area to parts that read most of it is right. The two named pages hand a whole area to one card.
