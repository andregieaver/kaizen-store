# Admin redesign, round 42: Roles, eBay and Header and footer on a phone

Decision D739, 17 November 2026. The boards are on the design canvas of round 42.

These were the tallest store pages on a phone that no round had reworked. The Website hub (1,888 px) is taller, but round 3 reworked it.

| Page | Before | After |
|---|---|---|
| Roles (`/staff/roles`) | 1,882 px | 832 px |
| eBay (`/integrations/ebay`) | 1,863 px | 973 px |
| Header and footer (`/settings/navigation`) | 1,860 px | 664 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Roles

- **One line says what roles are.**
- **The roles are rows of one card**, each with who holds it. Each still opens to change or delete it.
- **Make a role is a row** that opens the name and the grid.

## eBay

- **One line says what the page is for.**
- **What every listing needs is a row** that names the marketplace and how many of the five numbers are set (*eBay.de (Germany) · all
  five numbers set*). It is open while any number is missing.
- **Each product is one line**: its box, its name and where it stands. The SKU and the note on listing are shown from 640 px.

## Header and footer (`NavigationEditor`)

- **One line says what the page is for.**
- **The logo, the logo for dark backgrounds, the icon and the menus are four rows of one card.** Each says what is set (*In the header*,
  *None: the logo above is used*, *None: Kaizena Flow's is shown*, *Main menu · Footer menu*) and opens its card as it was.
- Kaizena Flow's own header and footer (`/admin/platform/navigation`) use the same editor, so they change the same way. Its business
  details stay a card under the rows.

## How this differs from the boards

- **Roles:** a role's line keeps *Nobody holds it* rather than *Nobody*.
- **Header and footer:** the rows have no small preview of the logo, and the two menus are one row. The links to Menus and Headers are
  in the opened card's help, not in a line under the rows.
- **eBay:** Connected and Disconnect keep their card above the row.

## Platform

- Kaizena Flow's header and footer share the editor.
- Its roles are the platform team's own page (`/admin/platform/team`, D471), as before.
- Kaizena Flow does not sell on eBay: it sells plans.

## Tests

- Lint, types and all unit tests pass. Seven files time out under the full run's load and pass when run alone.
- `passport-claims-ebay.spec.ts`, `icons.spec.ts` and `menus.spec.ts` pass against a local build.
