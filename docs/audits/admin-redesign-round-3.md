# The admin redesigned, round 3 (November 2026)

Decision D603. Round 1 (D595) set the dashboard, the record and the editor; round 2 (D597) the list and the hub. Round 3 finishes the list
(one search bar with Filters, pictures on a phone), uses the hub for the website, and gives the numbers the home page's treatment. The
proposals are on the owner's design canvas "Admin redesign, round 3"; the owner chose, 14 November 2026, to build them as drawn.

## New rules from this round

- A destructive action is never the green button; it lives in a More menu, in the danger colour, and its own page asks first.
- A missing setup is said once, where it matters most, with its one button.
- An empty figure is left out, not shown as a dash.
- Dates in words near today ("Today", "3 days ago"), the day and month further back.

## What was built

| Page | Built |
|---|---|
| Customers list | A sentence on who bought, how many this month and how many came back (`customerCounts()`); three figures; views All, New, Came back, Subscribed (`?show=new\|back\|subscribed`); one search bar with *Filters* (the tag) inside it and an order menu (`?sort=orders\|name`); rows with initials, the town, pictures of the latest order, the last order in words and what they spent; ticking people brings a dark bar to add or take off a tag (`tagTickedAction`); tagging everyone the search finds is a fold under the list; import and export in *More*. |
| A customer | Chips under the name (New this month, the account), *Email {name}* beside a *More* menu (give an account, merge, download the data, erase in red); a strip for an order still waiting to be sent; Orders, Spent and Customer since; *What {name} has bought* with the pictures of each order; the timeline, the edit form and *Account and privacy* (the customer group, the Privacy card, the rest) as folds. The Privacy card's *Erase personal data* is a danger outline, no longer green. |
| Website | A sentence on what is live (`siteFacts()`); *View the shop* and *Edit the front page*; the front page drawn with the live theme at half size (`/admin/{store}/website/front`, the theme preview's view without its bar); the Dream Factory's box, whose words and ideas open the Dream Factory with the field filled (`?wish=`, owners only); the everyday parts each with its state; every other page of the section by name. |
| Analytics overview | *How you're doing* with the answer in a sentence and the period as one button (`AnalyticsHeader compact`); Needs you today; four figures (net revenue, orders, average order, new customers), those with a value; sales per day beside *Steps to see more* (costs, visit counting); a running target, when there is one; best sellers; every other section in *Every figure, compared*. |
| Orders list | The search bar from the customers list: one bar with *Filters* inside it, *Clear all* only while a filter is on; on a phone each row shows the order's pictures. |

## Left for later

- Kaizena Flow's own Website hub (`/admin/platform/website`) keeps the cards of `SectionHub`; the same page for the platform's site is the
  next step (its front page, its parts' states).
- The phone's day headings on the customers and orders lists ("Today", "Yesterday") are not drawn yet; the rows themselves are.
- No page of cards follows Basic/Advanced any more; the sidebars still do (`admin-view.spec.ts` now checks the Website sidebar).

## Fixed after

- A store without the online shop had a Products tab that opened on Custom fields, the only page left in its section. Custom fields is now
  marked `aside` in `store-nav.ts`: a tab never opens on it, and a section with only such pages left is not in the menu. Such a store finds
  Custom fields on its Website page, under Everything else.
