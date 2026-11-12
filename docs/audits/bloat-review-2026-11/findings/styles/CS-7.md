# CS-7 ✓ Shop pages use admin-only colour roles that have no value outside the admin

Styles (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P0. **Effort:** S. **Confidence:** medium. **Step:** 0.24.
- **Second check:** confirmed.
- **Where:** `src/components/product-card.tsx:109`, `src/components/product-card.tsx:110`, `src/components/content-grid.tsx:206`, `src/components/product-parts.tsx:1347`, `src/components/product-parts.tsx:1348`, `src/components/checkout-form.tsx:460`, `src/app/supply/[token]/page.tsx:17`, `src/app/supply/[token]/page.tsx:60`, `src/app/passport/[id]/page.tsx:31`, `src/app/passport/[id]/page.tsx:137`, `src/components/inline-edit/markup-editor.tsx:170`, `src/app/globals.css:62`, `src/app/admin/schemes/meadow.css:15`
- **Evidence:** globals.css:62-66 says the roles (bg-card, border-line and the rest) are set only inside the admin. In the built files the global sheet has .border-line{border-color:var(--line)} and .bg-card{background-color:var(--card)} and no definition of --line or --card; the admin's file defines them only under html[data-admin] or [data-scheme-preview]. Counted again by the planner with the role names of globals.css:67-104: 20 uses on 14 lines of seven files outside the admin folders. border-line on the colour and option swatches of combined listings (product-card.tsx:109-110, content-grid.tsx:206, product-parts.tsx:1347-1348); border-line bg-card on one checkout field (checkout-form.tsx:460); the supplier's page (supply/[token]/page.tsx: its field look on line 17, four borders, and text-danger-text on the problem line 60); the product passport (two borders); and the on-site editor's own toolbar (markup-editor.tsx:170: hover:bg-sunken aria-pressed:bg-inverse aria-pressed:text-inverse-ink). The supplier and passport layouts set neither data-admin nor a theme. With the variable unset the declaration is invalid at computed-value time: a border takes the text colour, a background is see-through, an error line is not red. Not looked at in a browser.
- **Cost today:** No bytes. A wrong border on swatches in every store, one checkout field, the supplier's page and the passport; an error line that does not look like one; a pressed tool that looks unpressed. It also shows what one shared sheet hides: the build cannot tell a shop file that it used an admin class. Paid by: Shoppers and suppliers, in what they see; the team, when CS-1 is done and these classes must be decided.
- **Saving:** No bytes. Removes a visual fault on shop pages and one of the two blockers of CS-1.
- **Risk:** Low. A renamed class changes a colour by design: the border goes from the text colour to the theme's border colour. It is noticed by looking at the six places of step 6; the scan test stops it coming back.

## The fix

1. Replace the role names with the site's own in the seven files: border-line -> border-border in src/components/product-card.tsx:109-110, src/components/content-grid.tsx:206 (twice), src/components/product-parts.tsx:1347-1348, src/app/passport/[id]/page.tsx:31 and 137, and src/app/supply/[token]/page.tsx:68, 76, 122 and 129.
2. src/components/checkout-form.tsx:460 and the field constant at src/app/supply/[token]/page.tsx:17: 'border-line bg-card' -> 'border-border bg-background'.
3. src/app/supply/[token]/page.tsx:60: text-danger-text -> 'text-red-700 dark:text-red-400', the pair the storefront's own alerts use (rg 'role="alert" className' src/components shows it).
4. src/components/inline-edit/markup-editor.tsx:170: 'hover:bg-sunken aria-pressed:bg-inverse aria-pressed:text-inverse-ink' -> 'hover:bg-surface aria-pressed:bg-foreground aria-pressed:text-background'.
5. New test file src/lib/stylesheet-sources.scan.test.ts (CS-1, CS-6 and CS-9 add to it). First rule: read the role names from the '--color-<role>: var(--<role>)' lines of the @theme block in the site's CSS, then fail for any non-test .ts or .tsx under src/app (outside src/app/admin) or src/components (outside src/components/admin) that names a class ending in one of them behind bg-, text-, border-, ring-, outline-, divide-, fill-, stroke-, accent-, decoration-, from-, via- or to-, with or without variants. Add a would-notice case: the same check on src/components/admin/modal.tsx finds roles.
6. Look at the swatches on a product card and a product page with a combined listing, the checkout field, the supplier's page and a passport, in light and in dark.

**Done when:** rg -c --pcre2 with the role pattern over src/components and src/app, without the admin folders, tests and CSS, counts 0 uses (20 today), and the new rule in stylesheet-sources.scan.test.ts passes.

**Tests and rules that hold today's behaviour, and change with it:**

- New: src/lib/stylesheet-sources.scan.test.ts, rule 'the site's files speak the site's colour names'.
- src/app/admin/admin-type.scan.test.ts:85-91 holds the mirror rule for admin files (no site names, no fixed palette colours); unchanged, and its regexes are the model for the new one.
- e2e/a11y.spec.ts and e2e/shop-components.spec.ts cover the pages touched; they must pass unchanged.
- Rule: the comment at src/app/globals.css:62-66 and docs/admin-style.md section 4 (the roles are the admin's). Kept, and now checked.

**Notes:** Not bloat by itself: a visual defect and a missing check that CS-1 needs settled. P0 because it is half an hour of work, it is visible to shoppers, and CS-1 waits for it. The planner's recount adds one line to the skeptic's list (the editor's toolbar was named but not counted). CS-9 is the other half: admin components drawn outside the admin.
