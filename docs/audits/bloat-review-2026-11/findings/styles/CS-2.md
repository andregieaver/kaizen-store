# CS-2 ✓ A store with no builder motion still downloads motion.css

Styles (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P3. **Effort:** M. **Confidence:** low. **Step:** tolerated.
- **Second check:** corrected.
- **Where:** `src/app/globals.css:10`, `src/app/motion.css:1`, `src/components/motion-support.tsx:10`, `src/components/page-article.tsx:110`, `src/components/page-parts.tsx:245`, `src/lib/motion-attrs.ts:279`, `src/lib/background-layers.ts:172`, `src/lib/motion-css.test.ts:18`
- **Evidence:** In the built sheet the components layer (motion.css) is 18,742 B raw / 4,309 B gzip / 3,815 B Brotli (the planner's own parse). After CS-1 it would be 14% of the site's sheet raw and 19% of its Brotli. The motion script is already loaded only where needed (motion-support.tsx:10-20, motionNeeds()); the CSS is not. Nothing in it is dead. The six launch themes do their motion in their own theme CSS: rg for motion, backgroundMotion, backgroundLayers and gradient in src/lib/signature finds only each theme's reduced-motion query. So a store on a launch theme does not need this file until its owner adds a builder effect. The file is plain CSS (no Tailwind directive, no nesting), so it could be served as it is. Its rules are not only motion: a gradient background's frame and layers (page-parts.tsx:245-256), background layers (background-layers.ts:172-212) and split text need it for structure.
- **Cost today:** 3.8 KB Brotli (4.3 KB gzip), render-blocking, on the first visit to every store and on every admin screen. A store that uses no builder motion pays the same as one that uses all of it. Paid by: A shopper's browser.
- **Saving:** If built and if most pages have no builder motion: 3.8 KB Brotli / 4.3 KB gzip / 18.7 KB raw per first visit. Nothing on pages with motion, which make one more render-blocking request instead.
- **Risk:** A page that has data-fx attributes but no sheet shows broken backgrounds (layers fall into the flow); the gate test of step 4 is what stands between. If most real stores add an entrance somewhere, most pages load an extra file and the change is a net loss. How owners will use motion is unknown before opening.

## The fix

1. Do not build this now. After opening, measure with a read-only script over published pages, headers and footers: the share whose rows need the sheet (motionNeeds(rows).any, or any gradient background, or any background layers). Write the share into docs/performance.md.
2. Only if clearly more than half of real page views would not need it: a prebuild step writes motion.css, minified and beginning with '@layer theme, base, components, utilities;' (so the layer order holds whichever sheet arrives first), to public/ under a name with its content hash, and a generated module exports the address.
3. MotionSupport (src/components/motion-support.tsx) draws <link rel="stylesheet" precedence> to it when the page, header or footer needs it; widen MotionNeeds with a flag for gradient backgrounds and background layers (src/lib/motion-attrs.ts:279-309). The site's entry drops @import "./motion.css"; the admin's entry keeps it for the canvas.
4. Tests: src/lib/motion-css.test.ts:18-20 expects the import in globals.css and must expect the link instead; one new test ties the gate to every attribute motion.css styles (each [data-fx-*] selector of the file has a code path that sets the flag).

**Done when:** The share of published pages that need motion.css is written in docs/performance.md with the decision; if built, a store page without builder motion links no motion stylesheet and the site's sheet is 18.7 KB raw smaller.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/motion-css.test.ts (the catalogue and the sheet are two halves of one thing; line 18 holds the import), src/lib/background-layers.test.ts:51, e2e/motion.spec.ts, e2e/animation.spec.ts.
- Rule in src/app/motion.css:7-16: content is always reachable (no scripts, reduced motion, the 4 s failsafe). A sheet that fails to load must leave content visible: the hidden start state lives in that sheet, so it does.
- Next's CSS guide (node_modules/next/dist/docs/01-app/01-getting-started/11-css.md:294): imported CSS follows the importing segment and is not removed on navigation, so this needs a hand-made link, not an import.

**Comes after:** CS-1; A measured share of real pages that need motion.css, after opening

**Notes:** P3: true, but not worth doing now. It needs a build step and a hand-made stylesheet link for 3.8 KB, and its sign depends on use nobody can know before opening. This is not an argument from disuse: the idle cost is real and small, and the plan is to measure before paying for the fix. The draft's 'up to 7.2 KB gzip' is withdrawn (see refuted).
