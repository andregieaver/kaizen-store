# Admin redesign, round 60: Move a domain, Footers and Draft orders on a phone

Decision D820, 19 November 2026. The boards are on the design canvas of round 60.

These were the tallest store pages on a phone that no round had reworked.

| Page | Before | After |
|---|---|---|
| Move a domain (`/settings/domains/move/{domain}`) | 804 px, 473 px wide | 664 px, 390 px wide |
| Footers (`/footers`) | 795 px | 664 px |
| Draft orders (`/orders/drafts`) | 788 px | 664 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Move a domain

- **The page is no wider than the phone.** The first choice's button did not wrap, so the page was 473 px wide.
- **One line says what it is:** *Choose what you want. Each step checks itself.*
- **The four choices are rows of one card that wrap**, each saying what it involves: *The transfer code, then the new registrar
  takes it*; *Download the records, check them there, switch*; *For another site or shop*; *Its DNS and its registration both move
  out*. The chosen one is marked while its steps show under it.

## Footers (and Headers, which share the list)

- **One line says what a footer is:** *The bottom of every page: logo, menus, business details, the cookies link.* (Headers: *The
  top of every page: logo, menus, search, account and cart.*)
- **No footers yet is a line**, not a card.
- **The footer in use is one row** saying which (*The standard footer*, or the one chosen), with *Change* opening the choice.

## Draft orders

- **One line says what a draft is:** *An order you make for a customer, who pays it through a link.*
- **The views are one line that scrolls.**
- **The limit is one line:** *0 of 500 open drafts. A draft holds no stock until it is sent.*
- **An empty list offers New draft order once:** the empty card says *No draft orders yet.* without a second button.

## How this differs from the boards

- **Footers:** the empty line keeps its words (*Make the first one with New footer*); the row's change is *Change*, as drawn.
- **Move a domain:** *Use it somewhere else* keeps its bracket, and its sub says what it is for rather than repeating it.

## Platform

- Kaizena Flow's own Headers and Footers (`/admin/platform/headers`, `/admin/platform/footers`) get the same line, empty line and row:
  the choice of the one in use is one component (`SiteLayoutChoice`) and the words are shared.
- Draft orders and moving a domain stay store-only (`docs/platform-parity.md`): Kaizena Flow sells plans, not goods, and its own
  domain is set in Vercel.

## Tests

- Lint, types and all unit tests pass (the strings scan caught a full intro written as text, fixed before the push).
- `quotes.spec.ts` (which opens Draft orders) and `prefetch.spec.ts` pass against a local build (12 tests). The home's prefetch test
  failed once on a notices feed that came late and passed when run again.
