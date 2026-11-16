# Server code kept though nothing calls it yet

Step 0.36 of the bloat review deleted the exports nothing used. Unused is never a reason to retire a feature: the platform is not
open yet. Each entry in the first table is the server side of a feature that only lacks its screen, a form or a link: it stays.
The owner decides, entry by entry, to build the screen or to retire the code. The second table lists the other names the step left
in place, each with its reason. The review's unused-code script (`docs/audits/bloat-review-2026-11/scripts/unused-code.mjs`) keeps
listing every name below until it is wired or retired.

## Waiting for a screen

| Name | File | The server side of | What is missing | Date |
|---|---|---|---|---|
| `updateTimeEntryAction` | `src/app/admin/(gated)/(owner)/account/work/s/[store]/actions.ts` | Correcting a logged time entry in Work (D122, D123) | The edit form on a time entry; only start, stop and delete have one | 16 Nov 2026 |
| `orderContentTypes()` | `src/server/content-types.ts` | Content types in the owner's order (D326, `docs/wave-6-catalogue.md` H) | A way to reorder the types on the Content page; entries have `moveEntry()` and a control, types have neither control nor caller | 16 Nov 2026 |
| `dealOfThing()` | `src/server/deals.ts` | A deal shown on what it is linked to (D464) | The line on an order's, a quote's and a Work assignment's own page naming its deal | 16 Nov 2026 |
| `usageHistory()` | `src/server/usage.ts` | A metric's last 90 days for Lisa (D314, `docs/capacity.md` step 1.6) | The *Details* link and chart under *Usage this month* on a store's Billing page | 16 Nov 2026 |
| `previewStarters()` | `src/server/design-presets.ts` | The store templates a theme preview may show (D275, D277) | The preview's chooser that would list them; a rule names it (`docs/rules/admin/website.md`, A theme's own content), so it stays until the rule is changed with it | 16 Nov 2026 |

## Left in place for another reason

| Name | File | Reason | Date |
|---|---|---|---|
| `register` | `src/instrumentation.ts` | Next calls it | 16 Nov 2026 |
| `MODAL_LEFT_OUT` | `src/lib/page-modal.ts` | Named by a rule (`docs/rules/admin/website.md`, Modals) | 16 Nov 2026 |
| `carouselOnPhonesOnly` | `src/lib/responsive.ts` | Named by a rule (`docs/rules/admin/website.md`, Custom grid items and the carousel) | 16 Nov 2026 |
| `ACCOUNT_ONLY_SEGMENTS` | `src/lib/customer-accounts.ts` | Named by a rule (`docs/rules/admin/commerce.md`, Refund to store credit and customer accounts) | 16 Nov 2026 |
| `SENDCLOUD_TEST_OPTION` | `src/lib/sendcloud.ts` | Named by a rule (`docs/rules/admin/commerce.md`, Shipping carriers) and by `src/server/carriers/sendcloud.ts`'s comment | 16 Nov 2026 |
| `SERIES_TEXT` | `src/lib/work-settings.ts` | Named by a comment in `src/lib/admin-messages/screens.en.ts` | 16 Nov 2026 |
| `editBlockText` | `src/lib/order-edit.ts` | Named by a comment in `src/components/admin/orders/order-edit-card.tsx` | 16 Nov 2026 |
| `REVIEW_COLUMNS` | `src/lib/review-import.ts` | Named by a comment in `src/lib/shopify-copy.ts` | 16 Nov 2026 |
| `FIELD_FILE_ACCEPT` | `src/server/media.ts` | Named by a comment in `src/components/admin/fields-form-helpers.ts`, whose list mirrors it | 16 Nov 2026 |
| `buildTestDatabaseTemplate` | `src/db/testing.ts` | Used by the tests' own setup (`src/test/test-db-template.ts`), which the script counts as a test | 16 Nov 2026 |
| `LATER_AREAS`, `settledEnglish` | `src/components/admin/admin-text-later.ts` | Used by the tests' own setup (`src/test/admin-english.ts`) | 16 Nov 2026 |
| The Drizzle tables | `src/db/schema.ts` | drizzle-kit reads the file by path to write migrations (`drizzle.config.ts`); the script cannot see that | 16 Nov 2026 |
| `ContactFieldsCard`, `CustomerAccountsCard`, `PanelEdge` (`floating-panel.tsx`), `AdminLinkProps` (`ui/index.ts`), `AdAccountPlatform`, `Pinned` (`challenge-pin.ts`), `MIN_VERSION_VIEWS`, `FLAG_VERSION_VIEWS`, `RequestAddress`, `framePath`, `STATUS_SIGNAL` (`src/lib/experiments.ts`), `applyVariantAction`, `discardExperimentAction`, `cancelRequestRefusal`, `deleteRecording` | `src/components/admin/`, `src/lib/`, `src/app/admin/(gated)/[store]/experiments/actions.ts`, `src/server/support-requests.ts`, `src/server/recordings-admin.ts` | Not on the review's list of 12 November (`lists/unused-exports-tier-0.txt`): added or left unused since by work in progress elsewhere (the admin redesign, A/B tests, heatmaps and recordings, support); not this step's to judge | 16 Nov 2026 |
