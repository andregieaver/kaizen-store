# Admin redesign, round 57: Import customers, Your old shop's links and Issue a gift card on a phone

Decision D813, 19 November 2026. The boards are on the design canvas of round 57.

These were the tallest store pages on a phone that no round had reworked (Endpoints, SEO and the categories pages had been).

| Page | Before | After |
|---|---|---|
| Import customers (`/customers/import`) | 955 px | 664 px |
| Your old shop's links (`/redirects/old-shop`) | 955 px | 664 px |
| Issue a gift card (`/gift-cards/new`) | 941 px | 664 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Import customers

- **One line says what it brings in:** *Your customers from a CSV file, such as Shopify's export.*
- **The file's limit is one line:** *Up to 15.0 MB and 20,000 rows. Each row needs an email. Checked before anything changes.*
  (`CustomerUpload` takes the shorter phone hint, as the order history's has since round 55.)
- **What an import does is a row** (*Found by email; no passwords, no marketing*).
- **The file's keeping is one line:** *Your file is deleted 30 days after the import; the history stays.* The shared note from `sm` up
  speaks of stock; it is left for its own change.

## Your old shop's links

- **One line says what it is for:** *Check that every link to your old shop still leads somewhere here.*
- **The address and Check my old shop stay**, with one line under them: *Only its list of pages is read; nothing changes there.*
- **How this works is a row**, before a check and after it.

## Issue a gift card

- **One line says what it is:** *Worth the amount you give. Its code is shown once.*
- **The amount and its currency sit side by side.**
- **Who it is for, and why, is one row** (*Optional: an email sends them the code*): the email, name, message, language and the
  reason. An email the browser flags opens the row (`#gift-more`), so nothing it asks for stays hidden.
- *Issue the gift card* is on the first screen.

## How this differs from the boards

- **Your old shop's links:** the page menu keeps its place under the line.
- **Issue a gift card:** the language of the email, when the store has more than one, is in the row too.

## Platform

- Customers and redirects reach Kaizena Flow through its own store (D484): the same pages, so the same change.
- Gift cards stay store-only (`docs/platform-parity.md`): Kaizena Flow sells plans, not goods.

## Tests

- Lint, types and all unit tests pass.
- `redirects.spec.ts`, `redirects-admin.spec.ts`, `data-export.spec.ts` and `customers-staff.spec.ts` pass against a local build
  (24 tests). The customers spec first failed on the local database, which lacked migrations of 18 November; applied, it passes.
