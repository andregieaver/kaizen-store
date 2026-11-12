# AC-7 ✓ The Work invoice screen ships the whole admin catalogue, both languages, in one 1.7 MB chunk

What an owner's browser loads in the admin (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.9.
- **Second check:** confirmed.
- **Where:** `src/components/admin/work/invoice-draft-editor.tsx:43`, `src/components/admin/work/invoice-draft-editor.tsx:44`, `src/components/admin/work/invoice-issue-dialog.tsx:12`, `src/components/admin/work/invoice-readiness.tsx:8`, `src/components/admin/work/invoice-totals.tsx:5`, `src/lib/work-text.ts:4`, `src/lib/work-text.ts:11`, `src/components/admin/work/invoice-issued.tsx:18`, `src/app/admin/(gated)/(owner)/account/work/layout.tsx:22`, `src/components/admin/admin-catalogues.scan.test.ts:44`
- **Evidence:** /admin/account/work/s/[store]/invoices/[invoiceId] is the largest admin route: 4,274,839 bytes raw / 1,335,794 gzip. Its chunk 3fqt1dd2f0p1k.js is 1,704,595 bytes (526,391 gzip) and is on that one route. The client editor imports invoice-readiness.tsx and invoice-totals.tsx, written for the server (no "use client"), which import lib/work-text.ts, which imports lib/admin-text.ts: every area in both languages. I searched the closure of every "use client" file in src: exactly two have a path to admin-text.ts, invoice-draft-editor.tsx and invoice-issue-dialog.tsx, both through invoice-readiness.tsx. ReadinessList is imported only by those two client files; InvoiceTotalsView also by the server's invoice-issued.tsx. work-text.ts keeps the language in React's cache(), which holds per request on the server only, so in the browser these two parts read English whatever the account's language. The scan test meant to stop this matches only a direct import of a .en file in a "use client" file.
- **Cost today:** About 1.66 MB raw / about 520 KB gzip of text on each first open of a Work invoice, and again after every deploy that changes any admin word (the chunk holds them all). Paid by: An owner's browser, on the Work invoice screen only. The cost already follows use; it is 1.7 MB too large.
- **Saving:** Measured chunk: about 1.66 MB raw / about 520 KB gzip; the route falls from 4.27 MB to about 2.6 MB raw.
- **Risk:** Low. Side effect to check in a browser: a Norwegian account likely sees these two parts in English today, or a mismatch when the page wakes up; after the fix they follow the account's language. It would show in invoice-editor.test.ts and e2e/work.spec.ts.
- **Already tracked:** No.

## The fix

1. src/components/admin/work/invoice-readiness.tsx: remove the lib/work-text import (line 8). Add a prop words: { ready, toFix, fix, check, open, problems } where problems is the record of templates by code, or null for English; write the problem's text from it in the component (the rule of readinessText(): the server's message when problems is null or has no template for the code, else the template with its {values}). It is drawn only in the browser.
2. src/components/admin/work/invoice-totals.tsx: move the markup into invoice-totals-view.tsx as InvoiceTotalsParts with a words prop and no work-text import; invoice-totals.tsx keeps InvoiceTotalsView for the server (words={workText().invoiceTotals}), which invoice-issued.tsx line 18 goes on using.
3. invoice-draft-editor.tsx lines 43-44 and invoice-issue-dialog.tsx line 12: draw the two views with useAdminText("work").invoiceTotals and .invoiceReadiness (the Work layout hands work, account/work/layout.tsx line 22) and a new prop readinessWords for the words of the server-only screens area, which src/app/admin/(gated)/(owner)/account/work/s/[store]/invoices/[invoiceId]/page.tsx builds from workScreens().workReadiness and passes to the editor.
4. Check that VAT_NOTE_LABELS and vatGroupLabel (src/lib/work-invoice-ui.ts) import no catalogue file.
5. Add the rule to the guard of AC-11: no module reachable from a client component may import lib/admin-text or lib/work-text as a value.

**Done when:** route-bundle-stats.json after a build: /admin/account/work/s/[store]/invoices/[invoiceId] at or under 2,700,000 bytes (4,274,839 today), and no admin route has a first-load chunk over 600,000 bytes (one of 1,704,595 today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/admin/work/invoice-editor.test.ts draws the draft editor with renderToString: it must pass the new words (or wrap in AdminTextProvider).
- e2e/work.spec.ts and e2e/signed-in/admin-text-fallbacks.spec.ts (the Work invoice screen must not fall back to fetched English).
- docs/work.md sections 4.5 and 5.2; docs/platform-admin-i18n.md A10 (work-text.ts is for server components).
- src/components/admin/admin-catalogues.scan.test.ts line 44: its matcher cannot see this path; AC-11 replaces it with a walk.

**Notes:** The language point is read from the code (cache() on the server only), not seen in a browser. 137 source files and 2.8 MB of source are in admin client code only through this one screen's leak (verified report).
