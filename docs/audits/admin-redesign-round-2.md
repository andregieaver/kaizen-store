# The admin redesigned, round 2 (November 2026)

Decision D597. Round 1 (`admin-redesign-round-1.md`, D595) set the dashboard, the record and the editor. Round 2 sets the two patterns most of
the remaining pages are made of: the **list** (orders, products; later customers, returns, pages) and the **hub** (settings; later website).
The proposals are on the owner's design canvas "Admin redesign, round 2"; the owner chose, 14 November 2026, to build them as drawn.

## Rules every list follows from now on

- A picture or initials at the start of every row.
- State as a chip with a dot and a word; one warning colour per page.
- Opens on the view Homer needs today; All is one tab away.
- Search, filters and saved views together; columns and bulk actions only when asked for.

## What was built

| Page | Built |
|---|---|
| Orders list | The bare address shows *To send* while orders wait (without a redirect) (`?show=all` is All); the header says how many wait and since when, with *Start packing* (the oldest order) as its one green button and draft orders, emails and export in a *More* menu; the views are a pill with To send's count and a *More views* menu (the other built-in views and saved views); rows show initials, product pictures and the sending state as a chip (warning to send, green sent). Filters, columns, saved views and bulk actions are as before. |
| Products list | Pictures by default, the table (with its bulk tools) one press away, the choice kept in the browser; a search over names and SKUs and filters (All, On sale, Drafts, Needs stock) in the browser over the list read; stock as a bar with words, sold out dimmed with *Restock*, drafts *Finish it*; sixty at a time with *Show more*; import, export and categories in one menu beside *Add product*. |
| Product editor | Carried from round 1: the VAT part under each typed price (`vatIncluded()` at the country's rate for the product's category), one fewer / one more beside stock, and *Jump to* links at the top of More options. |
| Settings | By job (Get paid; Sell and deliver; Your business and team; Look and legal), each card with its state from the store's setup (business details, countries, checkout and test mode, delivery prices, the plan, the team, features on); a strip of the essentials with the next fix as the page's one green button; every other setting the member may open listed by name under *Everything else*; a search over all of them. Kaizena Flow's own Settings uses the same hub without the strip. |

## Left for later

- On a phone the orders list keeps its compact rows (number, name, payment, state); the drawn cards with pictures and the day headings come with the one search bar.
- The orders list's search bar and filter folds keep their old shape (a labelled field with its own button, two folds); one bar with a
  *Filters* button is next with the customers list.
- The products list filters in the browser over every product the page reads; paging on the server (the audit's H7) comes with large
  catalogues, and a category filter with it.
- Settings no longer follows Basic/Advanced: the Website hub and the sidebars still do (`admin-view.spec.ts` moved to the Website hub).
