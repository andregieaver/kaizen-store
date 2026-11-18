# Admin redesign, round 48: Suppliers, Shipping zones and Private mode on a phone

Decision D756, 18 November 2026. The boards are on the design canvas of round 48.

These were the tallest store pages on a phone that no round had reworked. Broadcasts and Apps and API were passed over, as rounds 10 and 27
reworked them.

| Page | Before | After |
|---|---|---|
| Suppliers (`/inventory/suppliers`) | 1,281 px | 664 px |
| Shipping zones (`/settings/shipping/zones`) | 1,273 px | 796 px |
| Private mode (`/settings/private`) | 1,245 px | 664 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Suppliers

- **One line says what the page is for.**
- **Each supplier is a line:** its name, then where it ships from, how fast and how many products (*Denmark · 2 working days · 1 variant*).
  The table, with stock and the deliveries on time, shows from 640 px.
- **Adding a supplier and the wait before an order goes are rows of one card.** The wait says what is set (*30 min, for a quick
  cancellation*).
- **The note that you are the seller is one line.**

## Shipping zones (`ZonesView`)

- **One line says what the page is for.**
- **Check a postal code stays,** without its explanation.
- **The zones card keeps its list, or its line saying there are none.** How codes are matched is a row inside it.
- **Add a zone is a row** (*A name and its codes, such as 8\*, 9\**) that opens the form.

## Private mode

- **One line says what the page is for.** The chip and the switch stay first.
- **The password, signing everyone out, the landing page and the preview are rows of one card.** Each says where it stands (*None: only
  your team can come in*). The password's row opens by itself while the store is private.
- The landing page and the preview are rows that lead straight there. Their cards show from 640 px.

## How this differs from the boards

- **Suppliers:** a supplier's line has no status at its right. The table's columns are stock and on time, not a status.
- **Shipping zones:** the check keeps its card and heading. The pattern rules sit inside the zones card, not beside Add a zone.
- **Private mode:** the switch keeps its card and full button words (*Make the store private*).

## Platform

- Kaizena Flow sells plans, not goods: it has no suppliers or shipping zones.
- It has no private mode of its own: its site is public, and its pages have their own drafts.

## Tests

- Lint and types pass.
- All unit tests pass.
- `suppliers.spec.ts` and `private-mode.spec.ts` pass against a local build. The phone's preview link carries no
  `data-private-preview`, so the spec's locator finds the card's.
