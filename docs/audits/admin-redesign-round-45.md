# Admin redesign, round 45: a new footer, Blogs and Bulk edit on a phone

Decision D743, 17 November 2026. The boards are on the design canvas of round 45.

These were the tallest store pages on a phone that no round had reworked.

| Page | Before | After |
|---|---|---|
| A new footer (`/footers/new`) | 1,574 px | 1,428 px |
| Blogs (`/articles/blogs`) | 1,539 px | 671 px |
| Bulk edit (`/products/bulk`) | 1,538 px | 765 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## A new footer (`PageEditor`)

- **The name loses its note on who sees it.** A header's does too, as the two share the editor.
- The footer is drawn as visitors see it, as before. Add a part stays under it.
- **Reveal on scroll is a row** saying *Off: the footer is where it always is*, or that it is on.
- Kaizena Flow's own headers and footers use the same editor, so they change the same way.

## Blogs

- **One line says what the page is for:** *Each with its own address, articles and comments.*
- **Each blog says its articles and comments in the line under its address:** *4 articles, comments: held for you to read*. The chips
  show from 640 px.
- **Add a blog is a row** (*A name, an address and its comments*) that opens the form. Edit opens it too, through its anchor.
- **In the form, the names in the other languages are a row.** The main language's name stays open. Every field is sent either way.

## Bulk edit (`RecentBatches`)

- **One line says what the page is for.**
- **Where to start is a strip** (*Tick products in the list, then Edit in a grid*) with a Products button.
- **Each recent change is a line:** *Change price · 2 changed*, with the short time under it (*15 Nov, 22:18*, `momentShort()`), and
  *undone* or how many failed where it applies. Undo stays beside a change still inside the seven days.
- Five show first, then *Show 5 more*.
- The table shows from 640 px.

## How this differs from the boards

- **A new footer:** the page shrinks least. The footer itself is most of it.
- **A new footer:** Page settings stays a heading over its rows (round 27). The footer has few of them.
- **Blogs:** Add a blog is a row with Open, not a green button. The form keeps its own title when opened.
- **Blogs:** *First blog* is not repeated in the line. It shows as a chip from 640 px, and `/blog` says it.
- **Bulk edit:** the products button is named *Products*, as the back link is.

## Platform

- Kaizena Flow's own footers and headers share the editor, so they change the same way.
- Kaizena Flow has one blog, so it has no Blogs page.
- It sells plans, not products, so it has no bulk grid.

## Tests

- Lint and types pass.
- All unit tests pass. `bulk-views.test.ts` now counts two Undo buttons, one in the table and one in the phone's lines.
- `momentShort()` has its own test.
- `blogs.spec.ts`, `products-grid.spec.ts` and `data-export.spec.ts` pass against a local build.
