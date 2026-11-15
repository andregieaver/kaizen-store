# The admin redesigned, round 8 (November 2026)

Decision D626. Round 8 takes three pages that opened on a form: the Team page, a role dropdown and a Change role button on every person,
two-step sign-in as a form and two invite cards that differ by one field; Segments, a paragraph and an empty box, with the six ready
segments only after New segment; and the product list on a phone, ten products in 4,488 px of pictures with the sold-out ones spread
among them. The proposals are on the owner's design canvas "Admin redesign, round 8"; the owner chose, 15 November 2026, to build them as
drawn.

## New rules from this round

- A list shows what each thing is in words; changing it is in its row's menu.
- Two forms that do almost the same are one form with a choice.
- An empty list offers what most shops make, with what it would hold now.
- On a phone, a list is rows a thumb can scan, never pictures a screen tall.

## What was built

| Page | Built |
|---|---|
| Team | A sentence on who works here and who has two-step sign-in; Roles and the Activity log under More, Invite someone the one button. Each person a row: their picture, name and email, "not signed in yet", their role as a chip, a collaborator's end date and their two-step state in words; Change role, Extend and Remove access in the row's ⋯ menu. One invite (email, role, Invite), with *For a limited time, as for an agency or a freelancer* one fold away (the collaborator's invite with its days). Two-step sign-in is one row with how many have it, the box and Save. |
| Segments | A sentence on what segments are. The ready segments not kept yet (D296's starters, the RFM ones once RFM means something) on the page itself, each with how many people it holds now (`countSegment()` over the people already read) and *Keep it* (`keepStarterAction()`, saved in the account's language, then opened); *Make your own* opens the rule builder. Kept segments are listed above under *Your segments*. |
| Products on a phone | Below `sm` each product is a row: a 48 px picture, the name, the price and one line of state with its action (Restock, Finish it). A sentence says how many are sold out; the chips scroll in one line; in All, sold-out products come first, then drafts; the view switch is left out on a phone; Add product is a wide button under the list. The grid of pictures stays from `sm` up. |

## Different from the boards

- Two-step sign-in keeps a box and Save rather than a switch that saves at once: the form works without script.
- On a phone, Current and Archived stay as tabs above the list rather than moving into More; the search stays in the page.
- The segment counts are the real ones; the board's were examples.
- Kaizena Flow's own team page (`/admin/platform/team`, D471) and its segments keep their present look: the same rows are their next step.
