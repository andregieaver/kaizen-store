# The admin redesigned, round 4 (November 2026)

Decision D612. Rounds 1 to 3 set the everyday pages; round 4 takes three places where an owner gives up: Marketing, which opened on an empty
list of campaigns; the product editor on a phone, 4,767 px tall with its options table running off the screen; and the support inbox, three
empty panes and seven controls. The proposals are on the owner's design canvas "Admin redesign, round 4"; the owner chose, 14 November 2026,
to build them as drawn.

## New rules from this round

- A section opens on what it does for the owner, not on its first tool.
- An empty page offers the next step ready-made, not a sentence about what could go there.
- On a phone, no table runs off the screen: a row becomes a card, and its rarer fields are one press away.
- The one button that saves stays within the thumb's reach.

## What was built

| Page | Built |
|---|---|
| Marketing | A first page of its own (`/admin/{store}/marketing`, the section's hub): a sentence on what brings people back and who came back (`customerCounts()`); the plays not yet running, each opening its setup (the email after a purchase, cart reminders, a first offer of 3 for 2 on the best seller by count, `bestSellerByCount()`); what runs now (automations that are on, with the emails sent in 30 days; cart reminders; the campaigns that are on, with their orders); the list's count; a broadcast; every tool by name. |
| A product on a phone | Save in a bar above the tab bar, saying whether anything is unsaved (the top bar's Save from Medium up); the photos, then the price and stock, then the words; each option a card (its name and stock first, its price with the country's name, then the SKU), its stock rules, quantities and codes behind *More for {name}*; the media limits left out on a phone. |
| Support inbox | A sentence on who waits for a person and the longest wait; presence, alerts and the AI partner in one menu (*Available · alerts on*); the tabs on one line, the search and filters behind a search button (open by themselves while one is in use); each conversation with initials, and the wait in the warning colour. The inbox is the same at every level, so Kaizena Flow's own desk has it too. |

## Different from the boards

- The plays open their setup pages rather than switching on at once: an email needs its words, and a campaign its product and dates.
- *Running now* says what each thing did that the store records (emails sent, a campaign's orders); what an email earned is not recorded,
  so it is not shown.
- An option's rarer settings open in place on a phone, not as a sheet over the page; there is no barcode scanner yet.
- The inbox does not yet say how many chats the AI answered by itself today, nor offer the AI's draft as a chip (the partner panel has it).
- Kaizena Flow's own marketing has no such first page yet: the platform's marketing tools are next.
