# The admin redesigned, round 1 (November 2026)

Decision D595. The owner asked, 14 November 2026, for the admin to be made less overwhelming, more focused, more graphical and more engaging,
from first principles, for a first-time owner (Homer) while every setting stays within reach (Lisa). Each round: proposals on a design
canvas beside screenshots of today's pages, iterated with the owner, then built and shipped to production one step at a time; then the next
pages. This round sets three patterns the rest of the admin reuses: the **dashboard** (Home), the **record** (an order) and the **editor**
(a product), plus Kaizena Flow's own Home and the frame around every page.

The proposals and the findings on today's pages are on the owner's design canvas (a private claude.ai artifact, "Admin redesign, round 1").

## Seven first principles

1. **One page, one question.** Each page answers the question Homer arrives with, in its title and on its first screen.
2. **One next step.** A single green button per page, chosen from the state of things.
3. **Show before you tell.** Product pictures in lists, a path for every process, a chart that tells one story, the shopper's own view.
4. **Numbers that mean something.** Every figure says what it is compared with.
5. **Depth, one step away.** Lisa's controls sit behind one fold per page, named for what is inside; nothing is removed, only moved.
6. **Reassure, then celebrate.** Say what happens next, confirm money before it moves, mark a new owner's milestones.
7. **Calm by default.** Meadow's rules hold (`docs/admin-style.md`).

## The owner's answers (14 November 2026)

- Ship to `main` as each step is done.
- The AI manager's button is a secondary button with a green sign; the page's own main action is its only green fill.
- The search in the top bar is a plain search icon (not a field with words).
- The greeting and milestones are the right tone.
- The phone's bottom bar and Kaizena Flow's own Home are part of this round.

## Steps and status

| Step | What | Status |
|---|---|---|
| 1 | The frame: a search icon opening the page finder (⌘K, Ctrl+K or `/`, audit D454 N6), the AI manager on ⌘J with a secondary button, the phone's bottom bar (`PhoneTabBar`) | Built |
| 2 | The store's Home: greeting and one sentence, *Next up*, the week as bars, latest orders with pictures, *Needs a look*, the setup ring, *Ask your AI manager*, milestones; the first week's path to opening | Built |
| 3 | Kaizena Flow's own Home in the same pattern: requests waiting as *Next up*, recurring revenue month by month with the target line, the funnel from sign-up to paying, *Running smoothly* apart from the business | Built |
| 4 | An order: state chips and a *Refund, cancel, more* menu in the header, the order's path, sending first, product pictures beside the items, *Refund or cancel* folded (opened from the menu), the refund button naming the amount and asking before money leaves | Built |
| 5 | A product: photos first, then the words (safety warnings, web address, excerpt and search results folded, open when warnings are written), price and stock, then categories; a *Draft / Published* switch; *What shoppers see* and *Ready to sell* beside it | Built |

## How it is built

- **The page finder** (`src/components/admin/page-finder.tsx`, `src/lib/page-finder.ts`): the search runs on the server
  (`findStorePagesAction`, `findPlatformPagesAction`) over the admin map, with the member's role and the store's features, so no screen
  loads the map. Only pages without params are offered. Advanced pages are found too: Basic hides links, never pages.
- **The phone's bottom bar**: under 768 px in the `rail` layout, the level's first four sections and *More* (the slide-out menu). The top
  bar's menu button is then shown only on tablets.
- **Home** (`src/app/admin/(gated)/[store]/page.tsx`, parts in `src/components/admin/home/`, words in `home.*.ts` under `today`, logic in
  `src/lib/home.ts`, reads in `src/server/home.ts`): every figure is counted in code from the store's rows (sales as the control center
  counts them: not cancelled, not a copy, payment captured). *Next up* is, in order: orders to send, the next setup step, the most urgent
  attention line, or *You're all caught up*. Attention lines are said without the store's name in front (audit N9). Every card Home had
  before is kept (Today, the Dream Factory, analytics alerts, the move watch, failed staff alerts, the briefing offer, demo content, the
  Basic hint).

- **Platform Home** (`src/app/admin/(gated)/platform/page.tsx`, reads in `src/server/platform-home.ts`): recurring revenue per month is
  worked back from `commerce.plan_moves` (live mode) from the current figure; the funnel counts the last six months' access requests,
  their stores, setup and live paying plans. Every figure the page had is kept (sales this month, targets, the briefing offer).
- **The order page**: `StepPath` (in `home-parts.tsx`) draws any process as a path; `FoldOnHash` and `MoreMenu`
  (`src/components/admin/orders/order-folds.tsx`). Nothing on the page was removed: the sections moved, and refund and cancel are one press away.
- **The product editor**: `ProductPreview` (`src/components/admin/product-preview.tsx`) and `readiness()` (`src/lib/product-readiness.ts`)
  read the editor's state; the preview is a sketch of the product page, *Open* shows the real one. Still to do from the proposal: one
  price field with the VAT split, the stock per option as steppers, and the jump list in *More options* (round 2, with the products list).
