# Copied code, measured (own scan, 11 Nov 2026)

Made by `scripts/clones.mjs`: non-test .ts and .tsx files of src; blank lines, comments, imports and lone closing brackets
dropped; a window of 10 consecutive lines (at least 220 characters) found in two or more places is a copy. It finds exact
copies after trimming, not copies with a renamed variable, so it under-counts. See `clones-notes.txt`.

| Measure | Lines |
|---|---|
| Code lines scanned (catalogues and schema.ts aside) | 472550 |
| ... of which lie in a copied window | 5423 (1.1%) |
| Code lines in the message catalogues and schema.ts (parallel by design) | 81685 |
| ... of which copied | 690 (0.8%) |

## By folder

| Folder | Code lines | Copied | Share |
|---|---|---|---|
| src/components/admin | 108140 | 2032 | 1.9% |
| src/app | 65684 | 1490 | 2.3% |
| src/lib | 194153 | 1235 | 0.6% |
| src/server | 145798 | 1116 | 0.8% |
| src/db | 13612 | 122 | 0.9% |
| src/components | 26761 | 118 | 0.4% |
| src/instrumentation.ts | 4 | 0 | 0.0% |
| src/proxy.ts | 83 | 0 | 0.0% |

## Files with the most copied lines (first 60)

- src/components/admin/page-builder.tsx: 205 of 5414 (3.8%)
- src/server/catalog.ts: 124 of 549 (22.6%)
- src/components/admin/work/owner-time.tsx: 91 of 220 (41.4%)
- src/app/admin/(gated)/[store]/integrations/[provider]/page.tsx: 86 of 179 (48.0%)
- src/app/admin/(gated)/platform/integrations/[provider]/page.tsx: 86 of 174 (49.4%)
- src/components/admin/affiliate-settings-form.tsx: 76 of 404 (18.8%)
- src/components/admin/bonus-settings-form.tsx: 76 of 469 (16.2%)
- src/components/admin/inventory/stock-import-flow.tsx: 76 of 170 (44.7%)
- src/app/s/[store]/[market]/account/orders/[orderId]/page.tsx: 73 of 260 (28.1%)
- src/app/s/[store]/[market]/order/[orderId]/order-section.tsx: 73 of 480 (15.2%)
- src/components/admin/work/invoices-list.tsx: 73 of 178 (41.0%)
- src/components/admin/work/time-filters.tsx: 73 of 122 (59.8%)
- src/server/work-owner.ts: 68 of 624 (10.9%)
- src/components/admin/work/owner-invoices.tsx: 62 of 190 (32.6%)
- src/components/admin/work/owner-report.tsx: 54 of 188 (28.7%)
- src/server/customer-import.ts: 52 of 286 (18.2%)
- src/server/inventory-jobs.ts: 52 of 432 (12.0%)
- src/app/admin/(gated)/(owner)/account/domains/move/[domain]/page.tsx: 48 of 72 (66.7%)
- src/app/admin/(gated)/[store]/settings/domains/move/[domain]/page.tsx: 48 of 72 (66.7%)
- src/components/admin/data/import-flow.tsx: 47 of 287 (16.4%)
- src/app/admin/(gated)/[store]/integrations/fiken/page.tsx: 44 of 350 (12.6%)
- src/app/admin/(gated)/[store]/integrations/tripletex/page.tsx: 44 of 431 (10.2%)
- src/app/admin/(gated)/[store]/pages/views.tsx: 44 of 396 (11.1%)
- src/components/admin/campaign-editor.tsx: 44 of 648 (6.8%)
- src/components/admin/discount-editor.tsx: 44 of 461 (9.5%)
- src/components/admin/inventory/stock-import-views.tsx: 43 of 202 (21.3%)
- src/components/admin/ai-provider-form.tsx: 42 of 604 (7.0%)
- src/components/admin/chat-agent-form.tsx: 42 of 150 (28.0%)
- src/components/admin/docs-guide-form.tsx: 42 of 120 (35.0%)
- src/components/admin/customer-import-views.tsx: 41 of 151 (27.2%)
- src/components/admin/work/clients-list.tsx: 41 of 80 (51.2%)
- src/components/admin/work/owner-clients.tsx: 41 of 110 (37.3%)
- src/components/admin/work/report-filters.tsx: 41 of 81 (50.6%)
- src/server/fiken-sync.ts: 41 of 420 (9.8%)
- src/server/tripletex-sync.ts: 41 of 518 (7.9%)
- src/server/work-time.ts: 41 of 506 (8.1%)
- src/components/product-parts.tsx: 40 of 1027 (3.9%)

