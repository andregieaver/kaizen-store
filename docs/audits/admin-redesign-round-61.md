# Admin redesign, round 61: Website chat, New draft order and Privacy requests on a phone

Decision D822, 19 November 2026. The boards are on the design canvas of round 61.

These were the tallest store pages on a phone that no round had reworked (Headers, as tall, changed with Footers in round 60).

| Page | Before | After |
|---|---|---|
| Website chat (`/support/widgets`) | 779 px | 664 px |
| New draft order (`/orders/drafts/new`) | 736 px | 664 px |
| Privacy requests (`/privacy`) | 731 px | 664 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Website chat

- **One line says what it is:** *Put this chat on your other websites; conversations come here.*
- **No widgets yet is a short line**, and the form's card has no heading (New chat widget stays for screen readers).
- **What the chat answers from is a row** (*Your knowledge base*, Open) in place of the two lines and their link under the form.

## New draft order

- **One line says what the market decides:** *Where it is for decides the currency, the VAT and the shipping.*
- **The language and currency share a line** under the country.
- **The hint is one line:** *You can change it later; the editor says which prices moved.* *Start the draft* is well inside the
  first screen.

## Privacy requests

- **One line says what to do:** *Log a request when it arrives and answer it within one month.*
- **An empty list is a line**, not a card.
- **How the month is counted is a row** (*To the same day; up to two more if complex*) that opens the full text, its lawyer line
  included.

## How this differs from the boards

- **Privacy requests:** the phone line leaves out *This is not legal advice*; the full text under the row ends by sending the owner
  to their lawyer.
- **New draft order:** the shop address of the market (`/no`) is in the full hint only.

## Platform

- Kaizena Flow's own Website chat (`/admin/platform/support/widgets`) gets the same line, empty line and row: the page's header and the
  list are the same words and component.
- Privacy requests reach Kaizena Flow through its own store (D484, `docs/platform-parity.md`): the same page, so the same change.
- Draft orders stay store-only: Kaizena Flow sells plans, not goods.

## Tests

- Lint, types and all unit tests pass.
- `privacy.spec.ts` and `support-embed.spec.ts` pass against a local build (6 tests).
