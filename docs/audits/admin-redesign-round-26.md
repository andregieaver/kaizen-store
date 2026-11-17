# Admin redesign, round 26: Books, Design and Traffic on a phone

Decision D699, 16 November 2026. The boards are on the design canvas of round 26 (each page as it was at 390 px, and a phone
proposal). I measured the height of all 270 store pages on a phone and took the three longest that an owner opens there:
- Books was 11,341 px: fifteen cards, then every journal entry in full.
- Design was 8,100 px: three paragraphs, then fourteen colour fields.
- Traffic was 7,315 px: every section said again that visit counting was off.

Everything below applies below 640 px. From 640 px each page is as before, so the desktop specs are unchanged.

## A shared row (`PhoneRow` and `PhoneRows`, `src/components/admin/phone-row.tsx`)

- On a phone, a part of a long page becomes one row. The row shows the part's name, what it holds or has chosen, and Change (Open on
  Books). Pressing it opens the part in place.
- `PhoneRows` puts the rows into one card.
- `flat` takes the frame off a part that is a card of its own, so it does not show as a card inside a card.
- A link to the row's `id` opens the row and scrolls it into view.

## Books (`/admin/{store}/settings/books`)

- **Under the title:** one line, *From 1 January 2026, in NOK · locked through 31 January*. The facts card waits for wider screens.
- **What needs the owner comes first:** while the bank has lines that are not in the books, a yellow strip names the first one, with
  *Post it*. Post it opens the Bank row.
- **The work, as rows:**
  - The year-end, when one is due
  - The opening balance, when it is offered
  - Bank (*0 of 1 line matched*)
  - Bills to pay
  - Receipts by email
  - Subscriptions
  - Budget
  - The threshold watch
  - Year-end
  - Waiting
- **Reports**, under their own heading:
  - Trial balance, with its days
  - Profit and loss, with its result
  - Balance sheet, with its day
  - VAT by code, with the amount to pay
  - SAF-T, either *Ready to download* or *Needs the organisation number*
  - The comparison with Tripletex, with its number of differences
- **Journal and entries:** the journal (*Newest: M2026-2 Tilbakeføring*), posting by hand, locking (with the day it is locked
  through) and opening earlier.
- **The journal's accounts:** they wrap instead of being cut to *192…*, and the amount columns are narrower on a phone.

## Design (`/admin/{store}/settings/design`)

- **Under the title:** one line, *How your store looks. Pages you build use it too.*
- **The live theme on top:** its four colours, its name, *Live on the store* and Preview.
- **The theme's settings, as rows that say what is chosen:**
  - Colours (the light and dark swatches)
  - Fonts (the font and the heading weight)
  - Buttons and corners
  - Layout
  - Screen sizes (*Tablet from 768 px, computer from 1,024 px*)
  - Product cards
  - Checkout look
- **The preview** is a row of its own below the settings.
- **The bar with Save** does not stick to the top of a phone's screen. It stays above the rows.
- **The rest of the page, as rows:**
  - Other themes (*0 installed*): the theme library
  - Theme updates, when there are any
  - Let pages follow the theme (*Count the settings first*)
  - Add a theme
  - Share this look
  - The cart
- **The starting points** (Themes) are the last row.

## Traffic (`/admin/{store}/analytics/traffic`)

- **While visit counting is off:** one card, *See where visitors come from*, with a wide *Turn on visit counting* button.
  - For an owner, the button switches counting on in place (`setVisitCountingAction`). Anyone else gets a link to the settings.
  - The funnel, devices and landing pages are left out until counting is on. They no longer each say that there is nothing to show.
  - This applies at every width.
- **On a phone, From your orders** is one card of rows. Each row opens its section in place:
  - Countries that buy (the first country)
  - What shoppers search for (counted)
  - When customers buy (the paid orders counted)
  - Refunds and returns
  The page's long line and the box of questions this page answers wait for wider screens.
- **Choosing the period on a phone** (`PeriodPicker`, so every analytics page):
  - Today, *7 days*, *30 days* and This month sit on one line, with *Other dates* at its end.
  - Other dates opens Yesterday, Previous month and This year, the two date fields and Compare with.
  - A period chosen from those stays on the line.

## How this differs from the boards

- **Books:** each card is its own row; the boards drew fewer, merged ones (Receipts and subscriptions, Budget and year-end).
- **Books:** the journal is a row naming its newest entry, not two entries open on the page.
- **Design:** Layout, Screen sizes, Product cards and the checkout have a row each, where the boards drew one *Spacing, motion and the
  rest*.
- **Design:** Theme updates, Add a theme, Share and the cart are rows too.
- **Traffic:** From your orders has What shoppers search for in place of Paid orders. The paid orders are counted on When customers buy.

## Platform

- **Shared parts:** the period picker is shared, so the platform's analytics pages get the same line of chips. `PhoneRow` is ready
  for the platform's own long pages.
- **Books:** Kaizena Flow's own books (D508) have their own page, which this round did not change. It is the next step for the books
  on a phone.
- **Design:** Kaizena Flow's site uses the theme editor, so its settings show as rows on a phone too.
- **Traffic:** this page is store-only. The platform has no visit funnel.

## Tests

- `traffic-view.test.ts` now expects the single card. When counting is off there is no funnel, device or landing text, and the paid
  orders are counted on the When row.
- `period-picker.test.ts` still finds three labels and one current period. The current chip may now carry its short name for a phone.
- `books.spec.ts` and the theme specs run at desktop width, where every region is as before.
