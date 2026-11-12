# Code nothing uses: suspects (own scan, 11 Nov 2026)

Made by `work/dead.mjs` (the repo's own TypeScript parser; see `dead-notes.txt` for the method and its blind spots). These
are SUSPECTS to check, not findings. Full lists: `dead.json`.

| Measure | Count | Lines |
|---|---|---|
| Source files (src, tests aside) | 4133 | 772110 |
| Files no entry point or test reaches | 0 | 0 |
| Files only tests reach | 42 | 6616 |
| Exports in src (tests and Next's own files aside) | 25753 | |
| Exports nothing imports and their own file does not use | 263 | 477 |
| Exports only tests import, unused in their own file (dead but for a test) | 655 | 6135 |
| Exports their own file uses and tests import (alive; exported for the test) | 3304 | |
| Exports used only inside their own file (the export is unneeded) | 2205 | |

Dead exports by kind: {"type":96,"const":140,"function":9,"named":2,"re-export":16}. Tests-only exports by kind: {"function":331,"const":291,"re-export":23,"type":10}.

## Files no entry point or test reaches (largest first)



## Files only tests reach (largest first, first 150)

src/lib/i18n-glossary.ts (853)
src/db/invoice-fixture.ts (457)
src/server/tripletex-test-support.ts (371)
src/server/fiken-test-support.ts (307)
src/components/admin/work/invoice-test-support.ts (272)
src/server/invoice-test-fixture.ts (259)
src/server/privacy-fixture.ts (252)
src/lib/legal-wording-nb.ts (236)
src/server/data-test-support.ts (236)
src/db/order-edit-fixture.ts (227)
src/lib/store-export-scope.ts (191)
src/lib/product-csv-test-support.ts (175)
src/server/inventory-test-support.ts (174)
src/server/trust-fixtures.ts (170)
src/components/admin/returns/test-fixtures.ts (169)
src/server/fulfilment-test-fixture.ts (167)
src/lib/work-import-fixture.ts (148)
src/server/work-reports-test-support.ts (148)
src/components/inline-edit/heading-editor.tsx (144)
src/server/tax-reports-fixture.ts (135)
src/lib/signature-themes.ts (132)
src/server/order-ops-fixture.ts (128)
src/lib/order-edit-view-fixture.ts (115)
src/server/analytics-insights-fixture.ts (114)
src/components/admin/invoices/test-fixtures.ts (101)
src/components/admin/privacy/test-fixtures.ts (100)
src/server/shipping-test-fixture.ts (97)
src/server/redirect-test-support.ts (93)
src/lib/part-css.testing.ts (87)
src/components/admin/templates-test-support.ts (80)
src/lib/experiment-legacy.ts (73)
src/db/testing.ts (68)
src/lib/xml-tree.test-helper.ts (66)
src/lib/store-copy-test-support.ts (58)
src/server/work-test-support.ts (51)
src/db/migration-files.ts (40)
src/lib/unit-price-test-support.ts (29)
src/server/exchange-test-support.ts (28)
src/server/capacity-test-support.ts (26)
src/components/admin/work/coming-soon.tsx (18)
src/lib/store-modules.ts (12)
src/server/test-days.ts (9)

## Dead exports by folder

- src/lib: 227 exports, 399 lines
- src/components: 22 exports, 47 lines
- src/server: 12 exports, 17 lines
- src/app: 1 exports, 9 lines
- src/instrumentation.ts: 1 exports, 5 lines

## Largest dead exports (first 120; types aside)

src/lib/fiken-settings.ts:17 VAT_TYPE_CODES (const, 11 lines)
src/lib/text-styles.ts:94 KIND_NAMES (const, 11 lines)
src/components/admin/navigation-editor.tsx:34 STORE_COPY (const, 10 lines)
src/lib/payment-terms.ts:110 TERMS_REFUSAL_WORDS (const, 10 lines)
src/app/admin/(gated)/(owner)/account/work/s/[store]/actions.ts:254 updateTimeEntryAction (function, 9 lines)
src/lib/content-tools.ts:6 CONTENT_TOOLS (const, 9 lines)
src/lib/onboarding.ts:21 SELL_ANSWER_WORDS (const, 9 lines)
src/lib/redirects.ts:31 KIND_WORDS (const, 9 lines)
src/lib/store-copy.ts:81 DEFAULT_COPY_OPTIONS (const, 9 lines)
src/components/admin/responsive-edit.tsx:160 SizeHeading (function, 8 lines)
src/components/admin/work/owner-common.tsx:50 SettingsLink (function, 8 lines)
src/lib/erasure-plan.ts:30 PLAN_WARNING_TEXT (const, 8 lines)
src/lib/marketing-consent.ts:62 UNSUBSCRIBE_WORDS (const, 8 lines)
src/lib/replicate-prompts.ts:142 familiesOf (function, 8 lines)
src/lib/store-copy-wizard.ts:44 KIND_WORDS (const, 8 lines)
src/lib/broadcasts.ts:340 STATUS_WORDS (const, 7 lines)
src/lib/capture.ts:81 CAPTURE_PROBLEM_WORDS (const, 7 lines)
src/lib/marketing-consent.ts:54 SOURCE_WORDS (const, 7 lines)
src/lib/payment-terms.ts:50 TERMS_STATE_LABELS (const, 7 lines)
src/lib/referrals.ts:85 REFERRAL_KIND_LABELS (const, 7 lines)
src/lib/store-copy-progress.ts:30 PHASE_STATE_WORDS (const, 6 lines)
src/instrumentation.ts:6 register (function, 5 lines)
src/lib/marketing-consent.ts:48 STATUS_WORDS (const, 5 lines)
src/lib/onboarding.ts:31 EXTRA_ANSWER_WORDS (const, 5 lines)
src/lib/work-settings.ts:102 SERIES_TEXT (const, 4 lines)
src/server/house-switch.ts:45 siteFromStoreNow (function, 4 lines)
src/lib/analytics-channels.ts:24 CHANNEL_LABELS (const, 3 lines)
src/lib/creators.ts:88 CREATOR_PROBLEMS (const, 3 lines)
src/lib/live-drills.ts:99 isDrillKind (function, 3 lines)
src/lib/work-text.ts:33 workLocale (function, 3 lines)
src/lib/work-ui.ts:45 allMessages (const, 3 lines)
src/server/registrars/index.ts:47 forgetSupportedTlds (function, 3 lines)
src/components/admin/custom-items-editor.tsx:47 CUSTOM_ITEMS_LIMITS (const, 2 lines)
src/components/admin/support/requests-view.tsx:16 REQUEST_KIND_WORDS (const, 2 lines)
src/lib/data-admin.ts:20 MAIN_CURRENCY_NOTE (const, 2 lines)
src/lib/data-admin.ts:24 NOT_A_STATEMENT_NOTE (const, 2 lines)
src/lib/drop-shipping.ts:100 extraDispatchDays (const, 2 lines)
src/lib/kaizen-life-handoffs.ts:15 isHandoffStatus (const, 2 lines)
src/lib/page-modal.ts:237 MODAL_LEFT_OUT (const, 2 lines)
src/lib/page-modal.ts:240 MODAL_LEFT_OUT_SHORT (const, 2 lines)
src/lib/store-copy-wizard.ts:172 STATE_LABELS (const, 2 lines)
src/lib/store-copy-wizard.ts:343 inputIsValid (const, 2 lines)
src/lib/store-copy.ts:93 copyCount (const, 2 lines)
src/lib/work-invoice-ui.ts:388 hasDraftProblems (const, 2 lines)
src/lib/work-reports.ts:148 periodText (const, 2 lines)
src/components/admin/analytics/oss-view.tsx:62 DISPATCH_NOTE (const, 1 lines)
src/components/admin/analytics/oss-view.tsx:64 PART_LABEL (const, 1 lines)
src/components/admin/analytics/overview-text.ts:85 plural (const, 1 lines)
src/components/admin/audience-fields.tsx:11 AUDIENCE_LABELS (const, 1 lines)
src/components/admin/colour-library.tsx:258 gradientSwatch (named, 1 lines)
src/components/admin/data/ui.ts:9 link (const, 1 lines)
src/components/admin/legal-pages-panel.tsx:32 LEGAL_STARTER_NOTICE (const, 1 lines)
src/components/admin/orders/parcel-status.tsx:11 PHASE_WORDS (const, 1 lines)
src/components/admin/plan-invoices.tsx:8 INVOICE_STATUS (const, 1 lines)
src/components/admin/privacy/styles.ts:9 link (const, 1 lines)
src/components/admin/privacy/test-fixtures.ts:24 NOW (const, 1 lines)
src/components/admin/templates-helpers.ts:32 SOURCE_PHRASES (const, 1 lines)
src/components/admin/ui/index.ts:2 ButtonKind (re-export, 1 lines)
src/components/admin/ui/index.ts:2 ButtonSize (re-export, 1 lines)
src/lib/affiliate-admin.ts:162 AFFILIATE_OFF_NOTE (const, 1 lines)
src/lib/analytics-forecast.ts:60 RANGE_PROBABILITY (const, 1 lines)
src/lib/analytics-targets.ts:202 isTargetMetric (const, 1 lines)
src/lib/analytics-targets.ts:206 isTargetPeriod (const, 1 lines)
src/lib/autopilot-autonomy.ts:319 LEVEL_WORDS (const, 1 lines)
src/lib/bonus-admin.ts:283 BONUS_ON_NOTES (const, 1 lines)
src/lib/bonus-admin.ts:284 BONUS_OFF_NOTE (const, 1 lines)
src/lib/bonus-levels.ts:15 BONUS_LEVEL_DAYS (const, 1 lines)
src/lib/bulk-admin.ts:38 ACTION_WORDS (const, 1 lines)
src/lib/carousel-settings.ts:71 carouselKey (const, 1 lines)
src/lib/colour.ts:13 hexColour (const, 1 lines)
src/lib/content-types.ts:48 MAX_CONTENT_TYPES (const, 1 lines)
src/lib/content-types.ts:49 MAX_ENTRIES (const, 1 lines)
src/lib/content-types.ts:55 TYPE_KEY (const, 1 lines)
src/lib/creators.ts:10 CREATOR_STATUSES (const, 1 lines)
src/lib/customer-accounts.ts:30 ACCOUNT_ONLY_SEGMENTS (const, 1 lines)
src/lib/data-admin.ts:28 TEST_PAYMENT_NOTE (const, 1 lines)
src/lib/data-admin.ts:31 NEVER_EMAILED_NOTE (const, 1 lines)
src/lib/data-admin.ts:165 jobEnded (const, 1 lines)
src/lib/data-job.ts:493 startCursor (const, 1 lines)
src/lib/dhl.ts:35 dhlServiceOf (const, 1 lines)
src/lib/docs-content.ts:677 isDocLang (named, 1 lines)
src/lib/draft-order.ts:426 shippingVat (const, 1 lines)
src/lib/drafts-words.ts:22 editBlockWords (const, 1 lines)
src/lib/experiments.ts:157 pageMarker (const, 1 lines)
src/lib/green-claims.ts:54 GREEN_RULE_DATE (const, 1 lines)
src/lib/integrations.ts:175 APP_ERASE_AFTER_HOURS (const, 1 lines)
src/lib/inventory.ts:236 isStockPolicy (const, 1 lines)
src/lib/invoice-admin.ts:17 TAB_LABELS (const, 1 lines)
src/lib/invoice-admin.ts:90 VAT_KIND_LABELS (const, 1 lines)
src/lib/invoice-admin.ts:94 SOURCE_LABELS (const, 1 lines)
src/lib/invoice-admin.ts:146 SELLER_FIELD_LABELS (const, 1 lines)
src/lib/limits.ts:31 STORE_LIMIT_KEYS (const, 1 lines)
src/lib/notification-tools.ts:25 RULE_RUNS_DEFAULT (const, 1 lines)
src/lib/notifications.ts:183 isEditableNotification (const, 1 lines)
src/lib/order-edit-status.ts:27 ORDER_EDIT_START (const, 1 lines)
src/lib/order-edit.ts:53 editBlockText (const, 1 lines)
src/lib/order-ops-events.ts:135 fulfilmentInOrdersArea (const, 1 lines)
src/lib/payment-facts.ts:19 riskWords (const, 1 lines)
src/lib/payment-methods.ts:39 METHOD_TYPES (const, 1 lines)
src/lib/payment-providers.ts:13 PROVIDER_NAMES (const, 1 lines)
src/lib/peppol.ts:27 BILLING_PROCESS (const, 1 lines)
src/lib/picture-direction.ts:26 SHAPE_WORDS (const, 1 lines)
src/lib/postnord.ts:36 POSTNORD_COUNTRIES (const, 1 lines)
src/lib/postnord.ts:422 POSTNORD_RETURN_COUNTRIES (const, 1 lines)
src/lib/price-words.ts:80 hasWords (const, 1 lines)
src/lib/product-csv-test-support.ts:174 noProblems (const, 1 lines)
src/lib/recommendations.ts:93 hasSignals (const, 1 lines)
src/lib/redirect-admin.ts:204 SUGGESTION_KIND (const, 1 lines)
src/lib/redirect-tools.ts:14 OVERVIEW_WINDOWS (const, 1 lines)
src/lib/redirect-tools.ts:34 atLeast (const, 1 lines)
src/lib/replicate-styles.ts:93 COPY_PROPERTIES (const, 1 lines)
src/lib/replicate-styles.ts:279 stylesProblem (const, 1 lines)
src/lib/retention.ts:46 isRetentionKind (const, 1 lines)
src/lib/retention.ts:335 COUNTRY_KINDS (const, 1 lines)
src/lib/return-admin.ts:36 EXCLUSION_LABELS (const, 1 lines)
src/lib/return-admin.ts:39 DECLINE_REASON_LABELS (const, 1 lines)
src/lib/return-admin.ts:60 KIND_FILTERS (const, 1 lines)
src/lib/return-admin.ts:281 CHANNEL_LABELS (const, 1 lines)
src/lib/return-admin.ts:293 EXCHANGE_FILTERS (const, 1 lines)
src/lib/review-import.ts:12 REVIEW_COLUMNS (const, 1 lines)

## Largest exports only tests import (first 80; types aside)

src/server/tripletex-test-support.ts:135 fakeTripletex (function, 236 lines)
src/server/fiken-test-support.ts:79 fakeFiken (function, 228 lines)
src/lib/invoice-snapshot.ts:512 buildInvoiceSnapshot (function, 189 lines)
src/lib/store-export-scope.ts:20 STORE_EXPORT_LEFT_OUT (const, 171 lines)
src/server/privacy-fixture.ts:71 buildSubject (function, 166 lines)
src/db/invoice-fixture.ts:211 placeOrder (function, 157 lines)
src/lib/invoice-snapshot.ts:733 buildEditInvoiceSnapshot (function, 111 lines)
src/components/inline-edit/heading-editor.tsx:12 InlineHeadingEditor (function, 92 lines)
src/lib/credit-allocation.ts:370 editCreditNote (function, 80 lines)
src/server/order-ops-fixture.ts:49 seedOrder (function, 79 lines)
src/components/admin/work/invoice-test-support.ts:170 issuedDetail (function, 78 lines)
src/components/admin/returns/test-fixtures.ts:35 detail (function, 70 lines)
src/lib/work-import-fixture.ts:80 sampleLifeExport (function, 68 lines)
src/lib/signature-themes.ts:66 signatureCheck (function, 66 lines)
src/lib/support-state.ts:65 nextState (function, 65 lines)
src/lib/typography.ts:462 TEXT_FIELDS (const, 55 lines)
src/server/trust-fixtures.ts:94 fakeSupabase (function, 55 lines)
src/lib/credit-allocation.ts:291 creditNoteSnapshot (function, 53 lines)
src/lib/privacy-export.ts:983 validateExport (function, 53 lines)
src/server/tax-reports-fixture.ts:50 sellerStore (function, 50 lines)
src/server/data-test-support.ts:29 fakeStorage (function, 49 lines)
src/db/order-edit-fixture.ts:154 edit (function, 48 lines)
src/server/orders.ts:604 listOrders (function, 43 lines)
src/db/invoice-fixture.ts:47 createInvoiceStore (function, 41 lines)
src/lib/store-features.ts:391 NO_FACTS (const, 39 lines)
src/lib/xml-tree.test-helper.ts:24 parseXml (function, 39 lines)
src/server/fulfilment-test-fixture.ts:84 paidOrder (function, 38 lines)
src/lib/product-csv-test-support.ts:112 boot (function, 37 lines)
src/server/fulfilment-test-fixture.ts:31 fxStore (function, 37 lines)
src/server/work-test-support.ts:16 makeWorkStore (function, 35 lines)
src/lib/work-csv.ts:215 invoiceToCsv (function, 34 lines)
src/server/shipping-test-fixture.ts:54 deliveryOrder (function, 33 lines)
src/lib/store-copy-rules.ts:494 SECRET_TABLES (const, 32 lines)
src/lib/personal-data.ts:752 registerProblems (function, 30 lines)
src/components/admin/templates-test-support.ts:51 fakeActions (function, 29 lines)
src/lib/work-csv.ts:309 creditNotesToCsv (function, 28 lines)
src/components/admin/analytics/customers-view.tsx:105 SEGMENT_COPY (const, 26 lines)
src/lib/order-edit-view-fixture.ts:77 summaryOf (function, 26 lines)
src/lib/api-contract.ts:85 contractSurface (function, 25 lines)
src/lib/legal-sources.ts:321 registerProblems (function, 25 lines)
src/lib/store-copy-test-support.ts:6 choicesOf (function, 25 lines)
src/lib/privacy-export.ts:905 emptyExportInput (function, 24 lines)
src/lib/store-copy-test-support.ts:34 progressOf (function, 24 lines)
src/server/analytics-insights-fixture.ts:85 seedBusyStore (function, 24 lines)
src/components/admin/work/invoice-test-support.ts:146 draftDetail (function, 23 lines)
src/lib/i18n-glossary.ts:830 glossaryMarkdown (function, 23 lines)
src/lib/product-csv-test-support.ts:43 context (function, 23 lines)
src/server/data-test-support.ts:146 importThrough (function, 23 lines)
src/lib/domain-connect.ts:47 domainConnectTemplate (function, 22 lines)
src/lib/part-css.testing.ts:59 partStyleAt (function, 22 lines)
src/components/admin/analytics/overview-view.tsx:42 OverviewView (function, 21 lines)
src/server/field-entities.ts:164 customerFieldExportMany (function, 21 lines)
src/server/work-reports-test-support.ts:19 makeReportStore (function, 21 lines)
src/components/admin/returns/test-fixtures.ts:106 row (const, 20 lines)
src/components/admin/work/invoice-test-support.ts:249 listRow (const, 20 lines)
src/lib/credit-allocation.ts:118 parseWorking (function, 20 lines)
src/lib/inventory-csv.ts:41 INVENTORY_FINDING_CODES (const, 20 lines)
src/server/field-entities.ts:139 customerFieldExport (function, 20 lines)
src/server/fiken-sync.ts:577 checkFikenDocument (function, 20 lines)
src/server/legal-sources.ts:287 legalSourceStates (function, 20 lines)
src/server/store-starters.ts:252 saveStarterDraft (function, 20 lines)
src/components/admin/privacy/test-fixtures.ts:65 plan (const, 19 lines)
src/lib/agent-eval.ts:555 recordingProblems (function, 19 lines)
src/lib/ai-cost.ts:39 callCost (function, 19 lines)
src/server/bookings.ts:42 setBookingsModule (function, 19 lines)
src/server/inventory-test-support.ts:149 movementsOf (function, 19 lines)
src/server/store-starters.ts:535 moveStarter (function, 19 lines)
src/server/trust-fixtures.ts:151 fakeAdmin (function, 19 lines)
src/server/withdrawals.ts:451 getWithdrawalRequest (function, 19 lines)
src/lib/admin-schemes.ts:43 CONTRAST_RULES (const, 18 lines)
src/lib/analytics-export.ts:225 NOT_EXPORTED (const, 18 lines)
src/lib/analytics-export.ts:431 tableUses (function, 18 lines)
src/lib/health.ts:42 describeDatabaseUrl (function, 18 lines)
src/server/redirect-test-support.ts:44 redirectFixture (function, 18 lines)
src/server/standing-orders.ts:1135 forgetStandingOrders (function, 18 lines)
src/server/tax-rate-overrides.ts:75 listOverrides (function, 18 lines)
src/db/invoice-fixture.ts:433 refundReturn (function, 17 lines)
src/lib/design-presets.ts:53 BRAND_FIELDS (const, 17 lines)
src/lib/i18n-glossary.ts:798 glossaryProblems (function, 17 lines)
src/lib/order-list.ts:434 describeFilters (function, 17 lines)

## Packages by number of importing files (fewest first)

- @codemirror/autocomplete: 1 files (1 outside tests): src/components/admin/css-code-editor.tsx
- @codemirror/commands: 1 files (1 outside tests): src/components/admin/css-code-editor.tsx
- @codemirror/lang-css: 1 files (1 outside tests): src/components/admin/css-code-editor.tsx
- @codemirror/language: 1 files (1 outside tests): src/components/admin/css-code-editor.tsx
- @codemirror/state: 1 files (1 outside tests): src/components/admin/css-code-editor.tsx
- @codemirror/view: 1 files (1 outside tests): src/components/admin/css-code-editor.tsx
- @lezer/highlight: 1 files (1 outside tests): src/components/admin/css-code-editor.tsx
- @tiptap/starter-kit: 1 files (1 outside tests): src/components/admin/rich-text-editor.tsx
- @stripe/connect-js: 1 files (1 outside tests): src/components/admin/stripe-connect-embed.tsx
- @stripe/react-connect-js: 1 files (1 outside tests): src/components/admin/stripe-connect-embed.tsx
- simple-icons: 1 files (1 outside tests): src/components/brand-icon.tsx
- @supabase/realtime-js: 1 files (1 outside tests): src/components/chat/use-support-channel.ts
- @google/model-viewer: 1 files (1 outside tests): src/components/product-gallery.tsx
- web-vitals: 1 files (1 outside tests): src/components/speed-beacon.tsx
- @vercel/functions: 1 files (1 outside tests): src/db/client.ts
- @jsquash/avif: 1 files (1 outside tests): src/lib/avif-encode.ts
- motion: 1 files (1 outside tests): src/lib/motion-scroll.ts
- qrcode-generator: 1 files (1 outside tests): src/lib/qr.ts
- node:vm: 1 files (0 outside tests): src/lib/wordpress-plugin.test.ts
- node:async_hooks: 1 files (1 outside tests): src/server/actor.ts
- @sparticuz/chromium: 1 files (1 outside tests): src/server/browser.ts
- subset-font: 1 files (1 outside tests): src/server/font-trim.ts
- mammoth: 1 files (1 outside tests): src/server/knowledge.ts
- drizzle-kit: 1 files (1 outside tests): drizzle.config.ts
- eslint: 1 files (1 outside tests): eslint.config.mjs
- eslint-config-next: 1 files (1 outside tests): eslint.config.mjs
- @tiptap/core: 2 files (2 outside tests): src/components/admin/rich-text-editor.tsx, src/components/inline-edit/markup-editor.tsx
- @tiptap/extensions: 2 files (2 outside tests): src/components/admin/rich-text-editor.tsx, src/components/inline-edit/markup-editor.tsx
- @electric-sql/pglite-pgvector: 2 files (1 outside tests): src/db/testing.ts, src/db/vat.test.ts
- mediabunny: 2 files (2 outside tests): src/lib/animation-make.ts, src/lib/video-compress.ts
- seek-bzip: 2 files (1 outside tests): src/lib/legal-passages.test.ts, src/server/legal-sources.ts
- @supabase/ssr: 2 files (2 outside tests): src/lib/supabase/client.ts, src/lib/supabase/server.ts
- opentype.js: 2 files (1 outside tests): src/server/brand-marks.int.test.ts, src/server/font-outlines.ts
- node:module: 2 files (1 outside tests): src/server/document-html.tsx, e2e/compress.spec.ts
- fontverter: 2 files (1 outside tests): src/server/font-trim.test.ts, src/server/font-trim.ts
- node:https: 2 files (1 outside tests): src/server/replicate-fetch.ts, e2e/fixtures/https-proxy.mjs
- k6: 2 files (2 outside tests): scripts/load/browse.js, scripts/load/cart.js
- @axe-core/playwright: 2 files (0 outside tests): e2e/a11y.ts, e2e-live/a11y.spec.ts
- @stripe/react-stripe-js: 3 files (3 outside tests): src/components/checkout-form.tsx, src/components/express-panel.tsx, src/components/klarna-element.tsx
- web-push: 3 files (1 outside tests): src/server/activities.int.test.ts, src/server/push.int.test.ts, src/server/push.ts
- unpdf: 3 files (2 outside tests): src/server/bill-reading.ts, src/server/knowledge.ts, e2e/invoices.spec.ts
- @tiptap/react: 4 files (4 outside tests): src/components/admin/markup-input.tsx, src/components/admin/rich-text-editor.tsx, src/components/inline-edit/markup-editor.tsx
- @stripe/stripe-js: 4 files (4 outside tests): src/components/checkout-form.tsx, src/components/express-panel.tsx, src/components/klarna-element.tsx
- pg: 4 files (1 outside tests): src/db/client.ts, src/db/invoices-concurrency.int.test.ts, src/server/variants-scale.int.test.ts
- node:os: 4 files (1 outside tests): src/db/migrate-no-transaction.int.test.ts, src/lib/docs-api-reference.test.ts, scripts/perf.mjs
- node:util: 4 files (2 outside tests): src/db/migrate-no-transaction.int.test.ts, src/lib/docs-api-reference.test.ts, src/server/customers.ts
- typescript: 4 files (0 outside tests): src/lib/brand.scan.test.ts, src/lib/permissions.scan.test.ts, src/lib/theme-words.scan.test.ts
- node:zlib: 4 files (2 outside tests): src/server/admin-api.int.test.ts, src/server/old-shop.int.test.ts, src/server/old-shop.ts
- node:url: 6 files (5 outside tests): src/lib/parity.test.ts, scripts/await-deploy.mjs, scripts/prune-snapshots.mjs
- @dnd-kit/sortable: 7 files (7 outside tests): src/components/admin/block-fields.tsx, src/components/admin/field-group-editor.tsx, src/components/admin/menu-editor.tsx
- node:dns: 7 files (7 outside tests): src/server/domain-health.ts, src/server/domain-move.ts, src/server/peppol-lookup.ts
- @dnd-kit/core: 8 files (8 outside tests): src/components/admin/block-fields.tsx, src/components/admin/deals/deal-board.tsx, src/components/admin/field-group-editor.tsx
- @dnd-kit/utilities: 8 files (8 outside tests): src/components/admin/block-fields.tsx, src/components/admin/deals/deal-board.tsx, src/components/admin/field-group-editor.tsx
- @supabase/supabase-js: 10 files (9 outside tests): src/app/auth/confirm/route.ts, src/lib/supabase/mailer.ts, src/server/data-job-store.ts
- node:child_process: 10 files (4 outside tests): src/db/migrate-no-transaction.int.test.ts, src/lib/docs-api-reference.test.ts, src/lib/woocommerce-mover.test.ts
- playwright-core: 10 files (9 outside tests): src/lib/cookie-scan.ts, src/lib/page-look-shoot.ts, src/lib/replicate-open.ts
- postgres: 14 files (6 outside tests): src/db/migrate-no-transaction.int.test.ts, src/lib/store-hosts-build.ts, scripts/db-migrate.mjs
- node:net: 17 files (2 outside tests): src/server/apps.int.test.ts, src/server/custom-app-tools.int.test.ts, src/server/custom-apps.int.test.ts
- node:http: 22 files (2 outside tests): src/lib/docs-api-reference.test.ts, src/server/apps.int.test.ts, src/server/custom-app-tools.int.test.ts
- lucide-react: 24 files (24 outside tests): src/components/admin/admin-rail.tsx, src/components/admin/admin-view.tsx, src/components/admin/builder-rails.tsx
- sharp: 38 files (14 outside tests): src/lib/review-pictures.test.ts, src/lib/webp-xmp.test.ts, src/server/admin-api.int.test.ts
- stripe: 46 files (27 outside tests): src/app/api/stripe/billing/[mode]/route.ts, src/app/api/stripe/connect/[mode]/route.ts, src/app/api/stripe/webhook/[storeId]/route.ts
- @electric-sql/pglite: 67 files (3 outside tests): src/db/activities.test.ts, src/db/affiliates.test.ts, src/db/ai-allowance.test.ts
- node:path: 156 files (21 outside tests): src/app/admin/admin-css.test.ts, src/app/admin/admin-schemes.test.ts, src/app/admin/admin-type.scan.test.ts
- node:fs: 169 files (24 outside tests): src/app/admin/admin-css.test.ts, src/app/admin/admin-schemes.test.ts, src/app/admin/admin-type.scan.test.ts
- @playwright/test: 229 files (2 outside tests): e2e/a11y.spec.ts, e2e/a11y.ts, e2e/ab-form-goal.spec.ts
- react-dom: 235 files (9 outside tests): src/app/s/[store]/[market]/account/change/[token]/change-view.test.ts, src/app/s/[store]/[market]/account/exchange/[token]/exchange-view.test.ts, src/app/s/[store]/[market]/account/pay/[token]/pay-view.test.ts
- node:crypto: 279 files (151 outside tests): src/app/(platform)/get-domain/actions.ts, src/app/admin/(gated)/platform/referrals/page.tsx, src/app/api/ab/assign/route.ts
- zod: 597 files (586 outside tests): src/app/(platform)/get-domain/actions.ts, src/app/(platform)/sign-up/actions.ts, src/app/admin/(gated)/(owner)/account/kaizen-support/turn/route.ts
- server-only: 787 files (787 outside tests): src/app/admin/(gated)/[store]/broadcasts/editor-props.ts, src/app/admin/(gated)/[store]/content/site.ts, src/app/admin/(gated)/[store]/pages/context.ts
