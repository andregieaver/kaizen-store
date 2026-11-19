# Admin redesign, round 51: Export customers, Add a store and Export products on a phone

Decision D784, 19 November 2026. The boards are on the design canvas of round 51.

These were the tallest store pages on a phone that no round had reworked.

| Page | Before | After |
|---|---|---|
| Export customers (`/customers/export`) | 1,175 px | 707 px |
| Add a store (`/settings/company/places/new`) | 1,174 px | 813 px |
| Export products (`/products/export`) | 1,163 px | 843 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Export customers

- **One line says what the file is.**
- **The format and Export come first.** The notes move after them with CSS `order`, on a phone only.
- **Personal data is one line under the form:** *Keep it only as long as you need it. Deleted from here after 7 days.*
- **About this file is a row** (*Its columns, marketing consent, large exports*) that opens both notes.

## Add a store (`PlaceFields`)

- **The name keeps its field.** Its hint is left out.
- **The address stays open.** Postcode and town sit side by side at every width.
- **Phone, directions and opening hours are one row** (*(optional)*). Their fields are sent either way.
- `PlaceFields` takes `part` (`address`, `extras` or `all`), so the page can put the optional fields behind the row. The office on the
  company page and a place's own page use all of it, as before.

## Export products

- **One line says what the file is.**
- **Which products, the format and Export stay as they are.**
- **What the file does not carry is a row** under the button.

## Both exports (`DialectField`)

- **The formats' help is left out on a phone.** Their names say enough. Export orders shares the field, so it loses the help too.

## How this differs from the boards

- **Export products:** the radios keep their words (*Only products that are*, *Only products in*).
- **Export products:** the pictures' addresses keep their tick and help, which the board left out.
- **Add a store:** the side-by-side postcode and town needed their inputs to shrink. At first the town's input kept its natural width
  and the page scrolled sideways (408 px). It now shrinks with its column.

## Platform

- Kaizena Flow sells plans, not goods: it has no customer or product exports of this kind, and no stores to visit.

## Tests

- Lint and types pass.
- All unit tests pass.
- `data-export.spec.ts` passes against a local build.
- Two new sign-in steps from another session (the Norwegian owner and platform admin) did not sign in against this local database. The
  owner's and the admin's did, and the screens were shot with them.
