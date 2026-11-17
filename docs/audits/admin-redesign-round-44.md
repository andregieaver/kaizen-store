# Admin redesign, round 44: Inventory analytics, Prices and a new content type on a phone

Decision D742, 17 November 2026. The boards are on the design canvas of round 44.

These were the tallest store pages on a phone that no round had reworked.

| Page | Before | After |
|---|---|---|
| Inventory analytics (`/analytics/inventory`) | 1,763 px | 1,476 px |
| Prices and quantity (`/settings/prices`) | 1,735 px | 701 px |
| New content type (`/content/new`) | 1,656 px | 1,056 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Inventory analytics (`InventoryView`)

- **One line says what the page is for:** *What is in stock, what runs out, what sits.*
- **Missing costs are one strip with Fix:** *223 units have no cost, so stock value is missing*. Fix goes where the costs are entered.
- **Running out loses its description.** Each alert says only how many sold in 30 days, beside its pill.
- The figures stay compact, as round 34 made them.
- **Every variant loses its description.** The list is as before.

## Prices and quantity (`PriceDisplayForm`)

- **One line says what the page is for.**
- **Decimals, words around a product's price and the quantity picker are rows of one card.** Each row says what is chosen, live:
  *Always show the decimals · 499,00 kr*, *None* or the price as shoppers read it, *− and + beside the number*.
- Advanced stays a fold under the rows. Save follows it.

## New content type (`ContentTypeEditor`)

- The name stays open. The card's heading is read out but not shown.
- **The web name and a page for each entry are one row in the name's card:** */entries/ · no page for each entry*. An empty web name
  opens the row when the browser flags it.
- **What the fields are for is a row:** *Title: Title · Summary: None · Picture: None*. It comes before the fields, as drawn.
- The fields card stays as it was. Save the type follows it.
- **The preview is a row** (*The form an entry gets*, Open).
- A content type's settings page uses the same editor, so it changes the same way.

## How this differs from the boards

- **Inventory analytics:** the alerts keep their own card with its heading, and their names keep the status (*out of stock*,
  *on backorder*). The figures keep round 34's grid rather than the board's one combined line.
- **Inventory analytics:** the page is still the tallest of the three. Most of what is left is the list of every variant.
- **New content type:** the web name row sits inside the name's card, not in a card with what the fields are for.

## Platform

- Kaizena Flow's own content types use the same editor, so they get the rows too.
- Kaizena Flow sells plans, not goods: it has no stock and no prices to show this way.

## Tests

- Lint and types pass.
- All unit tests pass.
- `price-display.spec.ts` and `content-types.spec.ts` pass against a local build.
