# Admin redesign, round 58: New text message, Close store and Change your store on a phone

Decision D814, 19 November 2026. The boards are on the design canvas of round 58.

These were the tallest store pages on a phone that no round had reworked.

| Page | Before | After |
|---|---|---|
| New text message (`/text-messages/new`) | 901 px | 713 px |
| Close store (`/settings/close`) | 887 px | 664 px |
| Change your store (`/dream-factory`) | 873 px | 664 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## New text message

- **What they get is one line under the message:** *They get “E2E Shop: …” and a link to stop texts.*
- **The preview waits for words:** the box of the text as sent, and its count of texts, shows once something is written.
- *Save draft* is on the first screen.

## Close store

- **One line says what closing is:** *Stops sales and takes the shop off the web. Nothing is deleted; you can reopen for 30 days.*
- **What stops the close comes first**, with *See the orders* under it.
- **What closing does and Take your store with you are two rows of one card** under the close, each opened with *Open*.

## Change your store

- **One line says what it is:** *Say what you want changed. Nothing goes live until you say so.*
- **The request and Plan my changes come first**, with a one-line example under the field.
- **Let the AI look at your site first is a row** under it (*Design, copy and images; it suggests what to ask for*): the three
  ticks and Analyse existing. It is open while the analysis works or after it failed; a finished analysis shows under the row, its
  suggestion already in the field.

## How this differs from the boards

- **Close store:** the sub of What closing does is *What carries on and what stops*, not the board's *Returns go on; Stripe pays out
  as usual*: what it lists depends on the store's open returns, bookings and checkouts.
- **New text message:** the count of texts waits with the preview, as it counts the empty message.

## Platform

- Text messages reach Kaizena Flow through its own store (D484): the same page, so the same change.
- Closing and the Dream Factory stay store-only (`docs/platform-parity.md`): Kaizena Flow is never closed, and its site is changed in
  the platform's own editor.

## Tests

- Lint, types and all unit tests pass.
- `text-messages.spec.ts` and `leaving.spec.ts` pass against a local build (8 tests). Downloading the store first failed on the
  local database, which lacked the form templates migration of 17 November; applied, it passes.
