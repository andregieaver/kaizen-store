# Admin redesign, round 17: a phone pass

Decision D652, 16 November 2026. The boards are on the design canvas of round 17 (today at 390 px and a phone proposal for each page).
Six pages from rounds 13 to 16 were checked on an iPhone-sized screen; Tax, Domains and Reports held up, and these three made the owner
scroll past filters and repeats first. Wide screens are unchanged.

## A row of chips on a phone

`CHIP_STRIP` and `CHIP_ITEM` (`src/lib/chip-strip.ts`): below 640 px a row of chips or cards is one line that scrolls sideways to the
screen's edges; from 640 px it wraps as before. `chosenFirst()` puts the chosen chip first so it shows without scrolling.

## Plan discounts (`/admin/platform/discounts`)

The four ready offers are a strip to swipe on a phone, snapping to each card, and the whole card is the link; Live now is on the first
screen. Wider, the grid of two and four columns stays.

## Activity log (`/admin/{store}/activity`)

People and areas are two one-line rows that scroll sideways, with Everyone and All areas first and the chosen chip next.

## Emails (`/admin/platform/emails`)

The chips scroll sideways. While email is not set up a row leaves out "Not sent (email not set up)" (`EmailLog` `quietUnsent`): the
sentence says it once; failures still show, in red. On a phone a row is the subject on one line and the time and store under it; the
address is on the email itself.

## What differs from the boards

- "More filters and download" stays a fold rather than a link.

## Tests

`chip-strip.test.ts` (the chosen chip first).
