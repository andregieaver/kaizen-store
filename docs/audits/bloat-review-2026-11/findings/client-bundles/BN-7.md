# BN-7 ✓ One Work screen loads 4.27 MB: the admin's whole text in both languages

The built client bundles, by page (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.9.
- **Second check:** confirmed.
- **Where:** `src/components/admin/work/invoice-readiness.tsx:8`, `src/components/admin/work/invoice-readiness.tsx:26`, `src/components/admin/work/invoice-totals.tsx:5`, `src/components/admin/work/invoice-totals.tsx:28`, `src/lib/work-text.ts:1`, `src/lib/work-text.ts:4`, `src/lib/work-text.ts:11`, `src/components/admin/work/invoice-draft-editor.tsx:43`, `src/components/admin/work/invoice-draft-editor.tsx:44`, `src/components/admin/work/invoice-issue-dialog.tsx:12`, `src/app/admin/(gated)/(owner)/account/work/layout.tsx:22`
- **Evidence:** /admin/account/work/s/[store]/invoices/[invoiceId] has 4,274,839 bytes of first scripts, the largest of 560 routes; the invoices list beside it has 1,262,262. Its 16 extra chunk files are 3,016,959 bytes; one of them, 3fqt1dd2f0p1k.js, is 1,704,595 bytes (526,861 gzip), is in no other route and holds the word 'Lagre' 548 times: the Norwegian catalogues. ReadinessList and InvoiceTotalsView have no 'use client' line and read their words through lib/work-text.ts (lines 8 and 5), which imports lib/admin-text.ts, a module with 134 catalogue imports (every area, two languages). Two client components import them (invoice-draft-editor.tsx:43 to 44, invoice-issue-dialog.tsx:12), so all of it becomes browser code. work-text.ts keeps the language in React's cache() (line 11), which holds per request on the server only, so in the browser these two parts read English whatever the account's language (read from the code, not run).
- **Cost today:** About 2.9 MB raw more than its sibling screens on each first open of a Work invoice draft; the 1.7 MB chunk alone is 527 KB gzip. Paid by: An owner or accountant using Work's invoices; and the build, which compiles the catalogues a second time for the client.
- **Saving:** About 2.9 MB raw on that route, to about 1.4 MB, the level of its sibling screens (estimate from the route's 16 extra chunks, 3,016,959 bytes, less the editor's own code).
- **Risk:** Low. It also corrects the language those two parts show to a Norwegian account. A missed word shows as an empty label on the draft's readiness list, which the Work spec opens.
- **Already tracked:** No. Same change as AC-7.

## The fix

1. src/components/admin/work/invoice-readiness.tsx: remove the lib/work-text import (line 8). ReadinessList takes a prop words: { ready, toFix, fix, check, open, problems } where problems is the record of templates by code, or null for English. Write a problem's text from it in the component by the rule of readinessText() (work-text.ts lines 27 to 31): the server's message when problems is null or has no template for the code, else the template with its {values}.
2. src/components/admin/work/invoice-totals.tsx: move the markup into invoice-totals-view.tsx as InvoiceTotalsParts with a words prop and no work-text import; invoice-totals.tsx keeps InvoiceTotalsView for the server (words from workText().invoiceTotals), which invoice-issued.tsx line 18 goes on using.
3. invoice-draft-editor.tsx lines 43 to 44 and 655 to 676, and invoice-issue-dialog.tsx lines 12 and 126: draw the two with useAdminText('work').invoiceTotals and .invoiceReadiness (the Work layout hands the work area, account/work/layout.tsx line 22) and a new prop readinessWords for the server-only screens area, which the page (src/app/admin/(gated)/(owner)/account/work/s/[store]/invoices/[invoiceId]/page.tsx) builds from workScreens().workReadiness and passes to the editor.
4. Check that VAT_NOTE_LABELS and vatGroupLabel (src/lib/work-invoice-ui.ts), which the totals also read, import no catalogue file.
5. Add lib/admin-text and lib/work-text to the forbidden list of BN-4's admin scan for every module a client component can reach.

**Done when:** After pnpm build, /admin/account/work/s/[store]/invoices/[invoiceId] is at or under 1,600,000 bytes in route-bundle-stats.json (4,274,839 today) and no route's first-load list holds a chunk file over 600,000 bytes (one of 1,704,595 today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/admin/work/invoice-editor.test.ts draws the draft editor: it must pass the new words or wrap in AdminTextProvider.
- e2e/work.spec.ts and e2e/signed-in/admin-text-fallbacks.spec.ts (the Work invoice screen must not fall back to fetched English).
- docs/work.md sections 4.5 and 5.2; docs/platform-admin-i18n.md A10 (work-text.ts is for server components): say there that a component a client part imports takes its words as props.
- src/components/admin/admin-catalogues.scan.test.ts line 48: its filter (files that start with 'use client' and import a catalogue directly) cannot see this path; BN-4's walk replaces it for this case.

**Notes:** This is the single largest route in the build and a three-file fix.
