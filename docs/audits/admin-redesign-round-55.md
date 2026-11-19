# Admin redesign, round 55: Product feeds, Import order history and Export redirects on a phone

Decision D806, 19 November 2026. The boards are on the design canvas of round 55.

These were the tallest store pages on a phone that no round had reworked.

| Page | Before | After |
|---|---|---|
| Product feeds (`/feeds`) | 1,015 px | 664 px |
| Import order history (`/orders/history-import`) | 995 px | 664 px |
| Export redirects (`/redirects/export`) | 993 px | 687 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Product feeds

- **One line says what the page is for:** *Your products where people shop: Google, Meta, TikTok, Pinterest and AI assistants.*
- **The three switches are rows of one card:** product feeds (first while they are off), shopping agents and the ChatGPT feed. Each
  says *On* or *Off* and where it goes; while it is off, its one press sits beside it (*Turn on*, or *Let in* for shopping agents), the
  same action as the card's button. The row opens the card with its explanation, addresses and the way to turn it off.
- With the feeds on, each country's addresses follow as before.

## Import order history

- **One line says what it brings in:** *Your old shop's orders, from Shopify's order export.*
- **The file's limit is one line:** *Up to 15.0 MB and 20,000 orders. Checked before anything is imported.* (`CustomerUpload` takes a
  shorter phone hint where the words give one; the customer import keeps its own.)
- **What an order history is is a row** (*Never paid, sent or counted; customers first*) after the upload.
- **The file's keeping is one line:** *Your file is deleted 30 days after the import; the history stays.* The longer note spoke of
  stock; it stays from `sm` up as it was.

## Export redirects

- **One line says what the file is:** *A row for each redirect: where it goes from and to.*
- **The two choices keep their names and lose their hints** on a phone.
- **About the file is a row** after the button.

## How this differs from the boards

- **Product feeds:** with the feeds on, their row is not shown; each country's addresses come after the two remaining rows, as from
  `sm` up.
- **Export redirects:** the second choice keeps its name (*All redirects, the automatic ones too*).

## Platform

- Kaizena Flow sells plans, not goods: it has no product feeds and no order history to bring in.
- Its redirects are its own store's (it serves kaizenaflow.com, D484): the same page, so the same change.

## Tests

- Lint and types pass.
- Unit tests pass but two that fail on main without this change (`admin-words-handed` for the support area and `route-load` for
  `store-product`), from other sessions' commits named in the `ci-red` issue (#22).
- `redirects-admin.spec.ts` and `standard-taxonomy.spec.ts` pass against a local build (6 tests). On a phone, *Let in* on the
  shopping agents row turned them on and the row said *On*; they were turned off again.