## Pairs of files that share the most (first 80; catalogue pairs aside)

- about 55 lines: src/app/s/[store]/[market]/account/orders/[orderId]/page.tsx <-> src/app/s/[store]/[market]/order/[orderId]/order-section.tsx
- about 55 lines: src/components/admin/work/owner-time.tsx <-> src/components/admin/work/time-filters.tsx
- about 47 lines: src/components/admin/affiliate-settings-form.tsx <-> src/components/admin/bonus-settings-form.tsx
- about 43 lines: src/components/admin/work/invoices-list.tsx <-> src/components/admin/work/owner-invoices.tsx
- about 39 lines: src/lib/admin-messages/privacy.en.ts <-> src/lib/erasure-plan.ts
- about 38 lines: src/app/admin/(gated)/(owner)/account/domains/move/[domain]/page.tsx <-> src/app/admin/(gated)/[store]/settings/domains/move/[domain]/page.tsx
- about 37 lines: src/app/admin/(gated)/[store]/integrations/[provider]/page.tsx <-> src/app/admin/(gated)/platform/integrations/[provider]/page.tsx
- about 35 lines: src/app/admin/(gated)/[store]/integrations/fiken/page.tsx <-> src/app/admin/(gated)/[store]/integrations/tripletex/page.tsx
- about 34 lines: src/lib/admin-messages/returns.en.ts <-> src/lib/exchange.ts
- about 28 lines: src/components/admin/data/import-flow.tsx <-> src/components/admin/inventory/stock-import-flow.tsx
- about 26 lines: src/app/admin/(gated)/[store]/customers/import/page.tsx <-> src/app/admin/(gated)/[store]/orders/history-import/page.tsx
- about 26 lines: src/components/admin/campaign-editor.tsx <-> src/components/admin/discount-editor.tsx
- about 26 lines: src/components/admin/customer-import-views.tsx <-> src/components/admin/inventory/stock-import-views.tsx
- about 24 lines: src/components/admin/chat-agent-form.tsx <-> src/components/admin/docs-guide-form.tsx
- about 24 lines: src/components/admin/data/findings-table.tsx <-> src/components/admin/inventory/stock-import-views.tsx
- about 24 lines: src/lib/work-owner.ts <-> src/lib/work-reports.ts
- about 24 lines: src/server/customer-import.ts <-> src/server/inventory-jobs.ts
- about 23 lines: src/components/admin/work/clients-list.tsx <-> src/components/admin/work/owner-clients.tsx
- about 23 lines: src/server/fiken-sync.ts <-> src/server/tripletex-sync.ts
- about 23 lines: src/server/work-owner.ts <-> src/server/work-time.ts
- about 22 lines: src/app/admin/(gated)/[store]/analytics/finance/loading.tsx <-> src/app/admin/(gated)/[store]/analytics/payouts/loading.tsx
- about 22 lines: src/components/admin/customer-import-views.tsx <-> src/components/admin/data/findings-table.tsx
- about 22 lines: src/lib/admin-messages/builder.en.ts <-> src/lib/page-content.ts
- about 22 lines: src/lib/admin-messages/design.en.ts <-> src/lib/theme-changes.ts
- about 21 lines: src/lib/admin-messages/legal.en.ts <-> src/lib/legal-roles.ts
- about 21 lines: src/lib/admin-messages/privacy.en.ts <-> src/server/privacy-admin.ts
- about 20 lines: src/lib/admin-messages/drafts.en.ts <-> src/lib/order-edit.ts
- about 19 lines: src/app/admin/(gated)/[store]/settings/domains/actions.ts <-> src/app/admin/(gated)/[store]/settings/domains/move-in/actions.ts
- about 19 lines: src/components/admin/work/owner-report.tsx <-> src/components/admin/work/report-filters.tsx
- about 19 lines: src/lib/admin-messages/design.en.ts <-> src/lib/theme-update.ts
- about 19 lines: src/server/work-attention.ts <-> src/server/work-overview.ts
- about 18 lines: src/app/admin/(gated)/(owner)/account/work/s/[store]/time/page.tsx <-> src/components/admin/work/owner-time.tsx
- about 18 lines: src/components/admin/work/invoice-credit-dialog.tsx <-> src/components/admin/work/invoice-issue-dialog.tsx
- about 18 lines: src/lib/admin-messages/product.en.ts <-> src/lib/unit-price-editor.ts
- about 18 lines: src/server/work-attention.ts <-> src/server/work-owner.ts
- about 18 lines: src/server/work-overview.ts <-> src/server/work-owner.ts
- about 17 lines: src/app/admin/(gated)/(owner)/account/domains/page.tsx <-> src/app/admin/(gated)/[store]/settings/domains/page.tsx
- about 16 lines: src/app/admin/(gated)/[store]/cart-reminders/page.tsx <-> src/app/admin/(gated)/platform/plan-reminders/page.tsx
- about 16 lines: src/components/admin/customer-import-flow.tsx <-> src/components/admin/inventory/stock-import-flow.tsx
- about 16 lines: src/components/admin/orders/order-edit-editor.tsx <-> src/components/admin/returns/exchange-builder.tsx
- about 16 lines: src/lib/admin-messages/drafts.en.ts <-> src/lib/draft-order.ts
- about 16 lines: src/lib/admin-messages/tax-reports.en.ts <-> src/lib/tax-classes.ts
- about 15 lines: src/app/admin/(gated)/[store]/inventory/import/page.tsx <-> src/app/admin/(gated)/[store]/products/import/page.tsx
- about 15 lines: src/app/admin/(gated)/[store]/loading.tsx <-> src/app/admin/(gated)/platform/loading.tsx
- about 15 lines: src/app/api/visit/speed/own/route.ts <-> src/app/api/visit/speed/route.ts
- about 15 lines: src/app/s/[store]/[market]/account/change/[token]/change-view.tsx <-> src/app/s/[store]/[market]/account/exchange/[token]/exchange-view.tsx
- about 15 lines: src/lib/ecb-history.ts <-> src/lib/withdrawal-days.ts
- about 14 lines: src/app/admin/(gated)/(owner)/account/domains/buy/actions.ts <-> src/app/admin/(gated)/[store]/settings/domains/actions.ts
- about 14 lines: src/app/admin/(gated)/(owner)/account/domains/buy/actions.ts <-> src/app/admin/(gated)/[store]/settings/domains/move-in/actions.ts
- about 14 lines: src/app/admin/(gated)/[store]/customers/import/[jobId]/page.tsx <-> src/app/admin/(gated)/[store]/orders/history-import/[jobId]/page.tsx
- about 14 lines: src/components/admin/drafts/draft-send.tsx <-> src/components/admin/orders/order-edit-parts.tsx
- about 14 lines: src/components/admin/vat/rate-form.tsx <-> src/components/admin/vat/shipping-rules-card.tsx
- about 14 lines: src/lib/xml-read.ts <-> src/lib/xml-tree.test-helper.ts
- about 13 lines: src/app/admin/(gated)/[store]/analytics/marketing/loading.tsx <-> src/app/admin/(gated)/[store]/analytics/subscriptions/loading.tsx
- about 13 lines: src/app/admin/(gated)/platform/themes/[presetId]/shell.tsx <-> src/app/admin/(gated)/platform/themes/page.tsx
- about 13 lines: src/components/admin/deals/deal-board.tsx <-> src/components/admin/deals/deal-status.tsx
- about 13 lines: src/components/admin/moving/shop-copy.tsx <-> src/components/admin/moving/shop-move.tsx
- about 13 lines: src/components/admin/redirects/not-found-table.tsx <-> src/components/admin/redirects/old-shop-check.tsx
- about 13 lines: src/components/admin/work/invoice-credit-dialog.tsx <-> src/components/admin/work/invoice-payments.tsx
- about 13 lines: src/lib/edit-grant.ts <-> src/lib/unlock-pass.ts
- about 13 lines: src/server/analytics-speed.ts <-> src/server/own-speed.ts
- about 13 lines: src/server/billing.ts <-> src/server/platform-discounts.ts
- about 12 lines: src/app/admin/(gated)/[store]/integrations/page.tsx <-> src/app/admin/(gated)/platform/integrations/page.tsx
- about 12 lines: src/components/admin/templates-modal.tsx <-> src/components/admin/templates-tab.tsx
- about 12 lines: src/components/admin/work/assignment-actions.tsx <-> src/components/admin/work/client-actions.tsx
- about 12 lines: src/components/admin/work/owner-overview.tsx <-> src/components/admin/work/work-overview.tsx
- about 12 lines: src/components/chat/thread-labels.ts <-> src/components/site-chat.tsx
- about 12 lines: src/lib/admin-messages/marketing.en.ts <-> src/lib/segments.ts
- about 12 lines: src/server/affiliate-emails.ts <-> src/server/bonus-emails.ts
- about 12 lines: src/server/connect.ts <-> src/server/host-payments.ts
- about 11 lines: src/app/admin/(gated)/(print)/account/templates/kaizen/[templateId]/preview/page.tsx <-> src/app/admin/(gated)/(print)/account/templates/s/[store]/[templateId]/preview/page.tsx
- about 11 lines: src/app/admin/(gated)/[store]/integrations/ebay/page.tsx <-> src/app/admin/(gated)/[store]/inventory/suppliers/[id]/page.tsx
- about 11 lines: src/app/admin/(gated)/[store]/inventory/export/page.tsx <-> src/app/admin/(gated)/[store]/products/export/page.tsx
- about 11 lines: src/app/admin/(gated)/[store]/settings/automation/[ruleId]/loading.tsx <-> src/app/admin/(gated)/[store]/settings/automation/new/loading.tsx
- about 11 lines: src/app/admin/try/[sandbox]/keep/page.tsx <-> src/components/platform-routes/sign-up.tsx
- about 11 lines: src/components/admin/ai-provider-form.tsx <-> src/server/ai.ts
- about 11 lines: src/components/admin/bill-fields.tsx <-> src/components/admin/receipt-fields.tsx
- about 11 lines: src/components/admin/block-fields.tsx <-> src/components/admin/typography-fields.tsx
- about 11 lines: src/components/admin/bonus-rewards-card.tsx <-> src/components/admin/checkout-rules.tsx
- about 11 lines: src/components/admin/look-versions-dialog.tsx <-> src/components/admin/page-versions-dialog.tsx

## Families: one block in four or more files (first 45)

- 4 files, about 10 lines each: src/components/admin/field-group-editor.tsx, src/components/admin/menu-editor.tsx, src/components/admin/term-page-fields.tsx, src/components/admin/work/tasks-panel.tsx
    >
    <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
    <circle cx="9" cy="6" r="1.5" />
    <circle cx="15" cy="6" r="1.5" />
    <circle cx="9" cy="12" r="1.5" />
    <circle cx="15" cy="12" r="1.5" />
