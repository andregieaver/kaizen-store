# Admin redesign, round 49: Workflows, Shipping profiles and Import products on a phone

Decision D762, 18 November 2026. The boards are on the design canvas of round 49.

These were the tallest store pages on a phone that no round had reworked. Company settings (1,231 px) was passed over, as rounds 10 and 23
reworked it.

| Page | Before | After |
|---|---|---|
| Workflows (`/settings/workflows`) | 1,237 px | 664 px |
| Shipping profiles (`/settings/shipping/profiles`) | 1,235 px | 664 px |
| Import products (`/products/import`) | 1,227 px | 671 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Workflows

- **One line says what the page is for:** *When something happens, do what you choose.*
- **The workflows come first,** or the line saying there are none.
- **New workflow is a row under them** (*When, only if, then*) that opens the whole form. CSS `order` moves it on a phone only.
- **The limits are one line.**
- Kaizena Flow's own workflows (`/admin/platform/workflows`, D516) change the same way, in the same change.

## Shipping profiles (`ProfilesView`)

- **One line says what the page is for.**
- **General, each profile and adding one are rows of one card.** General says its products (*10 products · every product in no other
  profile*). A profile's row opens its name, products and delete. Add a profile opens the form with every product to tick.
- **Why a basket pays more is one line under the card.**

## Import products (`ImportUpload`)

- As Import stock in round 46.
- **One line says what the page is for.**
- **The file's hint is one line.**
- **How the file is read is a row** (*Handles, SKUs, prices, pictures*) that opens the rules.
- **The note on keeping the file is one line.**

## How this differs from the boards

- **Shipping profiles:** the note on the sum of rates sits under the card, not in it.
- **Import products:** the back link keeps its place above the title.

## Platform

- Kaizena Flow sells plans, not goods: it has no shipping profiles or product imports.
- Kaizena Flow's own Workflows page (D516) gets the same rows: its workflows first, a new one as a row. Its limits keep their own words.

## Tests

- Lint and types pass.
- All unit tests pass.
- `automation.spec.ts` and `data-export.spec.ts` pass against a local build.
